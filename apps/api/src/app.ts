import { Hono, type Context } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import {
  AuditResultSchema,
  CategoryEnum,
  MAX_CLAIM_LENGTH,
  MAX_CONTEXT_LENGTH,
  TTL_DURATION_MS,
} from "@geminihall/schema";
import { cacheIdentity } from "@geminihall/audit-core/identity";
import type { AppEnv } from "./env";
import type { AdminVerifier } from "./access";
import { errorBody } from "./http";

const MIN_TOKEN_LENGTH = 32;
const MAX_TOKEN_LENGTH = 256;
const MAX_SUBMISSION_BODY_BYTES = 64 * 1024;
const PAGE_SIZE = 50;
const HEX64 = /^[0-9a-f]{64}$/;
const SITE_URL = "https://geminihall.cc";

function xmlEscape(value: string): string {
  return value.replace(/[<>&'"]/gu, (char) => {
    switch (char) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
      default: return char;
    }
  });
}

type BoundedJsonResult = { kind: "ok"; value: unknown } | { kind: "invalid" } | { kind: "too_large" };

async function readBoundedJson(request: Request): Promise<BoundedJsonResult> {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) return { kind: "invalid" };
    if (Number(contentLength) > MAX_SUBMISSION_BODY_BYTES) return { kind: "too_large" };
  }

  const body = request.body;
  if (!body) return { kind: "invalid" };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_SUBMISSION_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The request is already being rejected; cancellation is best-effort.
        }
        return { kind: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { kind: "invalid" };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { kind: "ok", value: JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)) as unknown };
  } catch {
    return { kind: "invalid" };
  }
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function clientKeyHash(c: Context<AppEnv>): Promise<string | null> {
  const token = c.req.header("X-Client-Token");
  if (!token || token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) return null;
  return sha256Hex(token);
}

const SubmissionRequestSchema = z.object({
  original_claim: z.string().trim().min(1).max(MAX_CLAIM_LENGTH),
  context: z.string().max(MAX_CONTEXT_LENGTH).optional(),
  locale: z.string().min(2).max(16),
  consent_version: z.string().min(1),
  result: AuditResultSchema,
});

const ReviewRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("APPROVE"),
    submission_id: z.string().uuid(),
    sanitized_title: z.string().trim().min(1).max(200),
    sanitized_claim: z.string().trim().min(1).max(MAX_CLAIM_LENGTH),
    correction: z.string().trim().max(MAX_CLAIM_LENGTH).nullable().optional(),
    reason: z.string().max(2000).optional(),
  }),
  z.object({
    action: z.literal("REJECT"),
    submission_id: z.string().uuid(),
    reason: z.string().trim().min(1).max(2000),
  }),
  z.object({
    action: z.literal("RETRACT"),
    entry_id: z.string().uuid(),
    reason: z.string().trim().min(1).max(2000),
  }),
]);

interface SubmissionRow {
  submission_id: string;
  client_key_hash: string;
  claim_cache_key: string;
  original_claim: string;
  context: string | null;
  locale: string;
  result_json: string;
  provider: string;
  model: string;
  consent_version: string;
  review_state: "PENDING" | "APPROVED" | "REJECTED";
  created_at: string;
  updated_at: string;
}

interface EntryRow {
  entry_id: string;
  submission_id: string;
  claim_cache_key: string;
  publication_status: "PUBLISHED" | "RETRACTED";
  audit_status: string;
  category: string | null;
  severity_score: number | null;
  sanitized_title: string;
  sanitized_claim: string;
  correction: string | null;
  evidence_json: string;
  audit_trace_json: string;
  limitations_json: string;
  estimated_error_pattern: string | null;
  ttl_category: string;
  provider: string;
  model: string;
  verified_at: string;
  expires_at: string;
  published_at: string;
}

function publicEntry(row: EntryRow, nowIso: string) {
  if (row.publication_status === "RETRACTED") {
    return {
      entry_id: row.entry_id,
      publication_status: row.publication_status,
      sanitized_title: row.sanitized_title,
      published_at: row.published_at,
    };
  }
  return {
    entry_id: row.entry_id,
    publication_status: row.publication_status,
    claim_cache_key: row.claim_cache_key,
    audit_status: row.audit_status,
    category: row.category,
    severity_score: row.severity_score,
    sanitized_title: row.sanitized_title,
    sanitized_claim: row.sanitized_claim,
    correction: row.correction,
    evidence_sources: JSON.parse(row.evidence_json) as unknown,
    audit_trace: JSON.parse(row.audit_trace_json) as unknown,
    limitations: JSON.parse(row.limitations_json) as unknown,
    estimated_error_pattern: row.estimated_error_pattern,
    ttl_category: row.ttl_category,
    auditor: { provider: row.provider, model: row.model },
    verified_at: row.verified_at,
    expires_at: row.expires_at,
    is_expired: row.expires_at <= nowIso,
    published_at: row.published_at,
  };
}

export function createApp(verifyAdmin: AdminVerifier, clock: () => number = Date.now) {
  const app = new Hono<AppEnv>();
  const nowIso = () => new Date(clock()).toISOString();

  app.use(
    "/api/*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'none'"],
      },
      referrerPolicy: "strict-origin-when-cross-origin",
      strictTransportSecurity: "max-age=31536000",
      xContentTypeOptions: "nosniff",
      xFrameOptions: "DENY",
    }),
  );

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/sitemap.xml", async (c) => {
    const { results } = await c.env.DB.prepare(
      "SELECT entry_id, published_at FROM public_entries WHERE publication_status = 'PUBLISHED' AND expires_at > ? ORDER BY published_at DESC LIMIT 49998",
    )
      .bind(nowIso())
      .all<{ entry_id: string; published_at: string }>();
    const urls = [
      `<url><loc>${SITE_URL}/</loc></url>`,
      `<url><loc>${SITE_URL}/about</loc></url>`,
      ...results.map((entry) => {
        const loc = xmlEscape(`${SITE_URL}/entries/${encodeURIComponent(entry.entry_id)}`);
        const lastmod = xmlEscape(entry.published_at);
        return `<url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>`;
      }),
    ].join("");
    return c.body(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, 200, {
      "Cache-Control": "public, max-age=300",
      "Content-Type": "application/xml; charset=UTF-8",
    });
  });

  app.post("/api/submissions", async (c) => {
    const owner = await clientKeyHash(c);
    if (!owner) return c.json(errorBody("UNAUTHORIZED_REQUEST_ACCESS", "クライアントトークンがありません。"), 403);

    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    if (c.env.SUBMIT_LIMITER) {
      const { success } = await c.env.SUBMIT_LIMITER.limit({ key: ip });
      if (!success) return c.json(errorBody("RATE_LIMITED", "申請が多すぎます。時間をおいてから申請してください。"), 429);
    }
    if (c.env.SUBMIT_TOKEN_LIMITER) {
      const { success } = await c.env.SUBMIT_TOKEN_LIMITER.limit({ key: owner });
      if (!success) return c.json(errorBody("RATE_LIMITED", "申請が多すぎます。時間をおいてから申請してください。"), 429);
    }

    const rawBody = await readBoundedJson(c.req.raw);
    if (rawBody.kind === "too_large") {
      return c.json(errorBody("INVALID_INPUT", "リクエスト本文が大きすぎます。"), 413);
    }
    if (rawBody.kind === "invalid") {
      return c.json(errorBody("INVALID_INPUT", "リクエスト本文が JSON ではありません。"), 400);
    }
    const parsed = SubmissionRequestSchema.safeParse(rawBody.value);
    if (!parsed.success) return c.json(errorBody("INVALID_INPUT", "申請内容が不正です。"), 400);
    const body = parsed.data;
    const result = body.result;
    const submissionId = result.request_id;

    if (Date.parse(result.verified_at) > clock()) {
      return c.json(errorBody("INVALID_INPUT", "監査日時が未来になっています。", submissionId), 400);
    }

    if (result.mode !== "LIVE") {
      return c.json(errorBody("INVALID_INPUT", "DEMO の結果は申請できません。", submissionId), 400);
    }
    if (body.consent_version !== c.env.CONSENT_VERSION) {
      return c.json(errorBody("INVALID_INPUT", "同意文が更新されています。もう一度確認してから申請してください。", submissionId), 400);
    }
    const identity = await cacheIdentity({ claim: body.original_claim, context: body.context, locale: body.locale });
    if (
      identity.normalizedClaim !== result.normalized_claim ||
      identity.contextFingerprint !== result.context_fingerprint
    ) {
      return c.json(errorBody("INVALID_INPUT", "監査結果と元の主張が一致しません。", submissionId), 400);
    }

    const existing = await c.env.DB.prepare("SELECT * FROM submissions WHERE submission_id = ?")
      .bind(submissionId)
      .first<SubmissionRow>();
    if (existing) {
      if (existing.client_key_hash !== owner) {
        return c.json(errorBody("UNAUTHORIZED_REQUEST_ACCESS", "この申請を参照する権限がありません。"), 403);
      }
      return c.json({ submission_id: submissionId, review_state: existing.review_state }, 200);
    }

    const now = nowIso();
    await c.env.DB.prepare(
      `INSERT INTO submissions
         (submission_id, client_key_hash, claim_cache_key, original_claim, context, locale, result_json, provider, model, consent_version, review_state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
    )
      .bind(
        submissionId,
        owner,
        identity.claimCacheKey,
        body.original_claim,
        body.context ?? null,
        body.locale,
        JSON.stringify(result),
        result.auditor.provider,
        result.auditor.model,
        body.consent_version,
        now,
        now,
      )
      .run();
    return c.json({ submission_id: submissionId, review_state: "PENDING" }, 201);
  });

  app.get("/api/submissions/:id", async (c) => {
    const owner = await clientKeyHash(c);
    const row = owner
      ? await c.env.DB.prepare("SELECT * FROM submissions WHERE submission_id = ?").bind(c.req.param("id")).first<SubmissionRow>()
      : null;
    if (!owner || !row || row.client_key_hash !== owner) {
      return c.json(errorBody("UNAUTHORIZED_REQUEST_ACCESS", "この申請を参照する権限がありません。"), 403);
    }
    const entry = await c.env.DB.prepare("SELECT entry_id, publication_status FROM public_entries WHERE submission_id = ?")
      .bind(row.submission_id)
      .first<{ entry_id: string; publication_status: string }>();
    return c.json({
      submission_id: row.submission_id,
      review_state: row.review_state,
      created_at: row.created_at,
      updated_at: row.updated_at,
      entry_id: entry?.entry_id ?? null,
      publication_status: entry?.publication_status ?? null,
    });
  });

  app.get("/api/public/lookup", async (c) => {
    const key = c.req.query("key") ?? "";
    if (!HEX64.test(key)) return c.json(errorBody("INVALID_INPUT", "キーの形式が不正です。"), 400);
    const now = nowIso();
    const row = await c.env.DB.prepare(
      `SELECT * FROM public_entries
        WHERE claim_cache_key = ? AND publication_status = 'PUBLISHED' AND expires_at > ?
        ORDER BY published_at DESC LIMIT 1`,
    )
      .bind(key, now)
      .first<EntryRow>();
    if (!row) return c.json(errorBody("NOT_FOUND", "公開済みの事例はありません。"), 404);
    return c.json({ entry: publicEntry(row, now) });
  });

  app.get("/api/public/entries", async (c) => {
    const category = c.req.query("category");
    if (category && !CategoryEnum.safeParse(category).success) {
      return c.json(errorBody("INVALID_INPUT", "カテゴリが不正です。"), 400);
    }
    const before = c.req.query("before");
    if (before !== undefined && !z.string().datetime().safeParse(before).success) {
      return c.json(errorBody("INVALID_INPUT", "日時カーソルが不正です。"), 400);
    }
    const params: unknown[] = [];
    let sql = "SELECT * FROM public_entries WHERE publication_status = 'PUBLISHED'";
    if (category) {
      sql += " AND category = ?";
      params.push(category);
    }
    if (before) {
      sql += " AND published_at < ?";
      params.push(before);
    }
    sql += " ORDER BY published_at DESC LIMIT ?";
    params.push(PAGE_SIZE + 1);
    const { results } = await c.env.DB.prepare(sql).bind(...params).all<EntryRow>();
    const now = nowIso();
    const page = results.slice(0, PAGE_SIZE);
    return c.json({
      entries: page.map((r) => publicEntry(r, now)),
      next_before: results.length > PAGE_SIZE ? page[page.length - 1]!.published_at : null,
    });
  });

  app.get("/api/public/entries/:id", async (c) => {
    const row = await c.env.DB.prepare("SELECT * FROM public_entries WHERE entry_id = ?")
      .bind(c.req.param("id"))
      .first<EntryRow>();
    if (!row) return c.json(errorBody("NOT_FOUND", "事例が見つかりません。"), 404);
    return c.json({ entry: publicEntry(row, nowIso()) });
  });

  app.use("/api/admin/*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.header("X-GeminiHall-Admin") !== "1") {
      return c.json(errorBody("UNAUTHORIZED_REQUEST_ACCESS", "管理画面以外からの操作は受け付けません。"), 403);
    }
    const reviewer = await verifyAdmin(c.req.raw, c.env);
    if (!reviewer) return c.json(errorBody("UNAUTHORIZED_REQUEST_ACCESS", "管理者として認証されていません。"), 403);
    c.set("reviewerId", reviewer);
    await next();
  });

  app.get("/api/admin/submissions", async (c) => {
    const state = c.req.query("state") ?? "PENDING";
    if (!["PENDING", "APPROVED", "REJECTED"].includes(state)) {
      return c.json(errorBody("INVALID_INPUT", "状態が不正です。"), 400);
    }
    const { results } = await c.env.DB.prepare(
      `SELECT submission_id, original_claim, provider, model, review_state, created_at
         FROM submissions WHERE review_state = ? ORDER BY created_at ASC LIMIT ?`,
    )
      .bind(state, PAGE_SIZE)
      .all();
    return c.json({ submissions: results });
  });

  app.get("/api/admin/me", (c) => c.json({ reviewer: c.get("reviewerId") }));

  app.get("/api/admin/submissions/:id", async (c) => {
    const row = await c.env.DB.prepare("SELECT * FROM submissions WHERE submission_id = ?")
      .bind(c.req.param("id"))
      .first<SubmissionRow>();
    if (!row) return c.json(errorBody("NOT_FOUND", "申請が見つかりません。"), 404);
    const { client_key_hash: _owner, result_json, ...rest } = row;
    const reviews = await c.env.DB.prepare(
      "SELECT review_id, entry_id, reviewer_id, action, reason, created_at FROM publication_reviews WHERE submission_id = ? ORDER BY created_at",
    )
      .bind(row.submission_id)
      .all();
    return c.json({ submission: { ...rest, result: JSON.parse(result_json) as unknown }, reviews: reviews.results });
  });

  app.post("/api/admin/reviews", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(errorBody("INVALID_INPUT", "リクエスト本文が JSON ではありません。"), 400);
    }
    const parsed = ReviewRequestSchema.safeParse(raw);
    if (!parsed.success) return c.json(errorBody("INVALID_INPUT", "審査内容が不正です。"), 400);
    const review = parsed.data;
    const db = c.env.DB;
    const reviewer = c.get("reviewerId");
    const now = nowIso();
    const reviewId = crypto.randomUUID();

    if (review.action === "RETRACT") {
      const entry = await db.prepare("SELECT * FROM public_entries WHERE entry_id = ?").bind(review.entry_id).first<EntryRow>();
      if (!entry) return c.json(errorBody("NOT_FOUND", "事例が見つかりません。"), 404);
      if (entry.publication_status === "RETRACTED") {
        return c.json(errorBody("INVALID_INPUT", "この事例はすでに撤回済みです。"), 409);
      }
      await db.batch([
        db.prepare("UPDATE public_entries SET publication_status = 'RETRACTED' WHERE entry_id = ? AND publication_status = 'PUBLISHED'").bind(entry.entry_id),
        db
          .prepare(
            "INSERT INTO publication_reviews (review_id, submission_id, entry_id, reviewer_id, action, reason, created_at) VALUES (?, ?, ?, ?, 'RETRACT', ?, ?)",
          )
          .bind(reviewId, entry.submission_id, entry.entry_id, reviewer, review.reason, now),
      ]);
      return c.json({ review_id: reviewId, entry_id: entry.entry_id, publication_status: "RETRACTED" });
    }

    const submission = await db.prepare("SELECT * FROM submissions WHERE submission_id = ?")
      .bind(review.submission_id)
      .first<SubmissionRow>();
    if (!submission) return c.json(errorBody("NOT_FOUND", "申請が見つかりません。"), 404);
    if (submission.review_state !== "PENDING") {
      return c.json(errorBody("INVALID_INPUT", "この申請はすでに審査済みです。"), 409);
    }

    if (review.action === "REJECT") {
      const results = await db.batch([
        db
          .prepare("UPDATE submissions SET review_state = 'REJECTED', updated_at = ? WHERE submission_id = ? AND review_state = 'PENDING'")
          .bind(now, submission.submission_id),
        db
          .prepare(
            `INSERT INTO publication_reviews (review_id, submission_id, entry_id, reviewer_id, action, reason, created_at)
             SELECT ?, ?, NULL, ?, 'REJECT', ?, ? WHERE changes() = 1`,
          )
          .bind(reviewId, submission.submission_id, reviewer, review.reason, now),
      ]);
      if ((results[0]?.meta.changes ?? 0) !== 1) {
        return c.json(errorBody("INVALID_INPUT", "この申請はすでに審査済みです。"), 409);
      }
      return c.json({ review_id: reviewId, submission_id: submission.submission_id, review_state: "REJECTED" });
    }

    const result = AuditResultSchema.parse(JSON.parse(submission.result_json));
    const verifiedAtMs = Date.parse(result.verified_at);
    if (!Number.isFinite(verifiedAtMs) || verifiedAtMs > clock()) {
      return c.json(errorBody("INVALID_INPUT", "監査日時が未来になっています。", submission.submission_id), 400);
    }
    const expiresAt = new Date(verifiedAtMs + TTL_DURATION_MS[result.ttl_category]).toISOString();
    const correction =
      result.audit_status === "UNVERIFIED_OR_AMBIGUOUS"
        ? null
        : review.correction === undefined
          ? result.correction
          : review.correction;
    if (result.audit_status === "CONFIRMED_HALLUCINATION" && !correction) {
      return c.json(errorBody("INVALID_INPUT", "誤りを確認した事例には訂正文が必要です。"), 400);
    }
    const entryId = crypto.randomUUID();
    const results = await db.batch([
      db
        .prepare("UPDATE submissions SET review_state = 'APPROVED', updated_at = ? WHERE submission_id = ? AND review_state = 'PENDING'")
        .bind(now, submission.submission_id),
      db
        .prepare(
          `INSERT INTO public_entries
             (entry_id, submission_id, claim_cache_key, publication_status, audit_status, category, severity_score,
              sanitized_title, sanitized_claim, correction, evidence_json, audit_trace_json, limitations_json,
              estimated_error_pattern, ttl_category, provider, model, verified_at, expires_at, published_at)
           SELECT ?, ?, ?, 'PUBLISHED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
        )
        .bind(
          entryId,
          submission.submission_id,
          submission.claim_cache_key,
          result.audit_status,
          result.category,
          result.severity_score,
          review.sanitized_title,
          review.sanitized_claim,
          correction,
          JSON.stringify(result.evidence_sources),
          JSON.stringify(result.audit_trace),
          JSON.stringify(result.limitations),
          result.estimated_error_pattern,
          result.ttl_category,
          result.auditor.provider,
          result.auditor.model,
          result.verified_at,
          expiresAt,
          now,
        ),
      db
        .prepare(
          `INSERT INTO publication_reviews (review_id, submission_id, entry_id, reviewer_id, action, reason, created_at)
           SELECT ?, ?, ?, ?, 'APPROVE', ?, ? WHERE changes() = 1`,
        )
        .bind(reviewId, submission.submission_id, entryId, reviewer, review.reason ?? null, now),
    ]);
    if ((results[0]?.meta.changes ?? 0) !== 1) {
      return c.json(errorBody("INVALID_INPUT", "この申請はすでに審査済みです。"), 409);
    }
    return c.json({ review_id: reviewId, submission_id: submission.submission_id, entry_id: entryId, publication_status: "PUBLISHED" });
  });

  app.notFound((c) => c.json(errorBody("NOT_FOUND", "見つかりません。"), 404));
  app.onError((_err, c) => c.json(errorBody("INTERNAL_ERROR", "サーバーで処理できませんでした。"), 500));

  return app;
}

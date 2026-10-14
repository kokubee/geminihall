import { describe, expect, it } from "vitest";
import { cacheIdentity } from "@geminihall/audit-core/identity";
import { ADMIN_HEADER, CONSENT, TOKEN_A, TOKEN_B, approve, call, postJson, setNow, submit } from "./helpers";

const ADMIN = { [ADMIN_HEADER]: "admin@example.com" };

describe("submissions", () => {
  it("accepts a valid submission and is idempotent for the owner", async () => {
    const { res, result } = await submit("日本国憲法は1950年に施行された", TOKEN_A);
    expect(res.status).toBe(201);
    const again = await postJson(
      "/api/submissions",
      { original_claim: "日本国憲法は1950年に施行された", locale: "ja", consent_version: CONSENT, result },
      { "X-Client-Token": TOKEN_A },
    );
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ review_state: "PENDING" });
  });

  it("rejects missing or short client tokens", async () => {
    const { res } = await submit("主張A", "short");
    expect(res.status).toBe(403);
  });

  it("rejects an outdated consent version", async () => {
    const { buildResult } = await import("./helpers");
    const result = await buildResult("主張B");
    const res = await postJson(
      "/api/submissions",
      { original_claim: "主張B", locale: "ja", consent_version: "old", result },
      { "X-Client-Token": TOKEN_A },
    );
    expect(res.status).toBe(400);
  });

  it("rejects a result whose normalized claim does not match the submitted claim", async () => {
    const { buildResult } = await import("./helpers");
    const result = await buildResult("本当の主張");
    const res = await postJson(
      "/api/submissions",
      { original_claim: "差し替えた主張", locale: "ja", consent_version: CONSENT, result },
      { "X-Client-Token": TOKEN_A },
    );
    expect(res.status).toBe(400);
  });

  it("rejects results that break the audit invariants", async () => {
    const { res } = await submit("主張C", TOKEN_A, { evidence_status: "INSUFFICIENT" });
    expect(res.status).toBe(400);
  });

  it("rejects DEMO results", async () => {
    const { res } = await submit("主張D", TOKEN_A, { mode: "DEMO" });
    expect(res.status).toBe(400);
  });

  it("blocks re-submitting another client's submission id", async () => {
    const { result } = await submit("主張E", TOKEN_A);
    const res = await postJson(
      "/api/submissions",
      { original_claim: "主張E", locale: "ja", consent_version: CONSENT, result },
      { "X-Client-Token": TOKEN_B },
    );
    expect(res.status).toBe(403);
  });
});

describe("受入2: submission ownership", () => {
  it("returns 403 for another token or no token, 200 for the owner", async () => {
    const { result } = await submit("主張F", TOKEN_A);
    const path = `/api/submissions/${result.request_id}`;
    expect((await call(path, { headers: { "X-Client-Token": TOKEN_A } })).status).toBe(200);
    const other = await call(path, { headers: { "X-Client-Token": TOKEN_B } });
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ error: { code: "UNAUTHORIZED_REQUEST_ACCESS" } });
    expect((await call(path)).status).toBe(403);
  });
});

describe("受入3: only approved entries are public", () => {
  it("hides pending, rejected and retracted entries from lookup and listing", async () => {
    const pending = await submit("保留中の主張", TOKEN_A);
    const rejected = await submit("却下される主張", TOKEN_A);
    const approved = await submit("承認される主張", TOKEN_A);
    const retracted = await submit("撤回される主張", TOKEN_A);

    const rej = await postJson("/api/admin/reviews", { action: "REJECT", submission_id: rejected.result.request_id, reason: "根拠が不十分" }, ADMIN);
    expect(rej.status).toBe(200);
    expect((await approve(approved.result.request_id)).status).toBe(200);
    const ret = (await (await approve(retracted.result.request_id)).json()) as { entry_id: string };
    expect(
      (await postJson("/api/admin/reviews", { action: "RETRACT", entry_id: ret.entry_id, reason: "誤りが見つかった" }, ADMIN)).status,
    ).toBe(200);

    const key = async (claim: string) => (await cacheIdentity({ claim, locale: "ja" })).claimCacheKey;
    expect((await call(`/api/public/lookup?key=${await key("保留中の主張")}`)).status).toBe(404);
    expect((await call(`/api/public/lookup?key=${await key("却下される主張")}`)).status).toBe(404);
    expect((await call(`/api/public/lookup?key=${await key("撤回される主張")}`)).status).toBe(404);
    const hit = await call(`/api/public/lookup?key=${await key("承認される主張")}`);
    expect(hit.status).toBe(200);
    const hitBody = (await hit.json()) as { entry: Record<string, unknown> };
    expect(hitBody.entry.sanitized_title).toBe("施行年の誤り");
    expect(hitBody.entry).not.toHaveProperty("original_claim");
    expect(JSON.stringify(hitBody)).not.toContain("client_key_hash");

    const list = (await (await call("/api/public/entries")).json()) as { entries: { sanitized_title: string }[] };
    expect(list.entries).toHaveLength(1);

    const retractedEntry = (await (await call(`/api/public/entries/${ret.entry_id}`)).json()) as { entry: Record<string, unknown> };
    expect(retractedEntry.entry.publication_status).toBe("RETRACTED");
    expect(retractedEntry.entry).not.toHaveProperty("evidence_sources");

    expect(pending.res.status).toBe(201);
  });

  it("stops returning an entry from lookup after it expires", async () => {
    const s = await submit("期限切れになる主張", TOKEN_A, { expires_at: "2026-10-16T00:00:00.000Z" });
    await approve(s.result.request_id);
    const key = (await cacheIdentity({ claim: "期限切れになる主張", locale: "ja" })).claimCacheKey;
    expect((await call(`/api/public/lookup?key=${key}`)).status).toBe(200);
    setNow("2026-10-17T00:00:00.000Z");
    expect((await call(`/api/public/lookup?key=${key}`)).status).toBe(404);
    setNow("2026-10-15T00:00:00.000Z");
  });

  it("does not let a private submission leak to another client through lookup", async () => {
    await submit("ユーザーAだけの主張", TOKEN_A);
    const key = (await cacheIdentity({ claim: "ユーザーAだけの主張", locale: "ja" })).claimCacheKey;
    expect((await call(`/api/public/lookup?key=${key}`, { headers: { "X-Client-Token": TOKEN_B } })).status).toBe(404);
  });
});

describe("admin", () => {
  it("rejects requests without admin identity", async () => {
    expect((await call("/api/admin/submissions")).status).toBe(403);
    expect((await postJson("/api/admin/reviews", { action: "REJECT", submission_id: crypto.randomUUID(), reason: "x" })).status).toBe(403);
  });

  it("records the reviewer and refuses to review twice", async () => {
    const s = await submit("二重審査の主張", TOKEN_A);
    expect((await approve(s.result.request_id)).status).toBe(200);
    expect((await approve(s.result.request_id)).status).toBe(409);
    const detail = (await (await call(`/api/admin/submissions/${s.result.request_id}`, { headers: ADMIN })).json()) as {
      submission: Record<string, unknown>;
      reviews: { reviewer_id: string; action: string }[];
    };
    expect(detail.submission).not.toHaveProperty("client_key_hash");
    expect(detail.reviews).toEqual([expect.objectContaining({ reviewer_id: "admin@example.com", action: "APPROVE" })]);
  });

  it("does not publish a correction for an abstained result", async () => {
    const s = await submit("保留の主張", TOKEN_A, {
      audit_status: "UNVERIFIED_OR_AMBIGUOUS",
      evidence_status: "INSUFFICIENT",
      hallucinated_claim: null,
      correction: null,
      category: null,
      severity_score: null,
      limitations: ["一次資料がない"],
      audit_trace: {
        decomposed_claims: [{ sub_claim: "保留の主張", verification_target: "x", status: "UNVERIFIABLE" }],
        alignment_reasoning: "根拠不足",
        abstention_reason: "一次資料がない",
      },
    });
    expect(s.res.status).toBe(201);
    const res = await postJson(
      "/api/admin/reviews",
      { action: "APPROVE", submission_id: s.result.request_id, sanitized_title: "t", sanitized_claim: "c", correction: "勝手な訂正" },
      ADMIN,
    );
    const body = (await res.json()) as { entry_id: string };
    const entry = (await (await call(`/api/public/entries/${body.entry_id}`)).json()) as { entry: { correction: unknown } };
    expect(entry.entry.correction).toBeNull();
  });
});

describe("public listing", () => {
  it("validates the category filter", async () => {
    expect((await call("/api/public/entries?category=Nope")).status).toBe(400);
    expect((await call("/api/public/entries?category=Chronological_Error")).status).toBe(200);
  });

  it("validates the lookup key format", async () => {
    expect((await call("/api/public/lookup?key=abc")).status).toBe(400);
  });
});

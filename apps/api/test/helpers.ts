import { env } from "cloudflare:test";
import { cacheIdentity } from "@geminihall/audit-core/identity";
import type { AuditResult } from "@geminihall/schema";
import { createApp } from "../src/app";

export const ADMIN_HEADER = "X-Test-Admin";
export const TOKEN_A = "a".repeat(40);
export const TOKEN_B = "b".repeat(40);
export const CONSENT = "2026-10-15";

let nowMs = Date.parse("2026-10-15T00:00:00.000Z");
export function setNow(iso: string) {
  nowMs = Date.parse(iso);
}

export const app = createApp(async (req) => req.headers.get(ADMIN_HEADER), () => nowMs);

export function call(path: string, init: RequestInit = {}) {
  return app.request(path, init, env);
}

export function postJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  return call(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

export async function buildResult(claim: string, overrides: Partial<AuditResult> = {}): Promise<AuditResult> {
  const id = await cacheIdentity({ claim, locale: "ja" });
  return {
    request_id: crypto.randomUUID(),
    mode: "LIVE",
    auditor: { provider: "ANTHROPIC", model: "claude-opus-5-5" },
    is_valid_input: true,
    contains_pii: false,
    audit_status: "CONFIRMED_HALLUCINATION",
    evidence_status: "VERIFIED",
    severity_score: 3,
    category: "Chronological_Error",
    ttl_category: "HISTORICAL_FACT",
    verified_at: "2026-10-15T00:00:00.000Z",
    expires_at: "2026-11-14T00:00:00.000Z",
    evidence_checked_at: "2026-10-15T00:00:00.000Z",
    normalized_claim: id.normalizedClaim,
    context_fingerprint: id.contextFingerprint,
    audit_trace: {
      decomposed_claims: [{ sub_claim: claim, verification_target: "施行日", status: "CONTRADICTED" }],
      alignment_reasoning: "資料と矛盾する。",
      abstention_reason: null,
    },
    hallucinated_claim: claim,
    correction: "1947年5月3日に施行された",
    unverified_notes: null,
    evidence_sources: [{ title: "資料", url: "https://www.example.go.jp/a", snippet: "昭和22年5月3日施行", verified: true }],
    estimated_error_pattern: null,
    limitations: [],
    ...overrides,
  };
}

export async function submit(claim: string, token: string, overrides: Partial<AuditResult> = {}) {
  const result = await buildResult(claim, overrides);
  const res = await postJson(
    "/api/submissions",
    { original_claim: claim, locale: "ja", consent_version: CONSENT, result },
    { "X-Client-Token": token },
  );
  return { res, result };
}

export async function approve(submissionId: string) {
  return postJson(
    "/api/admin/reviews",
    { action: "APPROVE", submission_id: submissionId, sanitized_title: "施行年の誤り", sanitized_claim: "施行年を取り違えた主張" },
    { [ADMIN_HEADER]: "admin@example.com" },
  );
}

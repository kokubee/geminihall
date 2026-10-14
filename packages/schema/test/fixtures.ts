import type { AuditResult } from "../src/index";

export function baseResult(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    request_id: "550e8400-e29b-41d4-a716-446655440000",
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
    normalized_claim: "日本国憲法は1950年に施行された",
    context_fingerprint: "abc",
    audit_trace: {
      decomposed_claims: [
        {
          sub_claim: "日本国憲法の施行年は1950年である",
          verification_target: "日本国憲法の施行日",
          status: "CONTRADICTED",
        },
      ],
      alignment_reasoning: "施行日は1947年5月3日であり、主張と矛盾する。",
      abstention_reason: null,
    },
    hallucinated_claim: "日本国憲法は1950年に施行された",
    correction: "日本国憲法は1947年5月3日に施行された",
    unverified_notes: null,
    evidence_sources: [
      {
        title: "日本国憲法",
        url: "https://www.example.go.jp/constitution",
        snippet: "昭和22年5月3日施行",
        verified: true,
      },
    ],
    estimated_error_pattern: "年号の取り違え",
    limitations: [],
    ...overrides,
  };
}

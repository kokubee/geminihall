import { describe, expect, it } from "vitest";
import type { AuditResult } from "@geminihall/schema";
import { cacheIdentity } from "@geminihall/audit-core/identity";
import { AUDIT_CASES, CACHE_PAIR_CASES, CONTEXT_PAIR_CASES } from "../src/cases";
import { computeMetrics, correctionMentions, snippetMatches, type CaseOutcome } from "../src/metrics";

function result(status: AuditResult["audit_status"], extra: Partial<AuditResult> = {}): AuditResult {
  return {
    request_id: "550e8400-e29b-41d4-a716-446655440000",
    mode: "LIVE",
    auditor: { provider: "ANTHROPIC", model: "m" },
    is_valid_input: true,
    contains_pii: false,
    audit_status: status,
    evidence_status: status === "UNVERIFIED_OR_AMBIGUOUS" ? "INSUFFICIENT" : "VERIFIED",
    severity_score: null,
    category: null,
    ttl_category: "HISTORICAL_FACT",
    verified_at: "2026-10-15T00:00:00.000Z",
    expires_at: "2026-11-14T00:00:00.000Z",
    evidence_checked_at: null,
    normalized_claim: "x",
    context_fingerprint: "y",
    audit_trace: {
      decomposed_claims: [{ sub_claim: "x", verification_target: "y", status: "UNVERIFIABLE" }],
      alignment_reasoning: "r",
      abstention_reason: status === "UNVERIFIED_OR_AMBIGUOUS" ? "根拠不足" : null,
    },
    hallucinated_claim: null,
    correction: null,
    unverified_notes: null,
    evidence_sources: [],
    estimated_error_pattern: null,
    limitations: status === "UNVERIFIED_OR_AMBIGUOUS" ? ["x"] : [],
    ...extra,
  };
}

const outcome = (id: string, r: AuditResult | null): CaseOutcome => ({
  case: AUDIT_CASES.find((c) => c.id === id)!,
  result: r,
  downgraded: false,
  error: r ? null : "fail",
  seconds: 1,
});

describe("dataset", () => {
  it("has 8 errors, 5 correct, 5 ambiguous and 2 cache pairs", () => {
    const count = (k: string) => AUDIT_CASES.filter((c) => c.kind === k).length;
    expect([count("FACTUAL_ERROR"), count("CORRECT"), count("AMBIGUOUS"), CACHE_PAIR_CASES.length]).toEqual([8, 5, 5, 2]);
  });

  it("gives every factual error a primary source and expected correction token", () => {
    for (const c of AUDIT_CASES.filter((c) => c.kind === "FACTUAL_ERROR")) {
      expect(c.primarySource).toMatch(/^https:\/\//);
      expect(c.expectedCorrectionTokens?.length).toBeGreaterThan(0);
    }
  });

  it("keeps cache boundary pairs on different keys", async () => {
    for (const p of [...CACHE_PAIR_CASES, ...CONTEXT_PAIR_CASES]) {
      const a = await cacheIdentity({ ...p.a, locale: "ja" });
      const b = await cacheIdentity({ ...p.b, locale: "ja" });
      expect(a.claimCacheKey).not.toBe(b.claimCacheKey);
    }
  });
});

describe("metrics", () => {
  it("counts false corrections over correct and ambiguous cases", () => {
    const m = computeMetrics(
      [
        outcome("C1", result("CONFIRMED_HALLUCINATION", { correction: "x" })),
        outcome("C2", result("SUPPORTED_CLAIM")),
        outcome("A1", result("UNVERIFIED_OR_AMBIGUOUS")),
        outcome("A2", result("CONFIRMED_HALLUCINATION", { correction: "x" })),
      ],
      [],
      [],
    );
    expect(m.falseCorrectionRate).toMatchObject({ numerator: 2, denominator: 4 });
    expect(m.abstentionAccuracy).toMatchObject({ numerator: 1, denominator: 2 });
    expect(m.supportedClaimRate).toMatchObject({ numerator: 1, denominator: 2 });
  });

  it("requires the expected token in the correction for error detection", () => {
    const m = computeMetrics(
      [
        outcome("E1", result("CONFIRMED_HALLUCINATION", { correction: "施行は１９４７年５月３日" })),
        outcome("E2", result("CONFIRMED_HALLUCINATION", { correction: "高さは600m" })),
        outcome("E3", null),
      ],
      [],
      [],
    );
    expect(m.errorDetectionRate).toMatchObject({ numerator: 1, denominator: 3 });
    expect(m.auditFailures).toBe(1);
  });

  it("excludes alive sources whose text could not be read from the grounding denominator", () => {
    const m = computeMetrics(
      [],
      [
        { caseId: "E1", url: "a", verified: true, status: 200, alive: true, snippetMatch: true },
        { caseId: "E1", url: "b", verified: true, status: 200, alive: true, snippetMatch: false },
        { caseId: "E1", url: "c", verified: true, status: 200, alive: true, snippetMatch: null },
        { caseId: "E1", url: "d", verified: true, status: 404, alive: false, snippetMatch: null },
      ],
      [],
    );
    expect(m.evidenceGroundingRate).toMatchObject({ numerator: 1, denominator: 3 });
    expect(m.sourceAliveRate).toMatchObject({ numerator: 3, denominator: 4 });
  });
});

describe("helpers", () => {
  it("matches snippets by character trigrams after normalization", () => {
    expect(snippetMatches("昭和22年5月3日から施行", "日本国憲法は 昭和２２年５月３日から 施行された")).toBe(true);
    expect(snippetMatches("昭和22年5月3日から施行", "まったく関係のない本文です")).toBe(false);
  });

  it("finds full-width tokens in corrections", () => {
    expect(correctionMentions(result("CONFIRMED_HALLUCINATION", { correction: "１９６４年" }), ["1964"])).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { AuditResultSchema } from "../src/index";
import { baseResult } from "./fixtures";

function issuePaths(input: unknown): string[] {
  const parsed = AuditResultSchema.safeParse(input);
  if (parsed.success) return [];
  return parsed.error.issues.map((i) => i.path.join("."));
}

describe("CONFIRMED_HALLUCINATION invariants", () => {
  it("accepts a fully evidenced confirmation", () => {
    expect(AuditResultSchema.safeParse(baseResult()).success).toBe(true);
  });

  it("rejects evidence_status INSUFFICIENT", () => {
    expect(issuePaths(baseResult({ evidence_status: "INSUFFICIENT" }))).toContain("evidence_status");
  });

  it("rejects when no source is verified", () => {
    const r = baseResult();
    r.evidence_sources = r.evidence_sources.map((s) => ({ ...s, verified: false }));
    expect(issuePaths(r)).toContain("evidence_sources");
  });

  it("rejects missing correction", () => {
    expect(issuePaths(baseResult({ correction: null }))).toContain("correction");
  });

  it("rejects missing hallucinated_claim", () => {
    expect(issuePaths(baseResult({ hallucinated_claim: null }))).toContain("correction");
  });
});

describe("UNVERIFIED_OR_AMBIGUOUS invariants", () => {
  const abstained = () =>
    baseResult({
      audit_status: "UNVERIFIED_OR_AMBIGUOUS",
      evidence_status: "INSUFFICIENT",
      hallucinated_claim: null,
      correction: null,
      unverified_notes: "一次資料が見つからない",
      limitations: ["公的な統計が未公表"],
      audit_trace: {
        decomposed_claims: [
          { sub_claim: "x", verification_target: "y", status: "UNVERIFIABLE" },
        ],
        alignment_reasoning: "根拠が不足している",
        abstention_reason: "一次資料が存在しない",
      },
    });

  it("accepts a proper abstention", () => {
    expect(AuditResultSchema.safeParse(abstained()).success).toBe(true);
  });

  it("rejects a non-null correction", () => {
    expect(issuePaths({ ...abstained(), correction: "断定的な訂正" })).toContain("correction");
  });

  it("rejects a missing abstention_reason", () => {
    const r = abstained();
    r.audit_trace.abstention_reason = null;
    expect(issuePaths(r)).toContain("limitations");
  });

  it("rejects empty limitations", () => {
    expect(issuePaths({ ...abstained(), limitations: [] })).toContain("limitations");
  });
});

describe("SUPPORTED_CLAIM invariants", () => {
  const supported = () =>
    baseResult({
      audit_status: "SUPPORTED_CLAIM",
      hallucinated_claim: null,
      correction: null,
      category: null,
      severity_score: null,
    });

  it("accepts a verified support", () => {
    expect(AuditResultSchema.safeParse(supported()).success).toBe(true);
  });

  it("rejects support without verified evidence", () => {
    expect(issuePaths({ ...supported(), evidence_status: "INSUFFICIENT" })).toContain("evidence_status");
    expect(issuePaths({ ...supported(), evidence_sources: [] })).toContain("evidence_sources");
  });
});

describe("structural checks", () => {
  it("requires at least one decomposed claim", () => {
    const r = baseResult();
    r.audit_trace.decomposed_claims = [];
    expect(issuePaths(r)).toContain("audit_trace.decomposed_claims");
  });

  it("rejects severity out of range", () => {
    expect(issuePaths(baseResult({ severity_score: 6 }))).toContain("severity_score");
  });
});

describe("evidence URLs", () => {
  it("accepts only http and https", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,x", "ftp://a/b"]) {
      const r = baseResult();
      r.evidence_sources = [{ ...r.evidence_sources[0]!, url }];
      expect(issuePaths(r)).toContain("evidence_sources.0.url");
    }
    expect(AuditResultSchema.safeParse(baseResult()).success).toBe(true);
  });
});

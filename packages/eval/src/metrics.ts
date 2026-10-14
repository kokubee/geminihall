import type { AuditResult } from "@geminihall/schema";
import type { AuditCase, CachePairCase } from "./cases";

export interface CaseOutcome {
  case: AuditCase;
  result: AuditResult | null;
  downgraded: boolean;
  error: string | null;
  seconds: number;
}

export interface SourceCheck {
  caseId: string;
  url: string;
  verified: boolean;
  status: number | null;
  alive: boolean;
  snippetMatch: boolean | null;
}

export interface CachePairOutcome {
  case: CachePairCase;
  keyA: string;
  keyB: string;
}

export interface Ratio {
  numerator: number;
  denominator: number;
  rate: number | null;
}

function ratio(numerator: number, denominator: number): Ratio {
  return { numerator, denominator, rate: denominator === 0 ? null : numerator / denominator };
}

function normalizeForMatch(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, "").toLowerCase();
}

export function correctionMentions(result: AuditResult, tokens: string[]): boolean {
  const text = normalizeForMatch(`${result.correction ?? ""}`);
  return tokens.some((t) => text.includes(normalizeForMatch(t)));
}

export function snippetMatches(snippet: string, pageText: string, threshold = 0.6): boolean {
  const s = normalizeForMatch(snippet);
  const page = normalizeForMatch(pageText);
  if (s.length < 3) return page.includes(s);
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) grams.add(s.slice(i, i + 3));
  let hit = 0;
  for (const g of grams) if (page.includes(g)) hit++;
  return hit / grams.size >= threshold;
}

export interface Metrics {
  falseCorrectionRate: Ratio;
  abstentionAccuracy: Ratio;
  evidenceGroundingRate: Ratio;
  falseCacheHitRate: Ratio;
  errorDetectionRate: Ratio;
  supportedClaimRate: Ratio;
  sourceAliveRate: Ratio;
  auditFailures: number;
}

export function computeMetrics(outcomes: CaseOutcome[], sources: SourceCheck[], pairs: CachePairOutcome[]): Metrics {
  const byKind = (k: AuditCase["kind"]) => outcomes.filter((o) => o.case.kind === k);
  const nonErrors = [...byKind("CORRECT"), ...byKind("AMBIGUOUS")];
  const falseCorrections = nonErrors.filter((o) => o.result?.audit_status === "CONFIRMED_HALLUCINATION").length;

  const ambiguous = byKind("AMBIGUOUS");
  const abstained = ambiguous.filter(
    (o) => o.result?.audit_status === "UNVERIFIED_OR_AMBIGUOUS" && Boolean(o.result.audit_trace.abstention_reason?.trim()),
  ).length;

  const errors = byKind("FACTUAL_ERROR");
  const detected = errors.filter(
    (o) =>
      o.result?.audit_status === "CONFIRMED_HALLUCINATION" &&
      correctionMentions(o.result, o.case.expectedCorrectionTokens ?? []),
  ).length;

  const correct = byKind("CORRECT");
  const supported = correct.filter((o) => o.result?.audit_status === "SUPPORTED_CLAIM").length;

  const checkable = sources.filter((s) => s.snippetMatch !== null || !s.alive);
  const grounded = checkable.filter((s) => s.alive && s.snippetMatch === true).length;

  return {
    falseCorrectionRate: ratio(falseCorrections, nonErrors.length),
    abstentionAccuracy: ratio(abstained, ambiguous.length),
    evidenceGroundingRate: ratio(grounded, checkable.length),
    falseCacheHitRate: ratio(pairs.filter((p) => p.keyA === p.keyB).length, pairs.length),
    errorDetectionRate: ratio(detected, errors.length),
    supportedClaimRate: ratio(supported, correct.length),
    sourceAliveRate: ratio(sources.filter((s) => s.alive).length, sources.length),
    auditFailures: outcomes.filter((o) => o.error !== null).length,
  };
}

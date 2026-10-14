import { AuditResultSchema, type AuditResult, type ModelAuditOutput } from "@geminihall/schema";
import { normalizeUrl } from "./normalize";

const TTL_MS: Record<AuditResult["ttl_category"], number> = {
  HISTORICAL_FACT: 30 * 24 * 60 * 60 * 1000,
  LAW_OR_INSTITUTION: 24 * 60 * 60 * 1000,
  CURRENT_NEWS: 60 * 60 * 1000,
  REALTIME: 0,
};

const DOWNGRADE_LIMITATION = "外部の検索結果で裏付けを確認できなかったため、判定を保留しました。";
const DOWNGRADE_REASON = "監査中に取得した外部ソースで、判定の根拠を確認できなかったため。";

export interface AssembleArgs {
  requestId: string;
  mode: "LIVE" | "DEMO";
  auditor: AuditResult["auditor"];
  normalizedClaim: string;
  contextFingerprint: string;
  model: ModelAuditOutput;
  retrievedUrls: Set<string>;
  searchUsed: boolean;
  nowMs: number;
}

export type AssembleOutcome =
  | { ok: true; result: AuditResult; downgraded: boolean }
  | { ok: false; issues: string };

export function assembleResult(args: AssembleArgs): AssembleOutcome {
  const { model } = args;
  const now = new Date(args.nowMs).toISOString();

  const evidence_sources = model.evidence_sources.flatMap((s) => {
    const url = normalizeUrl(s.url);
    if (!url || !s.title.trim() || !s.snippet.trim()) return [];
    return [{ title: s.title, url: s.url, snippet: s.snippet, verified: args.retrievedUrls.has(url) }];
  });
  const hasVerified = evidence_sources.some((s) => s.verified);

  let audit_status = model.audit_status;
  let evidence_status = model.evidence_status;
  let correction = model.correction;
  let hallucinated_claim = model.hallucinated_claim;
  let unverified_notes = model.unverified_notes;
  let limitations = [...model.limitations];
  let abstention_reason = model.audit_trace.abstention_reason;
  let severity_score =
    model.severity_score === null ? null : Math.min(5, Math.max(1, Math.round(model.severity_score)));
  let category = model.category;
  let downgraded = false;

  const needsVerifiedEvidence = audit_status === "CONFIRMED_HALLUCINATION" || audit_status === "SUPPORTED_CLAIM";
  if (needsVerifiedEvidence && (!hasVerified || evidence_status !== "VERIFIED")) {
    downgraded = true;
    const tentative = [unverified_notes, correction ? `未確認の訂正候補: ${correction}` : null]
      .filter((x): x is string => Boolean(x))
      .join("\n");
    audit_status = "UNVERIFIED_OR_AMBIGUOUS";
    if (evidence_status === "VERIFIED") evidence_status = "INSUFFICIENT";
    correction = null;
    hallucinated_claim = null;
    unverified_notes = tentative || null;
    limitations = [...limitations, DOWNGRADE_LIMITATION];
    abstention_reason = abstention_reason ?? DOWNGRADE_REASON;
    severity_score = null;
    category = null;
  }

  if (audit_status !== "CONFIRMED_HALLUCINATION") {
    severity_score = null;
    category = null;
  }
  if (audit_status === "SUPPORTED_CLAIM") {
    correction = null;
    hallucinated_claim = null;
  }

  const candidate: AuditResult = {
    request_id: args.requestId,
    mode: args.mode,
    auditor: args.auditor,
    is_valid_input: model.is_valid_input,
    contains_pii: model.contains_pii,
    audit_status,
    evidence_status,
    severity_score,
    category,
    ttl_category: model.ttl_category,
    verified_at: now,
    expires_at: new Date(args.nowMs + TTL_MS[model.ttl_category]).toISOString(),
    evidence_checked_at: args.searchUsed ? now : null,
    normalized_claim: args.normalizedClaim,
    context_fingerprint: args.contextFingerprint,
    audit_trace: { ...model.audit_trace, abstention_reason },
    hallucinated_claim,
    correction,
    unverified_notes,
    evidence_sources,
    estimated_error_pattern: model.estimated_error_pattern,
    limitations,
  };

  const parsed = AuditResultSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, issues: parsed.error.message };
  return { ok: true, result: parsed.data, downgraded };
}

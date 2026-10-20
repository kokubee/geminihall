import { z } from "zod";

export const MAX_CLAIM_LENGTH = 4000;
export const MAX_CONTEXT_LENGTH = 2000;
export const MAX_MODEL_LENGTH = 100;
export const MAX_EVIDENCE_TITLE_LENGTH = 300;
export const MAX_EVIDENCE_URL_LENGTH = 2048;
export const MAX_EVIDENCE_SNIPPET_LENGTH = 2000;
export const MAX_SUB_CLAIMS = 30;
export const MAX_SUB_CLAIM_LENGTH = 2000;
export const MAX_VERIFICATION_TARGET_LENGTH = 1000;
export const MAX_ALIGNMENT_REASONING_LENGTH = 8000;
export const MAX_ABSTENTION_REASON_LENGTH = 2000;
export const MAX_UNVERIFIED_NOTES_LENGTH = 8000;
export const MAX_ESTIMATED_ERROR_PATTERN_LENGTH = 2000;
export const MAX_LIMITATIONS = 20;
export const MAX_LIMITATION_LENGTH = 2000;

export const AuditStatusEnum = z.enum([
  "CONFIRMED_HALLUCINATION",
  "SUPPORTED_CLAIM",
  "UNVERIFIED_OR_AMBIGUOUS",
]);

export const EvidenceStatusEnum = z.enum([
  "VERIFIED",
  "CONFLICTING",
  "INSUFFICIENT",
  "UNAVAILABLE",
  "OUTDATED",
]);

export const CategoryEnum = z.enum([
  "Fact_Fabrication",
  "Chronological_Error",
  "Logic_Collapse",
  "Citation_Ghost",
  "Calculation_Bug",
  "Other",
]);

export const TtlCategoryEnum = z.enum([
  "HISTORICAL_FACT",
  "LAW_OR_INSTITUTION",
  "CURRENT_NEWS",
  "REALTIME",
]);

export const TTL_DURATION_MS: Readonly<Record<z.infer<typeof TtlCategoryEnum>, number>> = {
  HISTORICAL_FACT: 30 * 24 * 60 * 60 * 1000,
  LAW_OR_INSTITUTION: 24 * 60 * 60 * 1000,
  CURRENT_NEWS: 60 * 60 * 1000,
  REALTIME: 0,
};

export const SubClaimStatusEnum = z.enum(["CONTRADICTED", "SUPPORTED", "UNVERIFIABLE"]);

export const ModeEnum = z.enum(["LIVE", "DEMO"]);

export const ProviderEnum = z.enum(["ANTHROPIC", "OPENAI"]);

export const AuthViaEnum = z.enum(["API_KEY", "CHATGPT_PLAN", "MCP"]);

export const AuditorSchema = z.object({
  provider: ProviderEnum,
  model: z.string().min(1).max(MAX_MODEL_LENGTH),
  via: AuthViaEnum.optional(),
});

export const HttpUrlSchema = z.string().max(MAX_EVIDENCE_URL_LENGTH).pipe(z.url({ protocol: /^https?$/ }));

export const EvidenceSourceSchema = z.object({
  title: z.string().min(1).max(MAX_EVIDENCE_TITLE_LENGTH),
  url: HttpUrlSchema,
  snippet: z.string().min(1).max(MAX_EVIDENCE_SNIPPET_LENGTH),
  verified: z.boolean(),
});

export const AuditTraceSchema = z.object({
  decomposed_claims: z
    .array(
      z.object({
        sub_claim: z.string().min(1).max(MAX_SUB_CLAIM_LENGTH),
        verification_target: z.string().min(1).max(MAX_VERIFICATION_TARGET_LENGTH),
        status: SubClaimStatusEnum,
      }),
    )
    .min(1)
    .max(MAX_SUB_CLAIMS),
  alignment_reasoning: z.string().min(1).max(MAX_ALIGNMENT_REASONING_LENGTH),
  abstention_reason: z.string().max(MAX_ABSTENTION_REASON_LENGTH).nullable(),
});

export const AuditResultBaseSchema = z.object({
  request_id: z.string().uuid(),
  mode: ModeEnum,
  auditor: AuditorSchema,
  is_valid_input: z.boolean(),
  contains_pii: z.boolean(),
  audit_status: AuditStatusEnum,
  evidence_status: EvidenceStatusEnum,
  severity_score: z.number().int().min(1).max(5).nullable(),
  category: CategoryEnum.nullable(),
  ttl_category: TtlCategoryEnum,
  verified_at: z.string().datetime(),
  expires_at: z.string().datetime(),
  evidence_checked_at: z.string().datetime().nullable(),
  normalized_claim: z.string().min(1).max(MAX_CLAIM_LENGTH),
  context_fingerprint: z.string().min(1).max(256),
  audit_trace: AuditTraceSchema,
  hallucinated_claim: z.string().max(MAX_CLAIM_LENGTH).nullable(),
  correction: z.string().max(MAX_CLAIM_LENGTH).nullable(),
  unverified_notes: z.string().max(MAX_UNVERIFIED_NOTES_LENGTH).nullable(),
  evidence_sources: z.array(EvidenceSourceSchema).max(20),
  estimated_error_pattern: z.string().max(MAX_ESTIMATED_ERROR_PATTERN_LENGTH).nullable(),
  limitations: z.array(z.string().max(MAX_LIMITATION_LENGTH)).max(MAX_LIMITATIONS),
});

export const AuditResultSchema = AuditResultBaseSchema.superRefine((data, ctx) => {
  const hasVerifiedSource = data.evidence_sources.some((s) => s.verified);

  if (data.audit_status === "CONFIRMED_HALLUCINATION") {
    if (data.evidence_status !== "VERIFIED") {
      ctx.addIssue({
        code: "custom",
        message: "CONFIRMED_HALLUCINATION requires evidence_status to be VERIFIED",
        path: ["evidence_status"],
      });
    }
    if (!hasVerifiedSource) {
      ctx.addIssue({
        code: "custom",
        message: "CONFIRMED_HALLUCINATION requires at least one verified evidence source",
        path: ["evidence_sources"],
      });
    }
    if (!data.correction || !data.hallucinated_claim) {
      ctx.addIssue({
        code: "custom",
        message: "CONFIRMED_HALLUCINATION requires both hallucinated_claim and correction",
        path: ["correction"],
      });
    }
  }

  if (data.audit_status === "SUPPORTED_CLAIM") {
    if (data.evidence_status !== "VERIFIED") {
      ctx.addIssue({
        code: "custom",
        message: "SUPPORTED_CLAIM requires evidence_status to be VERIFIED",
        path: ["evidence_status"],
      });
    }
    if (!hasVerifiedSource) {
      ctx.addIssue({
        code: "custom",
        message: "SUPPORTED_CLAIM requires at least one verified evidence source",
        path: ["evidence_sources"],
      });
    }
  }

  if (data.audit_status === "UNVERIFIED_OR_AMBIGUOUS") {
    if (data.correction !== null) {
      ctx.addIssue({
        code: "custom",
        message:
          "UNVERIFIED_OR_AMBIGUOUS must have correction = null; use unverified_notes and limitations instead",
        path: ["correction"],
      });
    }
    if (data.limitations.length === 0 || !data.audit_trace.abstention_reason) {
      ctx.addIssue({
        code: "custom",
        message:
          "UNVERIFIED_OR_AMBIGUOUS requires limitation explanation and audit_trace.abstention_reason",
        path: ["limitations"],
      });
    }
  }
});

export type AuditResult = z.infer<typeof AuditResultSchema>;
export type AuditTrace = z.infer<typeof AuditTraceSchema>;
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

export const ModelEvidenceSourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
});

export const ModelAuditOutputSchema = z.object({
  is_valid_input: z.boolean(),
  contains_pii: z.boolean(),
  audit_status: AuditStatusEnum,
  evidence_status: EvidenceStatusEnum,
  severity_score: z.number().nullable(),
  category: CategoryEnum.nullable(),
  ttl_category: TtlCategoryEnum,
  audit_trace: z.object({
    decomposed_claims: z.array(
      z.object({
        sub_claim: z.string(),
        verification_target: z.string(),
        status: SubClaimStatusEnum,
      }),
    ).min(1),
    alignment_reasoning: z.string(),
    abstention_reason: z.string().nullable(),
  }),
  hallucinated_claim: z.string().nullable(),
  correction: z.string().nullable(),
  unverified_notes: z.string().nullable(),
  evidence_sources: z.array(ModelEvidenceSourceSchema),
  estimated_error_pattern: z.string().nullable(),
  limitations: z.array(z.string()),
});

export const BoundedModelAuditOutputSchema = ModelAuditOutputSchema.superRefine((data, ctx) => {
  const checkString = (value: string | null, maximum: number, path: (string | number)[]) => {
    if (value !== null && value.length > maximum) {
      ctx.addIssue({ code: "custom", message: `String exceeds ${maximum} characters`, path });
    }
  };
  const checkArray = (value: unknown[], maximum: number, path: (string | number)[]) => {
    if (value.length > maximum) {
      ctx.addIssue({ code: "custom", message: `Array exceeds ${maximum} items`, path });
    }
  };

  checkArray(data.audit_trace.decomposed_claims, MAX_SUB_CLAIMS, ["audit_trace", "decomposed_claims"]);
  data.audit_trace.decomposed_claims.forEach((claim, index) => {
    checkString(claim.sub_claim, MAX_SUB_CLAIM_LENGTH, ["audit_trace", "decomposed_claims", index, "sub_claim"]);
    checkString(claim.verification_target, MAX_VERIFICATION_TARGET_LENGTH, ["audit_trace", "decomposed_claims", index, "verification_target"]);
  });
  checkString(data.audit_trace.alignment_reasoning, MAX_ALIGNMENT_REASONING_LENGTH, ["audit_trace", "alignment_reasoning"]);
  checkString(data.audit_trace.abstention_reason, MAX_ABSTENTION_REASON_LENGTH, ["audit_trace", "abstention_reason"]);
  checkString(data.hallucinated_claim, MAX_CLAIM_LENGTH, ["hallucinated_claim"]);
  checkString(data.correction, MAX_CLAIM_LENGTH, ["correction"]);
  checkString(data.unverified_notes, MAX_UNVERIFIED_NOTES_LENGTH, ["unverified_notes"]);
  checkArray(data.evidence_sources, 20, ["evidence_sources"]);
  data.evidence_sources.forEach((source, index) => {
    checkString(source.title, MAX_EVIDENCE_TITLE_LENGTH, ["evidence_sources", index, "title"]);
    checkString(source.url, MAX_EVIDENCE_URL_LENGTH, ["evidence_sources", index, "url"]);
    checkString(source.snippet, MAX_EVIDENCE_SNIPPET_LENGTH, ["evidence_sources", index, "snippet"]);
  });
  checkString(data.estimated_error_pattern, MAX_ESTIMATED_ERROR_PATTERN_LENGTH, ["estimated_error_pattern"]);
  checkArray(data.limitations, MAX_LIMITATIONS, ["limitations"]);
  data.limitations.forEach((limitation, index) => checkString(limitation, MAX_LIMITATION_LENGTH, ["limitations", index]));
});

export type ModelAuditOutput = z.infer<typeof ModelAuditOutputSchema>;

export const ErrorCodeEnum = z.enum([
  "INVALID_INPUT",
  "UNAUTHORIZED_REQUEST_ACCESS",
  "RATE_LIMITED",
  "UPSTREAM_AI_UNAVAILABLE",
  "INTERNAL_AUDIT_SCHEMA_VIOLATION",
  "INTERNAL_ERROR",
]);

export type ErrorCode = z.infer<typeof ErrorCodeEnum>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeEnum,
    message: z.string(),
    request_id: z.string().uuid().nullable(),
  }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

export type Provider = z.infer<typeof ProviderEnum>;
export type Mode = z.infer<typeof ModeEnum>;

export const AuditInputSchema = z.object({
  claim: z.string().trim().min(1).max(MAX_CLAIM_LENGTH),
  context: z.string().max(MAX_CONTEXT_LENGTH).optional(),
  locale: z.string().min(2).max(16),
});

export type AuditInput = z.infer<typeof AuditInputSchema>;

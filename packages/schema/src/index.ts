import { z } from "zod";

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

export const SubClaimStatusEnum = z.enum(["CONTRADICTED", "SUPPORTED", "UNVERIFIABLE"]);

export const ModeEnum = z.enum(["LIVE", "DEMO"]);

export const ProviderEnum = z.enum(["ANTHROPIC", "OPENAI"]);

export const AuditorSchema = z.object({
  provider: ProviderEnum,
  model: z.string().min(1),
});

export const EvidenceSourceSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  snippet: z.string().min(1),
  verified: z.boolean(),
});

export const AuditTraceSchema = z.object({
  decomposed_claims: z
    .array(
      z.object({
        sub_claim: z.string().min(1),
        verification_target: z.string().min(1),
        status: SubClaimStatusEnum,
      }),
    )
    .min(1),
  alignment_reasoning: z.string().min(1),
  abstention_reason: z.string().nullable(),
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
  normalized_claim: z.string().min(1),
  context_fingerprint: z.string().min(1),
  audit_trace: AuditTraceSchema,
  hallucinated_claim: z.string().nullable(),
  correction: z.string().nullable(),
  unverified_notes: z.string().nullable(),
  evidence_sources: z.array(EvidenceSourceSchema),
  estimated_error_pattern: z.string().nullable(),
  limitations: z.array(z.string()),
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
    ),
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

export const MAX_CLAIM_LENGTH = 4000;
export const MAX_CONTEXT_LENGTH = 2000;

export const AuditInputSchema = z.object({
  claim: z.string().trim().min(1).max(MAX_CLAIM_LENGTH),
  context: z.string().max(MAX_CONTEXT_LENGTH).optional(),
  locale: z.string().min(2).max(16),
});

export type AuditInput = z.infer<typeof AuditInputSchema>;

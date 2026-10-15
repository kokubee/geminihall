import type { AuditResult, AuditTrace, EvidenceSource, Provider } from "@geminihall/schema";

export const SESSION_KEYS = {
  apiKeys: "byok.apiKeys",
  job: "audit.currentJob",
  pendingInput: "audit.pendingInput",
  privateCache: "audit.privateCache",
} as const;

export const LOCAL_KEYS = {
  settings: "settings",
  clientToken: "clientToken",
  keyHistory: "keyHistory",
} as const;

export type ApiKeys = Partial<Record<Provider, string>>;

export interface Settings {
  provider: Provider;
  models: Record<Provider, string>;
  costNoticeAccepted: boolean;
  publicLookup: boolean;
  demoMode: boolean;
}

export interface PublicEntry {
  entry_id: string;
  publication_status: "PUBLISHED" | "RETRACTED";
  claim_cache_key: string;
  audit_status: AuditResult["audit_status"];
  category: AuditResult["category"];
  severity_score: number | null;
  sanitized_title: string;
  sanitized_claim: string;
  correction: string | null;
  evidence_sources: EvidenceSource[];
  audit_trace: AuditTrace;
  limitations: string[];
  estimated_error_pattern: string | null;
  ttl_category: AuditResult["ttl_category"];
  auditor: { provider: Provider; model: string };
  verified_at: string;
  expires_at: string;
  is_expired: boolean;
  published_at: string;
}

export type JobState = "RUNNING" | "COMPLETED" | "FAILED" | "INTERRUPTED";
export type JobSource = "LIVE" | "PRIVATE_CACHE" | "PUBLIC" | "DEMO";

export type JobErrorKind =
  | "NO_API_KEY"
  | "INVALID_INPUT"
  | "UPSTREAM_AI_UNAVAILABLE"
  | "INTERNAL_AUDIT_SCHEMA_VIOLATION"
  | "INTERRUPTED";

export interface SubmissionInfo {
  submissionId?: string;
  state: "SENDING" | "PENDING" | "APPROVED" | "REJECTED" | "FAILED";
  entryId?: string | null;
  publicationStatus?: string | null;
  message?: string;
}

export interface AuditJob {
  requestId: string;
  state: JobState;
  source: JobSource;
  provider: Provider;
  model: string;
  claim: string;
  context?: string;
  startedAt: string;
  finishedAt?: string;
  result?: AuditResult;
  publicEntry?: PublicEntry;
  claimCacheKey?: string;
  downgraded?: boolean;
  submission?: SubmissionInfo;
  error?: { kind: JobErrorKind; message: string; status?: number };
}

export interface PendingInput {
  claim: string;
  context?: string;
  createdAt: string;
}

export type BackgroundMessage =
  | { type: "START_AUDIT"; claim: string; context?: string; force?: boolean }
  | { type: "SUBMIT_FOR_PUBLICATION"; requestId: string }
  | { type: "REFRESH_SUBMISSION"; requestId: string }
  | { type: "PING" };

export type StartAuditResponse = { ok: true; requestId: string } | { ok: false; reason: string };

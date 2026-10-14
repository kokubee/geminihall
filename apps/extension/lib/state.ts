import type { AuditResult, Provider } from "@geminihall/schema";

export const SESSION_KEYS = {
  apiKeys: "byok.apiKeys",
  job: "audit.currentJob",
  pendingInput: "audit.pendingInput",
} as const;

export const LOCAL_KEYS = {
  settings: "settings",
} as const;

export type ApiKeys = Partial<Record<Provider, string>>;

export interface Settings {
  provider: Provider;
  models: Record<Provider, string>;
  costNoticeAccepted: boolean;
}

export type JobState = "RUNNING" | "COMPLETED" | "FAILED" | "INTERRUPTED";

export type JobErrorKind =
  | "NO_API_KEY"
  | "INVALID_INPUT"
  | "UPSTREAM_AI_UNAVAILABLE"
  | "INTERNAL_AUDIT_SCHEMA_VIOLATION"
  | "INTERRUPTED";

export interface AuditJob {
  requestId: string;
  state: JobState;
  provider: Provider;
  model: string;
  claim: string;
  context?: string;
  startedAt: string;
  finishedAt?: string;
  result?: AuditResult;
  claimCacheKey?: string;
  downgraded?: boolean;
  error?: { kind: JobErrorKind; message: string; status?: number };
}

export interface PendingInput {
  claim: string;
  context?: string;
  createdAt: string;
}

export type BackgroundMessage =
  | { type: "START_AUDIT"; claim: string; context?: string }
  | { type: "PING" };

export type StartAuditResponse = { ok: true; requestId: string } | { ok: false; reason: string };

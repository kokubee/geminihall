import type { AuditResult, AuditTrace, EvidenceSource, Provider } from "@geminihall/schema";

export interface PublishedEntry {
  entry_id: string;
  publication_status: "PUBLISHED";
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

export interface RetractedEntry {
  entry_id: string;
  publication_status: "RETRACTED";
  sanitized_title: string;
  published_at: string;
}

export type Entry = PublishedEntry | RetractedEntry;

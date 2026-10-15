import type { AuditInput } from "@geminihall/schema";
import { claimCacheKey, contextFingerprint, normalizeText } from "./normalize";

export const AUDIT_POLICY_VERSION = "2026-10-15.4";

export interface CacheIdentity {
  normalizedClaim: string;
  contextFingerprint: string;
  claimCacheKey: string;
}

export async function cacheIdentity(input: AuditInput): Promise<CacheIdentity> {
  const normalizedClaim = normalizeText(input.claim);
  const fingerprint = await contextFingerprint(input.context);
  const key = await claimCacheKey({
    normalizedClaim,
    contextFingerprint: fingerprint,
    auditPolicyVersion: AUDIT_POLICY_VERSION,
    locale: input.locale,
  });
  return { normalizedClaim, contextFingerprint: fingerprint, claimCacheKey: key };
}

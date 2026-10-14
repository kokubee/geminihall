import type { AuditInput, AuditResult, Provider } from "@geminihall/schema";
import { anthropicAdapter } from "./anthropic";
import { assembleResult } from "./assemble";
import { InvalidClaimError, SchemaViolationError } from "./errors";
import { claimCacheKey, contextFingerprint, normalizeText, normalizeUrl } from "./normalize";
import { openaiAdapter } from "./openai";
import { AUDIT_SYSTEM_PROMPT, buildUserMessage } from "./prompt";
import type { ProviderAdapter } from "./provider";

export const AUDIT_POLICY_VERSION = "2026-10-15.2";

export const DEFAULT_MODELS: Record<Provider, string> = {
  ANTHROPIC: "claude-opus-5-5",
  OPENAI: "gpt-6-astra",
};

const ADAPTERS: Record<Provider, ProviderAdapter> = {
  ANTHROPIC: anthropicAdapter,
  OPENAI: openaiAdapter,
};

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

export interface RunAuditArgs {
  requestId: string;
  provider: Provider;
  apiKey: string;
  model: string;
  input: AuditInput;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

export interface RunAuditResult {
  result: AuditResult;
  claimCacheKey: string;
  downgraded: boolean;
}

export async function runAudit(args: RunAuditArgs): Promise<RunAuditResult> {
  const now = args.now ?? Date.now;
  const identity = await cacheIdentity(args.input);
  const adapter = ADAPTERS[args.provider];

  const providerResult = await adapter.run({
    apiKey: args.apiKey,
    model: args.model,
    system: AUDIT_SYSTEM_PROMPT,
    user: buildUserMessage(args.input),
    signal: args.signal,
    fetch: args.fetch,
  });

  if (!providerResult.output.is_valid_input) {
    throw new InvalidClaimError("no checkable factual claim was found in the input");
  }

  const retrieved = new Set(
    providerResult.retrievedUrls.map(normalizeUrl).filter((u): u is string => u !== null),
  );

  const assembled = assembleResult({
    requestId: args.requestId,
    mode: "LIVE",
    auditor: { provider: args.provider, model: args.model },
    normalizedClaim: identity.normalizedClaim,
    contextFingerprint: identity.contextFingerprint,
    model: providerResult.output,
    retrievedUrls: retrieved,
    searchUsed: providerResult.searchUsed,
    nowMs: now(),
  });
  if (!assembled.ok) throw new SchemaViolationError(assembled.issues);

  return { result: assembled.result, claimCacheKey: identity.claimCacheKey, downgraded: assembled.downgraded };
}

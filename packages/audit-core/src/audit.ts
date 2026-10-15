import type { AuditInput, AuditResult, Provider } from "@geminihall/schema";
import { anthropicAdapter } from "./anthropic";
import { assembleResult } from "./assemble";
import { InvalidClaimError, SchemaViolationError } from "./errors";
import { normalizeUrl } from "./normalize";
import { cacheIdentity } from "./identity";
import { openaiAdapter } from "./openai";
import { AUDIT_SYSTEM_PROMPT, buildUserMessage } from "./prompt";
import type { Credential, ProviderAdapter } from "./provider";

export { AUDIT_POLICY_VERSION, cacheIdentity, type CacheIdentity } from "./identity";
export { DEFAULT_MODELS } from "./models";

const ADAPTERS: Record<Provider, ProviderAdapter> = {
  ANTHROPIC: anthropicAdapter,
  OPENAI: openaiAdapter,
};

export interface RunAuditArgs {
  requestId: string;
  provider: Provider;
  credential: Credential;
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
    credential: args.credential,
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
    auditor: { provider: args.provider, model: args.model, via: args.credential.kind },
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

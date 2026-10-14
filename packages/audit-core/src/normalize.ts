import { sha256Hex } from "./crypto";

export const CONTEXT_FINGERPRINT_VERSION = "ctx-v1";

export function normalizeText(input: string): string {
  return input.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

export async function contextFingerprint(context: string | undefined): Promise<string> {
  return sha256Hex(`${CONTEXT_FINGERPRINT_VERSION}|${normalizeText(context ?? "")}`);
}

export async function claimCacheKey(parts: {
  normalizedClaim: string;
  contextFingerprint: string;
  auditPolicyVersion: string;
  locale: string;
}): Promise<string> {
  return sha256Hex(
    [parts.normalizedClaim, parts.contextFingerprint, parts.auditPolicyVersion, parts.locale].join("|"),
  );
}

export function normalizeUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_")) u.searchParams.delete(key);
  }
  u.hostname = u.hostname.toLowerCase();
  let s = u.toString();
  if (s.endsWith("?")) s = s.slice(0, -1);
  if (s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

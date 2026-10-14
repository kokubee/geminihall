import type { AuditResult } from "@geminihall/schema";
import { API_BASE, CONSENT_VERSION } from "./config";
import { LOCAL_KEYS, type PublicEntry } from "./state";

const TIMEOUT_MS = 10_000;

export async function clientToken(): Promise<string> {
  const stored = await chrome.storage.local.get(LOCAL_KEYS.clientToken);
  const existing = stored[LOCAL_KEYS.clientToken];
  if (typeof existing === "string" && existing.length >= 32) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  await chrome.storage.local.set({ [LOCAL_KEYS.clientToken]: token });
  return token;
}

export async function lookupPublic(claimCacheKey: string): Promise<PublicEntry | null> {
  const res = await fetch(`${API_BASE}/api/public/lookup?key=${encodeURIComponent(claimCacheKey)}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`lookup failed: ${res.status}`);
  const body = (await res.json()) as { entry: PublicEntry };
  return body.entry;
}

export type SubmitOutcome =
  | { ok: true; submissionId: string; reviewState: string }
  | { ok: false; status: number; message: string };

export async function submitForPublication(args: {
  claim: string;
  context?: string;
  result: AuditResult;
}): Promise<SubmitOutcome> {
  const res = await fetch(`${API_BASE}/api/submissions`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Client-Token": await clientToken() },
    body: JSON.stringify({
      original_claim: args.claim,
      context: args.context,
      locale: "ja",
      consent_version: CONSENT_VERSION,
      result: args.result,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => null)) as
    | { submission_id: string; review_state: string }
    | { error: { message: string } }
    | null;
  if (res.ok && body && "submission_id" in body) {
    return { ok: true, submissionId: body.submission_id, reviewState: body.review_state };
  }
  const message = body && "error" in body ? body.error.message : "申請を送信できませんでした。";
  return { ok: false, status: res.status, message };
}

export async function submissionStatus(id: string): Promise<{ review_state: string; entry_id: string | null; publication_status: string | null } | null> {
  const res = await fetch(`${API_BASE}/api/submissions/${encodeURIComponent(id)}`, {
    headers: { "X-Client-Token": await clientToken() },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return (await res.json()) as { review_state: string; entry_id: string | null; publication_status: string | null };
}

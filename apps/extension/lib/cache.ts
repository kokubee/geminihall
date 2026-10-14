import type { AuditResult } from "@geminihall/schema";
import { SESSION_KEYS } from "./state";

const MAX_ENTRIES = 100;

interface CachedResult {
  result: AuditResult;
  claim: string;
  context?: string;
  savedAt: string;
}

type CacheMap = Record<string, CachedResult>;

async function readCache(): Promise<CacheMap> {
  const stored = await chrome.storage.session.get(SESSION_KEYS.privateCache);
  return (stored[SESSION_KEYS.privateCache] as CacheMap | undefined) ?? {};
}

export function isReusable(result: AuditResult, nowMs: number): boolean {
  return result.ttl_category !== "REALTIME" && Date.parse(result.expires_at) > nowMs;
}

export async function getPrivate(key: string, nowMs: number): Promise<CachedResult | null> {
  const hit = (await readCache())[key];
  return hit && isReusable(hit.result, nowMs) ? hit : null;
}

export async function putPrivate(key: string, entry: CachedResult, nowMs: number): Promise<void> {
  if (!isReusable(entry.result, nowMs)) return;
  const cache = await readCache();
  cache[key] = entry;
  const live = Object.entries(cache)
    .filter(([, v]) => isReusable(v.result, nowMs))
    .sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt))
    .slice(0, MAX_ENTRIES);
  await chrome.storage.session.set({ [SESSION_KEYS.privateCache]: Object.fromEntries(live) });
}

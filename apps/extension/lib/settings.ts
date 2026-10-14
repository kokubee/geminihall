import { DEFAULT_MODELS } from "@geminihall/audit-core/models";
import type { Provider } from "@geminihall/schema";
import { LOCAL_KEYS, SESSION_KEYS, type ApiKeys, type Settings } from "./state";

export const DEFAULT_SETTINGS: Settings = {
  provider: "ANTHROPIC",
  models: { ...DEFAULT_MODELS },
  costNoticeAccepted: false,
};

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(LOCAL_KEYS.settings);
  const s = stored[LOCAL_KEYS.settings] as Partial<Settings> | undefined;
  return {
    provider: s?.provider === "OPENAI" ? "OPENAI" : "ANTHROPIC",
    models: { ...DEFAULT_SETTINGS.models, ...(s?.models ?? {}) },
    costNoticeAccepted: s?.costNoticeAccepted === true,
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [LOCAL_KEYS.settings]: settings });
}

export async function loadApiKeys(): Promise<ApiKeys> {
  const stored = await chrome.storage.session.get(SESSION_KEYS.apiKeys);
  return (stored[SESSION_KEYS.apiKeys] as ApiKeys | undefined) ?? {};
}

export async function setApiKey(provider: Provider, key: string | null): Promise<void> {
  const keys = await loadApiKeys();
  if (key) keys[provider] = key;
  else delete keys[provider];
  await chrome.storage.session.set({ [SESSION_KEYS.apiKeys]: keys });
}

export function maskKey(key: string): string {
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

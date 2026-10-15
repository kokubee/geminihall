import { DEFAULT_MODELS } from "@geminihall/audit-core/models";
import type { Provider } from "@geminihall/schema";
import { SIWC_ENABLED } from "./features";
import { LOCAL_KEYS, SESSION_KEYS, type ApiKeys, type Settings, type UiProvider } from "./state";

export const DEFAULT_SETTINGS: Settings = {
  provider: "ANTHROPIC",
  models: { ...DEFAULT_MODELS, CHATGPT_PLAN: "" },
  costNoticeAccepted: false,
  publicLookup: true,
  demoMode: false,
};

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(LOCAL_KEYS.settings);
  const s = stored[LOCAL_KEYS.settings] as Partial<Settings> | undefined;
  return {
    provider:
      s?.provider === "CHATGPT_PLAN"
        ? SIWC_ENABLED
          ? "CHATGPT_PLAN"
          : "OPENAI"
        : s?.provider === "OPENAI"
          ? "OPENAI"
          : "ANTHROPIC",
    models: { ...DEFAULT_SETTINGS.models, ...(s?.models ?? {}) },
    costNoticeAccepted: s?.costNoticeAccepted === true,
    publicLookup: s?.publicLookup !== false,
    demoMode: s?.demoMode === true,
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [LOCAL_KEYS.settings]: settings });
}

export async function loadApiKeys(): Promise<ApiKeys> {
  const stored = await chrome.storage.session.get(SESSION_KEYS.apiKeys);
  return (stored[SESSION_KEYS.apiKeys] as ApiKeys | undefined) ?? {};
}

export const KEY_LOSS_NOTE =
  "以前に入力したキーは消えています（ブラウザを閉じたか、拡張機能を更新・再読み込みしたため）。控えておいたキーを、もう一度入力してください。";

type KeyHistory = Partial<Record<Provider, boolean>>;

async function loadKeyHistory(): Promise<KeyHistory> {
  const stored = await chrome.storage.local.get(LOCAL_KEYS.keyHistory);
  return (stored[LOCAL_KEYS.keyHistory] as KeyHistory | undefined) ?? {};
}

export async function wasKeyEntered(provider: Provider): Promise<boolean> {
  return (await loadKeyHistory())[provider] === true;
}

export async function setApiKey(provider: Provider, key: string | null): Promise<void> {
  const keys = await loadApiKeys();
  if (key) keys[provider] = key;
  else delete keys[provider];
  await chrome.storage.session.set({ [SESSION_KEYS.apiKeys]: keys });
  const history = await loadKeyHistory();
  history[provider] = Boolean(key);
  await chrome.storage.local.set({ [LOCAL_KEYS.keyHistory]: history });
}

export function maskKey(key: string): string {
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

import { InvalidClaimError, ModelOutputError, SchemaViolationError, UpstreamError, runAudit } from "@geminihall/audit-core";
import { AuditInputSchema } from "@geminihall/schema";
import { loadApiKeys, loadSettings } from "../lib/settings";
import {
  SESSION_KEYS,
  type AuditJob,
  type BackgroundMessage,
  type JobErrorKind,
  type PendingInput,
  type StartAuditResponse,
} from "../lib/state";

const MENU_ID = "geminihall-audit-selection";
const KEEPALIVE_MS = 20_000;
const runningInThisWorker = new Set<string>();

async function restrictSessionStorage() {
  await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
}

async function writeJob(job: AuditJob) {
  await chrome.storage.session.set({ [SESSION_KEYS.job]: job });
}

async function readJob(): Promise<AuditJob | undefined> {
  const stored = await chrome.storage.session.get(SESSION_KEYS.job);
  return stored[SESSION_KEYS.job] as AuditJob | undefined;
}

async function markOrphanedJobInterrupted() {
  const job = await readJob();
  if (job?.state === "RUNNING" && !runningInThisWorker.has(job.requestId)) {
    await writeJob({
      ...job,
      state: "INTERRUPTED",
      finishedAt: new Date().toISOString(),
      error: { kind: "INTERRUPTED", message: "監査の途中で拡張機能が停止しました。もう一度実行してください。" },
    });
  }
}

function classify(err: unknown): { kind: JobErrorKind; message: string; status?: number } {
  if (err instanceof InvalidClaimError) {
    return { kind: "INVALID_INPUT", message: "検証できる事実の主張が見つかりませんでした。" };
  }
  if (err instanceof UpstreamError) {
    const status = err.status;
    if (status === 401 || status === 403) {
      return { kind: "UPSTREAM_AI_UNAVAILABLE", status, message: "APIキーが受け付けられませんでした。設定を確認してください。" };
    }
    if (status === 404) {
      return { kind: "UPSTREAM_AI_UNAVAILABLE", status, message: "指定したモデルが見つかりませんでした。設定のモデル名を確認してください。" };
    }
    if (status === 429) {
      return { kind: "UPSTREAM_AI_UNAVAILABLE", status, message: "AI側の利用上限に達しました。しばらく待ってから再実行してください。" };
    }
    return { kind: "UPSTREAM_AI_UNAVAILABLE", status, message: "監査AIに接続できませんでした。時間をおいて再実行してください。" };
  }
  if (err instanceof ModelOutputError || err instanceof SchemaViolationError) {
    return { kind: "INTERNAL_AUDIT_SCHEMA_VIOLATION", message: "監査結果の形式が不正だったため、表示を中止しました。" };
  }
  return { kind: "UPSTREAM_AI_UNAVAILABLE", message: "監査中に予期しないエラーが起きました。" };
}

async function startAudit(claim: string, context: string | undefined): Promise<StartAuditResponse> {
  const settings = await loadSettings();
  const parsed = AuditInputSchema.safeParse({ claim, context: context || undefined, locale: "ja" });
  if (!parsed.success) return { ok: false, reason: "INVALID_INPUT" };

  const current = await readJob();
  if (current?.state === "RUNNING" && runningInThisWorker.has(current.requestId)) {
    return { ok: false, reason: "ALREADY_RUNNING" };
  }

  const provider = settings.provider;
  const model = settings.models[provider];
  const job: AuditJob = {
    requestId: crypto.randomUUID(),
    state: "RUNNING",
    provider,
    model,
    claim: parsed.data.claim,
    context: parsed.data.context,
    startedAt: new Date().toISOString(),
  };

  const apiKey = (await loadApiKeys())[provider];
  if (!apiKey) {
    await writeJob({
      ...job,
      state: "FAILED",
      finishedAt: new Date().toISOString(),
      error: { kind: "NO_API_KEY", message: "APIキーが設定されていません。設定画面で入力してください。" },
    });
    return { ok: true, requestId: job.requestId };
  }

  runningInThisWorker.add(job.requestId);
  await writeJob(job);
  const keepalive = setInterval(() => void chrome.runtime.getPlatformInfo(), KEEPALIVE_MS);

  void (async () => {
    try {
      const out = await runAudit({ requestId: job.requestId, provider, apiKey, model, input: parsed.data });
      await writeJob({
        ...job,
        state: "COMPLETED",
        finishedAt: new Date().toISOString(),
        result: out.result,
        claimCacheKey: out.claimCacheKey,
        downgraded: out.downgraded,
      });
    } catch (err) {
      await writeJob({ ...job, state: "FAILED", finishedAt: new Date().toISOString(), error: classify(err) });
    } finally {
      clearInterval(keepalive);
      runningInThisWorker.delete(job.requestId);
    }
  })();

  return { ok: true, requestId: job.requestId };
}

export default defineBackground(() => {
  void restrictSessionStorage();
  void markOrphanedJobInterrupted();
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "GeminiHall で根拠を監査",
      contexts: ["selection"],
    });
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || !info.selectionText) return;
    if (tab?.windowId !== undefined) {
      void chrome.sidePanel.open({ windowId: tab.windowId });
    }
    const pending: PendingInput = {
      claim: info.selectionText.slice(0, 4000),
      createdAt: new Date().toISOString(),
    };
    void chrome.storage.session.set({ [SESSION_KEYS.pendingInput]: pending });
  });

  chrome.runtime.onMessage.addListener((message: BackgroundMessage, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) return false;
    if (message.type === "START_AUDIT") {
      void startAudit(message.claim, message.context).then(sendResponse);
      return true;
    }
    if (message.type === "PING") {
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
});

import { InvalidClaimError, ModelOutputError, SchemaViolationError, UpstreamError, runAudit, type Credential } from "@geminihall/audit-core";
import { cacheIdentity } from "@geminihall/audit-core/identity";
import { AuditInputSchema } from "@geminihall/schema";
import { lookupPublic, submissionStatus, submitForPublication } from "../lib/api";
import { getPrivate, putPrivate } from "../lib/cache";
import { DEMO_CLAIM, demoResult } from "../lib/demo";
import { KEY_LOSS_NOTE, loadApiKeys, loadSettings, wasKeyEntered } from "../lib/settings";
import { acknowledgeWelcome, accessToken, completeSignIn, invalidateSession, planModels, signOut, startSignIn } from "../lib/siwc-session";
import {
  SESSION_KEYS,
  auditProviderOf,
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

async function updateJob(requestId: string, patch: Partial<AuditJob>) {
  const job = await readJob();
  if (job?.requestId === requestId) await writeJob({ ...job, ...patch });
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

const PLAN_ERROR_MESSAGES: Record<string, string> = {
  subscription_sharing_usage_limit_exceeded:
    "ChatGPT プランの利用上限に達しました。ChatGPT の設定の「使用状況」で、プラン全体またはこのアプリの上限を確認してください。",
  subscription_sharing_user_not_eligible: "このアカウントやワークスペースでは、ChatGPT プランを外部アプリで使えません。",
  subscription_sharing_usage_unavailable: "ChatGPT プランの利用状況を確認できませんでした。時間をおいて再実行してください。",
  subscription_sharing_user_unavailable: "ChatGPT のアカウント情報を一時的に確認できませんでした。時間をおいて再実行してください。",
  subscription_sharing_unsupported_capability:
    "この監査で使う機能（web 検索や出力形式の指定など）が、ChatGPT プラン経由では使えませんでした。",
  subscription_sharing_route_not_supported: "ChatGPT プラン経由では、この呼び出し方が許可されていませんでした。",
  subscription_sharing_invalid_user: "ChatGPT のログイン情報を確認できませんでした。もう一度ログインしてください。",
};

const SECRET_LIKE = /(Bearer\s+\S+|sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/gu;

function errorDetail(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined;
  const parts: string[] = [err.name];
  if (err instanceof UpstreamError) {
    if (err.status) parts.push(`HTTP ${err.status}`);
    if (err.code) parts.push(err.code);
  }
  parts.push(err.message.replace(SECRET_LIKE, "[redacted]").slice(0, 200));
  return parts.join(" / ");
}

function classify(err: unknown): { kind: JobErrorKind; message: string; status?: number; detail?: string } {
  return { ...classifyBase(err), detail: errorDetail(err) };
}

function classifyBase(err: unknown): { kind: JobErrorKind; message: string; status?: number } {
  if (err instanceof UpstreamError && err.code && PLAN_ERROR_MESSAGES[err.code]) {
    return { kind: "UPSTREAM_AI_UNAVAILABLE", status: err.status, message: PLAN_ERROR_MESSAGES[err.code]! };
  }
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

async function startAudit(claim: string, context: string | undefined, force: boolean): Promise<StartAuditResponse> {
  const settings = await loadSettings();
  const current = await readJob();
  if (current?.state === "RUNNING" && runningInThisWorker.has(current.requestId)) {
    return { ok: false, reason: "ALREADY_RUNNING" };
  }

  const uiProvider = settings.provider;
  const provider = auditProviderOf(uiProvider);
  const model = settings.models[uiProvider] || (uiProvider === "CHATGPT_PLAN" ? "gpt-6-astra" : "");
  const requestId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  if (settings.demoMode) {
    await writeJob({
      requestId,
      state: "COMPLETED",
      source: "DEMO",
      provider: "ANTHROPIC",
      model: "claude-opus-5-5",
      claim: DEMO_CLAIM,
      startedAt,
      finishedAt: startedAt,
      result: demoResult(requestId),
    });
    return { ok: true, requestId };
  }

  const parsed = AuditInputSchema.safeParse({ claim, context: context || undefined, locale: "ja" });
  if (!parsed.success) return { ok: false, reason: "INVALID_INPUT" };
  const input = parsed.data;
  const identity = await cacheIdentity(input);
  const base: AuditJob = {
    requestId,
    state: "RUNNING",
    source: "LIVE",
    provider,
    model,
    claim: input.claim,
    context: input.context,
    startedAt,
    claimCacheKey: identity.claimCacheKey,
  };

  if (!force) {
    const own = await getPrivate(identity.claimCacheKey, Date.now());
    if (own) {
      await writeJob({ ...base, state: "COMPLETED", source: "PRIVATE_CACHE", finishedAt: startedAt, result: own.result });
      return { ok: true, requestId };
    }
  }

  const usePlan = uiProvider === "CHATGPT_PLAN";
  const apiKey = usePlan ? undefined : (await loadApiKeys())[provider];
  const planToken = usePlan ? await accessToken() : null;
  const credential: Credential | null = usePlan
    ? planToken
      ? { kind: "CHATGPT_PLAN", accessToken: planToken }
      : null
    : apiKey
      ? { kind: "API_KEY", apiKey }
      : null;
  const needsLookup = !force && settings.publicLookup;
  const missingKeyMessage = usePlan
    ? "ChatGPT にログインしていません。設定画面の「Continue with ChatGPT」からログインしてください（試作機能）。"
    : (await wasKeyEntered(provider))
      ? KEY_LOSS_NOTE
      : "APIキーが設定されていません。設定画面で入力してください。";
  const missingKind: JobErrorKind = usePlan ? "NOT_SIGNED_IN" : "NO_API_KEY";

  if (!credential && !needsLookup) {
    await writeJob({
      ...base,
      state: "FAILED",
      finishedAt: startedAt,
      error: { kind: missingKind, message: missingKeyMessage },
    });
    return { ok: true, requestId };
  }

  runningInThisWorker.add(requestId);
  await writeJob(base);
  const keepalive = setInterval(() => void chrome.runtime.getPlatformInfo(), KEEPALIVE_MS);

  void (async () => {
    try {
      if (needsLookup) {
        const entry = await lookupPublic(identity.claimCacheKey).catch(() => null);
        if (entry) {
          await writeJob({ ...base, state: "COMPLETED", source: "PUBLIC", finishedAt: new Date().toISOString(), publicEntry: entry });
          return;
        }
      }
      if (!credential) {
        await writeJob({
          ...base,
          state: "FAILED",
          finishedAt: new Date().toISOString(),
          error: {
            kind: missingKind,
            message: `公開辞典に同じ事例はありませんでした。${usePlan ? "" : "監査するには APIキーが必要です。"}${missingKeyMessage}`,
          },
        });
        return;
      }
      const out = await runAudit({ requestId, provider, credential, model, input });
      await putPrivate(
        identity.claimCacheKey,
        { result: out.result, claim: input.claim, context: input.context, savedAt: new Date().toISOString() },
        Date.now(),
      );
      await writeJob({
        ...base,
        state: "COMPLETED",
        finishedAt: new Date().toISOString(),
        result: out.result,
        downgraded: out.downgraded,
      });
    } catch (err) {
      if (usePlan && err instanceof UpstreamError && (err.status === 401 || err.code === "subscription_sharing_invalid_user")) {
        await invalidateSession("ChatGPT のログインが無効になりました。もう一度ログインしてください。");
      }
      await writeJob({ ...base, state: "FAILED", finishedAt: new Date().toISOString(), error: classify(err) });
    } finally {
      clearInterval(keepalive);
      runningInThisWorker.delete(requestId);
    }
  })();

  return { ok: true, requestId };
}

async function submit(requestId: string): Promise<{ ok: boolean }> {
  const job = await readJob();
  if (!job || job.requestId !== requestId || !job.result || job.result.mode !== "LIVE") return { ok: false };
  if (job.source !== "LIVE" && job.source !== "PRIVATE_CACHE") return { ok: false };
  if (job.submission && job.submission.state !== "FAILED") return { ok: true };

  await updateJob(requestId, { submission: { state: "SENDING" } });
  try {
    const out = await submitForPublication({ claim: job.claim, context: job.context, result: job.result });
    await updateJob(
      requestId,
      out.ok
        ? { submission: { state: "PENDING", submissionId: out.submissionId } }
        : { submission: { state: "FAILED", message: out.message } },
    );
    return { ok: out.ok };
  } catch {
    await updateJob(requestId, { submission: { state: "FAILED", message: "GeminiHall のサーバーに接続できませんでした。" } });
    return { ok: false };
  }
}

async function refreshSubmission(requestId: string) {
  const job = await readJob();
  const id = job?.submission?.submissionId;
  if (!job || job.requestId !== requestId || !id) return;
  const status = await submissionStatus(id).catch(() => null);
  if (!status) return;
  await updateJob(requestId, {
    submission: {
      ...job.submission!,
      state: status.review_state as "PENDING" | "APPROVED" | "REJECTED",
      entryId: status.entry_id,
      publicationStatus: status.publication_status,
    },
  });
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
    switch (message.type) {
      case "START_AUDIT":
        void startAudit(message.claim, message.context, message.force === true).then(sendResponse);
        return true;
      case "SUBMIT_FOR_PUBLICATION":
        void submit(message.requestId).then(sendResponse);
        return true;
      case "REFRESH_SUBMISSION":
        void refreshSubmission(message.requestId).then(() => sendResponse({ ok: true }));
        return true;
      case "SIWC_START":
        void startSignIn().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
        return true;
      case "SIWC_CALLBACK":
        void completeSignIn(message.search).then(sendResponse);
        return true;
      case "SIWC_SIGN_OUT":
        void signOut().then(sendResponse);
        return true;
      case "SIWC_MODELS":
        void planModels().then(sendResponse);
        return true;
      case "SIWC_ACK_WELCOME":
        void acknowledgeWelcome().then(() => sendResponse({ ok: true }));
        return true;
      case "PING":
        sendResponse({ ok: true });
        return false;
      default:
        return false;
    }
  });
});

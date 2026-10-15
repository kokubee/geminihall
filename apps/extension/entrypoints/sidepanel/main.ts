import { CONSENT_TEXT } from "../../lib/config";
import { h, renderResult, viewFromEntry, viewFromResult } from "../../lib/render";
import { KEY_LOSS_NOTE, loadApiKeys, loadSettings, maskKey, saveSettings, setApiKey, wasKeyEntered } from "../../lib/settings";
import {
  LOCAL_KEYS,
  SESSION_KEYS,
  auditProviderOf,
  type AuditJob,
  type PendingInput,
  type Settings,
  type SiwcRegistration,
  type SiwcStatus,
  type StartAuditResponse,
  type UiProvider,
} from "../../lib/state";
import type { PlanModel } from "../../lib/siwc";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const providerEl = $<HTMLSelectElement>("provider");
const modelEl = $<HTMLInputElement>("model");
const keyEl = $<HTMLInputElement>("api-key");
const keyStatusEl = $<HTMLParagraphElement>("key-status");
const publicLookupEl = $<HTMLInputElement>("public-lookup");
const settingsForm = $<HTMLFormElement>("settings-form");
const settingsPanel = $<HTMLDetailsElement>("settings");
const clearKeyBtn = $<HTMLButtonElement>("clear-key");
const keyFields = $<HTMLDivElement>("key-fields");
const keyNotice = $<HTMLDivElement>("key-notice");
const siwcSection = $<HTMLDivElement>("siwc-section");
const siwcStatusEl = $<HTMLParagraphElement>("siwc-status");
const siwcLoginBtn = $<HTMLButtonElement>("siwc-login");
const siwcLogoutBtn = $<HTMLButtonElement>("siwc-logout");
const siwcWelcome = $<HTMLDivElement>("siwc-welcome");
const siwcWelcomeOk = $<HTMLButtonElement>("siwc-welcome-ok");
const planModelField = $<HTMLLabelElement>("plan-model-field");
const planModelEl = $<HTMLSelectElement>("plan-model");
const demoEl = $<HTMLInputElement>("demo-mode");
const modeBadge = $<HTMLSpanElement>("mode-badge");
const claimEl = $<HTMLTextAreaElement>("claim");
const contextEl = $<HTMLTextAreaElement>("context");
const runBtn = $<HTMLButtonElement>("run");
const rerunBtn = $<HTMLButtonElement>("rerun");
const inputErrorEl = $<HTMLParagraphElement>("input-error");
const statusEl = $<HTMLElement>("status");
const resultEl = $<HTMLElement>("result");
const submissionEl = $<HTMLElement>("submission");

let settings: Settings;
let timer: number | undefined;
let currentJob: AuditJob | undefined;

function isPlan() {
  return providerEl.value === "CHATGPT_PLAN";
}

function renderProviderFields() {
  const plan = isPlan();
  keyFields.hidden = plan;
  keyNotice.hidden = plan;
  clearKeyBtn.hidden = plan;
  siwcSection.hidden = !plan;
  if (plan) void refreshSiwc();
}

async function refreshSiwc() {
  const status = (await chrome.storage.session.get(SESSION_KEYS.siwcStatus))[SESSION_KEYS.siwcStatus] as SiwcStatus | undefined;
  const tokens = (await chrome.storage.session.get(SESSION_KEYS.siwcTokens))[SESSION_KEYS.siwcTokens];
  const reg = (await chrome.storage.local.get(LOCAL_KEYS.siwcRegistration))[LOCAL_KEYS.siwcRegistration] as SiwcRegistration | undefined;
  const signedIn = Boolean(tokens) && status?.state !== "SIGNED_OUT";
  siwcLoginBtn.hidden = signedIn && status?.state !== "NO_PLAN";
  siwcLogoutBtn.hidden = !signedIn;
  siwcLoginBtn.disabled = status?.state === "SIGNING_IN";
  planModelField.hidden = !(signedIn && status?.state !== "NO_PLAN");
  siwcWelcome.hidden = !(signedIn && reg && !reg.welcomed && status?.state === "SIGNED_IN");
  const who = reg?.email ?? "ChatGPT アカウント";
  siwcStatusEl.textContent =
    status?.state === "SIGNING_IN"
      ? "別のタブで ChatGPT にログインしてください…"
      : status?.state === "ERROR"
        ? status.message
        : status?.state === "NO_PLAN"
          ? `${who} でログインしましたが、ChatGPT プランの利用が許可されていません。「Continue with ChatGPT」から許可してください。`
          : signedIn
            ? `ログイン中: ${who}（ブラウザを閉じるか拡張機能を更新するまで有効）`
            : status?.state === "SIGNED_OUT" && status.message
              ? status.message
              : reg
                ? `前回は ${who} でログインしていました。もう一度ログインしてください。`
                : "まだログインしていません。";
  if (!planModelField.hidden && planModelEl.options.length === 0) await loadPlanModels();
}

async function loadPlanModels() {
  const models = ((await chrome.runtime.sendMessage({ type: "SIWC_MODELS" }).catch(() => [])) ?? []) as PlanModel[];
  planModelEl.replaceChildren(...models.map((m) => new Option(m.displayName, m.slug)));
  if (!models.length) {
    planModelEl.append(new Option("（モデル一覧を取得できませんでした）", ""));
    return;
  }
  const saved = settings.models.CHATGPT_PLAN;
  planModelEl.value = models.some((m) => m.slug === saved) ? saved : models[0]!.slug;
  if (planModelEl.value !== saved) {
    settings = { ...settings, models: { ...settings.models, CHATGPT_PLAN: planModelEl.value } };
    await saveSettings(settings);
  }
}

planModelEl.addEventListener("change", async () => {
  settings = { ...settings, models: { ...settings.models, CHATGPT_PLAN: planModelEl.value } };
  await saveSettings(settings);
});

siwcLoginBtn.addEventListener("click", async () => {
  settings = { ...settings, provider: "CHATGPT_PLAN" };
  await saveSettings(settings);
  await chrome.runtime.sendMessage({ type: "SIWC_START" }).catch(() => undefined);
});

siwcLogoutBtn.addEventListener("click", async () => {
  siwcLogoutBtn.disabled = true;
  await chrome.runtime.sendMessage({ type: "SIWC_SIGN_OUT" }).catch(() => undefined);
  siwcLogoutBtn.disabled = false;
  planModelEl.replaceChildren();
});

siwcWelcomeOk.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "SIWC_ACK_WELCOME" }).catch(() => undefined);
  siwcWelcome.hidden = true;
});

async function refreshKeyStatus() {
  if (isPlan()) return;
  const keys = await loadApiKeys();
  const provider = auditProviderOf(providerEl.value as UiProvider);
  const key = keys[provider];
  keyStatusEl.textContent = key
    ? `入力済み: ${maskKey(key)}（ブラウザを閉じるか拡張機能を更新するまで有効）`
    : (await wasKeyEntered(provider))
      ? KEY_LOSS_NOTE
      : "このAIのキーは未設定です。";
  keyStatusEl.classList.toggle("key-lost", !key && (await wasKeyEntered(provider)));
  keyEl.value = "";
  keyEl.placeholder = key ? "変更する場合だけ入力" : "未設定";
  if (!key && !settings.demoMode) settingsPanel.open = true;
}

function renderMode() {
  demoEl.checked = settings.demoMode;
  modeBadge.textContent = settings.demoMode ? "DEMO" : "LIVE";
  modeBadge.className = settings.demoMode ? "badge badge-demo" : "badge";
  runBtn.textContent = settings.demoMode ? "記録済みのデモを表示" : "監査する";
}

function fillSettingsForm() {
  providerEl.value = settings.provider;
  modelEl.value = settings.models[settings.provider];
  renderProviderFields();
  publicLookupEl.checked = settings.publicLookup;
  renderMode();
}

providerEl.addEventListener("change", async () => {
  const p = providerEl.value as UiProvider;
  modelEl.value = settings.models[p];
  settings = { ...settings, provider: p };
  await saveSettings(settings);
  renderProviderFields();
  void refreshKeyStatus();
});

settingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const p = providerEl.value as UiProvider;
  const model = isPlan() ? settings.models.CHATGPT_PLAN : modelEl.value.trim();
  settings = {
    ...settings,
    provider: p,
    models: { ...settings.models, [p]: model || settings.models[p] },
    publicLookup: publicLookupEl.checked,
    costNoticeAccepted: true,
  };
  await saveSettings(settings);
  const key = keyEl.value.trim();
  if (key && p !== "CHATGPT_PLAN") await setApiKey(p, key);
  await refreshKeyStatus();
  keyStatusEl.textContent += "（設定を保存しました）";
});

clearKeyBtn.addEventListener("click", async () => {
  if (isPlan()) return;
  await setApiKey(providerEl.value as "ANTHROPIC" | "OPENAI", null);
  await refreshKeyStatus();
});

demoEl.addEventListener("change", async () => {
  settings = { ...settings, demoMode: demoEl.checked };
  await saveSettings(settings);
  renderMode();
});

function stopTimer() {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
}

function renderSubmission(job: AuditJob) {
  submissionEl.replaceChildren();
  submissionEl.hidden = true;
  const canSubmit = job.state === "COMPLETED" && job.result?.mode === "LIVE" && (job.source === "LIVE" || job.source === "PRIVATE_CACHE");
  if (!canSubmit) return;
  submissionEl.hidden = false;
  const sub = job.submission;
  submissionEl.append(h("h2", {}, "公開辞典への掲載"));

  if (!sub || sub.state === "FAILED") {
    if (sub?.message) submissionEl.append(h("p", { class: "error" }, sub.message));
    if (job.result?.contains_pii) {
      submissionEl.append(h("p", { class: "hint" }, "入力に個人情報が含まれている可能性があるため、申請できません。"));
      return;
    }
    const btn = h("button", { type: "button" }, "公開に同意して申請する") as HTMLButtonElement;
    btn.addEventListener("click", async () => {
      if (!window.confirm(CONSENT_TEXT)) return;
      btn.disabled = true;
      await chrome.runtime.sendMessage({ type: "SUBMIT_FOR_PUBLICATION", requestId: job.requestId }).catch(() => undefined);
    });
    submissionEl.append(
      h("p", { class: "hint" }, "この結果をほかの利用者の役に立てたい場合は、掲載を申請できます。管理者が根拠と個人情報の有無を確認してから掲載します。"),
      btn,
    );
    return;
  }

  const label: Record<string, string> = {
    SENDING: "申請を送信しています…",
    PENDING: "申請済みです。管理者の審査を待っています。",
    APPROVED: sub.publicationStatus === "RETRACTED" ? "掲載後に撤回されました。" : "審査を通過し、公開辞典に掲載されました。",
    REJECTED: "審査の結果、今回は掲載されませんでした。",
  };
  submissionEl.append(h("p", {}, label[sub.state] ?? sub.state));
}

function renderJob(job: AuditJob | undefined) {
  currentJob = job;
  stopTimer();
  statusEl.replaceChildren();
  resultEl.replaceChildren();
  statusEl.hidden = true;
  resultEl.hidden = true;
  submissionEl.hidden = true;
  rerunBtn.hidden = true;
  runBtn.disabled = false;
  if (!job) return;

  if (!claimEl.value) claimEl.value = job.claim;
  if (!contextEl.value && job.context) contextEl.value = job.context;

  if (job.state === "RUNNING") {
    runBtn.disabled = true;
    statusEl.hidden = false;
    const elapsed = h("span", {}, "");
    const tick = () => {
      elapsed.textContent = `${Math.max(0, Math.round((Date.now() - Date.parse(job.startedAt)) / 1000))}秒`;
    };
    tick();
    timer = window.setInterval(tick, 1000);
    statusEl.append(
      h("div", { class: "running" }, h("span", { class: "spinner", "aria-hidden": "true" }), "監査しています（主張の分解 → 検索による根拠照合 → 判定）… ", elapsed),
      h("p", { class: "hint" }, "このパネルを閉じても監査は続きます。開き直すと結果が表示されます。"),
    );
    return;
  }

  if (job.state === "FAILED" || job.state === "INTERRUPTED") {
    statusEl.hidden = false;
    statusEl.append(h("p", { class: "error" }, job.error?.message ?? "監査に失敗しました。"));
    if (job.error?.detail) statusEl.append(h("p", { class: "hint" }, `詳細: ${job.error.detail}`));
    if (job.error?.kind === "NO_API_KEY" || job.error?.status === 401 || job.error?.status === 404) settingsPanel.open = true;
    return;
  }

  const view = job.result ? viewFromResult(job.result) : job.publicEntry ? viewFromEntry(job.publicEntry) : null;
  if (job.state === "COMPLETED" && view) {
    resultEl.hidden = false;
    resultEl.append(renderResult(job, view));
    rerunBtn.hidden = job.source !== "PRIVATE_CACHE" && job.source !== "PUBLIC";
    renderSubmission(job);
  }
}

async function start(force: boolean) {
  inputErrorEl.hidden = true;
  const claim = claimEl.value.trim();
  if (!claim && !settings.demoMode) {
    inputErrorEl.textContent = "監査する主張を入力してください。";
    inputErrorEl.hidden = false;
    return;
  }
  if (!settings.demoMode && !isPlan() && !settings.costNoticeAccepted) {
    const ok = window.confirm("監査はあなたのAPIキーで実行され、利用料はあなたのアカウントに請求されます。続けますか？");
    if (!ok) return;
    settings = { ...settings, costNoticeAccepted: true };
    await saveSettings(settings);
  }
  if (settings.demoMode) {
    claimEl.value = "";
    contextEl.value = "";
  }
  runBtn.disabled = true;
  const res = (await chrome.runtime
    .sendMessage({ type: "START_AUDIT", claim, context: contextEl.value.trim() || undefined, force })
    .catch(() => undefined)) as StartAuditResponse | undefined;
  if (!res) {
    runBtn.disabled = false;
    inputErrorEl.textContent = "拡張機能の内部で監査を開始できませんでした。パネルを開き直してください。";
    inputErrorEl.hidden = false;
    return;
  }
  if (!res.ok) {
    runBtn.disabled = false;
    inputErrorEl.textContent =
      res.reason === "ALREADY_RUNNING" ? "別の監査が実行中です。完了までお待ちください。" : "入力内容を確認してください（主張は4000文字まで、文脈は2000文字まで）。";
    inputErrorEl.hidden = false;
  }
}

runBtn.addEventListener("click", () => void start(false));
rerunBtn.addEventListener("click", () => void start(true));

async function applyPendingInput() {
  const stored = await chrome.storage.session.get(SESSION_KEYS.pendingInput);
  const pending = stored[SESSION_KEYS.pendingInput] as PendingInput | undefined;
  if (!pending) return;
  claimEl.value = pending.claim;
  contextEl.value = "";
  await chrome.storage.session.remove(SESSION_KEYS.pendingInput);
  claimEl.focus();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session") return;
  if ((changes[SESSION_KEYS.siwcStatus] || changes[SESSION_KEYS.siwcTokens]) && isPlan()) void refreshSiwc();
  const jobChange = changes[SESSION_KEYS.job];
  if (jobChange) renderJob(jobChange.newValue as AuditJob | undefined);
  if (changes[SESSION_KEYS.pendingInput]?.newValue) void applyPendingInput();
});

async function init() {
  settings = await loadSettings();
  fillSettingsForm();
  await refreshKeyStatus();
  const stored = await chrome.storage.session.get(SESSION_KEYS.job);
  renderJob(stored[SESSION_KEYS.job] as AuditJob | undefined);
  await applyPendingInput();
  const sub = currentJob?.submission;
  if (currentJob && sub?.submissionId && sub.state === "PENDING") {
    await chrome.runtime.sendMessage({ type: "REFRESH_SUBMISSION", requestId: currentJob.requestId }).catch(() => undefined);
  }
}

void init();

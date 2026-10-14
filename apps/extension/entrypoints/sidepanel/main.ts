import { h, renderResult } from "../../lib/render";
import { loadApiKeys, loadSettings, maskKey, saveSettings, setApiKey } from "../../lib/settings";
import {
  SESSION_KEYS,
  type AuditJob,
  type PendingInput,
  type Settings,
  type StartAuditResponse,
} from "../../lib/state";
import type { Provider } from "@geminihall/schema";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const providerEl = $<HTMLSelectElement>("provider");
const modelEl = $<HTMLInputElement>("model");
const keyEl = $<HTMLInputElement>("api-key");
const keyStatusEl = $<HTMLParagraphElement>("key-status");
const settingsForm = $<HTMLFormElement>("settings-form");
const settingsPanel = $<HTMLDetailsElement>("settings");
const clearKeyBtn = $<HTMLButtonElement>("clear-key");
const claimEl = $<HTMLTextAreaElement>("claim");
const contextEl = $<HTMLTextAreaElement>("context");
const runBtn = $<HTMLButtonElement>("run");
const inputErrorEl = $<HTMLParagraphElement>("input-error");
const statusEl = $<HTMLElement>("status");
const resultEl = $<HTMLElement>("result");

let settings: Settings;
let timer: number | undefined;

async function refreshKeyStatus() {
  const keys = await loadApiKeys();
  const provider = providerEl.value as Provider;
  const key = keys[provider];
  keyStatusEl.textContent = key ? `保存済み: ${maskKey(key)}` : "このAIのキーは未設定です。";
  keyEl.value = "";
  keyEl.placeholder = key ? "変更する場合だけ入力" : "未設定";
  if (!key) settingsPanel.open = true;
}

function fillSettingsForm() {
  providerEl.value = settings.provider;
  modelEl.value = settings.models[settings.provider];
}

providerEl.addEventListener("change", () => {
  const p = providerEl.value as Provider;
  modelEl.value = settings.models[p];
  void refreshKeyStatus();
});

settingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const p = providerEl.value as Provider;
  const model = modelEl.value.trim();
  settings = {
    ...settings,
    provider: p,
    models: { ...settings.models, [p]: model || settings.models[p] },
    costNoticeAccepted: true,
  };
  await saveSettings(settings);
  const key = keyEl.value.trim();
  if (key) await setApiKey(p, key);
  await refreshKeyStatus();
  keyStatusEl.textContent += "（設定を保存しました）";
});

clearKeyBtn.addEventListener("click", async () => {
  await setApiKey(providerEl.value as Provider, null);
  await refreshKeyStatus();
});

function stopTimer() {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
}

function renderJob(job: AuditJob | undefined) {
  stopTimer();
  statusEl.replaceChildren();
  resultEl.replaceChildren();
  statusEl.hidden = true;
  resultEl.hidden = true;
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
    if (job.error?.kind === "NO_API_KEY" || job.error?.status === 401 || job.error?.status === 404) settingsPanel.open = true;
    return;
  }

  if (job.state === "COMPLETED" && job.result) {
    resultEl.hidden = false;
    resultEl.append(renderResult(job));
  }
}

runBtn.addEventListener("click", async () => {
  inputErrorEl.hidden = true;
  const claim = claimEl.value.trim();
  if (!claim) {
    inputErrorEl.textContent = "監査する主張を入力してください。";
    inputErrorEl.hidden = false;
    return;
  }
  if (!settings.costNoticeAccepted) {
    const ok = window.confirm("監査はあなたのAPIキーで実行され、利用料はあなたのアカウントに請求されます。続けますか？");
    if (!ok) return;
    settings = { ...settings, costNoticeAccepted: true };
    await saveSettings(settings);
  }
  runBtn.disabled = true;
  const res = (await chrome.runtime
    .sendMessage({ type: "START_AUDIT", claim, context: contextEl.value.trim() || undefined })
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
});

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
}

void init();

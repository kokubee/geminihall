import type { CallbackOutcome } from "../../lib/siwc-session";

const message = document.getElementById("message")!;
const search = window.location.search;
window.history.replaceState(null, "", window.location.pathname);

const outcome = (await chrome.runtime.sendMessage({ type: "SIWC_CALLBACK", search }).catch(() => null)) as CallbackOutcome | null;

if (!outcome) {
  message.textContent = "ログインの確認ができませんでした。GeminiHall のパネルからもう一度ログインしてください。";
} else if (!outcome.ok) {
  message.textContent = outcome.message;
} else {
  message.textContent = outcome.planEnabled
    ? "ログインしました。GeminiHall のパネルに戻ってください。"
    : "ログインしましたが、ChatGPT プランの利用が許可されませんでした。パネルの設定から、もう一度許可してください。";
  window.setTimeout(() => window.close(), 1500);
}

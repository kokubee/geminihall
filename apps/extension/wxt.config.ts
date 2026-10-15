import { readFileSync } from "node:fs";
import { defineConfig } from "wxt";

const API_BASE = process.env.WXT_API_BASE ?? "https://geminihall.cc";
const SIWC = process.env.WXT_SIWC === "1";
const BUILD_STAMP = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
}).format(new Date());
const VERSION = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version;
const CHANNEL = SIWC ? "試作（ChatGPTログイン）" : "";

export default defineConfig({
  manifestVersion: 3,
  filterEntrypoints: SIWC ? undefined : ["background", "sidepanel"],
  manifest: {
    name: "GeminiHall",
    version: VERSION,
    version_name: [VERSION, CHANNEL, BUILD_STAMP].filter(Boolean).join(" "),
    description: SIWC
      ? "AIの回答を、検索で取得した資料と照合して監査します。ChatGPT のログイン（試作）か、自分の API キーで使えます。"
      : "AIの回答を、検索で取得した資料と照合して監査します。自分の API キーで使えます。",
    permissions: ["storage", "sidePanel", "contextMenus", ...(SIWC ? ["declarativeNetRequest"] : [])],
    host_permissions: [
      "https://api.anthropic.com/*",
      "https://api.openai.com/*",
      `${new URL(API_BASE).origin}/*`,
      ...(SIWC ? ["https://auth.openai.com/*", "http://127.0.0.1/*"] : []),
    ],
    ...(SIWC
      ? { web_accessible_resources: [{ resources: ["siwc-callback.html"], matches: ["https://auth.openai.com/*", "http://127.0.0.1/*"] }] }
      : {}),
    action: { default_title: "GeminiHall を開く" },
    minimum_chrome_version: "116",
  },
});

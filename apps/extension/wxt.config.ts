import { readFileSync } from "node:fs";
import { defineConfig } from "wxt";

const API_BASE = process.env.WXT_API_BASE ?? "https://geminihall.cc";
const BUILD_STAMP = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
}).format(new Date());
const VERSION = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version;
const CHANNEL = process.env.GEMINIHALL_CHANNEL ?? "試作（ChatGPTログイン）";

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: "GeminiHall",
    version: VERSION,
    version_name: `${VERSION} ${CHANNEL} ${BUILD_STAMP}`,
    description: "AIの回答を、検索で取得した資料と照合して監査します。ChatGPT のログイン（試作）か、自分の API キーで使えます。",
    permissions: ["storage", "sidePanel", "contextMenus", "declarativeNetRequest"],
    host_permissions: [
      "https://api.anthropic.com/*",
      "https://api.openai.com/*",
      `${new URL(API_BASE).origin}/*`,
      "https://auth.openai.com/*",
      "http://127.0.0.1/*",
    ],
    web_accessible_resources: [{ resources: ["siwc-callback.html"], matches: ["https://auth.openai.com/*", "http://127.0.0.1/*"] }],
    action: { default_title: "GeminiHall を開く" },
    minimum_chrome_version: "116",
  },
});

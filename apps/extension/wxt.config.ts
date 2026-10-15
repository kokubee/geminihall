import { defineConfig } from "wxt";

const API_BASE = process.env.WXT_API_BASE ?? "https://geminihall.cc";

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: "GeminiHall",
    description: "AIの回答を、あなた自身のAPIキーで根拠付きに監査します。",
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

import { defineConfig } from "wxt";

const API_BASE = process.env.WXT_API_BASE ?? "https://geminihall.cc";

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: "GeminiHall",
    description: "AIの回答を、あなた自身のAPIキーで根拠付きに監査します。",
    permissions: ["storage", "sidePanel", "contextMenus"],
    host_permissions: ["https://api.anthropic.com/*", "https://api.openai.com/*", `${new URL(API_BASE).origin}/*`],
    action: { default_title: "GeminiHall を開く" },
    minimum_chrome_version: "116",
  },
});

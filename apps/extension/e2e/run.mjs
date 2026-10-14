import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(here, "../.output/chrome-mv3");
const FAKE_KEY = "sk-ant-e2e-fake-key-0123456789abcdef0123456789";
const SOURCE = "https://www.example.go.jp/constitution";
const results = [];

function modelOutput(urls) {
  return {
    is_valid_input: true,
    contains_pii: false,
    audit_status: "CONFIRMED_HALLUCINATION",
    evidence_status: "VERIFIED",
    severity_score: 4,
    category: "Chronological_Error",
    ttl_category: "HISTORICAL_FACT",
    audit_trace: {
      decomposed_claims: [
        { sub_claim: "日本国憲法は1950年に施行された", verification_target: "日本国憲法の施行日", status: "CONTRADICTED" },
      ],
      alignment_reasoning: "取得した資料では施行日は1947年5月3日である。",
      abstention_reason: null,
    },
    hallucinated_claim: "日本国憲法は1950年に施行された",
    correction: "日本国憲法は1947年5月3日に施行された",
    unverified_notes: null,
    evidence_sources: urls.map((url) => ({ title: "日本国憲法の施行", url, snippet: "昭和22年5月3日から施行" })),
    estimated_error_pattern: "年号の取り違え",
    limitations: [],
  };
}

function anthropicBody(citedUrls) {
  return {
    id: "msg_e2e",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [
      { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "q" } },
      {
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_1",
        content: [{ type: "web_search_result", url: SOURCE, title: "t", encrypted_content: "x", page_age: null }],
      },
      { type: "text", text: JSON.stringify(modelOutput(citedUrls)) },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, result: "PASS" });
  } catch (err) {
    results.push({ name, result: "FAIL", detail: err instanceof Error ? err.message : String(err) });
  }
}

const userDataDir = mkdtempSync(path.join(tmpdir(), "geminihall-e2e-"));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});

const outbound = [];
let nextBody = anthropicBody([SOURCE]);
let delayMs = 0;
await context.route(/^https:\/\/api\.(anthropic|openai)\.com\//, async (route) => {
  const req = route.request();
  outbound.push({ url: req.url(), headers: await req.allHeaders(), body: req.postData() ?? "" });
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(nextBody) });
});
const otherHosts = [];
context.on("request", (req) => {
  const u = new URL(req.url());
  if (u.protocol === "chrome-extension:" || u.hostname === "api.anthropic.com" || u.hostname === "api.openai.com") return;
  otherHosts.push(req.url());
});
const consoleLines = [];

let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent("serviceworker");
sw.on("console", (m) => consoleLines.push(m.text()));
const extensionId = new URL(sw.url()).host;
const panelUrl = `chrome-extension://${extensionId}/sidepanel.html`;

async function openSettings(p) {
  await p.evaluate(() => {
    document.getElementById("settings").open = true;
  });
}

async function openPanel() {
  const page = await context.newPage();
  page.on("console", (m) => consoleLines.push(m.text()));
  await page.goto(panelUrl);
  await page.waitForSelector("#run");
  return page;
}

let page = await openPanel();

await check("設定: 偽キーを保存でき、パネルには伏せ字だけが表示される", async () => {
  await page.selectOption("#provider", "ANTHROPIC");
  await page.fill("#api-key", FAKE_KEY);
  await page.click("#settings-form button[type=submit]");
  await page.waitForFunction(() => document.querySelector("#key-status")?.textContent?.includes("保存済み"));
  const status = await page.textContent("#key-status");
  assert.ok(!status.includes(FAKE_KEY));
  assert.equal(await page.inputValue("#api-key"), "");
});

await check("受入1: 実行中にパネルを閉じて開き直すと実行中表示、完了後は audit_trace 付きの結果が復元される", async () => {
  delayMs = 4000;
  await page.fill("#claim", "日本国憲法は1950年に施行された");
  await page.click("#run");
  await page.waitForSelector("#status .running");
  await page.close();
  page = await openPanel();
  await page.waitForSelector("#status .running", { timeout: 3000 });
  await page.waitForSelector(".result .verdict", { timeout: 15000 });
  await page.close();
  page = await openPanel();
  await page.waitForSelector(".result .verdict", { timeout: 5000 });
  const verdict = await page.textContent(".verdict-label");
  assert.equal(verdict, "誤りを確認");
  const steps = await page.$$eval(".trace .step-title", (els) => els.map((e) => e.textContent));
  assert.equal(steps.length, 3);
  assert.ok((await page.textContent(".subclaims")).includes("日本国憲法の施行日"));
  assert.ok((await page.textContent(".sources")).includes("取得確認済み"));
  await page.setViewportSize({ width: 400, height: 900 });
  await page.screenshot({ path: path.resolve(here, "../.output/e2e-result.png"), fullPage: true });
  delayMs = 0;
});

await check("受入3: 検索で取得していない URL を根拠にした断定は、判定保留に格下げして表示される", async () => {
  nextBody = anthropicBody(["https://fabricated.example.com/fake"]);
  await page.fill("#claim", "日本国憲法は1951年に施行された");
  await page.click("#run");
  await page.waitForFunction(() => document.querySelector(".verdict-label")?.textContent === "判定を保留", null, { timeout: 15000 });
  assert.ok((await page.textContent(".notice")).includes("判定を保留に切り替えました"));
  assert.ok((await page.textContent(".sources")).includes("未確認"));
});

await check("受入2: キーは storage.session だけにあり、local・各社API以外の通信・コンソール・リクエスト本文に現れない", async () => {
  const stores = await sw.evaluate(async () => ({
    local: JSON.stringify(await chrome.storage.local.get(null)),
    session: JSON.stringify(await chrome.storage.session.get(null)),
  }));
  assert.ok(!stores.local.includes(FAKE_KEY), "key found in storage.local");
  assert.ok(stores.session.includes(FAKE_KEY), "key missing from storage.session");
  assert.equal(otherHosts.length, 0, `unexpected hosts: ${otherHosts.join(", ")}`);
  assert.ok(outbound.length >= 2);
  for (const r of outbound) {
    assert.equal(new URL(r.url).hostname, "api.anthropic.com");
    assert.equal(r.headers["x-api-key"], FAKE_KEY);
    assert.equal(r.headers["anthropic-dangerous-direct-browser-access"], "true");
    assert.ok(!r.body.includes(FAKE_KEY), "key found in request body");
  }
  assert.ok(!consoleLines.some((l) => l.includes(FAKE_KEY)), "key found in console output");
});

await check("キー隔離: storage.session のアクセスレベルが TRUSTED_CONTEXTS で、manifest に content script がない", async () => {
  const manifest = await sw.evaluate(() => chrome.runtime.getManifest());
  assert.equal(manifest.content_scripts, undefined);
  const level = await sw.evaluate(async () => {
    try {
      await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
      return "ok";
    } catch (e) {
      return String(e);
    }
  });
  assert.equal(level, "ok");
});

await check("キー未設定: キーを消して実行すると、設定を促すエラーになり通信しない", async () => {
  const before = outbound.length;
  await openSettings(page);
  await page.click("#clear-key");
  await page.waitForFunction(() => document.querySelector("#key-status")?.textContent?.includes("未設定"));
  await page.fill("#claim", "日本国憲法は1952年に施行された");
  await page.click("#run");
  await page.waitForSelector("#status .error", { timeout: 5000 });
  assert.ok((await page.textContent("#status .error")).includes("APIキーが設定されていません"));
  assert.equal(outbound.length, before);
});

await check("HTTP 401: キーが拒否されたら設定確認を促す", async () => {
  await openSettings(page);
  await page.fill("#api-key", FAKE_KEY);
  await page.click("#settings-form button[type=submit]");
  await page.waitForFunction(() => document.querySelector("#key-status")?.textContent?.includes("保存済み"));
  await context.unroute(/^https:\/\/api\.(anthropic|openai)\.com\//);
  await context.route(/^https:\/\/api\.anthropic\.com\//, (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }),
    }),
  );
  await page.fill("#claim", "日本国憲法は1953年に施行された");
  await page.click("#run");
  await page.waitForSelector("#status .error", { timeout: 10000 });
  assert.ok((await page.textContent("#status .error")).includes("APIキーが受け付けられませんでした"));
});

await page.screenshot({ path: path.resolve(here, "../.output/e2e-last.png"), fullPage: true });
await context.close();

for (const r of results) console.log(`${r.result}  ${r.name}${r.detail ? `\n      ${r.detail}` : ""}`);
process.exit(results.every((r) => r.result === "PASS") ? 0 : 1);

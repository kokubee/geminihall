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
const serverCalls = [];
let nextBody = anthropicBody([SOURCE]);
let delayMs = 0;
let aiStatus = 200;
const publicEntries = new Map();
await context.route(/^https:\/\/api\.(anthropic|openai)\.com\//, async (route) => {
  const req = route.request();
  outbound.push({ url: req.url(), headers: await req.allHeaders(), body: req.postData() ?? "" });
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  if (aiStatus !== 200) {
    await route.fulfill({
      status: aiStatus,
      contentType: "application/json",
      body: JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }),
    });
    return;
  }
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(nextBody) });
});
await context.route(/^https:\/\/geminihall\.cc\//, async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  serverCalls.push({ method: req.method(), path: url.pathname, query: url.search, headers: await req.allHeaders(), body: req.postData() ?? "" });
  if (url.pathname === "/api/public/lookup") {
    const entry = publicEntries.get(url.searchParams.get("key"));
    await route.fulfill(
      entry
        ? { status: 200, contentType: "application/json", body: JSON.stringify({ entry }) }
        : { status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_FOUND", message: "none", request_id: null } }) },
    );
    return;
  }
  if (url.pathname === "/api/submissions" && req.method() === "POST") {
    const body = JSON.parse(req.postData() ?? "{}");
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ submission_id: body.result.request_id, review_state: "PENDING" }) });
    return;
  }
  if (url.pathname.startsWith("/api/submissions/")) {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ review_state: "APPROVED", entry_id: "e1", publication_status: "PUBLISHED" }) });
    return;
  }
  await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
});
const otherHosts = [];
context.on("request", (req) => {
  const u = new URL(req.url());
  if (u.protocol === "chrome-extension:" || ["api.anthropic.com", "api.openai.com", "geminihall.cc"].includes(u.hostname)) return;
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
  await page.waitForFunction(() => document.querySelector("#key-status")?.textContent?.includes("入力済み"));
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
  await page.waitForFunction(() => document.querySelector("#key-status")?.textContent?.includes("入力済み"));
  aiStatus = 401;
  await page.fill("#claim", "日本国憲法は1953年に施行された");
  await page.click("#run");
  await page.waitForSelector("#status .error", { timeout: 10000 });
  assert.ok((await page.textContent("#status .error")).includes("APIキーが受け付けられませんでした"));
  aiStatus = 200;
});

await check("キャッシュ: 同じ主張の再監査はブラウザ内の結果を再利用し、AIを呼ばない。「もう一度監査する」でAIを呼ぶ", async () => {
  nextBody = anthropicBody([SOURCE]);
  const before = outbound.length;
  await page.fill("#claim", "日本国憲法は1950年に施行された");
  await page.click("#run");
  await page.waitForSelector(".result .verdict", { timeout: 10000 });
  assert.equal(outbound.length, before);
  assert.ok((await page.textContent(".result")).includes("以前に行った監査の結果を再利用"));
  await page.click("#rerun");
  await page.waitForFunction((n) => !document.querySelector("#rerun") || document.querySelector("#rerun").hidden, null, { timeout: 15000 });
  await page.waitForSelector(".result .verdict", { timeout: 15000 });
  assert.equal(outbound.length, before + 1);
});

await check("受入(公開照会): 公開辞典に事例があればAIを呼ばずに表示し、送るのはハッシュ値だけ", async () => {
  const claim = "公開辞典に載っている主張";
  const key = await sw.evaluate(async (c) => {
    const norm = c.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
    const hex = async (t) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const fp = await hex("ctx-v1|");
    return hex([norm, fp, "2026-10-15.3", "ja"].join("|"));
  }, claim);
  const out = modelOutput([SOURCE]);
  publicEntries.set(key, {
    entry_id: "11111111-1111-4111-8111-111111111111",
    publication_status: "PUBLISHED",
    claim_cache_key: key,
    audit_status: out.audit_status,
    category: out.category,
    severity_score: out.severity_score,
    sanitized_title: "公開済みの事例タイトル",
    sanitized_claim: claim,
    correction: out.correction,
    evidence_sources: out.evidence_sources.map((s) => ({ ...s, verified: true })),
    audit_trace: out.audit_trace,
    limitations: [],
    estimated_error_pattern: null,
    ttl_category: "HISTORICAL_FACT",
    auditor: { provider: "ANTHROPIC", model: "claude-opus-5-5" },
    verified_at: "2026-10-15T00:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
    is_expired: false,
    published_at: "2026-10-15T00:00:00.000Z",
  });
  const before = outbound.length;
  const serverBefore = serverCalls.length;
  await page.fill("#claim", claim);
  await page.click("#run");
  await page.waitForFunction(() => document.querySelector(".entry-title")?.textContent === "公開済みの事例タイトル", null, { timeout: 10000 });
  assert.equal(outbound.length, before);
  const lookups = serverCalls.slice(serverBefore);
  assert.equal(lookups.length, 1);
  assert.ok(lookups[0].query.includes(key));
  assert.ok(!decodeURIComponent(lookups[0].query).includes(claim));
  assert.equal(lookups[0].headers["x-api-key"], undefined);
  assert.ok(await page.isHidden("#submission"));
});

await check("公開照会を無効にすると、サーバーに問い合わせずAIを呼ぶ", async () => {
  await openSettings(page);
  await page.uncheck("#public-lookup");
  await page.click("#settings-form button[type=submit]");
  await page.waitForFunction(() => document.querySelector("#key-status")?.textContent?.includes("設定を保存しました"));
  const serverBefore = serverCalls.length;
  const before = outbound.length;
  await page.fill("#claim", "照会しない設定での主張");
  await page.click("#run");
  await page.waitForSelector(".result .verdict", { timeout: 15000 });
  await page.waitForFunction((n) => document.querySelector(".verdict-label") !== null, null);
  assert.equal(serverCalls.length, serverBefore);
  assert.equal(outbound.length, before + 1);
});

await check("公開申請: 同意すると主張と結果だけを送り、キーは送らず、申請済みと表示される", async () => {
  page.once("dialog", (d) => d.accept());
  const serverBefore = serverCalls.length;
  await page.click("#submission button");
  await page.waitForFunction(() => document.querySelector("#submission")?.textContent?.includes("審査を待っています"), null, { timeout: 10000 });
  const posts = serverCalls.slice(serverBefore).filter((c) => c.method === "POST");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].path, "/api/submissions");
  assert.ok(posts[0].headers["x-client-token"]?.length >= 32);
  assert.ok(!posts[0].body.includes(FAKE_KEY));
  const body = JSON.parse(posts[0].body);
  assert.equal(body.original_claim, "照会しない設定での主張");
  assert.equal(body.result.mode, "LIVE");
  await page.close();
  page = await openPanel();
  await page.waitForFunction(() => document.querySelector("#submission")?.textContent?.includes("公開辞典に掲載されました"), null, { timeout: 10000 });
});

await check("DEMO: 記録済みの結果を DEMO 表示で返し、AIもサーバーも呼ばず、申請もできない", async () => {
  const before = outbound.length;
  const serverBefore = serverCalls.length;
  await page.check("#demo-mode");
  assert.equal(await page.textContent("#mode-badge"), "DEMO");
  await page.click("#run");
  await page.waitForFunction(() => document.querySelector(".notice-demo")?.textContent?.includes("DEMO / Recorded Result"), null, { timeout: 5000 });
  assert.equal(outbound.length, before);
  assert.equal(serverCalls.length, serverBefore);
  assert.ok(await page.isHidden("#submission"));
  await page.screenshot({ path: path.resolve(here, "../.output/e2e-demo.png"), fullPage: true });
  await page.uncheck("#demo-mode");
});

await check("キー消失の説明: 設定画面に消える場面が書かれ、消えたキーは理由付きで再入力を求める", async () => {
  await openSettings(page);
  const notice = await page.textContent("#key-notice");
  for (const phrase of ["ブラウザ（Chrome）を閉じたとき", "更新・再読み込みしたとき", "控えておいてください"]) assert.ok(notice.includes(phrase), phrase);
  await page.fill("#api-key", FAKE_KEY);
  await page.click("#settings-form button[type=submit]");
  await page.waitForFunction(() => document.querySelector("#key-status")?.textContent?.includes("入力済み"));
  await sw.evaluate(() => chrome.storage.session.remove("byok.apiKeys"));
  await page.close();
  page = await openPanel();
  await page.waitForFunction(() => document.querySelector("#key-status")?.textContent?.includes("以前に入力したキーは消えています"));
  const local = await sw.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
  assert.ok(!local.includes(FAKE_KEY), "key must not be in storage.local");
  await page.fill("#claim", "キーが消えたあとの主張");
  await page.click("#run");
  await page.waitForSelector("#status .error", { timeout: 10000 });
  assert.ok((await page.textContent("#status .error")).includes("以前に入力したキーは消えています"));
});

await check("通信先: 拡張が通信したのは各社APIと geminihall.cc だけで、サーバーへの通信にキーが含まれない", async () => {
  assert.equal(otherHosts.length, 0, `unexpected hosts: ${otherHosts.join(", ")}`);
  for (const c of serverCalls) {
    assert.ok(!JSON.stringify(c).includes(FAKE_KEY), "key found in a request to geminihall.cc");
  }
});

await page.screenshot({ path: path.resolve(here, "../.output/e2e-last.png"), fullPage: true });
await context.close();

for (const r of results) console.log(`${r.result}  ${r.name}${r.detail ? `\n      ${r.detail}` : ""}`);
process.exit(results.every((r) => r.result === "PASS") ? 0 : 1);

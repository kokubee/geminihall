import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(here, "../.output/chrome-mv3");
const SOURCE = "https://www.example.go.jp/constitution";
const ACCESS = "plan-access-token-e2e";
const REFRESH = "plan-refresh-token-e2e";
const CLIENT = "oaiapp_e2e";
const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (err) {
    results.push(["FAIL", name, err instanceof Error ? err.message.split("\n")[0] : String(err)]);
  }
}

const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "e2e", alg: "RS256", use: "sig" };
const idToken = (nonce, aud = CLIENT) =>
  new SignJWT({ nonce, email: "reviewer@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "e2e" })
    .setIssuer("https://auth.openai.com")
    .setAudience(aud)
    .setSubject("sub-e2e")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);

const modelOutput = {
  is_valid_input: true,
  contains_pii: false,
  audit_status: "CONFIRMED_HALLUCINATION",
  evidence_status: "VERIFIED",
  severity_score: 3,
  category: "Chronological_Error",
  ttl_category: "HISTORICAL_FACT",
  audit_trace: {
    decomposed_claims: [{ sub_claim: "施行年は1950年", verification_target: "施行日", status: "CONTRADICTED" }],
    alignment_reasoning: "資料では1947年5月3日。",
    abstention_reason: null,
  },
  hallucinated_claim: "1950年に施行された",
  correction: "1947年5月3日に施行された",
  unverified_notes: null,
  evidence_sources: [{ title: "資料", url: SOURCE, snippet: "昭和22年5月3日施行" }],
  estimated_error_pattern: null,
  limitations: [],
};
const finalResponse = {
  id: "resp_e2e",
  object: "response",
  created_at: 1,
  status: "completed",
  error: null,
  incomplete_details: null,
  model: "gpt-plan-e2e",
  output: [
    { type: "web_search_call", id: "ws", status: "completed", action: { type: "search", query: "q", sources: [{ type: "url", url: SOURCE }] } },
    { type: "message", id: "m", status: "completed", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(modelOutput), annotations: [] }] },
  ],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
};
const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");

const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "gh-siwc-")), {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});

const calls = { authorize: [], token: [], revoke: [], models: 0, responses: [], loopbackHits: 0 };
let stateOverride = null;
await context.route(/^https:\/\/auth\.openai\.com\//, async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  if (url.pathname === "/api/accounts/authorize") {
    calls.authorize.push(url);
    const redirect = new URL(url.searchParams.get("redirect_uri"));
    redirect.searchParams.set("code", "code-e2e");
    redirect.searchParams.set("scope", "chatgpt.tokens.use.direct email offline_access openid profile resource.invoke");
    redirect.searchParams.set("state", stateOverride ?? url.searchParams.get("state"));
    if (url.searchParams.get("client_id") === "dynamic_agent_client") redirect.searchParams.set("client_id", CLIENT);
    globalThis.__nonce = url.searchParams.get("nonce");
    return route.fulfill({ status: 302, headers: { location: redirect.toString() } });
  }
  if (url.pathname === "/api/accounts/oauth/token") {
    const form = new URLSearchParams(req.postData() ?? "");
    calls.token.push(Object.fromEntries(form));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: ACCESS,
        refresh_token: REFRESH,
        id_token: await idToken(globalThis.__nonce),
        token_type: "Bearer",
        expires_in: 3600,
        scope: "chatgpt.tokens.use.direct email offline_access openid profile resource.invoke",
      }),
    });
  }
  if (url.pathname === "/.well-known/jwks.json") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ keys: [jwk] }) });
  if (url.pathname === "/api/accounts/oauth/revoke") {
    calls.revoke.push(Object.fromEntries(new URLSearchParams(req.postData() ?? "")));
    return route.fulfill({ status: 200, body: "" });
  }
  return route.fulfill({ status: 404, body: "" });
});
await context.route(/^http:\/\/127\.0\.0\.1:\d+\//, (route) => {
  calls.loopbackHits++;
  return route.fulfill({ status: 200, body: "loopback reached" });
});
await context.route(/^https:\/\/api\.openai\.com\//, async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  if (url.pathname === "/v1/models") {
    calls.models++;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [{ slug: "gpt-plan-e2e", display_name: "GPT Plan E2E", visibility: "list" }, { slug: "hidden", visibility: "hide" }] }),
    });
  }
  if (url.pathname === "/v1/responses") {
    calls.responses.push({ headers: await req.allHeaders(), body: JSON.parse(req.postData() ?? "{}") });
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sse([
        { type: "response.created", sequence_number: 0, response: { ...finalResponse, status: "in_progress", output: [] } },
        { type: "response.completed", sequence_number: 1, response: finalResponse },
      ]),
    });
  }
  return route.fulfill({ status: 404, body: "{}" });
});
await context.route(/^https:\/\/geminihall\.cc\//, (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));

let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent("serviceworker");
const extensionId = new URL(sw.url()).host;
const panelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
async function completeAuthorizeTab() {
  const tab = await context.waitForEvent("page", { predicate: (p) => p.url().startsWith("https://auth.openai.com/"), timeout: 10000 });
  const url = new URL(tab.url());
  calls.authorize.push(url);
  globalThis.__nonce = url.searchParams.get("nonce");
  const redirect = new URL(url.searchParams.get("redirect_uri"));
  redirect.searchParams.set("code", "code-e2e");
  redirect.searchParams.set("scope", "chatgpt.tokens.use.direct email offline_access openid profile resource.invoke");
  redirect.searchParams.set("state", stateOverride ?? url.searchParams.get("state"));
  if (url.searchParams.get("client_id") === "dynamic_agent_client") redirect.searchParams.set("client_id", CLIENT);
  await tab.goto(redirect.toString()).catch(() => undefined);
  return tab;
}

async function signIn() {
  const pending = completeAuthorizeTab();
  await page.click("#siwc-login");
  return pending;
}

let page = await context.newPage();
await page.goto(panelUrl);
await page.evaluate(() => {
  document.getElementById("settings").open = true;
});

await check("試作の表示: ChatGPT を選ぶとキー欄が消え、試作である旨とログインボタンが出る", async () => {
  await page.selectOption("#provider", "CHATGPT_PLAN");
  assert.equal(await page.isVisible("#api-key"), false);
  assert.ok((await page.textContent("#siwc-section")).includes("試作機能です"));
  assert.equal(await page.textContent("#siwc-login"), "Continue with ChatGPT");
});

await check("初回ログイン: dynamic_agent_client で登録し、戻り先は拡張機能のページに振り替わり 127.0.0.1 には届かない", async () => {
  const tab = await signIn();
  await tab.waitForURL(/^chrome-extension:\/\/.*\/siwc-callback\.html/, { timeout: 10000 }).catch(() => undefined);
  await page.waitForFunction(() => document.querySelector("#siwc-status")?.textContent?.includes("ログイン中"), null, { timeout: 15000 });
  const a = calls.authorize[0];
  assert.equal(a.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(a.searchParams.get("agent_name_hint"), "GeminiHall");
  assert.match(a.searchParams.get("redirect_uri"), /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
  assert.match(a.searchParams.get("ext_agent_host_id"), /^urn:uuid:/);
  assert.equal(calls.loopbackHits, 0, "the loopback URL must not actually be requested");
  const t = calls.token[0];
  assert.equal(t.client_id, CLIENT);
  assert.equal(t.grant_type, "authorization_code");
  assert.equal(t.redirect_uri, a.searchParams.get("redirect_uri"));
  assert.ok(!("client_secret" in t));
});

await check("初回の確認表示とモデル一覧: 「ChatGPT のプランを使っています」が出て、一覧は表示対象のモデルだけ", async () => {
  await page.waitForSelector("#siwc-welcome:not([hidden])");
  await page.waitForFunction(() => document.querySelectorAll("#plan-model option").length > 0);
  const opts = await page.$$eval("#plan-model option", (o) => o.map((x) => x.value));
  assert.deepEqual(opts, ["gpt-plan-e2e"]);
  await page.click("#siwc-welcome-ok");
  await page.waitForSelector("#siwc-welcome", { state: "hidden" });
});

await check("トークンの保存先: アクセス・更新トークンはディスク側(local)になく、local には登録情報だけ", async () => {
  const local = await sw.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
  const session = await sw.evaluate(async () => JSON.stringify(await chrome.storage.session.get(null)));
  assert.ok(!local.includes(ACCESS) && !local.includes(REFRESH), "tokens leaked to storage.local");
  assert.ok(local.includes(CLIENT), "issued client id should be kept for re-sign-in");
  assert.ok(session.includes(ACCESS));
});

await check("監査: サブスクのトークンで stream=true・store=false の Responses を呼び、結果に経路が記録される", async () => {
  await page.fill("#claim", "日本国憲法は1950年に施行された");
  await page.click("#run");
  await page.waitForSelector(".result .verdict", { timeout: 15000 });
  const r = calls.responses[0];
  assert.equal(r.headers.authorization, `Bearer ${ACCESS}`);
  assert.equal(r.body.stream, true);
  assert.equal(r.body.store, false);
  assert.equal(r.body.model, "gpt-plan-e2e");
  const job = await sw.evaluate(async () => (await chrome.storage.session.get("audit.currentJob"))["audit.currentJob"]);
  assert.equal(job.result.auditor.via, "CHATGPT_PLAN");
});

await check("ログアウト: 更新トークンを失効させ、トークンを消し、登録情報は残す", async () => {
  await page.evaluate(() => {
    document.getElementById("settings").open = true;
  });
  await page.click("#siwc-logout");
  await page.waitForFunction(() => document.querySelector("#siwc-status")?.textContent?.includes("ログアウトしました"), null, { timeout: 10000 });
  assert.equal(calls.revoke.length, 1);
  assert.equal(calls.revoke[0].token, REFRESH);
  assert.equal(calls.revoke[0].token_type_hint, "refresh_token");
  assert.equal(calls.revoke[0].client_id, CLIENT);
  const session = await sw.evaluate(async () => JSON.stringify(await chrome.storage.session.get(null)));
  assert.ok(!session.includes(ACCESS));
});

await check("再ログイン: 発行済みの client_id と login_hint を使い、agent_name_hint は送らない", async () => {
  await signIn();
  await page.waitForFunction(() => document.querySelector("#siwc-status")?.textContent?.includes("ログイン中"), null, { timeout: 15000 });
  const a = calls.authorize.at(-1);
  assert.equal(a.searchParams.get("client_id"), CLIENT);
  assert.equal(a.searchParams.get("agent_name_hint"), null);
  assert.equal(a.searchParams.get("login_hint"), "reviewer@example.com");
});

await check("不正な応答: state が一致しなければトークン交換をせずエラーにする", async () => {
  await page.click("#siwc-logout");
  await page.waitForFunction(() => document.querySelector("#siwc-status")?.textContent?.includes("ログアウト"), null, { timeout: 10000 });
  const before = calls.token.length;
  stateOverride = "forged-state";
  await signIn();
  await page.waitForFunction(() => document.querySelector("#siwc-status")?.textContent?.includes("state の不一致"), null, { timeout: 15000 });
  assert.equal(calls.token.length, before);
  stateOverride = null;
});

await context.close();
for (const r of results) console.log(r.join("  "));
process.exit(results.every((r) => r[0] === "PASS") ? 0 : 1);

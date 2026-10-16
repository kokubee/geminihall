import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../extension/node_modules/playwright/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? "http://127.0.0.1:8791";
const reportsDir = path.resolve(here, "../../../packages/eval/reports");
const report = readdirSync(reportsDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(path.join(reportsDir, f), "utf8")))
  .find((d) => d.outcomes.length >= 10);
const confirmed = report.outcomes.find((o) => o.case.id === "E1").result;
const abstained = report.outcomes.find((o) => o.case.id === "A4").result;

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (err) {
    results.push(["FAIL", name, err instanceof Error ? err.message.split("\n")[0] : String(err)]);
  }
}

const browser = await chromium.launch({ channel: "chromium", headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const posts = [];
let authed = true;

const submission = (r, claim) => ({
  submission: {
    submission_id: r.request_id,
    claim_cache_key: "k",
    original_claim: claim,
    context: null,
    locale: "ja",
    provider: r.auditor.provider,
    model: r.auditor.model,
    consent_version: "2026-10-15",
    review_state: "PENDING",
    created_at: "2026-10-15T00:00:00.000Z",
    updated_at: "2026-10-15T00:00:00.000Z",
    result: r,
  },
  reviews: [],
});

await ctx.route(/\/api\/admin\//, async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (!authed) return json(403, { error: { code: "UNAUTHORIZED_REQUEST_ACCESS", message: "x", request_id: null } });
  if (url.pathname === "/api/admin/me") return json(200, { reviewer: "reviewer@example.com" });
  if (url.pathname === "/api/admin/submissions") {
    return json(200, {
      submissions: [
        { submission_id: confirmed.request_id, original_claim: "日本国憲法は1950年5月3日に施行された。", provider: "OPENAI", model: "gpt-6-astra", review_state: "PENDING", created_at: "2026-10-15T00:00:00.000Z" },
        { submission_id: abstained.request_id, original_claim: "邪馬台国は九州にあった。", provider: "OPENAI", model: "gpt-6-astra", review_state: "PENDING", created_at: "2026-10-15T00:00:00.000Z" },
      ],
    });
  }
  if (url.pathname === `/api/admin/submissions/${confirmed.request_id}`) return json(200, submission(confirmed, "日本国憲法は1950年5月3日に施行された。"));
  if (url.pathname === `/api/admin/submissions/${abstained.request_id}`) return json(200, submission(abstained, "邪馬台国は九州にあった。"));
  if (url.pathname === "/api/admin/reviews" && req.method() === "POST") {
    posts.push({ headers: await req.allHeaders(), body: JSON.parse(req.postData() ?? "{}") });
    return json(200, { review_id: "r", entry_id: "00000000-0000-4000-8000-000000000001", publication_status: "PUBLISHED" });
  }
  return json(404, { error: { code: "NOT_FOUND", message: "x", request_id: null } });
});

await check("未認証: 管理者として認証されていない旨を表示し、一覧を出さない", async () => {
  authed = false;
  await page.goto(`${BASE}/admin/`);
  await page.waitForSelector(".error-box");
  assert.ok((await page.textContent(".error-box")).includes("認証されていません"));
  assert.equal(await page.$(".table"), null);
  authed = true;
});

await check("一覧: 審査待ちの申請が並び、審査者が表示される", async () => {
  await page.goto(`${BASE}/admin/`);
  await page.waitForSelector(".table");
  assert.equal(await page.textContent("#reviewer"), "reviewer@example.com");
  assert.equal(await page.$$eval(".table tbody tr", (rows) => rows.length), 2);
});

await check("承認: タイトルが下書きされ、空にすると送られず、入力後に APPROVE を送る", async () => {
  await page.click(`a[href="#/submission/${confirmed.request_id}"]`);
  await page.waitForSelector("form.form");
  assert.ok((await page.textContent(".sources")).includes("監査中に取得"));
  assert.equal(await page.$eval("form.form input", (el) => el.value), "日本国憲法は1950年5月3日に施行された");
  await page.fill("form.form input >> nth=0", "");
  await page.click("button[type=submit]");
  await page.waitForTimeout(500);
  assert.equal(posts.length, 0);
  assert.equal(await page.$eval("form.form input", (el) => el.validity.valid), false);
  await page.fill("form.form input >> nth=0", "日本国憲法の施行年の取り違え");
  await page.click("button[type=submit]");
  await page.waitForSelector(".ok-box");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].headers["x-geminihall-admin"], "1");
  assert.equal(posts[0].body.action, "APPROVE");
  assert.equal(posts[0].body.sanitized_title, "日本国憲法の施行年の取り違え");
  assert.ok(posts[0].body.correction.includes("1947"));
});

await check("判定保留の申請: タイトルが下書きされ、訂正欄は無効で、承認時に訂正を送らない", async () => {
  await page.goto(`${BASE}/admin/#/submission/${abstained.request_id}`);
  await page.waitForSelector("form.form");
  assert.equal(await page.$eval("form.form input", (el) => el.value), "邪馬台国は九州にあった");
  assert.equal(await page.isDisabled("form.form textarea >> nth=1"), true);
  await page.fill("form.form input >> nth=0", "邪馬台国の所在地");
  await page.click("button[type=submit]");
  await page.waitForSelector(".ok-box");
  assert.equal(posts.at(-1).body.correction, null);
});

await check("却下: 理由が空なら送らず、入力後に REJECT を送る", async () => {
  await page.goto(`${BASE}/admin/#/submission/${abstained.request_id}`);
  await page.waitForSelector("form.form");
  const before = posts.length;
  await page.click(".btn-danger");
  await page.waitForSelector(".error-box");
  assert.equal(posts.length, before);
  await page.fill("form.form input >> nth=2", "根拠が不十分");
  await page.click(".btn-danger");
  await page.waitForSelector(".ok-box");
  assert.equal(posts.at(-1).body.action, "REJECT");
});

await check("撤回: 掲載中の一覧から理由付きで RETRACT を送る", async () => {
  await page.goto(`${BASE}/admin/#/published`);
  await page.waitForSelector(".table tbody tr");
  page.once("dialog", (d) => d.accept());
  await page.fill(".table tbody tr >> nth=0 >> input", "誤りが見つかった");
  await page.click(".table tbody tr >> nth=0 >> .btn-danger");
  await page.waitForSelector(".ok-box");
  assert.equal(posts.at(-1).body.action, "RETRACT");
});

await check("検索避け: 管理画面に noindex が付いている", async () => {
  const robots = await page.getAttribute('meta[name="robots"]', "content");
  assert.ok(robots.includes("noindex"));
});

await browser.close();
for (const r of results) console.log(r.join("  "));
process.exit(results.every((r) => r[0] === "PASS") ? 0 : 1);

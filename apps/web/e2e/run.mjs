import assert from "node:assert/strict";
import { chromium } from "../../extension/node_modules/playwright/index.mjs";

const BASE = process.argv[2] ?? "http://127.0.0.1:8791";
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
const page = await browser.newPage();
const errors = [];
const dialogs = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", async (d) => {
  dialogs.push(d.message());
  await d.dismiss();
});

await check("一覧: 公開済みだけが表示され、撤回済みは出ない", async () => {
  await page.goto(`${BASE}/`);
  await page.waitForSelector(".card-title");
  const titles = await page.$$eval(".card-title", (els) => els.map((e) => e.textContent));
  assert.ok(titles.includes("日本国憲法の施行年の取り違え"));
  assert.ok(!titles.some((t) => t.includes("撤回の表示確認用")));
});

await check("絞り込み: カテゴリで一覧が絞られ、選択中のチップが示される", async () => {
  await page.click('a.chip[href="/?category=Chronological_Error"]');
  await page.waitForFunction(() => document.querySelector(".chip-active")?.textContent === "年代・日付の誤り");
  await page.waitForSelector(".card-title");
  const titles = await page.$$eval(".card-title", (els) => els.map((e) => e.textContent));
  assert.ok(titles.length >= 1 && titles.every((t) => t.includes("取り違え")));
});

await check("詳細: 監査の工程3段階・根拠・掲載日が表示され、タイトルが変わる", async () => {
  await page.goto(`${BASE}/entries/00000000-0000-4000-8000-000000000001`);
  await page.waitForSelector(".trace");
  assert.equal(await page.$$eval(".trace .step", (els) => els.length), 3);
  assert.ok((await page.title()).startsWith("日本国憲法の施行年の取り違え"));
  const rels = await page.$$eval(".sources a", (els) => els.map((a) => a.rel));
  assert.ok(rels.length > 0 && rels.every((r) => r.includes("noopener")));
});

await check("撤回: 撤回済みの事例は内容を出さず、撤回されたことを表示する", async () => {
  await page.goto(`${BASE}/entries/00000000-0000-4000-8000-000000000005`);
  await page.waitForSelector(".notice-warn");
  assert.ok((await page.textContent(".notice-warn")).includes("撤回されました"));
  assert.equal(await page.$(".trace"), null);
});

await check("安全性: HTML を含む文面は文字として表示し、javascript: の根拠はリンクにしない", async () => {
  await page.goto(`${BASE}/entries/00000000-0000-4000-8000-000000000006`);
  await page.waitForSelector(".sources");
  assert.ok((await page.textContent("h1")).includes("<img src=x"));
  assert.equal(await page.$(".detail img"), null);
  assert.equal(await page.$$eval(".sources a", (els) => els.length), 0);
  assert.ok((await page.textContent(".notice-warn")).includes("有効期限を過ぎています"));
  assert.equal(dialogs.length, 0);
});

await check("存在しない事例: 見つからない旨を表示する", async () => {
  await page.goto(`${BASE}/entries/99999999-9999-4999-8999-999999999999`);
  await page.waitForSelector(".empty");
  assert.ok((await page.textContent(".empty")).includes("見つかりませんでした"));
});

await check("スマホ幅: 375px で横スクロールが発生しない", async () => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const p of ["/", "/entries/00000000-0000-4000-8000-000000000001", "/about"]) {
    await page.goto(`${BASE}${p}`);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.equal(overflow, false, `overflow on ${p}`);
  }
});

await check("ページ内エラーがない", async () => {
  assert.deepEqual(errors, []);
});

await browser.close();
for (const r of results) console.log(r.join("  "));
process.exit(results.every((r) => r[0] === "PASS") ? 0 : 1);

// デモ動画の素材を撮影して 1 本の mp4 に結合する（Phase 4）。
// - 拡張機能は DEMO モード（記録済みの結果を表示し、AI もサーバーも呼ばない）だけを使う。
// - 公開辞典のカットは本番 https://geminihall.cc をそのまま映す。
// 実行前に通常ビルドを作っておくこと: pnpm --filter @geminihall/extension build
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(here, "../.output/chrome-mv3");
const outDir = path.resolve(here, "../.output/demo-video");
const demoOut = path.resolve(here, "../../../docs/demo.mp4");
mkdirSync(outDir, { recursive: true });

const cardsDir = mkdtempSync(path.join(tmpdir(), "geminihall-cards-"));
const CARD_CSS = `
  * { margin: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    display: grid; place-items: center;
    background: #f7f7f5; color: #1d1d1b;
    font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .card { text-align: center; padding: 0 80px; }
  .kicker { font-size: 15px; letter-spacing: .35em; color: #5f5f5a; margin-bottom: 30px; }
  .name { font-size: 84px; letter-spacing: .02em; }
  .name.small { font-size: 64px; }
  .tagline { font-size: 24px; color: #3c3c38; margin-top: 26px; }
  .verdicts { margin-top: 46px; display: flex; gap: 14px; justify-content: center; }
  .v { font-size: 17px; padding: 10px 22px; border-radius: 999px; font-weight: 600; }
  .v.confirmed { background: #fdecec; color: #a1231d; }
  .v.supported { background: #e8f4ec; color: #1f6b3a; }
  .v.unverified { background: #fff5df; color: #7a5200; }
  .note { margin-top: 58px; font-size: 14px; color: #5f5f5a; }
  .url { font-size: 34px; margin-top: 18px; color: #2f5bd3; font-weight: 600; }
  .repo { margin-top: 14px; font-size: 17px; color: #3c3c38; }
`;
writeFileSync(
  path.join(cardsDir, "title.html"),
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${CARD_CSS}</style></head><body>
<main class="card">
  <p class="kicker">CHROME 拡張機能 ＋ 公開辞典</p>
  <h1 class="name">GeminiHall</h1>
  <p class="tagline">AI の回答を、実際に取得した資料と照合して監査する</p>
  <p class="verdicts"><span class="v confirmed">誤りを確認</span><span class="v supported">根拠で裏付け</span><span class="v unverified">判定を保留</span></p>
  <p class="note">デモ動画 — 監査結果は記録済みのものを表示しています（画面内に DEMO と表示）</p>
</main></body></html>`,
);
writeFileSync(
  path.join(cardsDir, "end.html"),
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${CARD_CSS}</style></head><body>
<main class="card">
  <h1 class="name small">GeminiHall</h1>
  <p class="url">geminihall.cc</p>
  <p class="repo">ソースコード: github.com/kokubee/geminihall（MIT）</p>
  <p class="note">監査は利用者のブラウザの中で行い、公開辞典に載るのは管理者の承認を受けた事例だけです。</p>
</main></body></html>`,
);

const videos = {};

// ── A. タイトルカード（4.2 秒）──
{
  const browser = await chromium.launch({ channel: "chromium", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: outDir, size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();
  const video = page.video();
  await page.goto(`file://${path.join(cardsDir, "title.html")}`);
  await page.waitForTimeout(4200);
  await page.close();
  videos.title = await video.path();
  await context.close();
  await browser.close();
}

// ── B. 拡張機能: DEMO モードで記録済みの監査結果を表示 ──
{
  const userDataDir = mkdtempSync(path.join(tmpdir(), "geminihall-demo-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    viewport: { width: 430, height: 820 },
    recordVideo: { dir: outDir, size: { width: 430, height: 820 } },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker");
  const extensionId = new URL(sw.url()).host;
  // 撮影前準備: DEMO モードを保存しておく（設定欄が開かないクリーンな初期表示になる）。
  await sw.evaluate(() => chrome.storage.local.set({ settings: { demoMode: true } }));

  const page = await context.newPage();
  const video = page.video();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.waitForSelector("#run");
  await page.waitForFunction(() => document.querySelector("#mode-badge")?.textContent === "DEMO");
  await page.waitForTimeout(1500);
  await page.click("#run");
  await page.waitForSelector(".result .verdict", { timeout: 20000 });
  await page.waitForTimeout(1800);
  for (let i = 0; i < 24; i++) {
    await page.mouse.wheel(0, 90);
    await page.waitForTimeout(160);
  }
  await page.waitForTimeout(1600);
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, -150);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(900);
  await page.close();
  videos.extension = await video.path();
  await context.close();
}

// ── C. 公開辞典（本番）+ エンドカード ──
{
  const browser = await chromium.launch({ channel: "chromium", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: outDir, size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();
  const video = page.video();
  await page.goto("https://geminihall.cc/");
  await page.waitForSelector(".card-title", { timeout: 20000 });
  await page.waitForTimeout(2200);
  await page.hover(".card-link");
  await page.waitForTimeout(600);
  await page.click(".card-link");
  await page.waitForSelector(".trace .step", { timeout: 20000 });
  await page.waitForTimeout(2000);
  for (let i = 0; i < 18; i++) {
    await page.mouse.wheel(0, 90);
    await page.waitForTimeout(160);
  }
  await page.waitForTimeout(1500);
  await page.goto(`file://${path.join(cardsDir, "end.html")}`);
  await page.waitForTimeout(4000);
  await page.close();
  videos.dictionary = await video.path();
  await context.close();
  await browser.close();
}

console.log(JSON.stringify(videos, null, 2));

// ── 結合: 拡張カットだけ横に余白を付けて 1280x800 に揃え、1 本の mp4 にする ──
const filter = [
  "[1:v]scale=1280:800:force_original_aspect_ratio=decrease,pad=1280:800:(ow-iw)/2:(oh-ih)/2:color=0xf7f7f5,setsar=1,format=yuv420p[b]",
  "[0:v]setsar=1,format=yuv420p[a]",
  "[2:v]setsar=1,format=yuv420p[c]",
  "[a][b][c]concat=n=3:v=1:a=0[out]",
].join(";");
const r = spawnSync(
  "ffmpeg",
  ["-y", "-i", videos.title, "-i", videos.extension, "-i", videos.dictionary, "-filter_complex", filter, "-map", "[out]", "-c:v", "libx264", "-preset", "slow", "-crf", "26", "-movflags", "+faststart", demoOut],
  { stdio: "inherit" },
);
if (r.status !== 0) {
  console.error("ffmpeg に失敗しました。素材の webm は残しています:", videos);
  process.exit(1);
}
console.log(`完成: ${demoOut}`);

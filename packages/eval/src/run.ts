import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_MODELS, cacheIdentity, runAudit } from "@geminihall/audit-core";
import type { Provider } from "@geminihall/schema";
import { AUDIT_CASES, CACHE_PAIR_CASES, CONTEXT_PAIR_CASES, type AuditCase } from "./cases";
import { checkSources } from "./grounding";
import { computeMetrics, type CachePairOutcome, type CaseOutcome, type Metrics, type SourceCheck } from "./metrics";

const here = path.dirname(fileURLToPath(import.meta.url));

const { values } = parseArgs({
  options: {
    provider: { type: "string", default: "ANTHROPIC" },
    model: { type: "string" },
    only: { type: "string" },
    concurrency: { type: "string", default: "3" },
    "dry-run": { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
  },
});

const provider = values.provider as Provider;
if (provider !== "ANTHROPIC" && provider !== "OPENAI") {
  console.error("--provider must be ANTHROPIC or OPENAI");
  process.exit(1);
}
const model = values.model ?? DEFAULT_MODELS[provider];
const only = values.only ? new Set(values.only.split(",")) : null;
const cases = AUDIT_CASES.filter((c) => !only || only.has(c.id));
const concurrency = Math.max(1, Number(values.concurrency) || 3);

async function cachePairs(): Promise<CachePairOutcome[]> {
  const out: CachePairOutcome[] = [];
  for (const pair of [...CACHE_PAIR_CASES, ...CONTEXT_PAIR_CASES]) {
    const a = await cacheIdentity({ ...pair.a, locale: "ja" });
    const b = await cacheIdentity({ ...pair.b, locale: "ja" });
    out.push({ case: pair, keyA: a.claimCacheKey, keyB: b.claimCacheKey });
  }
  return out;
}

async function runCase(c: AuditCase, apiKey: string): Promise<CaseOutcome> {
  const started = Date.now();
  try {
    const out = await runAudit({
      requestId: crypto.randomUUID(),
      provider,
      apiKey,
      model,
      input: { claim: c.claim, context: c.context, locale: "ja" },
    });
    return { case: c, result: out.result, downgraded: out.downgraded, error: null, seconds: (Date.now() - started) / 1000 };
  } catch (err) {
    const e = err as Error & { status?: number };
    return {
      case: c,
      result: null,
      downgraded: false,
      error: `${e.name}${e.status ? ` ${e.status}` : ""}: ${e.message.slice(0, 200)}`,
      seconds: (Date.now() - started) / 1000,
    };
  }
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]!);
        process.stderr.write(".");
      }
    }),
  );
  process.stderr.write("\n");
  return results;
}

function pct(r: { rate: number | null; numerator: number; denominator: number }): string {
  return r.rate === null ? "n/a" : `${(r.rate * 100).toFixed(0)}% (${r.numerator}/${r.denominator})`;
}

function renderMarkdown(args: {
  startedAt: string;
  metrics: Metrics;
  outcomes: CaseOutcome[];
  sources: SourceCheck[];
  pairs: CachePairOutcome[];
}): string {
  const { metrics: m } = args;
  const lines = [
    `# GeminiHall 評価レポート`,
    "",
    `- 実行日時: ${args.startedAt}`,
    `- 監査AI: ${provider}（${model}）`,
    `- 監査ケース数: ${args.outcomes.length}（失敗 ${m.auditFailures}）`,
    "",
    "本評価は監査プロセスの妥当性を確かめるための設計値であり、統計的な性能保証ではない。",
    "",
    "## 4指標",
    "",
    "| 指標 | 値 | 目標 |",
    "| --- | --- | --- |",
    `| 誤訂正率（正しい主張・根拠不足を誤りと断定した割合） | ${pct(m.falseCorrectionRate)} | 0% |`,
    `| 判定保留の適切性（根拠不足を保留にし理由を示した割合） | ${pct(m.abstentionAccuracy)} | 高いほどよい |`,
    `| 根拠の実在・対応確認率（URLが開け、スニペットが本文と整合） | ${pct(m.evidenceGroundingRate)} | 高いほどよい |`,
    `| 誤キャッシュ率（数値・否定・文脈違いが同じキーになった割合） | ${pct(m.falseCacheHitRate)} | 0% |`,
    "",
    "## 補助指標",
    "",
    `- 誤り検出率（事実誤認を誤りと判定し、訂正に正解を含めた割合）: ${pct(m.errorDetectionRate)}`,
    `- 正しい主張の裏付け率: ${pct(m.supportedClaimRate)}`,
    `- 根拠URLの到達率: ${pct(m.sourceAliveRate)}`,
    `- 本文を確認できなかった根拠（PDF など）: ${args.sources.filter((s) => s.alive && s.snippetMatch === null).length} 件（確認率の分母から除外）`,
    "",
    "## ケース別",
    "",
    "| ID | 種別 | 判定 | 格下げ | 根拠(照合済/全) | 秒 | 備考 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...args.outcomes.map((o) => {
      const r = o.result;
      const srcs = r ? `${r.evidence_sources.filter((s) => s.verified).length}/${r.evidence_sources.length}` : "-";
      return `| ${o.case.id} | ${o.case.kind} | ${r?.audit_status ?? "失敗"} | ${o.downgraded ? "あり" : ""} | ${srcs} | ${o.seconds.toFixed(0)} | ${(o.error ?? "").replace(/\|/gu, "/")} |`;
    }),
    "",
    "## キャッシュ境界",
    "",
    "| ID | 違い | 別キーか |",
    "| --- | --- | --- |",
    ...args.pairs.map((p) => `| ${p.case.id} | ${p.case.variation} | ${p.keyA !== p.keyB ? "はい" : "いいえ（誤キャッシュ）"} |`),
    "",
  ];
  return lines.join("\n");
}

const pairs = await cachePairs();

console.log(`監査AI: ${provider}（${model}）`);
console.log(`AI 呼び出し予定: ${cases.length} 回（1回ごとに web 検索を最大6回使います）。並列数 ${concurrency}。`);
console.log(`キャッシュ境界の検証は AI を呼ばずに実行します: ${pairs.length} 組。`);

if (values["dry-run"]) {
  const m = computeMetrics([], [], pairs);
  console.log(`誤キャッシュ率: ${pct(m.falseCacheHitRate)}`);
  process.exit(m.falseCacheHitRate.numerator === 0 ? 0 : 1);
}

if (!values.yes) {
  console.error("実行するには --yes を付けてください（利用料が発生します）。件数だけ確認する場合は --dry-run を使ってください。");
  process.exit(1);
}

const envName = provider === "ANTHROPIC" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
const apiKey = process.env[envName];
if (!apiKey) {
  console.error(`${envName} が設定されていません。`);
  process.exit(1);
}

const startedAt = new Date().toISOString();
const outcomes = await pool(cases, concurrency, (c) => runCase(c, apiKey));
const sources: SourceCheck[] = [];
for (const o of outcomes) if (o.result) sources.push(...(await checkSources(o.case.id, o.result)));
const metrics = computeMetrics(outcomes, sources, pairs);

const stamp = startedAt.replace(/[-:]/gu, "").replace(/\..+$/u, "").replace("T", "-");
const dir = path.resolve(here, "../reports");
mkdirSync(dir, { recursive: true });
const base = path.join(dir, `${stamp}-${provider.toLowerCase()}`);
writeFileSync(`${base}.json`, `${JSON.stringify({ startedAt, provider, model, metrics, outcomes, sources, pairs }, null, 2)}\n`);
writeFileSync(`${base}.md`, renderMarkdown({ startedAt, metrics, outcomes, sources, pairs }));
console.log(renderMarkdown({ startedAt, metrics, outcomes, sources, pairs }).split("## ケース別")[0]);
console.log(`レポート: ${base}.md`);

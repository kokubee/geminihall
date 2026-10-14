import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const reportsDir = path.resolve(here, "../../../packages/eval/reports");
const reportFile = readdirSync(reportsDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ f, d: JSON.parse(readFileSync(path.join(reportsDir, f), "utf8")) }))
  .filter(({ d }) => d.outcomes.length >= 10)
  .sort((a, b) => b.f.localeCompare(a.f))[0];
if (!reportFile) throw new Error("no full eval report found");

const picks = [
  { id: "E1", title: "日本国憲法の施行年の取り違え", status: "PUBLISHED", publishedAt: "2026-10-15T01:00:00.000Z" },
  { id: "E8", title: "東海道新幹線の開業年の取り違え", status: "PUBLISHED", publishedAt: "2026-10-15T02:00:00.000Z" },
  { id: "C2", title: "東京スカイツリーの高さ", status: "PUBLISHED", publishedAt: "2026-10-15T03:00:00.000Z" },
  { id: "A4", title: "邪馬台国の所在地", status: "PUBLISHED", publishedAt: "2026-10-15T04:00:00.000Z" },
  { id: "E5", title: "富士山の標高の誤り（撤回の表示確認用）", status: "RETRACTED", publishedAt: "2026-10-15T05:00:00.000Z" },
];

const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const lines = ["DELETE FROM publication_reviews;", "DELETE FROM public_entries;", "DELETE FROM submissions;"];
picks.forEach((p, i) => {
  const o = reportFile.d.outcomes.find((x) => x.case.id === p.id);
  if (!o?.result) throw new Error(`no result for ${p.id}`);
  const r = o.result;
  const submissionId = r.request_id;
  const entryId = `00000000-0000-4000-8000-00000000000${i + 1}`;
  lines.push(
    `INSERT INTO submissions VALUES (${[submissionId, "seed", "seed-key-" + p.id, o.case.claim, null, "ja", JSON.stringify(r), r.auditor.provider, r.auditor.model, "2026-10-15", "APPROVED", p.publishedAt, p.publishedAt].map(q).join(", ")});`,
  );
  lines.push(
    `INSERT INTO public_entries VALUES (${[
      entryId, submissionId, `seed-key-${p.id}`, p.status, r.audit_status, r.category, r.severity_score, p.title, o.case.claim, r.correction,
      JSON.stringify(r.evidence_sources), JSON.stringify(r.audit_trace), JSON.stringify(r.limitations), r.estimated_error_pattern,
      r.ttl_category, r.auditor.provider, r.auditor.model, r.verified_at, r.expires_at, p.publishedAt,
    ].map(q).join(", ")});`,
  );
});
const base = reportFile.d.outcomes.find((x) => x.case.id === "E1").result;
const hostile = {
  ...base,
  request_id: "00000000-0000-4000-8000-0000000000a6",
  evidence_sources: [{ title: "危険なリンク", url: "javascript:alert(1)", snippet: "表示テスト", verified: false }],
};
lines.push(
  `INSERT INTO submissions VALUES (${[hostile.request_id, "seed", "seed-key-X", "安全性確認用の主張", null, "ja", JSON.stringify(hostile), "OPENAI", "gpt-6-astra", "2026-10-15", "APPROVED", "2026-10-14T00:00:00.000Z", "2026-10-14T00:00:00.000Z"].map(q).join(", ")});`,
  `INSERT INTO public_entries VALUES (${[
    "00000000-0000-4000-8000-000000000006", hostile.request_id, "seed-key-X", "PUBLISHED", base.audit_status, "Other", base.severity_score, "<img src=x onerror=alert(1)> 安全性確認用", "<script>alert(1)</script>", base.correction,
    JSON.stringify(hostile.evidence_sources), JSON.stringify(base.audit_trace), "[]", null, base.ttl_category, "OPENAI", "gpt-6-astra", base.verified_at, "2026-10-01T00:00:00.000Z", "2026-10-14T00:00:00.000Z",
  ].map(q).join(", ")});`,
);
const out = path.resolve(here, "../.wrangler/seed-local.sql");
writeFileSync(out, `${lines.join("\n")}\n`);
console.log(`seed written from ${reportFile.f}: ${out}`);

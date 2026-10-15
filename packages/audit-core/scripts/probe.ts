import { writeFileSync } from "node:fs";
import { DEFAULT_MODELS, runAudit } from "../src/index";
import type { Provider } from "@geminihall/schema";

const provider = (process.argv[2] ?? "ANTHROPIC") as Provider;
const envName = provider === "ANTHROPIC" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
const apiKey = process.env[envName];
if (!apiKey) {
  console.error(`${envName} is not set`);
  process.exit(1);
}
const model = process.argv[3] ?? DEFAULT_MODELS[provider];
const claim = process.argv[4] ?? "日本国憲法は1950年5月3日に施行された。";

const started = Date.now();
try {
  const out = await runAudit({
    requestId: crypto.randomUUID(),
    provider,
    credential: { kind: "API_KEY", apiKey },
    model,
    input: { claim, locale: "ja" },
  });
  const r = out.result;
  const outPath = process.argv[5];
  if (outPath) writeFileSync(outPath, `${JSON.stringify({ claim, result: r }, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        provider,
        model,
        seconds: Math.round((Date.now() - started) / 1000),
        downgraded: out.downgraded,
        audit_status: r.audit_status,
        evidence_status: r.evidence_status,
        correction: r.correction,
        sub_claims: r.audit_trace.decomposed_claims.length,
        sources: r.evidence_sources.map((s) => ({ url: s.url, verified: s.verified })),
        limitations: r.limitations,
      },
      null,
      2,
    ),
  );
} catch (err) {
  const e = err as Error & { status?: number };
  console.error(JSON.stringify({ provider, model, error: e.name, status: e.status ?? null, message: e.message.slice(0, 500) }));
  process.exit(2);
}

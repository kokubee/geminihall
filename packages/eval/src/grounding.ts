import type { AuditResult } from "@geminihall/schema";
import { snippetMatches, type SourceCheck } from "./metrics";

const FETCH_TIMEOUT_MS = 15_000;
const UA = "Mozilla/5.0 (compatible; GeminiHall-Eval/0.1; +https://geminihall.cc)";

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">");
}

async function readPage(url: string): Promise<{ status: number | null; text: string | null }> {
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "user-agent": UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.includes("html")) return { status: res.status, text: null };
    const buf = new Uint8Array(await res.arrayBuffer());
    const charset = /charset=([^;]+)/iu.exec(type)?.[1]?.trim().toLowerCase();
    let html = new TextDecoder(charset && charset !== "utf8" ? charset : "utf-8").decode(buf);
    const meta = /<meta[^>]+charset=["']?([\w-]+)/iu.exec(html)?.[1]?.toLowerCase();
    if (!charset && meta && meta !== "utf-8") {
      try {
        html = new TextDecoder(meta).decode(buf);
      } catch {}
    }
    return { status: res.status, text: htmlToText(html) };
  } catch {
    return { status: null, text: null };
  }
}

export async function checkSources(caseId: string, result: AuditResult): Promise<SourceCheck[]> {
  const checks: SourceCheck[] = [];
  for (const src of result.evidence_sources) {
    const page = await readPage(src.url);
    const alive = page.status !== null && page.status >= 200 && page.status < 400;
    checks.push({
      caseId,
      url: src.url,
      verified: src.verified,
      status: page.status,
      alive,
      snippetMatch: page.text === null ? null : snippetMatches(src.snippet, page.text),
    });
  }
  return checks;
}

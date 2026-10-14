import type { AuditResult } from "@geminihall/schema";
import type { AuditJob } from "./state";

type Child = Node | string | null | undefined | false;

export function h(tag: string, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

export function safeHttpUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const STATUS_LABEL: Record<AuditResult["audit_status"], string> = {
  CONFIRMED_HALLUCINATION: "誤りを確認",
  SUPPORTED_CLAIM: "根拠で裏付け",
  UNVERIFIED_OR_AMBIGUOUS: "判定を保留",
};

const STATUS_CLASS: Record<AuditResult["audit_status"], string> = {
  CONFIRMED_HALLUCINATION: "status-confirmed",
  SUPPORTED_CLAIM: "status-supported",
  UNVERIFIED_OR_AMBIGUOUS: "status-unverified",
};

const SUB_LABEL: Record<AuditResult["audit_trace"]["decomposed_claims"][number]["status"], string> = {
  CONTRADICTED: "矛盾",
  SUPPORTED: "裏付けあり",
  UNVERIFIABLE: "確認できず",
};

const EVIDENCE_LABEL: Record<AuditResult["evidence_status"], string> = {
  VERIFIED: "根拠を確認済み",
  CONFLICTING: "根拠どうしが矛盾",
  INSUFFICIENT: "根拠が不足",
  UNAVAILABLE: "根拠を取得できず",
  OUTDATED: "根拠が古い",
};

const TTL_LABEL: Record<AuditResult["ttl_category"], string> = {
  HISTORICAL_FACT: "確定した過去の事実（30日間有効）",
  LAW_OR_INSTITUTION: "法令・制度・仕様（24時間有効）",
  CURRENT_NEWS: "現在の出来事（1時間有効）",
  REALTIME: "リアルタイム情報（再利用しない）",
};

const PROVIDER_LABEL = { ANTHROPIC: "Claude", OPENAI: "OpenAI" } as const;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" });
}

function step(n: number, title: string, ...body: Child[]): HTMLElement {
  return h("li", { class: "step" }, h("div", { class: "step-title" }, h("span", { class: "step-no" }, String(n)), title), ...body);
}

export function renderResult(job: AuditJob): HTMLElement {
  const r = job.result!;
  const root = h("div", { class: "result" });

  root.append(
    h(
      "div",
      { class: `verdict ${STATUS_CLASS[r.audit_status]}` },
      h("div", { class: "verdict-label" }, STATUS_LABEL[r.audit_status]),
      h("div", { class: "verdict-sub" }, EVIDENCE_LABEL[r.evidence_status]),
      r.severity_score !== null ? h("div", { class: "verdict-sub" }, `深刻度 ${r.severity_score} / 5`) : null,
    ),
  );

  if (job.downgraded) {
    root.append(
      h(
        "p",
        { class: "notice" },
        "AIは断定的な判定を返しましたが、監査中に実際に取得した資料で裏付けを確認できなかったため、判定を保留に切り替えました。",
      ),
    );
  }

  if (r.correction) {
    root.append(
      h(
        "div",
        { class: "panel" },
        h("h2", {}, "訂正"),
        r.hallucinated_claim ? h("p", { class: "claim-wrong" }, r.hallucinated_claim) : null,
        h("p", { class: "claim-right" }, r.correction),
      ),
    );
  }
  if (r.unverified_notes) {
    root.append(h("div", { class: "panel" }, h("h2", {}, "未確認のメモ"), h("p", { class: "prewrap" }, r.unverified_notes)));
  }

  const subClaims = h(
    "ul",
    { class: "subclaims" },
    ...r.audit_trace.decomposed_claims.map((c) =>
      h(
        "li",
        {},
        h("span", { class: `pill pill-${c.status.toLowerCase()}` }, SUB_LABEL[c.status]),
        h("span", {}, c.sub_claim),
        h("div", { class: "hint" }, `照合先: ${c.verification_target}`),
      ),
    ),
  );

  const sources = h(
    "ul",
    { class: "sources" },
    ...r.evidence_sources.map((s) => {
      const href = safeHttpUrl(s.url);
      const title = href
        ? h("a", { href, target: "_blank", rel: "noopener noreferrer" }, s.title)
        : h("span", {}, s.title);
      return h(
        "li",
        {},
        h("span", { class: s.verified ? "pill pill-supported" : "pill pill-unverifiable" }, s.verified ? "取得確認済み" : "未確認"),
        title,
        h("div", { class: "hint" }, s.url),
        h("blockquote", {}, s.snippet),
      );
    }),
  );

  root.append(
    h(
      "ol",
      { class: "trace panel" },
      step(1, "主張の分解", subClaims),
      step(2, "根拠との照合", h("p", { class: "prewrap" }, r.audit_trace.alignment_reasoning), r.evidence_sources.length ? sources : h("p", { class: "hint" }, "根拠として示せる資料はありませんでした。")),
      step(
        3,
        r.audit_status === "UNVERIFIED_OR_AMBIGUOUS" ? "判定の保留" : "判定",
        h("p", {}, STATUS_LABEL[r.audit_status]),
        r.audit_trace.abstention_reason ? h("p", { class: "prewrap" }, `保留の理由: ${r.audit_trace.abstention_reason}`) : null,
      ),
    ),
  );

  if (r.limitations.length) {
    root.append(h("div", { class: "panel" }, h("h2", {}, "この監査の限界"), h("ul", {}, ...r.limitations.map((l) => h("li", {}, l)))));
  }

  root.append(
    h(
      "dl",
      { class: "meta panel" },
      h("dt", {}, "監査したAI"),
      h("dd", {}, `${PROVIDER_LABEL[r.auditor.provider]}（${r.auditor.model}）`),
      h("dt", {}, "監査日時"),
      h("dd", {}, formatTime(r.verified_at)),
      h("dt", {}, "情報の種類"),
      h("dd", {}, TTL_LABEL[r.ttl_category]),
      h("dt", {}, "有効期限"),
      h("dd", {}, formatTime(r.expires_at)),
      r.contains_pii ? h("dt", {}, "注意") : null,
      r.contains_pii ? h("dd", {}, "入力に個人情報が含まれている可能性があります。") : null,
    ),
  );

  root.append(
    h(
      "p",
      { class: "hint" },
      "この結果は、AIが検索で取得した資料をもとにした監査記録です。最終的な判断は、根拠のリンク先をご自身で確かめてください。",
    ),
  );
  return root;
}

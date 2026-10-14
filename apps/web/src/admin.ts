import type { AuditResult } from "@geminihall/schema";
import { formatDateTime, h, safeHttpUrl } from "./dom";
import { CATEGORY_LABEL, PROVIDER_LABEL, STATUS_LABEL, SUB_LABEL } from "./labels";
import type { PublishedEntry } from "./types";
import { statusBadge } from "./views";

const app = document.getElementById("app")!;
const reviewerEl = document.getElementById("reviewer")!;

interface SubmissionSummary {
  submission_id: string;
  original_claim: string;
  provider: "ANTHROPIC" | "OPENAI";
  model: string;
  review_state: string;
  created_at: string;
}

interface SubmissionDetail {
  submission: {
    submission_id: string;
    claim_cache_key: string;
    original_claim: string;
    context: string | null;
    locale: string;
    provider: "ANTHROPIC" | "OPENAI";
    model: string;
    consent_version: string;
    review_state: "PENDING" | "APPROVED" | "REJECTED";
    created_at: string;
    updated_at: string;
    result: AuditResult;
  };
  reviews: { review_id: string; entry_id: string | null; reviewer_id: string; action: string; reason: string | null; created_at: string }[];
}

class AuthError extends Error {}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json", "X-GeminiHall-Admin": "1" } : {}), ...init.headers },
  });
  if (res.status === 403 && path === "/api/admin/me") throw new AuthError();
  const body = (await res.json().catch(() => null)) as (T & { error?: { message: string } }) | null;
  if (!res.ok) throw new Error(body?.error?.message ?? `エラーが起きました（${res.status}）`);
  return body as T;
}

function post<T>(body: unknown) {
  return api<T>("/api/admin/reviews", { method: "POST", body: JSON.stringify(body) });
}

function link(href: string, text: string) {
  return h("a", { href }, text);
}

function message(kind: "ok" | "error", text: string) {
  return h("div", { class: kind === "ok" ? "ok-box" : "error-box", role: kind === "error" ? "alert" : "status" }, text);
}

const STATE_LABEL: Record<string, string> = { PENDING: "審査待ち", APPROVED: "承認済み", REJECTED: "却下" };

async function renderList(state: string) {
  const tabs = h(
    "nav",
    { class: "tabs" },
    ...["PENDING", "APPROVED", "REJECTED"].map((s) => h("a", { class: s === state ? "chip chip-active" : "chip", href: `#/list/${s}` }, STATE_LABEL[s]!)),
    h("a", { class: state === "PUBLISHED" ? "chip chip-active" : "chip", href: "#/published" }, "掲載中（撤回）"),
  );
  app.replaceChildren(h("h1", {}, "公開申請の審査"), tabs, h("p", { class: "muted" }, "読み込んでいます…"));
  const { submissions } = await api<{ submissions: SubmissionSummary[] }>(`/api/admin/submissions?state=${state}`);
  const table = submissions.length
    ? h(
        "table",
        { class: "table" },
        h("thead", {}, h("tr", {}, h("th", {}, "申請日時"), h("th", {}, "主張"), h("th", { class: "hide-sm" }, "AI"))),
        h(
          "tbody",
          {},
          ...submissions.map((s) =>
            h(
              "tr",
              {},
              h("td", {}, formatDateTime(s.created_at)),
              h("td", {}, link(`#/submission/${s.submission_id}`, s.original_claim.slice(0, 80))),
              h("td", { class: "hide-sm" }, `${PROVIDER_LABEL[s.provider]}（${s.model}）`),
            ),
          ),
        ),
      )
    : h("p", { class: "empty" }, `${STATE_LABEL[state]}の申請はありません。`);
  app.replaceChildren(h("h1", {}, "公開申請の審査"), tabs, table);
}

async function renderPublished() {
  const tabs = h(
    "nav",
    { class: "tabs" },
    ...["PENDING", "APPROVED", "REJECTED"].map((s) => h("a", { class: "chip", href: `#/list/${s}` }, STATE_LABEL[s]!)),
    h("a", { class: "chip chip-active", href: "#/published" }, "掲載中（撤回）"),
  );
  const { entries } = await fetch("/api/public/entries").then((r) => r.json() as Promise<{ entries: PublishedEntry[] }>);
  const rows = entries.map((e) => {
    const reason = h("input", { type: "text", placeholder: "撤回の理由（必須）", "aria-label": "撤回の理由" }) as HTMLInputElement;
    const btn = h("button", { type: "button", class: "btn btn-danger" }, "撤回") as HTMLButtonElement;
    const status = h("div", {});
    btn.addEventListener("click", async () => {
      if (!reason.value.trim()) {
        status.replaceChildren(message("error", "撤回の理由を入力してください。"));
        return;
      }
      if (!window.confirm(`「${e.sanitized_title}」を撤回します。公開辞典では撤回済みと表示されます。よろしいですか？`)) return;
      btn.disabled = true;
      try {
        await post({ action: "RETRACT", entry_id: e.entry_id, reason: reason.value.trim() });
        status.replaceChildren(message("ok", "撤回しました。"));
      } catch (err) {
        btn.disabled = false;
        status.replaceChildren(message("error", (err as Error).message));
      }
    });
    return h(
      "tr",
      {},
      h("td", {}, h("a", { href: `/entries/${e.entry_id}`, target: "_blank", rel: "noopener" }, e.sanitized_title), h("div", {}, statusBadge(e))),
      h("td", {}, h("div", { class: "form" }, reason, h("div", { class: "actions" }, btn), status)),
    );
  });
  app.replaceChildren(
    h("h1", {}, "掲載中の事例"),
    tabs,
    rows.length ? h("table", { class: "table" }, h("tbody", {}, ...rows)) : h("p", { class: "empty" }, "掲載中の事例はありません。"),
  );
}

function resultSection(r: AuditResult) {
  return h(
    "section",
    { class: "panel" },
    h("h2", {}, "監査結果"),
    h("p", {}, h("span", { class: `status-badge status-${r.audit_status === "CONFIRMED_HALLUCINATION" ? "confirmed" : r.audit_status === "SUPPORTED_CLAIM" ? "supported" : "unverified"}` }, STATUS_LABEL[r.audit_status]), r.category ? ` ${CATEGORY_LABEL[r.category]}` : "", r.severity_score ? ` 深刻度 ${r.severity_score}/5` : ""),
    r.contains_pii ? message("error", "AIは、入力に個人情報が含まれている可能性があると判定しています。公開用の文面で必ず取り除いてください。") : null,
    h(
      "dl",
      { class: "kv" },
      h("dt", {}, "誤った主張"),
      h("dd", {}, r.hallucinated_claim ?? "—"),
      h("dt", {}, "訂正"),
      h("dd", {}, r.correction ?? "—"),
      h("dt", {}, "未確認のメモ"),
      h("dd", {}, r.unverified_notes ?? "—"),
      h("dt", {}, "照合の説明"),
      h("dd", {}, r.audit_trace.alignment_reasoning),
      h("dt", {}, "保留の理由"),
      h("dd", {}, r.audit_trace.abstention_reason ?? "—"),
      h("dt", {}, "限界"),
      h("dd", {}, r.limitations.join("\n") || "—"),
      h("dt", {}, "監査日時"),
      h("dd", {}, `${formatDateTime(r.verified_at)}（有効期限 ${formatDateTime(r.expires_at)}）`),
    ),
    h("h2", {}, "主張の分解"),
    h("ul", { class: "subclaims" }, ...r.audit_trace.decomposed_claims.map((c) => h("li", {}, h("span", { class: `pill pill-${c.status.toLowerCase()}` }, SUB_LABEL[c.status]), c.sub_claim, h("div", { class: "muted small" }, `照合先: ${c.verification_target}`)))),
    h("h2", {}, "根拠（リンク先を開いて内容を確認してください）"),
    h(
      "ul",
      { class: "sources" },
      ...r.evidence_sources.map((s) => {
        const href = safeHttpUrl(s.url);
        return h(
          "li",
          {},
          h("span", { class: s.verified ? "pill pill-supported" : "pill pill-unverifiable" }, s.verified ? "監査中に取得" : "未確認"),
          href ? h("a", { href, target: "_blank", rel: "noopener noreferrer" }, s.title) : h("span", {}, `${s.title}（リンク不可）`),
          h("div", { class: "muted small url" }, s.url),
          h("blockquote", {}, s.snippet),
        );
      }),
    ),
  );
}

async function renderSubmission(id: string) {
  const detail = await api<SubmissionDetail>(`/api/admin/submissions/${encodeURIComponent(id)}`);
  const s = detail.submission;
  const r = s.result;
  const status = h("div", {});
  const parts: (HTMLElement | null)[] = [
    h("p", { class: "back" }, link(`#/list/${s.review_state}`, "← 一覧に戻る")),
    h("h1", {}, `申請（${STATE_LABEL[s.review_state]}）`),
    h(
      "section",
      { class: "panel" },
      h("h2", {}, "申請内容"),
      h(
        "dl",
        { class: "kv" },
        h("dt", {}, "主張"),
        h("dd", {}, s.original_claim),
        h("dt", {}, "文脈"),
        h("dd", {}, s.context ?? "—"),
        h("dt", {}, "監査したAI"),
        h("dd", {}, `${PROVIDER_LABEL[s.provider]}（${s.model}）`),
        h("dt", {}, "申請日時"),
        h("dd", {}, formatDateTime(s.created_at)),
        h("dt", {}, "同意文"),
        h("dd", {}, s.consent_version),
      ),
    ),
    resultSection(r),
  ];

  if (s.review_state === "PENDING") {
    const title = h("input", { type: "text", maxlength: "200", required: "" }) as HTMLInputElement;
    const claim = h("textarea", { rows: "3", maxlength: "4000", required: "" }) as HTMLTextAreaElement;
    claim.value = s.original_claim;
    const correction = h("textarea", { rows: "3", maxlength: "4000" }) as HTMLTextAreaElement;
    correction.value = r.correction ?? "";
    const abstained = r.audit_status === "UNVERIFIED_OR_AMBIGUOUS";
    if (abstained) correction.disabled = true;
    const approveReason = h("input", { type: "text", maxlength: "2000" }) as HTMLInputElement;
    const rejectReason = h("input", { type: "text", maxlength: "2000" }) as HTMLInputElement;
    const approveBtn = h("button", { type: "submit", class: "btn btn-primary" }, "承認して掲載") as HTMLButtonElement;
    const rejectBtn = h("button", { type: "button", class: "btn btn-danger" }, "却下") as HTMLButtonElement;

    const form = h(
      "form",
      { class: "form panel" },
      h("h2", {}, "審査"),
      h("p", { class: "muted small" }, "根拠のリンク先を開いて内容を確かめ、個人情報を取り除いた公開用の文面を書いてから承認してください。"),
      h("label", {}, "公開用のタイトル（必須）", title),
      h("label", {}, "公開用の主張（必須・個人情報を取り除く）", claim),
      h("label", {}, abstained ? "訂正（判定保留のため公開しません）" : "公開用の訂正", correction),
      h("label", {}, "承認のメモ（任意・非公開）", approveReason),
      h("div", { class: "actions" }, approveBtn),
      h("hr", {}),
      h("label", {}, "却下の理由（却下する場合は必須・非公開）", rejectReason),
      h("div", { class: "actions" }, rejectBtn),
      status,
    ) as HTMLFormElement;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!title.value.trim() || !claim.value.trim()) {
        status.replaceChildren(message("error", "タイトルと主張を入力してください。"));
        return;
      }
      if (r.audit_status === "CONFIRMED_HALLUCINATION" && !correction.value.trim()) {
        status.replaceChildren(message("error", "誤りを確認した事例には訂正が必要です。"));
        return;
      }
      approveBtn.disabled = true;
      try {
        const out = await post<{ entry_id: string }>({
          action: "APPROVE",
          submission_id: s.submission_id,
          sanitized_title: title.value.trim(),
          sanitized_claim: claim.value.trim(),
          correction: abstained ? null : correction.value.trim() || null,
          reason: approveReason.value.trim() || undefined,
        });
        status.replaceChildren(message("ok", "承認しました。"), h("p", {}, h("a", { href: `/entries/${out.entry_id}`, target: "_blank", rel: "noopener" }, "公開ページを開く")));
      } catch (err) {
        approveBtn.disabled = false;
        status.replaceChildren(message("error", (err as Error).message));
      }
    });

    rejectBtn.addEventListener("click", async () => {
      if (!rejectReason.value.trim()) {
        status.replaceChildren(message("error", "却下の理由を入力してください。"));
        return;
      }
      rejectBtn.disabled = true;
      try {
        await post({ action: "REJECT", submission_id: s.submission_id, reason: rejectReason.value.trim() });
        status.replaceChildren(message("ok", "却下しました。"));
      } catch (err) {
        rejectBtn.disabled = false;
        status.replaceChildren(message("error", (err as Error).message));
      }
    });
    parts.push(form);
  }

  if (detail.reviews.length) {
    parts.push(
      h(
        "section",
        { class: "panel" },
        h("h2", {}, "審査の記録"),
        h("ul", {}, ...detail.reviews.map((rv) => h("li", {}, `${formatDateTime(rv.created_at)} ${rv.action} ${rv.reviewer_id}${rv.reason ? `：${rv.reason}` : ""}`))),
      ),
    );
  }
  app.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
}

async function route() {
  const hash = window.location.hash.replace(/^#/, "") || "/list/PENDING";
  try {
    const sub = /^\/submission\/([0-9a-f-]{36})$/u.exec(hash);
    if (sub) await renderSubmission(sub[1]!);
    else if (hash === "/published") await renderPublished();
    else {
      const m = /^\/list\/(PENDING|APPROVED|REJECTED)$/u.exec(hash);
      await renderList(m ? m[1]! : "PENDING");
    }
  } catch (err) {
    app.replaceChildren(message("error", (err as Error).message));
  }
}

async function init() {
  try {
    const me = await api<{ reviewer: string }>("/api/admin/me");
    reviewerEl.textContent = me.reviewer;
  } catch (err) {
    app.replaceChildren(
      h("h1", {}, "審査"),
      message("error", err instanceof AuthError ? "管理者として認証されていません。Cloudflare Access でログインしてから開き直してください。" : (err as Error).message),
    );
    return;
  }
  window.addEventListener("hashchange", () => void route());
  await route();
}

void init();

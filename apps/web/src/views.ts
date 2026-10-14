import { CATEGORY_LABEL, PROVIDER_LABEL, STATUS_CLASS, STATUS_LABEL, SUB_LABEL, TTL_LABEL } from "./labels";
import { formatDate, formatDateTime, h, safeHttpUrl } from "./dom";
import type { Entry, PublishedEntry } from "./types";

export function statusBadge(e: PublishedEntry): HTMLElement {
  return h("span", { class: `status-badge ${STATUS_CLASS[e.audit_status]}` }, STATUS_LABEL[e.audit_status]);
}

export function entryCard(e: PublishedEntry): HTMLElement {
  return h(
    "li",
    { class: "card" },
    h(
      "a",
      { class: "card-link", href: `/entries/${e.entry_id}`, "data-link": "" },
      h("div", { class: "card-head" }, statusBadge(e), e.category ? h("span", { class: "tag" }, CATEGORY_LABEL[e.category]) : null, e.is_expired ? h("span", { class: "tag tag-warn" }, "再確認が必要") : null),
      h("h2", { class: "card-title" }, e.sanitized_title),
      h("p", { class: "card-claim" }, e.sanitized_claim),
      e.correction ? h("p", { class: "card-correction" }, `訂正: ${e.correction}`) : null,
      h("p", { class: "card-meta" }, `${formatDate(e.published_at)} 掲載 ・ ${PROVIDER_LABEL[e.auditor.provider]} で監査`),
    ),
  );
}

export function categoryFilter(current: string | null): HTMLElement {
  const items: [string | null, string][] = [[null, "すべて"], ...Object.entries(CATEGORY_LABEL)];
  return h(
    "nav",
    { class: "filters", "aria-label": "カテゴリで絞り込む" },
    ...items.map(([value, label]) =>
      h(
        "a",
        {
          class: value === current ? "chip chip-active" : "chip",
          href: value ? `/?category=${value}` : "/",
          "data-link": "",
          ...(value === current ? { "aria-current": "page" } : {}),
        },
        label,
      ),
    ),
  );
}

function step(n: number, title: string, ...body: (Node | null)[]): HTMLElement {
  return h("li", { class: "step" }, h("div", { class: "step-title" }, h("span", { class: "step-no" }, String(n)), title), ...body);
}

export function entryDetail(entry: Entry): HTMLElement {
  if (entry.publication_status === "RETRACTED") {
    return h(
      "article",
      { class: "detail" },
      h("p", { class: "back" }, h("a", { href: "/", "data-link": "" }, "← 一覧に戻る")),
      h("div", { class: "notice notice-warn" }, h("strong", {}, "この事例は撤回されました。"), " 掲載後に誤りや問題が見つかったため、内容の表示を取りやめています。"),
      h("h1", {}, entry.sanitized_title),
      h("p", { class: "muted" }, `${formatDate(entry.published_at)} 掲載`),
    );
  }

  const e = entry;
  const subClaims = h(
    "ul",
    { class: "subclaims" },
    ...e.audit_trace.decomposed_claims.map((c) =>
      h("li", {}, h("span", { class: `pill pill-${c.status.toLowerCase()}` }, SUB_LABEL[c.status]), h("span", {}, c.sub_claim), h("div", { class: "muted small" }, `照合先: ${c.verification_target}`)),
    ),
  );

  const sources = h(
    "ul",
    { class: "sources" },
    ...e.evidence_sources.map((s) => {
      const href = safeHttpUrl(s.url);
      return h(
        "li",
        {},
        h("span", { class: s.verified ? "pill pill-supported" : "pill pill-unverifiable" }, s.verified ? "監査中に取得" : "未確認"),
        href ? h("a", { href, target: "_blank", rel: "noopener noreferrer nofollow" }, s.title) : h("span", {}, s.title),
        h("div", { class: "muted small url" }, s.url),
        h("blockquote", {}, s.snippet),
      );
    }),
  );

  return h(
    "article",
    { class: "detail" },
    h("p", { class: "back" }, h("a", { href: "/", "data-link": "" }, "← 一覧に戻る")),
    h("div", { class: "detail-head" }, statusBadge(e), e.category ? h("span", { class: "tag" }, CATEGORY_LABEL[e.category]) : null, e.severity_score !== null ? h("span", { class: "tag" }, `深刻度 ${e.severity_score} / 5`) : null),
    h("h1", {}, e.sanitized_title),
    e.is_expired
      ? h("div", { class: "notice notice-warn" }, "この事例は有効期限を過ぎています。内容が今も正しいとは限らないため、根拠のリンク先で最新の情報を確かめてください。")
      : null,
    h("section", { class: "panel" }, h("h2", {}, "監査した主張"), h("p", { class: e.audit_status === "CONFIRMED_HALLUCINATION" ? "claim-wrong" : "" }, e.sanitized_claim), e.correction ? h("div", {}, h("h2", {}, "訂正"), h("p", { class: "claim-right" }, e.correction)) : null),
    h(
      "section",
      { class: "panel" },
      h("h2", {}, "監査の工程"),
      h(
        "ol",
        { class: "trace" },
        step(1, "主張の分解", subClaims),
        step(2, "根拠との照合", h("p", { class: "prewrap" }, e.audit_trace.alignment_reasoning), e.evidence_sources.length ? sources : h("p", { class: "muted" }, "根拠として示せる資料はありませんでした。")),
        step(
          3,
          e.audit_status === "UNVERIFIED_OR_AMBIGUOUS" ? "判定の保留" : "判定",
          h("p", {}, STATUS_LABEL[e.audit_status]),
          e.audit_trace.abstention_reason ? h("p", { class: "prewrap" }, `保留の理由: ${e.audit_trace.abstention_reason}`) : null,
        ),
      ),
    ),
    e.limitations.length ? h("section", { class: "panel" }, h("h2", {}, "この監査の限界"), h("ul", {}, ...e.limitations.map((l) => h("li", {}, l)))) : null,
    e.estimated_error_pattern ? h("section", { class: "panel" }, h("h2", {}, "誤りの起き方（推定）"), h("p", {}, e.estimated_error_pattern)) : null,
    h(
      "dl",
      { class: "meta panel" },
      h("dt", {}, "監査したAI"),
      h("dd", {}, `${PROVIDER_LABEL[e.auditor.provider]}（${e.auditor.model}）`),
      h("dt", {}, "監査日時"),
      h("dd", {}, formatDateTime(e.verified_at)),
      h("dt", {}, "掲載日"),
      h("dd", {}, formatDate(e.published_at)),
      h("dt", {}, "情報の種類"),
      h("dd", {}, TTL_LABEL[e.ttl_category]),
      h("dt", {}, "有効期限"),
      h("dd", {}, formatDateTime(e.expires_at)),
    ),
    h(
      "p",
      { class: "muted small" },
      "この記録は、利用者のブラウザで AI が作成した監査結果を、管理者が根拠と個人情報の有無を確認したうえで掲載したものです。GeminiHall は監査結果が改ざんされていないことを技術的に保証できないため、根拠のリンク先をご自身で確かめてください。",
    ),
  );
}

export function aboutView(): HTMLElement {
  return h(
    "article",
    { class: "detail prose" },
    h("h1", {}, "GeminiHall について"),
    h("p", {}, "GeminiHall は、AI の回答に含まれる主張を、検索で実際に取得した資料にもとづいて監査し、その記録を公開する取り組みです。"),
    h("h2", {}, "監査の考え方"),
    h(
      "ul",
      {},
      h("li", {}, "監査に使う AI を、正解を知っている存在として扱いません。監査中に取得した資料で裏付けられない限り、「誤り」とも「正しい」とも断定しません。"),
      h("li", {}, "主張を小さな単位に分け、それぞれを資料と照合し、判定または判定の保留に至るまでの工程をすべて表示します。"),
      h("li", {}, "根拠が足りない主張、意見や価値判断、未来の予測は「判定を保留」とし、その理由を示します。"),
      h("li", {}, "情報の種類ごとに有効期限を設け、期限を過ぎた事例は再確認が必要であることを表示します。"),
    ),
    h("h2", {}, "掲載までの流れ"),
    h(
      "ol",
      {},
      h("li", {}, "利用者が、Chrome 拡張機能と自分の AI の契約で監査を実行します。監査は利用者のブラウザの中だけで行われ、API キーは GeminiHall に送られません。"),
      h("li", {}, "利用者が結果を見て、公開に同意したうえで掲載を申請します。"),
      h("li", {}, "管理者が根拠のリンク先と個人情報の有無を確認し、公開用に文面を整えてから掲載します。"),
    ),
    h("p", {}, h("a", { href: "/", "data-link": "" }, "公開辞典を見る")),
  );
}

export function emptyView(message: string): HTMLElement {
  return h("p", { class: "empty" }, message);
}

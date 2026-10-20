import { NotFoundError, getEntry, listEntries } from "./api";
import { h } from "./dom";
import { CATEGORY_LABEL } from "./labels";
import { aboutView, categoryFilter, emptyView, entryCard, entryDetail } from "./views";

const app = document.getElementById("app")!;
const BASE_TITLE = "GeminiHall";
const DEFAULT_PAGE_TITLE = "AI回答の監査記録・公開辞典";
const BASE_URL = "https://geminihall.cc";

function setPageMetadata(options: { title?: string; description: string; path: string; noindex?: boolean }) {
  const title = `${options.title ?? DEFAULT_PAGE_TITLE} | ${BASE_TITLE}`;
  const canonical = new URL(options.path, BASE_URL).toString();
  document.title = title;

  const setMetaContent = (name: string, key: "name" | "property", value: string) => {
    let element = document.head.querySelector<HTMLMetaElement>(`meta[${key}="${name}"]`);
    if (!element) {
      element = document.createElement("meta");
      element.setAttribute(key, name);
      document.head.append(element);
    }
    element.content = value;
  };

  setMetaContent("description", "name", options.description);
  setMetaContent("og:title", "property", title);
  setMetaContent("og:description", "property", options.description);
  setMetaContent("og:url", "property", canonical);
  setMetaContent("twitter:title", "name", title);
  setMetaContent("twitter:description", "name", options.description);

  let canonicalElement = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonicalElement) {
    canonicalElement = document.createElement("link");
    canonicalElement.rel = "canonical";
    document.head.append(canonicalElement);
  }
  canonicalElement.href = canonical;

  let robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (options.noindex) {
    if (!robots) {
      robots = document.createElement("meta");
      robots.name = "robots";
      document.head.append(robots);
    }
    robots.content = "noindex,follow";
  } else {
    robots?.remove();
  }
}

async function renderList(url: URL) {
  const raw = url.searchParams.get("category");
  const category = raw && Object.hasOwn(CATEGORY_LABEL, raw) ? raw : null;
  setPageMetadata({ description: "利用者のブラウザで AI の主張を検索で取得した資料と照合し、管理者が根拠を確認した監査記録を掲載します。掲載記録は真偽を保証せず、一次資料の代わりにもなりません。", path: "/" });
  const list = h("ul", { class: "cards" });
  const more = h("button", { type: "button", class: "more", hidden: "" }, "さらに表示");
  const intro = app.querySelector(".intro") ?? h("section", { class: "intro" }, h("h1", {}, "AI の回答の監査記録"), h("p", {}, "AI が示した主張を、検索で取得した資料と照合した記録です。管理者が根拠を確認した事例を掲載します。"));
  app.replaceChildren(
    intro,
    categoryFilter(category),
    list,
    more,
  );

  let before: string | undefined;
  const load = async () => {
    more.setAttribute("disabled", "");
    const page = await listEntries({ category: category ?? undefined, before });
    list.append(...page.entries.map(entryCard));
    if (!list.children.length) list.replaceWith(emptyView("まだ掲載された事例はありません。"));
    before = page.next_before ?? undefined;
    more.toggleAttribute("hidden", !page.next_before);
    more.removeAttribute("disabled");
  };
  more.addEventListener("click", () => void load());
  await load();
}

async function renderEntry(id: string) {
  try {
    const entry = await getEntry(id);
    const description = entry.publication_status === "RETRACTED"
      ? "この監査記録は掲載後に誤りや問題が見つかったため撤回されました。"
      : `${entry.sanitized_claim} GeminiHall の監査記録です。根拠のリンク先で内容をご確認ください。`.slice(0, 300);
    setPageMetadata({
      title: entry.sanitized_title,
      description,
      path: `/entries/${encodeURIComponent(entry.entry_id)}`,
      noindex: entry.publication_status === "RETRACTED" || entry.is_expired,
    });
    app.replaceChildren(entryDetail(entry));
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
    setPageMetadata({ title: "見つかりません", description: "指定されたGeminiHallの監査記録は見つかりませんでした。", path: window.location.pathname, noindex: true });
    app.replaceChildren(emptyView("この事例は見つかりませんでした。"), h("p", {}, h("a", { href: "/", "data-link": "" }, "一覧に戻る")));
  }
}

async function route() {
  const url = new URL(window.location.href);
  app.setAttribute("aria-busy", "true");
  try {
    const entryMatch = /^\/entries\/([0-9a-f-]{36})\/?$/u.exec(url.pathname);
    if (entryMatch) await renderEntry(entryMatch[1]!);
    else if (url.pathname === "/about" || url.pathname === "/about/") {
      setPageMetadata({ title: "GeminiHall について", description: "GeminiHallの監査の考え方、掲載までの流れ、記録の限界を説明します。", path: "/about" });
      app.replaceChildren(aboutView());
    } else if (url.pathname === "/") await renderList(url);
    else {
      setPageMetadata({ title: "見つかりません", description: "指定されたページは見つかりませんでした。", path: url.pathname, noindex: true });
      app.replaceChildren(emptyView("ページが見つかりませんでした。"), h("p", {}, h("a", { href: "/", "data-link": "" }, "一覧に戻る")));
    }
  } catch {
    app.replaceChildren(emptyView("読み込みに失敗しました。時間をおいて再読み込みしてください。"));
  } finally {
    app.removeAttribute("aria-busy");
  }
}

document.addEventListener("click", (e) => {
  const a = (e.target as Element | null)?.closest("a[data-link]");
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  const href = a.getAttribute("href")!;
  if (href !== window.location.pathname + window.location.search) window.history.pushState({}, "", href);
  window.scrollTo(0, 0);
  void route();
});

window.addEventListener("popstate", () => void route());
void route();

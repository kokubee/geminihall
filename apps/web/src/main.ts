import { NotFoundError, getEntry, listEntries } from "./api";
import { h } from "./dom";
import { CATEGORY_LABEL } from "./labels";
import { aboutView, categoryFilter, emptyView, entryCard, entryDetail } from "./views";

const app = document.getElementById("app")!;
const BASE_TITLE = "GeminiHall 公開辞典";

function setTitle(sub?: string) {
  document.title = sub ? `${sub} | ${BASE_TITLE}` : BASE_TITLE;
}

async function renderList(url: URL) {
  const raw = url.searchParams.get("category");
  const category = raw && Object.hasOwn(CATEGORY_LABEL, raw) ? raw : null;
  setTitle();
  const list = h("ul", { class: "cards" });
  const more = h("button", { type: "button", class: "more", hidden: "" }, "さらに表示");
  app.replaceChildren(
    h("section", { class: "intro" }, h("h1", {}, "AI の回答の監査記録"), h("p", {}, "AI が示した主張を、検索で取得した資料と照合した記録です。誤りを確認したもの、根拠で裏付けられたもの、根拠が足りず判定を保留したものを掲載しています。")),
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
    setTitle(entry.sanitized_title);
    app.replaceChildren(entryDetail(entry));
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
    setTitle("見つかりません");
    app.replaceChildren(emptyView("この事例は見つかりませんでした。"), h("p", {}, h("a", { href: "/", "data-link": "" }, "一覧に戻る")));
  }
}

async function route() {
  const url = new URL(window.location.href);
  app.setAttribute("aria-busy", "true");
  try {
    const entryMatch = /^\/entries\/([0-9a-f-]{36})\/?$/u.exec(url.pathname);
    if (entryMatch) await renderEntry(entryMatch[1]!);
    else if (url.pathname === "/about") {
      setTitle("GeminiHall について");
      app.replaceChildren(aboutView());
    } else if (url.pathname === "/") await renderList(url);
    else {
      setTitle("見つかりません");
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

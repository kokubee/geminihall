import { describe, expect, it } from "vitest";
import { ADMIN_HEADER, TOKEN_A, app, approve, call, postJson, setNow, submit, testEnv } from "./helpers";

const ADMIN = { [ADMIN_HEADER]: "admin@example.com" };

describe("SEO assets", () => {
  it("lists only active published records in the sitemap", async () => {
    setNow("2026-10-15T00:00:00.000Z");
    try {
      const active = await submit("有効な公開記録", TOKEN_A);
      const expiring = await submit("期限切れの公開記録", TOKEN_A, { ttl_category: "CURRENT_NEWS" });
      const retracted = await submit("撤回された公開記録", TOKEN_A);
      const pending = await submit("未審査の記録", TOKEN_A);

      const activeEntry = (await (await approve(active.result.request_id)).json()) as { entry_id: string };
      const expiredEntry = (await (await approve(expiring.result.request_id)).json()) as { entry_id: string };
      const retractedEntry = (await (await approve(retracted.result.request_id)).json()) as { entry_id: string };
      expect((await postJson("/api/admin/reviews", { action: "RETRACT", entry_id: retractedEntry.entry_id, reason: "テスト" }, ADMIN)).status).toBe(200);

      setNow("2026-10-15T01:00:00.000Z");
      const response = await call("/sitemap.xml");
      const sitemap = await response.text();
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/xml");
      expect(response.headers.get("cache-control")).toContain("max-age=300");
      expect(sitemap).toContain("<loc>https://geminihall.cc/</loc>");
      expect(sitemap).toContain("<loc>https://geminihall.cc/about</loc>");
      expect(sitemap).toContain(`/entries/${activeEntry.entry_id}`);
      expect(sitemap).not.toContain(`/entries/${expiredEntry.entry_id}`);
      expect(sitemap).not.toContain(`/entries/${retractedEntry.entry_id}`);
      expect(sitemap).not.toContain(pending.result.request_id);
    } finally {
      setNow("2026-10-15T00:00:00.000Z");
    }
  });

  it("serves the app shell only for existing entry pages and returns a noindex 404 otherwise", async () => {
    const assets = {
      fetch: async (request: Request) => {
        const path = new URL(request.url).pathname;
        return path === "/404.html"
          ? new Response("not found page", { headers: { "Content-Type": "text/html; charset=UTF-8" } })
          : new Response("app shell", { headers: { "Content-Type": "text/html; charset=UTF-8" } });
      },
    } as unknown as typeof testEnv.ASSETS;
    const envWithAssets = { ...testEnv, ASSETS: assets };

    const missing = await app.request(`/entries/${crypto.randomUUID()}`, {}, envWithAssets);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-robots-tag")).toBe("noindex, follow");
    expect(await missing.text()).toBe("not found page");

    const { result } = await submit("既存の公開記録ページ", TOKEN_A);
    const approved = (await (await approve(result.request_id)).json()) as { entry_id: string };
    const existing = await app.request(`/entries/${approved.entry_id}`, {}, envWithAssets);
    expect(existing.status).toBe(200);
    expect(await existing.text()).toBe("app shell");

    const existingWithSlash = await app.request(`/entries/${approved.entry_id}/`, {}, envWithAssets);
    expect(existingWithSlash.status).toBe(200);
    expect(await existingWithSlash.text()).toBe("app shell");
  });
});

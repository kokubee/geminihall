import { describe, expect, it } from "vitest";
import { ADMIN_HEADER, TOKEN_A, approve, call, postJson, setNow, submit } from "./helpers";

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
});

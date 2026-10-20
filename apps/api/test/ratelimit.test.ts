import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { CONSENT, TOKEN_A, app, buildResult } from "./helpers";

describe("submission rate limit", () => {
  it("returns 429 once the limiter refuses", async () => {
    let calls = 0;
    const limiter = { limit: async () => ({ success: ++calls <= 2 }) };
    const tokenLimiter = { limit: async () => ({ success: true }) };
    const send = async (claim: string) =>
      app.request(
        "/api/submissions",
        {
          method: "POST",
          headers: { "content-type": "application/json", "X-Client-Token": TOKEN_A, "CF-Connecting-IP": "192.0.2.1" },
          body: JSON.stringify({ original_claim: claim, locale: "ja", consent_version: CONSENT, result: await buildResult(claim) }),
        },
        { ...env, SUBMIT_LIMITER: limiter as unknown as RateLimit, SUBMIT_TOKEN_LIMITER: tokenLimiter as unknown as RateLimit },
      );
    expect((await send("制限テスト1")).status).toBe(201);
    expect((await send("制限テスト2")).status).toBe(201);
    const third = await send("制限テスト3");
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
  });

  it("limits by IP even when each request rotates its client token", async () => {
    const ipCounts = new Map<string, number>();
    const ipLimiter = {
      limit: async ({ key }: { key: string }) => {
        const count = (ipCounts.get(key) ?? 0) + 1;
        ipCounts.set(key, count);
        return { success: count <= 10 };
      },
    };
    const tokenLimiter = { limit: async () => ({ success: true }) };
    const send = async (index: number) => {
      const claim = `同一IPのトークン変更テスト${index}`;
      return app.request(
        "/api/submissions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Client-Token": `token-${index}-${"a".repeat(40)}`,
            "CF-Connecting-IP": "203.0.113.10",
          },
          body: JSON.stringify({ original_claim: claim, locale: "ja", consent_version: CONSENT, result: await buildResult(claim) }),
        },
        { ...env, SUBMIT_LIMITER: ipLimiter as unknown as RateLimit, SUBMIT_TOKEN_LIMITER: tokenLimiter as unknown as RateLimit },
      );
    };

    for (let index = 1; index <= 10; index++) expect((await send(index)).status).toBe(201);
    const eleventh = await send(11);
    expect(eleventh.status).toBe(429);
    expect(ipCounts.get("203.0.113.10")).toBe(11);
  });
});

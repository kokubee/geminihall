import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { CONSENT, TOKEN_A, app, buildResult } from "./helpers";

describe("submission rate limit", () => {
  it("returns 429 once the limiter refuses", async () => {
    let calls = 0;
    const limiter = { limit: async () => ({ success: ++calls <= 2 }) };
    const send = async (claim: string) =>
      app.request(
        "/api/submissions",
        {
          method: "POST",
          headers: { "content-type": "application/json", "X-Client-Token": TOKEN_A },
          body: JSON.stringify({ original_claim: claim, locale: "ja", consent_version: CONSENT, result: await buildResult(claim) }),
        },
        { ...env, SUBMIT_LIMITER: limiter as unknown as RateLimit },
      );
    expect((await send("制限テスト1")).status).toBe(201);
    expect((await send("制限テスト2")).status).toBe(201);
    const third = await send("制限テスト3");
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
  });
});

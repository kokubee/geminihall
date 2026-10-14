import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { createApp } from "../src/app";
import { adminAllowlist, verifyAccessJwt } from "../src/access";
import { ADMIN_HEADER, call } from "./helpers";

describe("admin CSRF guard", () => {
  it("rejects admin POSTs without the admin header even for an authenticated reviewer", async () => {
    const res = await call("/api/admin/reviews", {
      method: "POST",
      headers: { "content-type": "application/json", [ADMIN_HEADER]: "admin@example.com" },
      body: JSON.stringify({ action: "REJECT", submission_id: crypto.randomUUID(), reason: "x" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("verifyAccessJwt", () => {
  it("fails closed when the allowlist or Access settings are empty", async () => {
    const req = new Request("https://geminihall.cc/api/admin/me", { headers: { "Cf-Access-Jwt-Assertion": "x" } });
    expect(await verifyAccessJwt(req, { ...env, ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com", ACCESS_AUD: "aud", ACCESS_ADMIN_EMAILS: "" })).toBeNull();
    expect(await verifyAccessJwt(req, { ...env, ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "aud", ACCESS_ADMIN_EMAILS: "a@example.com" })).toBeNull();
  });

  it("normalizes the allowlist", () => {
    expect([...adminAllowlist({ ...env, ACCESS_ADMIN_EMAILS: " A@Example.com, b@example.com ," })]).toEqual(["a@example.com", "b@example.com"]);
  });

  it("returns 403 from /api/admin/me when the real verifier is used without Access", async () => {
    const app = createApp(verifyAccessJwt);
    const res = await app.request("/api/admin/me", {}, env);
    expect(res.status).toBe(403);
  });
});

import { describe, expect, it } from "vitest";
import { AuditResultSchema } from "@geminihall/schema";
import { isReusable } from "../lib/cache";
import { DEMO_CLAIM, demoResult } from "../lib/demo";
import { safeHttpUrl } from "../lib/render";

describe("demo fixture", () => {
  it("is a valid DEMO result that keeps the recorded claim", () => {
    const r = demoResult("550e8400-e29b-41d4-a716-446655440000");
    expect(AuditResultSchema.safeParse(r).success).toBe(true);
    expect(r.mode).toBe("DEMO");
    expect(DEMO_CLAIM.length).toBeGreaterThan(0);
  });
});

describe("private cache reuse", () => {
  const base = demoResult("550e8400-e29b-41d4-a716-446655440000");

  it("reuses unexpired non-realtime results", () => {
    expect(isReusable({ ...base, expires_at: "2099-01-01T00:00:00.000Z" }, Date.parse("2026-10-15T00:00:00Z"))).toBe(true);
  });

  it("never reuses realtime results or expired ones", () => {
    const now = Date.parse("2026-10-15T00:00:00Z");
    expect(isReusable({ ...base, ttl_category: "REALTIME", expires_at: "2099-01-01T00:00:00.000Z" }, now)).toBe(false);
    expect(isReusable({ ...base, expires_at: "2026-10-14T00:00:00.000Z" }, now)).toBe(false);
  });
});

describe("safeHttpUrl", () => {
  it("only allows http and https links", () => {
    expect(safeHttpUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,x")).toBeNull();
  });
});

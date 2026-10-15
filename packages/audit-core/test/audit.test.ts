import { describe, expect, it } from "vitest";
import { AuditResultSchema } from "@geminihall/schema";
import {
  InvalidClaimError,
  ModelOutputError,
  UpstreamError,
  cacheIdentity,
  normalizeUrl,
  runAudit,
} from "../src/index";
import { anthropicMessage, confirmedOutput, mockFetch, openaiResponse, type CapturedRequest } from "./helpers";

const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440000";
const SOURCE = "https://www.example.go.jp/constitution";
const FAKE_KEY = "test-key-not-real-0000000000000000";
const input = { claim: "日本国憲法は1950年に施行された", locale: "ja" };
const fixedNow = () => Date.parse("2026-10-15T00:00:00.000Z");

describe("runAudit with Anthropic", () => {
  it("keeps a confirmation whose source was actually retrieved", async () => {
    const captured: CapturedRequest[] = [];
    const out = await runAudit({
      requestId: REQUEST_ID,
      provider: "ANTHROPIC",
      credential: { kind: "API_KEY", apiKey: FAKE_KEY },
      model: "claude-opus-5-5",
      input,
      now: fixedNow,
      fetch: mockFetch([anthropicMessage(confirmedOutput([SOURCE]), [SOURCE])], captured),
    });
    expect(out.downgraded).toBe(false);
    expect(out.result.audit_status).toBe("CONFIRMED_HALLUCINATION");
    expect(out.result.evidence_sources[0]?.verified).toBe(true);
    expect(out.result.auditor).toEqual({ provider: "ANTHROPIC", model: "claude-opus-5-5", via: "API_KEY" });
    expect(out.result.expires_at).toBe("2026-11-14T00:00:00.000Z");
    expect(AuditResultSchema.safeParse(out.result).success).toBe(true);

    expect(captured).toHaveLength(1);
    const req = captured[0]!;
    expect(new URL(req.url).host).toBe("api.anthropic.com");
    expect(req.headers.get("x-api-key")).toBe(FAKE_KEY);
    expect(req.headers.get("anthropic-dangerous-direct-browser-access")).toBe("true");
    expect(JSON.stringify(req.body)).not.toContain(FAKE_KEY);
  });

  it("downgrades a confirmation that cites a URL the search never returned", async () => {
    const out = await runAudit({
      requestId: REQUEST_ID,
      provider: "ANTHROPIC",
      credential: { kind: "API_KEY", apiKey: FAKE_KEY },
      model: "claude-opus-5-5",
      input,
      now: fixedNow,
      fetch: mockFetch([anthropicMessage(confirmedOutput(["https://fabricated.example.com/a"]), [SOURCE])]),
    });
    expect(out.downgraded).toBe(true);
    expect(out.result.audit_status).toBe("UNVERIFIED_OR_AMBIGUOUS");
    expect(out.result.correction).toBeNull();
    expect(out.result.unverified_notes).toContain("1947");
    expect(out.result.audit_trace.abstention_reason).toBeTruthy();
    expect(out.result.evidence_sources.every((s) => !s.verified)).toBe(true);
    expect(AuditResultSchema.safeParse(out.result).success).toBe(true);
  });

  it("downgrades a confirmation when no search ran at all", async () => {
    const out = await runAudit({
      requestId: REQUEST_ID,
      provider: "ANTHROPIC",
      credential: { kind: "API_KEY", apiKey: FAKE_KEY },
      model: "claude-opus-5-5",
      input,
      now: fixedNow,
      fetch: mockFetch([anthropicMessage(confirmedOutput([SOURCE]), [])]),
    });
    expect(out.result.audit_status).toBe("UNVERIFIED_OR_AMBIGUOUS");
  });

  it("continues a paused turn", async () => {
    const paused = anthropicMessage(confirmedOutput([SOURCE]), [SOURCE], "pause_turn");
    paused.content = paused.content.slice(0, 2);
    const captured: CapturedRequest[] = [];
    const out = await runAudit({
      requestId: REQUEST_ID,
      provider: "ANTHROPIC",
      credential: { kind: "API_KEY", apiKey: FAKE_KEY },
      model: "claude-opus-5-5",
      input,
      now: fixedNow,
      fetch: mockFetch([paused, anthropicMessage(confirmedOutput([SOURCE]), [])], captured),
    });
    expect(captured).toHaveLength(2);
    expect(out.result.audit_status).toBe("CONFIRMED_HALLUCINATION");
  });

  it("raises UpstreamError on refusal", async () => {
    await expect(
      runAudit({
        requestId: REQUEST_ID,
        provider: "ANTHROPIC",
        credential: { kind: "API_KEY", apiKey: FAKE_KEY },
        model: "claude-opus-5-5",
        input,
        fetch: mockFetch([anthropicMessage(confirmedOutput([SOURCE]), [SOURCE], "refusal")]),
      }),
    ).rejects.toBeInstanceOf(UpstreamError);
  });

  it("raises UpstreamError on an HTTP error without leaking the key", async () => {
    const err = await runAudit({
      requestId: REQUEST_ID,
      provider: "ANTHROPIC",
      credential: { kind: "API_KEY", apiKey: FAKE_KEY },
      model: "claude-opus-5-5",
      input,
      fetch: mockFetch([
        new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ]),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).status).toBe(401);
    expect(String((err as Error).message)).not.toContain(FAKE_KEY);
  });

  it("raises ModelOutputError on non-JSON output", async () => {
    const msg = anthropicMessage(confirmedOutput([SOURCE]), [SOURCE]);
    msg.content[2] = { type: "text", text: "not json" };
    await expect(
      runAudit({
        requestId: REQUEST_ID,
        provider: "ANTHROPIC",
        credential: { kind: "API_KEY", apiKey: FAKE_KEY },
        model: "claude-opus-5-5",
        input,
        fetch: mockFetch([msg]),
      }),
    ).rejects.toBeInstanceOf(ModelOutputError);
  });

  it("raises InvalidClaimError when the model finds no checkable claim", async () => {
    const output = { ...confirmedOutput([SOURCE]), is_valid_input: false };
    await expect(
      runAudit({
        requestId: REQUEST_ID,
        provider: "ANTHROPIC",
        credential: { kind: "API_KEY", apiKey: FAKE_KEY },
        model: "claude-opus-5-5",
        input,
        fetch: mockFetch([anthropicMessage(output, [SOURCE])]),
      }),
    ).rejects.toBeInstanceOf(InvalidClaimError);
  });
});

describe("runAudit with OpenAI", () => {
  it("verifies sources from web_search_call and strips utm parameters", async () => {
    const captured: CapturedRequest[] = [];
    const out = await runAudit({
      requestId: REQUEST_ID,
      provider: "OPENAI",
      credential: { kind: "API_KEY", apiKey: FAKE_KEY },
      model: "gpt-6-astra",
      input,
      now: fixedNow,
      fetch: mockFetch([openaiResponse(confirmedOutput([SOURCE]), [`${SOURCE}?utm_source=chatgpt.com`])], captured),
    });
    expect(out.result.audit_status).toBe("CONFIRMED_HALLUCINATION");
    expect(out.result.evidence_sources[0]?.verified).toBe(true);

    const req = captured[0]!;
    expect(new URL(req.url).host).toBe("api.openai.com");
    expect(req.headers.get("authorization")).toBe(`Bearer ${FAKE_KEY}`);
    const body = req.body as Record<string, unknown>;
    expect(body.include).toEqual(["web_search_call.action.sources"]);
    expect(body.store).toBe(false);
    expect(JSON.stringify(body)).not.toContain(FAKE_KEY);
  });

  it("accepts url_citation annotations as retrieved sources", async () => {
    const out = await runAudit({
      requestId: REQUEST_ID,
      provider: "OPENAI",
      credential: { kind: "API_KEY", apiKey: FAKE_KEY },
      model: "gpt-6-astra",
      input,
      now: fixedNow,
      fetch: mockFetch([openaiResponse(confirmedOutput([SOURCE]), [], [SOURCE])]),
    });
    expect(out.result.evidence_sources[0]?.verified).toBe(true);
  });

  it("downgrades unretrieved sources", async () => {
    const out = await runAudit({
      requestId: REQUEST_ID,
      provider: "OPENAI",
      credential: { kind: "API_KEY", apiKey: FAKE_KEY },
      model: "gpt-6-astra",
      input,
      now: fixedNow,
      fetch: mockFetch([openaiResponse(confirmedOutput(["https://fabricated.example.com/a"]), [SOURCE])]),
    });
    expect(out.result.audit_status).toBe("UNVERIFIED_OR_AMBIGUOUS");
  });
});

describe("cache identity", () => {
  it("differs when only a number differs", async () => {
    const a = await cacheIdentity({ claim: "東京都の人口は1400万人である", locale: "ja" });
    const b = await cacheIdentity({ claim: "東京都の人口は1300万人である", locale: "ja" });
    expect(a.claimCacheKey).not.toBe(b.claimCacheKey);
  });

  it("differs when only negation differs", async () => {
    const a = await cacheIdentity({ claim: "この法律は2020年に施行された", locale: "ja" });
    const b = await cacheIdentity({ claim: "この法律は2020年に施行されなかった", locale: "ja" });
    expect(a.claimCacheKey).not.toBe(b.claimCacheKey);
  });

  it("differs when only context differs", async () => {
    const a = await cacheIdentity({ claim: "x は正しい", context: "Gemini の回答 A", locale: "ja" });
    const b = await cacheIdentity({ claim: "x は正しい", context: "Gemini の回答 B", locale: "ja" });
    expect(a.claimCacheKey).not.toBe(b.claimCacheKey);
  });

  it("ignores whitespace and full-width differences", async () => {
    const a = await cacheIdentity({ claim: "ＡＢＣ  は 2020年", locale: "ja" });
    const b = await cacheIdentity({ claim: "abc は 2020年", locale: "ja" });
    expect(a.claimCacheKey).toBe(b.claimCacheKey);
  });
});

describe("normalizeUrl", () => {
  it("drops fragments, utm params and trailing slash", () => {
    expect(normalizeUrl("https://Example.com/a/?utm_source=x&id=1#frag")).toBe("https://example.com/a/?id=1");
    expect(normalizeUrl("https://example.com/a/")).toBe("https://example.com/a");
  });

  it("rejects non-http schemes", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("OpenAI inline citations", () => {
  it("removes markdown citation links from text fields but keeps source URLs", async () => {
    const output = confirmedOutput([SOURCE]);
    output.correction = `日本国憲法は1947年5月3日に施行された。([example.go.jp](${SOURCE}?utm_source=openai))`;
    const out = await runAudit({
      requestId: REQUEST_ID,
      provider: "OPENAI",
      credential: { kind: "API_KEY", apiKey: FAKE_KEY },
      model: "gpt-6-astra",
      input,
      now: fixedNow,
      fetch: mockFetch([openaiResponse(output, [SOURCE])]),
    });
    expect(out.result.correction).toBe("日本国憲法は1947年5月3日に施行された。");
    expect(out.result.evidence_sources[0]?.url).toBe(SOURCE);
  });
});

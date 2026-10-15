import { describe, expect, it } from "vitest";
import { UpstreamError, runAudit } from "../src/index";
import { confirmedOutput, mockFetch, openaiResponse, sseResponse, type CapturedRequest } from "./helpers";

const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440000";
const SOURCE = "https://www.example.go.jp/constitution";
const TOKEN = "chatgpt-plan-access-token-for-test";
const input = { claim: "日本国憲法は1950年5月3日に施行された", locale: "ja" };

describe("runAudit with a ChatGPT plan token", () => {
  it("streams with store=false, waits for response.completed and records the auth path", async () => {
    const captured: CapturedRequest[] = [];
    const final = openaiResponse(confirmedOutput([SOURCE]), [SOURCE]);
    const out = await runAudit({
      requestId: REQUEST_ID,
      provider: "OPENAI",
      credential: { kind: "CHATGPT_PLAN", accessToken: TOKEN },
      model: "gpt-6-astra",
      input,
      fetch: mockFetch(
        [
          sseResponse([
            { type: "response.created", sequence_number: 0, response: { ...final, status: "in_progress", output: [] } },
            { type: "response.completed", sequence_number: 1, response: final },
          ]),
        ],
        captured,
      ),
    });
    expect(out.result.audit_status).toBe("CONFIRMED_HALLUCINATION");
    expect(out.result.auditor.via).toBe("CHATGPT_PLAN");
    const body = captured[0]!.body as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body.input).toEqual([{ type: "message", role: "user", content: [{ type: "input_text", text: expect.stringContaining("1950") }] }]);
    expect(body.store).toBe(false);
    expect(body).not.toHaveProperty("max_output_tokens");
    expect(body).not.toHaveProperty("temperature");
    expect(captured[0]!.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("surfaces a usage-limit failure with its code", async () => {
    const final = openaiResponse(confirmedOutput([SOURCE]), [SOURCE]);
    const err = await runAudit({
      requestId: REQUEST_ID,
      provider: "OPENAI",
      credential: { kind: "CHATGPT_PLAN", accessToken: TOKEN },
      model: "gpt-6-astra",
      input,
      fetch: mockFetch([
        sseResponse([
          {
            type: "response.failed",
            sequence_number: 1,
            response: { ...final, status: "failed", output: [], error: { code: "subscription_sharing_usage_limit_exceeded", message: "limit" } },
          },
        ]),
      ]),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).code).toBe("subscription_sharing_usage_limit_exceeded");
  });

  it("treats a stream without response.completed as a failure", async () => {
    const final = openaiResponse(confirmedOutput([SOURCE]), [SOURCE]);
    await expect(
      runAudit({
        requestId: REQUEST_ID,
        provider: "OPENAI",
        credential: { kind: "CHATGPT_PLAN", accessToken: TOKEN },
        model: "gpt-6-astra",
        input,
        fetch: mockFetch([sseResponse([{ type: "response.created", sequence_number: 0, response: { ...final, status: "in_progress", output: [] } }])]),
      }),
    ).rejects.toBeInstanceOf(UpstreamError);
  });

  it("maps an HTTP 429 error code from the admission layer", async () => {
    const err = await runAudit({
      requestId: REQUEST_ID,
      provider: "OPENAI",
      credential: { kind: "CHATGPT_PLAN", accessToken: TOKEN },
      model: "gpt-6-astra",
      input,
      fetch: mockFetch([
        new Response(JSON.stringify({ error: { code: "subscription_sharing_usage_limit_exceeded", message: "limit", type: "x", param: null } }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
      ]),
    }).catch((e: unknown) => e);
    expect((err as UpstreamError).status).toBe(429);
    expect((err as UpstreamError).code).toBe("subscription_sharing_usage_limit_exceeded");
  });

  it("refuses to send a ChatGPT plan token to Claude", async () => {
    await expect(
      runAudit({
        requestId: REQUEST_ID,
        provider: "ANTHROPIC",
        credential: { kind: "CHATGPT_PLAN", accessToken: TOKEN },
        model: "claude-opus-5-5",
        input,
        fetch: mockFetch([]),
      }),
    ).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("plan route output recovery", () => {
  it("uses streamed text deltas when the completed response carries no message text", async () => {
    const full = openaiResponse(confirmedOutput([SOURCE]), [SOURCE]);
    const text = JSON.stringify(confirmedOutput([SOURCE]));
    const bare = { ...full, output: full.output.filter((o: { type: string }) => o.type !== "message") };
    const out = await runAudit({
      requestId: REQUEST_ID,
      provider: "OPENAI",
      credential: { kind: "CHATGPT_PLAN", accessToken: TOKEN },
      model: "m",
      input,
      fetch: mockFetch([
        sseResponse([
          { type: "response.output_text.delta", sequence_number: 1, item_id: "m", output_index: 1, content_index: 0, delta: text.slice(0, 50), logprobs: [] },
          { type: "response.output_text.delta", sequence_number: 2, item_id: "m", output_index: 1, content_index: 0, delta: text.slice(50), logprobs: [] },
          { type: "response.completed", sequence_number: 3, response: bare },
        ]),
      ]),
    });
    expect(out.result.audit_status).toBe("CONFIRMED_HALLUCINATION");
  });
});

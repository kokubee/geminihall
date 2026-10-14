import type { ModelAuditOutput } from "@geminihall/schema";

export interface CapturedRequest {
  url: string;
  headers: Headers;
  body: unknown;
}

export function mockFetch(responses: unknown[], captured: CapturedRequest[] = []): typeof fetch {
  let i = 0;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const text = await req.text();
    captured.push({ url: req.url, headers: req.headers, body: text ? JSON.parse(text) : null });
    const body = responses[Math.min(i, responses.length - 1)];
    i++;
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json", "request-id": "req_test" },
    });
  }) as typeof fetch;
}

export function confirmedOutput(urls: string[]): ModelAuditOutput {
  return {
    is_valid_input: true,
    contains_pii: false,
    audit_status: "CONFIRMED_HALLUCINATION",
    evidence_status: "VERIFIED",
    severity_score: 4,
    category: "Chronological_Error",
    ttl_category: "HISTORICAL_FACT",
    audit_trace: {
      decomposed_claims: [
        {
          sub_claim: "日本国憲法は1950年に施行された",
          verification_target: "日本国憲法の施行日",
          status: "CONTRADICTED",
        },
      ],
      alignment_reasoning: "取得した資料では施行日は1947年5月3日である。",
      abstention_reason: null,
    },
    hallucinated_claim: "日本国憲法は1950年に施行された",
    correction: "日本国憲法は1947年5月3日に施行された",
    unverified_notes: null,
    evidence_sources: urls.map((url) => ({ title: "日本国憲法", url, snippet: "昭和22年5月3日から施行" })),
    estimated_error_pattern: "年号の取り違え",
    limitations: [],
  };
}

export function anthropicMessage(output: ModelAuditOutput, searchUrls: string[], stopReason = "end_turn") {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [
      { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "日本国憲法 施行日" } },
      {
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_1",
        content: searchUrls.map((url) => ({
          type: "web_search_result",
          url,
          title: "result",
          encrypted_content: "x",
          page_age: null,
        })),
      },
      { type: "text", text: JSON.stringify(output) },
    ],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

export function openaiResponse(output: ModelAuditOutput, searchUrls: string[], citationUrls: string[] = []) {
  return {
    id: "resp_test",
    object: "response",
    created_at: 1,
    status: "completed",
    error: null,
    incomplete_details: null,
    model: "gpt-6-astra",
    output: [
      {
        type: "web_search_call",
        id: "ws_1",
        status: "completed",
        action: { type: "search", query: "q", sources: searchUrls.map((url) => ({ type: "url", url })) },
      },
      {
        type: "message",
        id: "msg_1",
        status: "completed",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(output),
            annotations: citationUrls.map((url) => ({
              type: "url_citation",
              url,
              title: "t",
              start_index: 0,
              end_index: 1,
            })),
          },
        ],
      },
    ],
    usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
  };
}

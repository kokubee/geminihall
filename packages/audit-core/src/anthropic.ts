import Anthropic from "@anthropic-ai/sdk";
import { UpstreamError, ModelOutputError } from "./errors";
import {
  AUDIT_TIMEOUT_MS,
  auditOutputJsonSchema,
  parseModelJson,
  type ProviderAdapter,
  type ProviderRequest,
  type ProviderResult,
} from "./provider";

const MAX_CONTINUATIONS = 3;

export function anthropicRetrievedUrls(content: Anthropic.Beta.BetaContentBlock[]): {
  urls: string[];
  searchUsed: boolean;
} {
  const urls: string[] = [];
  let searchUsed = false;
  for (const block of content) {
    if (block.type !== "web_search_tool_result") continue;
    searchUsed = true;
    if (!Array.isArray(block.content)) continue;
    for (const item of block.content) {
      if (item.type === "web_search_result") urls.push(item.url);
    }
  }
  return { urls, searchUsed };
}

export const anthropicAdapter: ProviderAdapter = {
  async run(req: ProviderRequest): Promise<ProviderResult> {
    if (req.credential.kind !== "API_KEY") throw new UpstreamError("Claude requires an API key");
    const client = new Anthropic({
      apiKey: req.credential.apiKey,
      dangerouslyAllowBrowser: true,
      timeout: AUDIT_TIMEOUT_MS,
      maxRetries: 0,
      ...(req.fetch ? { fetch: req.fetch } : {}),
    });
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: req.user }];
    const allContent: Anthropic.Beta.BetaContentBlock[] = [];
    let response: Anthropic.Beta.BetaMessage | undefined;

    for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
      try {
        response = await client.beta.messages.create(
          {
            model: req.model,
            max_tokens: 16000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            system: req.system,
            output_config: {
              effort: "medium",
              format: { type: "json_schema", schema: auditOutputJsonSchema() },
            },
            tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
            messages,
          },
          req.signal ? { signal: req.signal } : undefined,
        );
      } catch (err) {
        if (err instanceof Anthropic.APIError) throw new UpstreamError(err.message, err.status);
        throw new UpstreamError(err instanceof Error ? err.message : String(err));
      }
      allContent.push(...response.content);
      if (response.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: response.content });
    }

    if (!response) throw new UpstreamError("no response");
    if (response.stop_reason === "refusal") throw new UpstreamError("the model declined this request");
    if (response.stop_reason === "pause_turn") throw new UpstreamError("the audit did not finish");
    if (response.stop_reason === "max_tokens") throw new ModelOutputError("the audit output was truncated");

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const { urls, searchUsed } = anthropicRetrievedUrls(allContent);
    return { output: parseModelJson(text), retrievedUrls: urls, searchUsed };
  },
};

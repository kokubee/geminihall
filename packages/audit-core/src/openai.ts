import OpenAI from "openai";
import { UpstreamError, ModelOutputError } from "./errors";
import {
  AUDIT_TIMEOUT_MS,
  auditOutputJsonSchema,
  parseModelJson,
  type ProviderAdapter,
  type ProviderRequest,
  type ProviderResult,
} from "./provider";

const INLINE_CITATION = /\s*\(\[[^\]]*\]\(https?:\/\/[^)\s]+\)\)/gu;

export function stripInlineCitations<T>(value: T): T {
  if (typeof value === "string") return value.replace(INLINE_CITATION, "").trim() as T;
  if (Array.isArray(value)) return value.map(stripInlineCitations) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, k === "url" ? v : stripInlineCitations(v)]),
    ) as T;
  }
  return value;
}

export function openaiRetrievedUrls(output: OpenAI.Responses.ResponseOutputItem[]): {
  urls: string[];
  searchUsed: boolean;
} {
  const urls: string[] = [];
  let searchUsed = false;
  for (const item of output) {
    if (item.type === "web_search_call") {
      searchUsed = true;
      const action = item.action;
      if (action?.type === "search") {
        for (const source of action.sources ?? []) {
          if (source.type === "url") urls.push(source.url);
        }
      } else if (action?.type === "open_page" && action.url) {
        urls.push(action.url);
      }
    } else if (item.type === "message") {
      for (const part of item.content) {
        if (part.type !== "output_text") continue;
        for (const ann of part.annotations) {
          if (ann.type === "url_citation") urls.push(ann.url);
        }
      }
    }
  }
  return { urls, searchUsed };
}

export const openaiAdapter: ProviderAdapter = {
  async run(req: ProviderRequest): Promise<ProviderResult> {
    const client = new OpenAI({
      apiKey: req.apiKey,
      dangerouslyAllowBrowser: true,
      timeout: AUDIT_TIMEOUT_MS,
      maxRetries: 0,
      ...(req.fetch ? { fetch: req.fetch } : {}),
    });

    let response: OpenAI.Responses.Response;
    try {
      response = await client.responses.create(
        {
          model: req.model,
          instructions: req.system,
          input: req.user,
          tools: [{ type: "web_search" }],
          include: ["web_search_call.action.sources"],
          store: false,
          text: {
            format: {
              type: "json_schema",
              name: "geminihall_audit",
              schema: auditOutputJsonSchema(),
              strict: true,
            },
          },
        },
        req.signal ? { signal: req.signal } : undefined,
      );
    } catch (err) {
      if (err instanceof OpenAI.APIError) throw new UpstreamError(err.message, err.status);
      throw new UpstreamError(err instanceof Error ? err.message : String(err));
    }

    if (response.status === "incomplete") {
      throw new ModelOutputError(`the audit output was incomplete: ${response.incomplete_details?.reason ?? "unknown"}`);
    }
    if (response.status === "failed") throw new UpstreamError(response.error?.message ?? "the audit failed");

    for (const item of response.output) {
      if (item.type !== "message") continue;
      for (const part of item.content) {
        if (part.type === "refusal") throw new UpstreamError("the model declined this request");
      }
    }

    const { urls, searchUsed } = openaiRetrievedUrls(response.output);
    return { output: stripInlineCitations(parseModelJson(response.output_text)), retrievedUrls: urls, searchUsed };
  },
};

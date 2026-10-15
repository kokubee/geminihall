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

function outputText(output: OpenAI.Responses.ResponseOutputItem[]): string {
  const parts: string[] = [];
  for (const item of output) {
    if (item.type !== "message") continue;
    for (const part of item.content) {
      if (part.type === "refusal") throw new UpstreamError("the model declined this request");
      if (part.type === "output_text") parts.push(part.text);
    }
  }
  return parts.join("");
}

function upstream(err: unknown): UpstreamError {
  if (err instanceof UpstreamError) return err;
  if (err instanceof OpenAI.APIError) {
    const code = typeof err.code === "string" ? err.code : undefined;
    return new UpstreamError(err.message, err.status, code);
  }
  return new UpstreamError(err instanceof Error ? err.message : String(err));
}

async function runStreaming(
  client: OpenAI,
  params: OpenAI.Responses.ResponseCreateParamsNonStreaming,
  signal: AbortSignal | undefined,
): Promise<OpenAI.Responses.Response> {
  const stream = await client.responses.create({ ...params, stream: true }, signal ? { signal } : undefined);
  let completed: OpenAI.Responses.Response | null = null;
  for await (const event of stream) {
    if (event.type === "response.completed") completed = event.response;
    else if (event.type === "response.failed") {
      const e = event.response.error;
      throw new UpstreamError(e?.message ?? "the audit failed", undefined, e?.code ?? undefined);
    } else if (event.type === "response.incomplete") {
      throw new ModelOutputError(`the audit output was incomplete: ${event.response.incomplete_details?.reason ?? "unknown"}`);
    } else if (event.type === "error") {
      throw new UpstreamError(event.message, undefined, event.code ?? undefined);
    }
  }
  if (!completed) throw new UpstreamError("the stream ended before the audit completed");
  return completed;
}

export const openaiAdapter: ProviderAdapter = {
  async run(req: ProviderRequest): Promise<ProviderResult> {
    const token = req.credential.kind === "API_KEY" ? req.credential.apiKey : req.credential.accessToken;
    const client = new OpenAI({
      apiKey: token,
      dangerouslyAllowBrowser: true,
      timeout: AUDIT_TIMEOUT_MS,
      maxRetries: 0,
      ...(req.fetch ? { fetch: req.fetch } : {}),
    });

    const params: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
      model: req.model,
      instructions: req.system,
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: req.user }] }],
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
    };

    let response: OpenAI.Responses.Response;
    try {
      if (req.credential.kind === "CHATGPT_PLAN") {
        response = await runStreaming(client, params, req.signal);
      } else {
        response = await client.responses.create(params, req.signal ? { signal: req.signal } : undefined);
      }
    } catch (err) {
      if (err instanceof ModelOutputError) throw err;
      throw upstream(err);
    }

    if (response.status === "incomplete") {
      throw new ModelOutputError(`the audit output was incomplete: ${response.incomplete_details?.reason ?? "unknown"}`);
    }
    if (response.status === "failed") throw new UpstreamError(response.error?.message ?? "the audit failed", undefined, response.error?.code ?? undefined);

    const text = outputText(response.output);
    const { urls, searchUsed } = openaiRetrievedUrls(response.output);
    return { output: stripInlineCitations(parseModelJson(text)), retrievedUrls: urls, searchUsed };
  },
};

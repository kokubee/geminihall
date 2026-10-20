import { BoundedModelAuditOutputSchema, ModelAuditOutputSchema, type ModelAuditOutput } from "@geminihall/schema";
import { z } from "zod";
import { ModelOutputError } from "./errors";

export type Credential =
  | { kind: "API_KEY"; apiKey: string }
  | { kind: "CHATGPT_PLAN"; accessToken: string };

export interface ProviderRequest {
  credential: Credential;
  model: string;
  system: string;
  user: string;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
}

export interface ProviderResult {
  output: ModelAuditOutput;
  retrievedUrls: string[];
  searchUsed: boolean;
}

export interface ProviderAdapter {
  run(req: ProviderRequest): Promise<ProviderResult>;
}

export const AUDIT_TIMEOUT_MS = 120_000;

export function auditOutputJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(ModelAuditOutputSchema, { target: "draft-7" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

const SECRET_LIKE = /(Bearer\s+\S+|sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/gu;

function preview(text: string): string {
  return text.replace(SECRET_LIKE, "[redacted]").replace(/\s+/gu, " ").slice(0, 120);
}

export function extractJsonText(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  if (fenced) return fenced[1]!;
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

export function parseModelJson(text: string): ModelAuditOutput {
  let json: unknown;
  try {
    json = JSON.parse(extractJsonText(text));
  } catch {
    throw new ModelOutputError(`model output is not valid JSON (length ${text.length}: "${preview(text)}")`);
  }
  const parsed = BoundedModelAuditOutputSchema.safeParse(json);
  if (!parsed.success) throw new ModelOutputError(`model output failed schema: ${parsed.error.message}`);
  return parsed.data;
}

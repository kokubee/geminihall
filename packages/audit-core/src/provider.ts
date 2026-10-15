import { ModelAuditOutputSchema, type ModelAuditOutput } from "@geminihall/schema";
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

export function parseModelJson(text: string): ModelAuditOutput {
  let json: unknown;
  try {
    json = JSON.parse(text.trim());
  } catch {
    throw new ModelOutputError("model output is not valid JSON");
  }
  const parsed = ModelAuditOutputSchema.safeParse(json);
  if (!parsed.success) throw new ModelOutputError(`model output failed schema: ${parsed.error.message}`);
  return parsed.data;
}

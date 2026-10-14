import { AuditResultSchema, type AuditResult } from "@geminihall/schema";
import recorded from "./demo-recorded.json";

export const DEMO_CLAIM: string = recorded.claim;

export function demoResult(requestId: string): AuditResult {
  return AuditResultSchema.parse({ ...recorded.result, request_id: requestId, mode: "DEMO" });
}

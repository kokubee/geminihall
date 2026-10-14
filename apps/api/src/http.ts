import type { ErrorCode } from "@geminihall/schema";

export function errorBody(code: ErrorCode | "NOT_FOUND", message: string, requestId: string | null = null) {
  return { error: { code, message, request_id: requestId } };
}

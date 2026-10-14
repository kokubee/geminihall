import type { AuditResult } from "@geminihall/schema";

export const STATUS_LABEL: Record<AuditResult["audit_status"], string> = {
  CONFIRMED_HALLUCINATION: "誤りを確認",
  SUPPORTED_CLAIM: "根拠で裏付け",
  UNVERIFIED_OR_AMBIGUOUS: "判定を保留",
};

export const STATUS_CLASS: Record<AuditResult["audit_status"], string> = {
  CONFIRMED_HALLUCINATION: "status-confirmed",
  SUPPORTED_CLAIM: "status-supported",
  UNVERIFIED_OR_AMBIGUOUS: "status-unverified",
};

export const CATEGORY_LABEL: Record<NonNullable<AuditResult["category"]>, string> = {
  Fact_Fabrication: "事実の捏造",
  Chronological_Error: "年代・日付の誤り",
  Logic_Collapse: "論理の破綻",
  Citation_Ghost: "存在しない出典",
  Calculation_Bug: "計算の誤り",
  Other: "その他",
};

export const SUB_LABEL = {
  CONTRADICTED: "矛盾",
  SUPPORTED: "裏付けあり",
  UNVERIFIABLE: "確認できず",
} as const;

export const TTL_LABEL: Record<AuditResult["ttl_category"], string> = {
  HISTORICAL_FACT: "確定した過去の事実（30日ごとに再確認）",
  LAW_OR_INSTITUTION: "法令・制度・仕様（24時間ごとに再確認）",
  CURRENT_NEWS: "現在の出来事（1時間ごとに再確認）",
  REALTIME: "リアルタイム情報",
};

export const PROVIDER_LABEL = { ANTHROPIC: "Claude", OPENAI: "OpenAI" } as const;

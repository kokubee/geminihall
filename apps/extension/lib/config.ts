export const API_BASE: string = import.meta.env.WXT_API_BASE ?? "https://geminihall.cc";
export const CONSENT_VERSION = "2026-10-15";
export const CONSENT_TEXT = [
  "この監査結果を GeminiHall の公開辞典への掲載候補として申請します。",
  "・送信するのは、監査した主張、文脈、監査結果です。APIキーは送りません。",
  "・管理者が根拠のリンク先と個人情報の有無を確認し、公開用に文面を編集したうえで掲載するか判断します。",
  "・掲載された事例は、ほかの利用者が同じ主張を監査するときに表示されます。",
  "・主張や文脈に個人情報が含まれる場合は、申請しないでください。",
].join("\n");

import type { Provider } from "@geminihall/schema";

export const DEFAULT_MODELS: Record<Provider, string> = {
  ANTHROPIC: "claude-opus-5-5",
  OPENAI: "gpt-6-astra",
};

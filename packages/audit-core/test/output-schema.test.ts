import { describe, expect, it } from "vitest";
import { auditOutputJsonSchema } from "../src/index";

describe("structured output schema", () => {
  it("uses no numeric or string constraint keywords that structured outputs reject", () => {
    const text = JSON.stringify(auditOutputJsonSchema());
    for (const keyword of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "pattern", "format"]) {
      expect(text).not.toContain(`"${keyword}"`);
    }
  });

  it("closes every object and requires every property", () => {
    const visit = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      if (obj.type === "object") {
        expect(obj.additionalProperties).toBe(false);
        const props = Object.keys((obj.properties as Record<string, unknown>) ?? {});
        expect(new Set(obj.required as string[])).toEqual(new Set(props));
      }
      Object.values(obj).forEach(visit);
    };
    visit(auditOutputJsonSchema());
  });
});

import { ModelOutputError, extractJsonText } from "../src/index";
import { parseModelJson } from "../src/provider";

describe("model JSON extraction", () => {
  it("unwraps code fences and surrounding prose", () => {
    expect(extractJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonText('Here is the audit:\n{"a":1}\nThanks')).toBe('{"a":1}');
    expect(extractJsonText('{"a":1}')).toBe('{"a":1}');
  });

  it("reports length and a redacted preview when parsing fails", () => {
    try {
      parseModelJson("Sorry, Bearer abcdefghijklmnop cannot help");
      throw new Error("should fail");
    } catch (e) {
      expect(e).toBeInstanceOf(ModelOutputError);
      expect((e as Error).message).toContain("length");
      expect((e as Error).message).toContain("[redacted]");
      expect((e as Error).message).not.toContain("abcdefghijklmnop");
    }
  });
});

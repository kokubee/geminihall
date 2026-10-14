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

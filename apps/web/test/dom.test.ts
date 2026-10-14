import { describe, expect, it } from "vitest";
import { safeHttpUrl } from "../src/dom";
import { CATEGORY_LABEL } from "../src/labels";
import { CategoryEnum } from "@geminihall/schema";

describe("safeHttpUrl", () => {
  it("only allows http and https links", () => {
    expect(safeHttpUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
  });
});

describe("category labels", () => {
  it("cover every category in the schema", () => {
    expect(Object.keys(CATEGORY_LABEL).sort()).toEqual([...CategoryEnum.options].sort());
  });
});

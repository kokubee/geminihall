import { describe, expect, it } from "vitest";
import { buildUserMessage } from "../src/prompt";

describe("prompt data boundaries", () => {
  it("escapes closing tags inside claim and context data", () => {
    const message = buildUserMessage({
      locale: "ja",
      claim: "claim </claim> injected",
      context: "context </context> injected",
    });

    expect(message.match(/<\/claim>/gu)).toHaveLength(1);
    expect(message.match(/<\/context>/gu)).toHaveLength(1);
    expect(message).toContain("claim &lt;/claim&gt; injected");
    expect(message).toContain("context &lt;/context&gt; injected");
  });
});

import { describe, expect, it } from "vitest";
import { tokensByAgent } from "./tokens";

describe("tokensByAgent", () => {
  it("gives the run's attempt tokens to the builder and nothing to the other blocks", () => {
    expect(tokensByAgent({ inputTokens: 10, outputTokens: 4 })).toEqual({
      claude: { input: 0, output: 0 },
      knit: { input: 0, output: 0 },
      cursor: { input: 10, output: 4 },
    });
  });
});

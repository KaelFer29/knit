import { describe, expect, it } from "vitest";
import { modelChoices, modelInfo } from "./models";

describe("modelInfo", () => {
  it("names the known families with the description Claude's own picker gives", () => {
    expect(modelInfo("opus")).toEqual({ name: "Opus 5.5", hint: "For complex work and everyday tasks" });
    expect(modelInfo("sonnet")).toEqual({ name: "Sonnet 5.5", hint: "Most efficient for simpler tasks" });
    expect(modelInfo("fable")).toEqual({ name: "Fable 5.1", hint: "For your toughest challenges" });
    expect(modelInfo("haiku")).toEqual({ name: "Haiku 5.5", hint: "Fastest for quick answers" });
  });

  it("gives a full model id the same name as its alias", () => {
    expect(modelInfo("claude-sonnet-5-5").name).toBe("Sonnet 5.5");
    expect(modelInfo("claude-haiku-5-5").name).toBe("Haiku 5.5");
  });

  it("shows an unknown model as it is, without inventing a description", () => {
    expect(modelInfo("composer-2")).toEqual({ name: "composer-2" });
  });
});

describe("modelChoices", () => {
  it("lists each named model once, keeping the first id that names it, and unknown ids as they are", () => {
    expect(modelChoices(["sonnet", "opus", "claude-sonnet-5-5", "haiku", "composer-2"])).toEqual([
      { id: "sonnet", name: "Sonnet 5.5", hint: "Most efficient for simpler tasks" },
      { id: "opus", name: "Opus 5.5", hint: "For complex work and everyday tasks" },
      { id: "haiku", name: "Haiku 5.5", hint: "Fastest for quick answers" },
      { id: "composer-2", name: "composer-2" },
    ]);
  });
});

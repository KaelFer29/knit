import { describe, expect, it } from "vitest";
import { modelChoices, modelInfo, shortModelId } from "./models";

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

describe("shortModelId", () => {
  it("shows the parameters of an id after a dash instead of in long brackets", () => {
    expect(shortModelId("claude-opus-4-8[context=1m,effort=high,fast=false]")).toBe("claude-opus-4-8-1m-high");
    expect(shortModelId("gpt-5[effort=high]")).toBe("gpt-5-high");
  });

  it("keeps a flag that is on by its name, and drops one that is off", () => {
    expect(shortModelId("m[fast=true]")).toBe("m-fast");
    expect(shortModelId("m[fast=false,context=1m]")).toBe("m-1m");
  });

  it("leaves a plain id, an empty group and a key without a value as they are or short", () => {
    expect(shortModelId("composer-2.5-fast")).toBe("composer-2.5-fast");
    expect(shortModelId("m[]")).toBe("m");
    expect(shortModelId("m[thinking]")).toBe("m-thinking");
  });

  it("never leaves a bracket in what it returns", () => {
    for (const id of ["a[b=c]", "a[b=c,d=e,f=true]", "a[]", "weird]id[", "[x]"]) {
      expect(shortModelId(id), id).not.toMatch(/[[\]]/);
    }
  });

  it("is what the picker names an unknown parameterized model", () => {
    expect(modelInfo("composer-2[context=1m,effort=high]")).toEqual({ name: "composer-2-1m-high" });
  });
});


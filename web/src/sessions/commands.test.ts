import { describe, expect, it } from "vitest";
import { filterCommands, knitCommandOf, paletteCommands, paletteQuery, usageAction } from "./commands";
import type { AgentView } from "./types";

const caps = { resume: true, chooseModel: false, commandList: false, visibleReasoning: false, planUsage: false };
const agent = (c: Partial<typeof caps>, label = "Agent"): AgentView => ({ id: "a", label, capabilities: { ...caps, ...c }, profileFields: [] });

describe("paletteCommands", () => {
  it("offers /clear and /usage to every agent and nothing else without capabilities", () => {
    expect(paletteCommands(agent({}), ["compact"]).map((c) => c.name)).toEqual(["clear", "usage"]);
  });

  it("adds /model and /usage from the declared capabilities, not from a name", () => {
    expect(paletteCommands(agent({ chooseModel: true, planUsage: true }), []).map((c) => c.name)).toEqual(["clear", "model", "usage"]);
  });

  it("appends the agent's own list when it has one, and Knit's commands win a name clash", () => {
    const cmds = paletteCommands(agent({ commandList: true, planUsage: true }, "Zed"), ["compact", "usage", "init"]);
    expect(cmds.map((c) => `${c.source}:${c.name}`)).toEqual(["knit:clear", "knit:usage", "agent:compact", "agent:init"]);
    expect(cmds[2]!.description).toBe("Send /compact to Zed");
  });

  it("works before the agents are known", () => {
    expect(paletteCommands(undefined, ["x"]).map((c) => c.name)).toEqual(["clear"]);
  });
});

describe("filtering and parsing", () => {
  const cmds = paletteCommands(agent({ commandList: true }), ["compact", "context", "review"]);

  it("lists prefix matches before substring matches", () => {
    expect(filterCommands(cmds, "c").map((c) => c.name)).toEqual(["clear", "compact", "context"]);
    expect(filterCommands(cmds, "view").map((c) => c.name)).toEqual(["review"]);
    expect(filterCommands(cmds, "").length).toBe(cmds.length);
  });

  it("opens the palette only for a lone slash word", () => {
    expect(paletteQuery("/")).toBe("");
    expect(paletteQuery("/com")).toBe("com");
    expect(paletteQuery("/compact now")).toBeUndefined();
    expect(paletteQuery("hello /x")).toBeUndefined();
  });

  it("recognizes only Knit's commands as native", () => {
    expect(knitCommandOf("/clear", cmds)?.name).toBe("clear");
    expect(knitCommandOf(" /clear ", cmds)?.name).toBe("clear");
    expect(knitCommandOf("/compact", cmds)).toBeUndefined();
    expect(knitCommandOf("/clear now", cmds)).toBeUndefined();
  });
});

describe("usageAction", () => {
  it("sends /usage to an agent that reports plan usage, so its answer shows in the session", () => {
    expect(usageAction(agent({ planUsage: true }))).toEqual({ kind: "send", prompt: "/usage" });
  });

  it("says so for an agent that does not report plan usage, instead of doing nothing", () => {
    expect(usageAction(agent({}, "Zed"))).toEqual({ kind: "notice", text: "Zed does not report plan usage." });
  });
});

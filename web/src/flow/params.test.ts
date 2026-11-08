import { describe, expect, it } from "vitest";
import { DEFAULT_FIXTURE, parseFlowParams } from "./params";

describe("parseFlowParams", () => {
  it("shows the most representative fixture, with no switcher, when there are no parameters", () => {
    expect(parseFlowParams("")).toEqual({ fixture: DEFAULT_FIXTURE, switcher: false, demo: false });
    expect(DEFAULT_FIXTURE).toBe("runningRun");
  });

  it("picks the fixture named in the query and shows the switcher", () => {
    expect(parseFlowParams("?fixture=failedRun")).toEqual({ fixture: "failedRun", switcher: true, demo: false });
  });

  it("falls back to the default for an unknown name, but still shows the switcher", () => {
    expect(parseFlowParams("?fixture=nope")).toEqual({ fixture: DEFAULT_FIXTURE, switcher: true, demo: false });
  });

  it("turns the demo pulses on with demo=1", () => {
    expect(parseFlowParams("?fixture=retryingRun&demo=1").demo).toBe(true);
    expect(parseFlowParams("?demo=1").demo).toBe(true);
    expect(parseFlowParams("?demo=0").demo).toBe(false);
  });
});

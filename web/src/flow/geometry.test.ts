import { describe, expect, it } from "vitest";
import { computeWires, curvePath, spread, strandId, type FlowLayout, type Rect } from "./geometry";

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

const horizontal: FlowLayout = {
  orientation: "horizontal",
  claude: rect(0, 100, 200, 200),
  knit: rect(300, 0, 600, 400),
  cursor: rect(1000, 120, 200, 160),
  knitInput: rect(300, 0, 280, 300),
  knitCore: rect(580, 0, 320, 300),
};

const vertical: FlowLayout = {
  orientation: "vertical",
  claude: rect(200, 0, 300, 160),
  knit: rect(0, 240, 700, 400),
  cursor: rect(200, 720, 300, 160),
  knitInput: rect(0, 240, 300, 300),
  knitCore: rect(300, 240, 400, 300),
};

describe("spread", () => {
  it("is empty for no strands and centered for one", () => {
    expect(spread(0, 8, 100)).toEqual([]);
    expect(spread(1, 8, 100)).toEqual([0]);
  });

  it("spaces strands by the step around zero", () => {
    expect(spread(3, 8, 100)).toEqual([-8, 0, 8]);
    expect(spread(4, 6, 100)).toEqual([-9, -3, 3, 9]);
  });

  it("tightens the step so the whole ribbon never exceeds the maximum span", () => {
    const offsets = spread(11, 10, 40);
    expect(offsets).toHaveLength(11);
    expect(offsets[0]).toBeCloseTo(-20);
    expect(offsets[10]).toBeCloseTo(20);
  });
});

describe("strandId", () => {
  it("joins the wire and the task", () => {
    expect(strandId("plan", "T3")).toBe("plan:T3");
  });
});

describe("curvePath", () => {
  it("leaves and arrives horizontally for a horizontal flow", () => {
    expect(curvePath({ x: 0, y: 0 }, { x: 100, y: 40 }, "horizontal")).toBe("M0 0 C50 0 50 40 100 40");
  });

  it("leaves and arrives vertically for a vertical flow", () => {
    expect(curvePath({ x: 0, y: 0 }, { x: 40, y: 100 }, "vertical")).toBe("M0 0 C0 50 40 50 40 100");
  });

  it("curves backwards when the wire runs against the axis (the result wire)", () => {
    expect(curvePath({ x: 100, y: 0 }, { x: 0, y: 10 }, "horizontal")).toBe("M100 0 C50 0 50 10 0 10");
  });

  it("keeps a minimum handle length on very short wires", () => {
    expect(curvePath({ x: 0, y: 0 }, { x: 10, y: 0 }, "horizontal")).toBe("M0 0 C24 0 -14 0 10 0");
  });
});

describe("computeWires, horizontal", () => {
  const strands = { plan: ["T1", "T2", "T3"], prompt: ["T1", "T2"], result: ["T1"] };
  const { paths, ports } = computeWires(horizontal, strands);
  const byId = (id: string) => paths.find((p) => p.id === id)!;

  it("draws one strand per task for each wire, in order", () => {
    expect(paths.map((p) => p.id)).toEqual(["plan:T1", "plan:T2", "plan:T3", "prompt:T1", "prompt:T2", "result:T1"]);
    expect(paths.every((p) => !p.idle)).toBe(true);
    expect(byId("plan:T2").wire).toBe("plan");
    expect(byId("plan:T2").taskId).toBe("T2");
  });

  it("sends the plan from Claude's right edge to Knit's left edge", () => {
    for (const id of ["plan:T1", "plan:T2", "plan:T3"]) {
      expect(byId(id).from.x).toBe(200);
      expect(byId(id).to.x).toBe(300);
    }
    // The middle strand is on the centers of the two anchors: Claude (y 200) and Knit's input (y 150).
    expect(byId("plan:T2").from.y).toBe(200);
    expect(byId("plan:T2").to.y).toBe(150);
    expect(byId("plan:T1").from.y).toBeLessThan(byId("plan:T2").from.y);
    expect(byId("plan:T3").from.y).toBeGreaterThan(byId("plan:T2").from.y);
  });

  it("sends the prompt from Knit to Cursor and the result back, on two separate lanes", () => {
    const prompt = byId("prompt:T1");
    const result = byId("result:T1");
    expect(prompt.from.x).toBe(900);
    expect(prompt.to.x).toBe(1000);
    expect(result.from.x).toBe(1000);
    expect(result.to.x).toBe(900);
    expect(prompt.to.y).toBeLessThan(result.from.y);
    expect(prompt.from.y).toBeLessThan(result.to.y);
  });

  it("emits the path data of each strand starting at its source", () => {
    const p = byId("plan:T2");
    expect(p.d.startsWith(`M${p.from.x} ${p.from.y} C`)).toBe(true);
    expect(p.d.endsWith(`${p.to.x} ${p.to.y}`)).toBe(true);
  });

  it("adds a port at each end of each wire", () => {
    expect(ports.map((p) => p.id)).toEqual(["plan:out", "plan:in", "prompt:out", "prompt:in", "result:out", "result:in"]);
    expect(ports.find((p) => p.id === "plan:out")!.at.x).toBe(200);
    expect(ports.find((p) => p.id === "result:in")!.at.x).toBe(900);
  });

  it("falls back to the whole Knit block when its zones are unknown", () => {
    const { paths: plain } = computeWires({ ...horizontal, knitInput: undefined, knitCore: undefined }, { plan: ["T1"], prompt: [], result: [] });
    expect(plain[0]!.to.y).toBe(200);
  });
});

describe("computeWires, idle lanes", () => {
  it("keeps an idle lane for a wire that carries nothing yet, so the circuit stays connected", () => {
    const { paths } = computeWires(horizontal, { plan: ["T1"], prompt: [], result: [] });
    expect(paths.map((p) => [p.id, p.idle])).toEqual([
      ["plan:T1", false],
      ["prompt", true],
      ["result", true],
    ]);
    expect(paths.find((p) => p.id === "prompt")!.taskId).toBeUndefined();
  });
});

describe("computeWires, vertical", () => {
  const { paths } = computeWires(vertical, { plan: ["T1", "T2"], prompt: ["T1"], result: ["T1"] });
  const byId = (id: string) => paths.find((p) => p.id === id)!;

  it("runs the flow top to bottom: Claude, Knit, Cursor", () => {
    expect(byId("plan:T1").from.y).toBe(160);
    expect(byId("plan:T1").to.y).toBe(240);
    expect(byId("prompt:T1").from.y).toBe(640);
    expect(byId("prompt:T1").to.y).toBe(720);
    expect(byId("result:T1").from.y).toBe(720);
    expect(byId("result:T1").to.y).toBe(640);
  });

  it("lands the plan on Knit's input column and leaves from its core column", () => {
    // Knit input center x is 150; Claude center x is 350.
    const mid = (a: number, b: number) => (a + b) / 2;
    expect(mid(byId("plan:T1").to.x, byId("plan:T2").to.x)).toBe(150);
    expect(mid(byId("plan:T1").from.x, byId("plan:T2").from.x)).toBe(350);
    expect(byId("prompt:T1").from.x).toBeGreaterThan(300);
  });

  it("is a pure function: same input, same output", () => {
    const again = computeWires(vertical, { plan: ["T1", "T2"], prompt: ["T1"], result: ["T1"] });
    expect(again.paths).toEqual(paths);
  });
});

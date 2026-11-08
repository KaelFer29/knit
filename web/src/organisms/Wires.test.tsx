import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runningRun } from "../fixtures/boards";
import { computeWires, type FlowLayout } from "../flow/geometry";
import type { Pulse } from "../flow/pulses";
import { boardStrands } from "../flow/strands";
import { Wires } from "./Wires";

const layout: FlowLayout = {
  orientation: "horizontal",
  claude: { x: 0, y: 100, width: 200, height: 200 },
  knit: { x: 300, y: 0, width: 600, height: 400 },
  cursor: { x: 1000, y: 120, width: 200, height: 160 },
};
const geometry = computeWires(layout, boardStrands(runningRun));
const accents = { plan: "var(--agent-claude)", prompt: "var(--agent-knit)", result: "var(--agent-cursor)" };

const draw = (props: { pulses?: Pulse[]; reducedMotion?: boolean; onPulseEnd?: (id: string) => void } = {}) =>
  render(<Wires wires={runningRun.wires} geometry={geometry} size={{ width: 1200, height: 400 }} accents={accents} reducedMotion={props.reducedMotion ?? false} {...props} />);

afterEach(() => vi.useRealTimers());

describe("Wires", () => {
  it("draws one strand per task on each wire, with its geometry and state", () => {
    const { container } = draw();
    const strands = container.querySelectorAll("path.wires__strand");
    expect(strands).toHaveLength(geometry.paths.length);
    const t3 = container.querySelector("path[data-wire='prompt'][data-task='T3']");
    expect(t3?.getAttribute("d")).toBe(geometry.paths.find((p) => p.id === "prompt:T3")?.d);
    expect(t3?.getAttribute("data-state")).toBe("running");
    expect(container.querySelector("path[data-wire='plan'][data-task='T1']")?.getAttribute("data-state")).toBe("delivered");
  });

  it("is decorative: hidden from assistive technology", () => {
    const { container } = draw();
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("sizes its view box to the canvas", () => {
    const { container } = draw();
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 1200 400");
  });

  it("puts a port at each end of each wire", () => {
    const { container } = draw();
    expect(container.querySelectorAll("circle.wires__port")).toHaveLength(geometry.ports.length);
  });

  it("lets the strand of the open task flow while its wire is active, and no other", () => {
    const { container } = draw();
    const flowing = [...container.querySelectorAll("path[data-flowing='true']")].map((p) => p.getAttribute("data-task"));
    // The prompt wire is active and T3 runs. T4 is the next one on the plan wire, which is active too.
    expect(flowing.sort()).toEqual(["T3", "T4"]);
  });

  it("keeps an idle lane for a wire with no strands", () => {
    const empty = computeWires(layout, { plan: ["T1"], prompt: [], result: [] });
    const { container } = render(<Wires wires={[]} geometry={empty} size={{ width: 1200, height: 400 }} accents={accents} reducedMotion={false} />);
    expect(container.querySelectorAll("path[data-idle='true']")).toHaveLength(2);
  });
});

describe("pulses", () => {
  const pulse: Pulse = { id: "p1", wireId: "prompt:T3", kind: "prompt" };

  it("travels a dot along the strand of its wire, in the color of the sender", () => {
    const { container } = draw({ pulses: [pulse] });
    const dot = container.querySelector("circle.wires__pulse");
    expect(dot?.getAttribute("data-kind")).toBe("prompt");
    expect(dot?.getAttribute("data-wire")).toBe("prompt:T3");
    expect((dot as SVGElement).style.getPropertyValue("--pulse-path")).toContain(geometry.paths.find((p) => p.id === "prompt:T3")!.d);
    expect((dot as SVGElement).style.getPropertyValue("--pulse-color")).toBe("var(--agent-knit)");
  });

  it("tells the owner when the dot has arrived", () => {
    const onPulseEnd = vi.fn();
    const { container } = draw({ pulses: [pulse], onPulseEnd });
    fireEvent.animationEnd(container.querySelector("circle.wires__pulse")!);
    expect(onPulseEnd).toHaveBeenCalledWith("p1");
  });

  it("ignores a pulse for a wire that is not drawn", () => {
    const { container } = draw({ pulses: [{ id: "p2", wireId: "plan:T99", kind: "dispatched" }] });
    expect(container.querySelector("circle.wires__pulse")).toBeNull();
  });

  it("can pulse the same strand twice at once", () => {
    const { container } = draw({ pulses: [pulse, { ...pulse, id: "p3" }] });
    expect(container.querySelectorAll("circle.wires__pulse")).toHaveLength(2);
  });

  it("under reduced motion highlights the strand instead of moving a dot, then lets go", () => {
    vi.useFakeTimers();
    const onPulseEnd = vi.fn();
    const { container } = draw({ pulses: [pulse], reducedMotion: true, onPulseEnd });
    expect(container.querySelector("circle.wires__pulse")).toBeNull();
    const highlight = container.querySelector("path.wires__highlight");
    expect(highlight?.getAttribute("data-kind")).toBe("prompt");
    expect(highlight?.getAttribute("d")).toBe(geometry.paths.find((p) => p.id === "prompt:T3")!.d);
    expect(onPulseEnd).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(onPulseEnd).toHaveBeenCalledWith("p1");
  });
});

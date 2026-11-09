import { ALL_FIXTURES } from "../fixtures/boards";

export type FixtureName = keyof typeof ALL_FIXTURES;

/** The most representative sample: a run in progress with delivered, running and queued tasks. */
export const DEFAULT_FIXTURE: FixtureName = "runningRun";

export interface FlowParams {
  fixture: FixtureName;
  /** The fixture switcher shows only when the URL asks for a fixture. */
  switcher: boolean;
  /** Play pulses on the fixture so the motion can be seen. */
  demo: boolean;
  /** `?run=<id>` draws that run from the live API instead of a fixture. */
  run: string | undefined;
}

const isFixture = (name: string | null): name is FixtureName => name !== null && Object.hasOwn(ALL_FIXTURES, name);

/** Reads `?fixture=<name>` and `?demo=1` from a query string. */
export function parseFlowParams(search: string): FlowParams {
  const params = new URLSearchParams(search);
  const name = params.get("fixture");
  const demo = params.get("demo");
  const run = params.get("run");
  return {
    fixture: isFixture(name) ? name : DEFAULT_FIXTURE,
    switcher: name !== null,
    run: run !== null && run !== "" ? run : undefined,
    demo: demo !== null && demo !== "0" && demo !== "false",
  };
}

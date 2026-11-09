import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AGENTS } from "../identity/agents";
import type { BlockDetails, BlockView } from "../single/pipeline";
import { BlockCard } from "./BlockCard";

const details: BlockDetails = { facts: [], meters: [], agents: [] };
const view = (over: Partial<BlockView> = {}): BlockView => ({ status: "done", headline: "Plan billing", lines: [], ...over });

describe("BlockCard model", () => {
  it("shows the model in place of the status when the block has one", () => {
    render(<BlockCard identity={AGENTS.claude} view={view({ model: "Sonnet 5.5" })} details={details} open={false} onOpen={() => {}} />);
    expect(screen.getByText("Sonnet 5.5")).toBeTruthy();
    expect(screen.queryByText("Done")).toBeNull();
  });

  it("keeps the status for a block with no model (the orchestrator)", () => {
    render(<BlockCard identity={AGENTS.knit} view={view({ status: "working" })} details={details} open={false} onOpen={() => {}} />);
    expect(screen.getByText("Working")).toBeTruthy();
  });
});

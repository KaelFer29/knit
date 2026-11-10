import { describe, expect, it } from "vitest";
import { decideReturn, returnTargetOf } from "./return-rules.js";

const checkedOut = (taskId: string, from: unknown) => ({ type: "branch.checked_out", taskId, payload: { branch: `docs/${taskId}`, freedWorktree: true, from } });
const returned = { type: "branch.returned", taskId: "T1", payload: { branch: "main" } };

describe("returnTargetOf", () => {
  it("is the branch the repository was on before the last checkout Knit made", () => {
    expect(returnTargetOf([checkedOut("T1", "main")])).toEqual({ taskId: "T1", branch: "main" });
    expect(returnTargetOf([checkedOut("T1", "main"), checkedOut("T2", "feat/x")])).toEqual({ taskId: "T2", branch: "feat/x" });
  });

  it("is nothing once the repository was given back", () => {
    expect(returnTargetOf([checkedOut("T1", "main"), returned])).toBeUndefined();
  });

  it("is nothing for a checkout that recorded no previous branch (the repository was detached), or for old events", () => {
    expect(returnTargetOf([checkedOut("T1", undefined)])).toBeUndefined();
    expect(returnTargetOf([{ type: "branch.checked_out", taskId: "T1", payload: { branch: "docs/T1" } }])).toBeUndefined();
  });

  it("ignores unrelated events", () => {
    expect(returnTargetOf([{ type: "task.passed", taskId: "T1" }])).toBeUndefined();
  });
});

describe("decideReturn", () => {
  const target = { taskId: "T1", branch: "main" };

  it("says where the repository goes and what stays", () => {
    const d = decideReturn({ runStatus: "passed", target, taskBranch: "docs/alpha" });
    expect(d).toMatchObject({ ok: true });
    if (d.ok) expect(d.effects[0]).toMatch(/back to main/);
    if (d.ok) expect(d.effects[1]).toMatch(/docs\/alpha and its commits stay/);
  });

  it("refuses while the run is running", () => {
    expect(decideReturn({ runStatus: "running", target })).toEqual({ ok: false, reason: expect.stringMatching(/still running/) });
  });

  it("refuses when Knit did not switch the repository", () => {
    expect(decideReturn({ runStatus: "passed", target: undefined })).toEqual({ ok: false, reason: expect.stringMatching(/no branch to return it to/) });
  });
});

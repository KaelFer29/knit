import { describe, expect, it, vi } from "vitest";
import { priorPrOf } from "./pr-info.js";

describe("priorPrOf", () => {
  const inspector = (n: number | undefined) => ({ commitsSince: vi.fn(() => n) });

  it("counts the commits the branch has past the commit the pull request ended at, once it is merged or closed", () => {
    const i = inspector(2);
    expect(priorPrOf({ state: "merged", base: "main", headSha: "abc" }, i, "/r", "docs/one")).toEqual({ state: "merged", newCommits: 2 });
    expect(i.commitsSince).toHaveBeenCalledWith("/r", "abc", "docs/one");
    expect(priorPrOf({ state: "closed", base: "main", headSha: "abc" }, inspector(0), "/r", "docs/one")).toEqual({ state: "closed", newCommits: 0 });
  });

  it("does not count while the pull request is open: its branch moves with it", () => {
    const i = inspector(5);
    expect(priorPrOf({ state: "open", base: "main", headSha: "abc" }, i, "/r", "docs/one")).toEqual({ state: "open" });
    expect(i.commitsSince).not.toHaveBeenCalled();
  });

  it("says nothing it does not know: no commit to count from, an unknown commit, or no status at all", () => {
    expect(priorPrOf({ state: "merged", base: "main" }, inspector(3), "/r", "docs/one")).toEqual({ state: "merged" });
    expect(priorPrOf({ state: "merged", base: "main", headSha: "abc" }, inspector(undefined), "/r", "docs/one")).toEqual({ state: "merged" });
    expect(priorPrOf(undefined, inspector(3), "/r", "docs/one")).toBeUndefined();
  });
});

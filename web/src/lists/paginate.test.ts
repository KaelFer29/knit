import { describe, expect, it } from "vitest";
import { matchesQuery, paginate } from "./paginate";

const items = Array.from({ length: 23 }, (_, i) => i + 1);

describe("paginate", () => {
  it("returns the requested page and the page count", () => {
    const page = paginate(items, 2, 10);
    expect(page.items).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(page).toMatchObject({ page: 2, pages: 3, total: 23, from: 11, to: 20 });
  });

  it("keeps the last page short", () => {
    const page = paginate(items, 3, 10);
    expect(page.items).toEqual([21, 22, 23]);
    expect(page).toMatchObject({ from: 21, to: 23 });
  });

  it("clamps a page out of range to the nearest valid one", () => {
    expect(paginate(items, 99, 10).page).toBe(3);
    expect(paginate(items, 0, 10).page).toBe(1);
    expect(paginate(items, -4, 10).page).toBe(1);
  });

  it("has one empty page when there are no items", () => {
    expect(paginate([], 1, 10)).toEqual({ items: [], page: 1, pages: 1, total: 0, from: 0, to: 0 });
  });

  it("treats a page size below one as one", () => {
    expect(paginate(items, 1, 0).items).toEqual([1]);
  });
});

describe("matchesQuery", () => {
  it("matches every term, in any field, ignoring case and accents", () => {
    expect(matchesQuery(["Añadir login", "run-abc"], "LOGIN abc")).toBe(true);
    expect(matchesQuery(["Anadir login"], "añadir")).toBe(true);
  });

  it("fails when one term is missing", () => {
    expect(matchesQuery(["add login"], "login logout")).toBe(false);
  });

  it("matches everything when the query is blank", () => {
    expect(matchesQuery(["anything"], "   ")).toBe(true);
    expect(matchesQuery([], "")).toBe(true);
  });

  it("ignores missing fields", () => {
    expect(matchesQuery(["a", undefined], "a")).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiGet } from "./client";

afterEach(() => vi.unstubAllGlobals());

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("api client", () => {
  it("sends same-origin credentials and parses JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiGet<{ ok: boolean }>("/api/runs")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/runs", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
  });

  it("throws an ApiError with the status and the server's message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(404, { error: "run not found" })));
    const failure = await apiGet("/api/runs/nope").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 404, message: "run not found" });
  });

  it("falls back to the status text when the error body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500, statusText: "Server Error" })));
    await expect(apiGet("/api/runs")).rejects.toMatchObject({ status: 500, message: "Server Error" });
  });
});

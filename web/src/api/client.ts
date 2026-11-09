/**
 * Typed client for the `knit ui` HTTP API. No real calls yet: the routes arrive with the server.
 * Same-origin credentials only; the page and the API are served from the same 127.0.0.1 origin.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function failure(response: Response): Promise<ApiError> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
      return new ApiError(response.status, body.error);
    }
  } catch {
    // Not JSON: fall through to the status text.
  }
  return new ApiError(response.status, response.statusText || `HTTP ${response.status}`);
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", headers: { accept: "application/json" } });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

/** Sends a JSON body with a mutating method. The server also needs the page's own Origin, which the browser adds. */
export async function apiSend<T>(method: "PUT" | "POST", path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

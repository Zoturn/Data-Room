import type { ZodType } from "zod";
import { ApiError, ContractError, NetworkError, toApiError } from "./errors";

const BASE_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001/api";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** Internal: prevents a refresh attempt from recursing into another refresh. */
  skipRefresh?: boolean;
};

/**
 * Concurrent 401s must share one refresh. Five parallel requests each triggering their own
 * rotation would present the server with an already-rotated token, which is exactly the
 * theft signal that revokes the whole family — the app would log itself out.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${BASE_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      // Cleared in a microtask so callers awaiting this promise all see the same result.
      queueMicrotask(() => {
        refreshInFlight = null;
      });
    }
  })();

  return refreshInFlight;
}

/**
 * Every request is credentialed, because the session lives in httpOnly cookies — a request
 * without `credentials: "include"` arrives anonymous and the failure looks like a session bug.
 */
async function request(path: string, options: RequestOptions): Promise<Response> {
  const { method = "GET", body, signal, skipRefresh = false } = options;

  const init: RequestInit = {
    method,
    credentials: "include",
    headers: { Accept: "application/json" },
    ...(signal ? { signal } : {}),
  };

  if (body !== undefined) {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new NetworkError(cause);
  }

  // One refresh, one retry. A second 401 means the session is genuinely over.
  if (response.status === 401 && !skipRefresh) {
    const refreshed = await refreshSession();
    if (refreshed) return request(path, { ...options, skipRefresh: true });
  }

  if (!response.ok) throw await toApiError(response);

  return response;
}

/**
 * Reads a response and validates it against the shape the caller expects.
 *
 * The schema is required rather than a type parameter alone: `response.json()` produces
 * `any`, so trusting a declared type would assert a shape nobody checked. Validating here
 * turns a contract drift between the API and this app into one clear error at the boundary,
 * instead of an undefined three components deep.
 */
export async function apiFetch<T>(
  path: string,
  schema: ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const response = await request(path, options);

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new ContractError(path, cause);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ContractError(path, parsed.error);

  return parsed.data;
}

/** For endpoints that answer with no body — a delete, a logout. */
export async function apiSend(path: string, options: RequestOptions = {}): Promise<void> {
  await request(path, options);
}

export { ApiError, ContractError, NetworkError };

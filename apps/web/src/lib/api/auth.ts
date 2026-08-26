import type { LoginInput, RegisterInput, SessionUser } from "@data-room/shared";
import { sessionUserSchema } from "@data-room/shared";
import { apiFetch, apiSend } from "./client";
import { ApiError } from "./errors";

/**
 * Resolved exactly as the client resolves it. Google sign-in is a full-page navigation to
 * the API rather than a fetch — the browser has to leave this origin for Google's consent
 * screen — so it cannot travel through `apiFetch` and needs the absolute URL here.
 *
 * `NEXT_PUBLIC_API_URL` is public by definition; nothing secret may carry that prefix.
 */
const API_BASE_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001/api";

/**
 * Creates an account and signs it in. The session arrives as httpOnly cookies, so the
 * returned user is a description of who was signed in, never a credential to store.
 */
export async function registerAccount(input: RegisterInput): Promise<SessionUser> {
  return apiFetch("/auth/register", sessionUserSchema, { method: "POST", body: input });
}

/** Signs in with a password. Every failure path answers one uniform 401 — see auth-and-guards.md. */
export async function signInWithPassword(input: LoginInput): Promise<SessionUser> {
  return apiFetch("/auth/login", sessionUserSchema, { method: "POST", body: input });
}

/**
 * Ends the session. A 401 here is swallowed deliberately: signing out of a session that has
 * already expired is exactly the outcome the user asked for, and surfacing an error would
 * leave them unable to complete the one action that makes them feel safe.
 */
export async function signOut(): Promise<void> {
  try {
    await apiSend("/auth/logout", { method: "POST" });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return;
    throw error;
  }
}

/**
 * The only read of session truth. `null` means signed out — a 401 from `/auth/me` is an
 * answer, not a failure, and must not be rendered as a broken application. Anything else
 * (offline, 500, contract drift) still throws, because "we cannot tell" is a third state
 * and must not be mistaken for "signed out".
 *
 * The client has already tried one refresh and one replay before the 401 reaches here.
 */
export async function fetchSessionUser(signal?: AbortSignal): Promise<SessionUser | null> {
  try {
    return await apiFetch("/auth/me", sessionUserSchema, signal ? { signal } : {});
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/**
 * Where the "Continue with Google" control points. `returnTo` is a same-origin path that
 * the API round-trips through the OAuth `state` parameter, so a deep link survives the
 * detour through Google. It is encoded rather than interpolated so a path containing `&`
 * or `#` cannot graft extra parameters onto the request.
 */
export function googleSignInUrl(returnTo?: string): string {
  const url = `${API_BASE_URL}/auth/google`;
  return returnTo ? `${url}?returnTo=${encodeURIComponent(returnTo)}` : url;
}

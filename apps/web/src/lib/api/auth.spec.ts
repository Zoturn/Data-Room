import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { fetchSessionUser, signOut } from "./auth";
import { ApiError } from "./errors";

const originalFetch = globalThis.fetch;

type FetchLike = typeof originalFetch;

/** Every request the stub saw, so a test can assert what actually left the app. */
let requested: string[] = [];

function respondWith(reply: (url: string) => Response): void {
  const handler: FetchLike = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    requested.push(url);
    return reply(url);
  };
  globalThis.fetch = handler;
}

function envelope(status: number, code: string): Response {
  return new Response(JSON.stringify({ code, message: "Nope", requestId: "req_test" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  requested = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchSessionUser", () => {
  it("returns the parsed user for a live session", async () => {
    const user = {
      id: "usr_1",
      email: "owner@acme.com",
      displayName: "Owner",
      hasPassword: true,
    };
    respondWith(() => new Response(JSON.stringify(user), { status: 200 }));

    await expect(fetchSessionUser()).resolves.toEqual(user);
  });

  it("answers null once the refresh has also failed, rather than throwing", async () => {
    // Signed out is an answer. Throwing here would render the application as broken to
    // every visitor who simply has not signed in yet.
    respondWith(() => envelope(401, "UNAUTHENTICATED"));

    await expect(fetchSessionUser()).resolves.toBeNull();
    expect(requested.some((url) => url.endsWith("/auth/refresh"))).toBe(true);
  });

  it("still throws when the API is broken, so an outage is not mistaken for a sign-out", async () => {
    respondWith(() => envelope(500, "INTERNAL_ERROR"));

    await expect(fetchSessionUser()).rejects.toBeInstanceOf(ApiError);
  });
});

describe("signOut", () => {
  it("succeeds against an already-expired session", async () => {
    // Signing out of a dead session is exactly the outcome the user asked for.
    respondWith(() => envelope(401, "UNAUTHENTICATED"));

    await expect(signOut()).resolves.toBeUndefined();
  });

  it("does not hide a real server failure", async () => {
    respondWith(() => envelope(500, "INTERNAL_ERROR"));

    await expect(signOut()).rejects.toBeInstanceOf(ApiError);
  });
});


import { describe, expect, it, jest } from "@jest/globals";
import type { SessionUser } from "@data-room/shared";
import { authKeys, toSessionState } from "./useSession";

const user: SessionUser = {
  id: "usr_1",
  email: "owner@acme.com",
  displayName: "Owner",
  hasPassword: true,
};

const retry = jest.fn();

describe("authKeys", () => {
  it("nests the session under one root, so sign-out can drop everything else by prefix", () => {
    expect(authKeys.session()).toEqual(["auth", "session"]);
    expect(authKeys.session()[0]).toBe(authKeys.all[0]);
  });
});

describe("toSessionState", () => {
  it("is loading while the first answer is still in flight", () => {
    expect(toSessionState({ user: undefined, error: null, retry })).toEqual({ status: "loading" });
  });

  it("is signed in once the user arrives", () => {
    expect(toSessionState({ user, error: null, retry })).toEqual({ status: "signed-in", user });
  });

  it("treats a null user — the client's rendering of a 401 — as signed out, not as an error", () => {
    expect(toSessionState({ user: null, error: null, retry })).toEqual({ status: "signed-out" });
  });

  it("reports an unreachable API as its own state, never as signed out", () => {
    const error = new Error("offline");
    const state = toSessionState({ user: undefined, error, retry });

    // Collapsing this into "signed-out" would eject a signed-in user on every blip.
    expect(state.status).toBe("unavailable");
    if (state.status !== "unavailable") throw new Error("expected an unavailable session");
    expect(state.error).toBe(error);
    expect(state.retry).toBe(retry);
  });

  it("keeps a known user signed in when a later refetch fails", () => {
    expect(toSessionState({ user, error: new Error("offline"), retry })).toEqual({
      status: "signed-in",
      user,
    });
  });

  it("keeps a known sign-out definitive when a later refetch fails", () => {
    expect(toSessionState({ user: null, error: new Error("offline"), retry })).toEqual({
      status: "signed-out",
    });
  });
});

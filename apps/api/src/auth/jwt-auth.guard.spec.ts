import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ACCESS_COOKIE_NAME } from "./cookies";
import { currentUserFrom } from "./current-user.decorator";
import { Public } from "./public.decorator";
import {
  JwtAuthGuard,
  UnauthenticatedError,
  type AccessTokenVerifier,
  type AuthUser,
  type AuthenticatedRequest,
  type VerifiedAccessClaims,
} from "./jwt-auth.guard";

/**
 * Named after the scenarios in
 * openspec/changes/add-authentication/specs/authentication/spec.md — "Endpoints are
 * protected by default" — so the mapping from requirement to test is visible.
 *
 * Nothing here mints a real token: the guard depends on AccessTokenVerifier, so the signing
 * key, the clock and the JWT framing all stay in the token service's own spec.
 */

const claims: VerifiedAccessClaims = { sub: "user_1" };
const signedIn: AuthUser = { id: "user_1" };

/** A controller as it looks the moment someone adds an endpoint and thinks no further. */
class UnmarkedController {
  listDocuments(): string {
    return "documents";
  }
}

class MixedController {
  @Public()
  login(): string {
    return "login";
  }

  listDocuments(): string {
    return "documents";
  }
}

@Public()
class PublicCallbackController {
  callback(): string {
    return "callback";
  }
}

/**
 * A stub execution context. The guard touches exactly these three members, and the health
 * controller's spec establishes the same "fake only what is used" shape for a response.
 */
function contextFor(
  controller: new () => object,
  handler: () => unknown,
  request: AuthenticatedRequest,
): ExecutionContext {
  const context = {
    getClass: () => controller,
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => request }),
  };

  return context as unknown as ExecutionContext;
}

function requestWithToken(token: string): AuthenticatedRequest {
  return { cookies: { [ACCESS_COOKIE_NAME]: token } };
}

function guardWith(verifier: AccessTokenVerifier): JwtAuthGuard {
  return new JwtAuthGuard(new Reflector(), verifier);
}

/** Narrows the rejection without a cast, and fails loudly if the guard let the call pass. */
async function rejectionOf(result: Promise<unknown>): Promise<UnauthenticatedError> {
  try {
    await result;
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) return error;
    throw error;
  }

  throw new Error("Expected the guard to reject the request, but it allowed it through.");
}

describe("JwtAuthGuard", () => {
  describe("Scenario: New endpoint inherits protection", () => {
    it("rejects an anonymous request to a handler nobody decorated", async () => {
      // The whole point of the global guard: protection is what happens when a developer
      // adds a route and forgets that authentication exists.
      const verify = jest.fn((): VerifiedAccessClaims => claims);
      const guard = guardWith({ verifyAccessToken: verify });

      const error = await rejectionOf(
        guard.canActivate(
          contextFor(UnmarkedController, UnmarkedController.prototype.listDocuments, {}),
        ),
      );

      expect(error.code).toBe("UNAUTHENTICATED");
      expect(error.status).toBe(401);
      expect(verify).not.toHaveBeenCalled();
    });

    it("does not treat a sibling handler's @Public() as covering the whole controller", async () => {
      const guard = guardWith({ verifyAccessToken: () => claims });

      const error = await rejectionOf(
        guard.canActivate(contextFor(MixedController, MixedController.prototype.listDocuments, {})),
      );

      expect(error.status).toBe(401);
    });

    it("rejects a request whose cookie jar has no access cookie at all", async () => {
      const guard = guardWith({ verifyAccessToken: () => claims });

      const error = await rejectionOf(
        guard.canActivate(
          contextFor(UnmarkedController, UnmarkedController.prototype.listDocuments, {
            cookies: { some_other_cookie: "value" },
          }),
        ),
      );

      expect(error.status).toBe(401);
    });

    it("rejects a cookie that is present but empty", async () => {
      const verify = jest.fn((): VerifiedAccessClaims => claims);
      const guard = guardWith({ verifyAccessToken: verify });

      const error = await rejectionOf(
        guard.canActivate(
          contextFor(
            UnmarkedController,
            UnmarkedController.prototype.listDocuments,
            requestWithToken(""),
          ),
        ),
      );

      expect(error.status).toBe(401);
      expect(verify).not.toHaveBeenCalled();
    });
  });

  describe("Scenario: Existence is not disclosed", () => {
    it("answers a request for a real resource id exactly as it answers one for a fiction", async () => {
      const guard = guardWith({ verifyAccessToken: () => claims });
      const forRealId: AuthenticatedRequest = { cookies: {} };
      const forInventedId: AuthenticatedRequest = { cookies: {} };

      const real = await rejectionOf(
        guard.canActivate(
          contextFor(UnmarkedController, UnmarkedController.prototype.listDocuments, forRealId),
        ),
      );
      const invented = await rejectionOf(
        guard.canActivate(
          contextFor(UnmarkedController, UnmarkedController.prototype.listDocuments, forInventedId),
        ),
      );

      // Same code, same status, same message — and the guard has no way to tell the two
      // apart even if it wanted to, since its only dependency is the token verifier.
      expect(invented.code).toBe(real.code);
      expect(invented.status).toBe(real.status);
      expect(invented.message).toBe(real.message);
    });

    it("reports a tampered token the same way as an absent one", async () => {
      const guard = guardWith({
        verifyAccessToken: () => {
          throw new Error("invalid signature");
        },
      });

      const tampered = await rejectionOf(
        guard.canActivate(
          contextFor(
            UnmarkedController,
            UnmarkedController.prototype.listDocuments,
            requestWithToken("forged.token.value"),
          ),
        ),
      );
      const absent = await rejectionOf(
        guard.canActivate(
          contextFor(UnmarkedController, UnmarkedController.prototype.listDocuments, {}),
        ),
      );

      expect(tampered.code).toBe(absent.code);
      expect(tampered.message).toBe(absent.message);
      // The verifier's own message would say which check failed; it must not travel out.
      expect(tampered.message).not.toContain("signature");
    });
  });

  describe("@Public()", () => {
    it("lets an anonymous request reach a public handler", async () => {
      const verify = jest.fn((): VerifiedAccessClaims => claims);
      const guard = guardWith({ verifyAccessToken: verify });

      const allowed = await guard.canActivate(
        contextFor(MixedController, MixedController.prototype.login, {}),
      );

      expect(allowed).toBe(true);
      expect(verify).not.toHaveBeenCalled();
    });

    it("is honoured when it marks the whole controller", async () => {
      const guard = guardWith({ verifyAccessToken: () => claims });

      const allowed = await guard.canActivate(
        contextFor(PublicCallbackController, PublicCallbackController.prototype.callback, {}),
      );

      expect(allowed).toBe(true);
    });
  });

  describe("Scenario: Valid session", () => {
    it("verifies the access cookie and puts the caller on the request", async () => {
      const verify = jest.fn((): VerifiedAccessClaims => claims);
      const guard = guardWith({ verifyAccessToken: verify });
      const request = requestWithToken("valid.access.token");

      const allowed = await guard.canActivate(
        contextFor(UnmarkedController, UnmarkedController.prototype.listDocuments, request),
      );

      expect(allowed).toBe(true);
      expect(verify).toHaveBeenCalledWith("valid.access.token");
      expect(request.user).toEqual(signedIn);
    });

    it("takes the caller's id from the signed subject, never from the request", async () => {
      // A request that tries to name its own user must be ignored: the token is the only
      // thing that says who is calling.
      const guard = guardWith({ verifyAccessToken: () => ({ sub: "user_from_token" }) });
      const request: AuthenticatedRequest = {
        cookies: { [ACCESS_COOKIE_NAME]: "valid.access.token" },
        user: { id: "user_smuggled_in" },
      };

      await guard.canActivate(
        contextFor(UnmarkedController, UnmarkedController.prototype.listDocuments, request),
      );

      expect(request.user).toEqual({ id: "user_from_token" });
    });

    it("awaits a verifier that resolves asynchronously", async () => {
      const guard = guardWith({ verifyAccessToken: async () => claims });
      const request = requestWithToken("valid.access.token");

      await guard.canActivate(
        contextFor(UnmarkedController, UnmarkedController.prototype.listDocuments, request),
      );

      expect(request.user).toEqual(signedIn);
    });

    it("rejects a verifier that rejects asynchronously", async () => {
      const guard = guardWith({
        verifyAccessToken: () => Promise.reject(new Error("jwt expired")),
      });

      const error = await rejectionOf(
        guard.canActivate(
          contextFor(
            UnmarkedController,
            UnmarkedController.prototype.listDocuments,
            requestWithToken("expired.access.token"),
          ),
        ),
      );

      expect(error.status).toBe(401);
    });

    it("leaves the request anonymous when verification fails", async () => {
      const guard = guardWith({
        verifyAccessToken: () => {
          throw new Error("jwt expired");
        },
      });
      const request = requestWithToken("expired.access.token");

      await rejectionOf(
        guard.canActivate(
          contextFor(UnmarkedController, UnmarkedController.prototype.listDocuments, request),
        ),
      );

      // A half-populated request is worse than a rejected one: a later handler that only
      // checked for the property's presence would treat a rejected caller as signed in.
      expect(request.user).toBeUndefined();
    });
  });
});

describe("@CurrentUser()", () => {
  it("hands the handler the caller the guard verified", async () => {
    const guard = guardWith({ verifyAccessToken: () => claims });
    const request = requestWithToken("valid.access.token");
    const context = contextFor(
      UnmarkedController,
      UnmarkedController.prototype.listDocuments,
      request,
    );

    await guard.canActivate(context);

    expect(currentUserFrom(undefined, context)).toEqual(signedIn);
  });

  it("refuses to invent a caller on a route the guard never checked", () => {
    // Asking for the current user inside a @Public() handler is a coding mistake. Failing
    // is the safe answer; returning undefined would push the mistake into the handler.
    const context = contextFor(MixedController, MixedController.prototype.login, {});

    expect(() => currentUserFrom(undefined, context)).toThrow(UnauthenticatedError);
  });
});

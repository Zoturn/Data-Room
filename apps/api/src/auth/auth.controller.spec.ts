import { HTTP_CODE_METADATA, ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { sessionUserSchema, type SessionUser } from "@data-room/shared";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { AuthController } from "./auth.controller";
import { InvalidRefreshTokenError, UnauthenticatedError } from "./auth.errors";
import { AuthService, type AuthenticatedSession } from "./auth.service";
import { REFRESH_COOKIE_NAME, SessionCookies, type CookieResponse } from "./cookies";
import { type AuthenticatedRequest } from "./jwt-auth.guard";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { SessionService } from "./session.service";
import { TokenService, type IssuedSession } from "./token.service";

/**
 * Named after the scenarios in
 * openspec/changes/add-authentication/specs/authentication/spec.md.
 *
 * Every collaborator is stubbed: what is under test here is the wiring — which handler is
 * public, what is written to the response and in what order — not the rules, which have
 * their own specs. The real HTTP surface, including the guards, the pipes and the cookies a
 * browser actually receives, is exercised by the Cypress API specs.
 */
const sessionUser: SessionUser = {
  id: "usr_1",
  email: "owner@acme.com",
  displayName: "Owner",
  hasPassword: true,
};

function issuedSession(): IssuedSession {
  return {
    userId: "usr_1",
    familyId: "fam_1",
    accessToken: "access-token-value",
    accessTokenExpiresAt: new Date("2026-01-01T00:15:00.000Z"),
    refreshToken: "refresh-token-value",
    refreshTokenExpiresAt: new Date("2026-01-08T00:00:00.000Z"),
  };
}

type AuthStub = Pick<AuthService, "register" | "login" | "getSessionUser">;
type TokensStub = Pick<TokenService, "rotate">;
type SessionsStub = Pick<SessionService, "endSession">;
type CookiesStub = Pick<SessionCookies, "setSession" | "clearSession">;

type Harness = {
  controller: AuthController;
  auth: AuthStub;
  tokens: TokensStub;
  sessions: SessionsStub;
  cookies: CookiesStub;
  response: CookieResponse;
  calls: string[];
};

async function harness(rotate?: TokensStub["rotate"]): Promise<Harness> {
  const calls: string[] = [];
  const session: AuthenticatedSession = { user: sessionUser, session: issuedSession() };

  const auth: AuthStub = {
    register: jest.fn(async () => session),
    login: jest.fn(async () => session),
    getSessionUser: jest.fn(async () => sessionUser),
  };

  const tokens: TokensStub = { rotate: rotate ?? jest.fn(async () => issuedSession()) };

  const sessions: SessionsStub = {
    endSession: jest.fn(async () => {
      calls.push("endSession");
    }),
  };

  const cookies: CookiesStub = {
    setSession: jest.fn(() => {
      calls.push("setSession");
    }),
    clearSession: jest.fn(() => {
      calls.push("clearSession");
    }),
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      { provide: AuthService, useValue: auth },
      { provide: TokenService, useValue: tokens },
      { provide: SessionService, useValue: sessions },
      { provide: SessionCookies, useValue: cookies },
    ],
  }).compile();

  return {
    controller: moduleRef.get(AuthController),
    auth,
    tokens,
    sessions,
    cookies,
    response: { cookie: jest.fn() },
    calls,
  };
}

function requestWithRefreshCookie(value?: string): AuthenticatedRequest {
  return value === undefined ? {} : { cookies: { [REFRESH_COOKIE_NAME]: value } };
}

/** Route-argument metadata is where Nest records the pipes bound to a handler parameter. */
function pipesFor(handler: string): unknown[] {
  const metadata: unknown = Reflect.getMetadata(ROUTE_ARGS_METADATA, AuthController, handler);
  if (typeof metadata !== "object" || metadata === null) return [];

  const pipes: unknown[] = [];
  for (const entry of Object.values(metadata)) {
    if (typeof entry !== "object" || entry === null || !("pipes" in entry)) continue;
    const bound: unknown = entry.pipes;
    if (Array.isArray(bound)) pipes.push(...bound);
  }
  return pipes;
}

/**
 * The throttler's metadata keys are internal to the library, so they are discovered rather
 * than imported. A version that renames them makes this return `undefined` and fails the
 * test, which is the honest outcome — a silently unthrottled login is the alternative.
 */
function throttleLimitFor(handler: (...args: never[]) => unknown): unknown {
  const keys: unknown[] = Reflect.getMetadataKeys(handler);
  const limitKey = keys.find(
    (key): key is string => typeof key === "string" && key.startsWith("THROTTLER:LIMIT"),
  );
  if (limitKey === undefined) return undefined;

  const limit: unknown = Reflect.getMetadata(limitKey, handler);
  return limit;
}

describe("AuthController", () => {
  const reflector = new Reflector();

  describe("Scenario: Successful registration signs the user in", () => {
    it("creates the account, sets both cookies and returns the session user", async () => {
      const { controller, auth, cookies, response } = await harness();

      const body = await controller.register(
        { email: "owner@acme.com", password: "correct horse battery" },
        response,
      );

      expect(auth.register).toHaveBeenCalledWith({
        email: "owner@acme.com",
        password: "correct horse battery",
      });
      expect(cookies.setSession).toHaveBeenCalledWith(response, issuedSession());
      expect(body).toEqual(sessionUser);
    });

    it("returns no credential material in the body", async () => {
      // The tokens are set as httpOnly cookies and must exist nowhere else. sessionUserSchema
      // is strict, so this also fails if a field is added to the response without thought.
      const { controller, response } = await harness();

      const body = await controller.register(
        { email: "owner@acme.com", password: "correct horse battery" },
        response,
      );

      expect(sessionUserSchema.safeParse(body).success).toBe(true);
      const serialised = JSON.stringify(body);
      expect(serialised).not.toContain("access-token-value");
      expect(serialised).not.toContain("refresh-token-value");
    });

    it("validates the body with the shared registration schema", () => {
      expect(pipesFor("register").some((pipe) => pipe instanceof ZodValidationPipe)).toBe(true);
    });
  });

  describe("Scenario: Sign-in with a correct password", () => {
    it("sets both cookies, returns the user, and answers 200 rather than 201", async () => {
      const { controller, auth, cookies, response } = await harness();

      const body = await controller.login(
        { email: "owner@acme.com", password: "hunter2" },
        response,
      );

      expect(auth.login).toHaveBeenCalledWith({ email: "owner@acme.com", password: "hunter2" });
      expect(cookies.setSession).toHaveBeenCalledWith(response, issuedSession());
      expect(body).toEqual(sessionUser);
      expect(
        reflector.get<number | undefined>(HTTP_CODE_METADATA, AuthController.prototype.login),
      ).toBe(200);
    });

    it("validates the body with the shared login schema", () => {
      expect(pipesFor("login").some((pipe) => pipe instanceof ZodValidationPipe)).toBe(true);
    });
  });

  describe("Scenario: Rotation on refresh", () => {
    it("rotates the presented cookie and reissues both cookies", async () => {
      const { controller, tokens, cookies, auth, response } = await harness();

      const body = await controller.refresh(requestWithRefreshCookie("presented-token"), response);

      expect(tokens.rotate).toHaveBeenCalledWith("presented-token");
      expect(cookies.setSession).toHaveBeenCalledWith(response, issuedSession());
      expect(auth.getSessionUser).toHaveBeenCalledWith("usr_1");
      expect(body).toEqual(sessionUser);
    });

    it("refuses a request with no refresh cookie without touching the token service", async () => {
      // The token is read from the cookie and from nowhere else — never a body, never a
      // query string. See auth-and-guards.md rule 5.
      const { controller, tokens, cookies, response } = await harness();

      await expect(controller.refresh(requestWithRefreshCookie(), response)).rejects.toBeInstanceOf(
        InvalidRefreshTokenError,
      );

      expect(tokens.rotate).not.toHaveBeenCalled();
      expect(cookies.setSession).not.toHaveBeenCalled();
    });
  });

  describe("Scenario: Replayed token revokes the family", () => {
    it("clears the cookies and propagates the 401 when the token is rejected", async () => {
      const { controller, cookies, response } = await harness(
        jest.fn(async () => {
          throw new InvalidRefreshTokenError();
        }),
      );

      await expect(
        controller.refresh(requestWithRefreshCookie("replayed-token"), response),
      ).rejects.toBeInstanceOf(UnauthenticatedError);

      // A token that has just been rejected will never be accepted again, so leaving it in
      // the browser only produces another replay on the next request.
      expect(cookies.clearSession).toHaveBeenCalledWith(response);
      expect(cookies.setSession).not.toHaveBeenCalled();
    });

    it("leaves the session alone when refresh fails for an unrelated reason", async () => {
      // A database outage is not evidence that the token is bad. Signing the user out here
      // would turn a transient failure into a lost session.
      const { controller, cookies, response } = await harness(
        jest.fn(async () => {
          throw new Error("connection terminated unexpectedly");
        }),
      );

      await expect(
        controller.refresh(requestWithRefreshCookie("good-token"), response),
      ).rejects.toThrow("connection terminated unexpectedly");

      expect(cookies.clearSession).not.toHaveBeenCalled();
    });
  });

  describe("Scenario: Sign-out ends the session", () => {
    it("clears the cookies and revokes the family the presented token belongs to", async () => {
      const { controller, cookies, sessions, response, calls } = await harness();

      await controller.logout(requestWithRefreshCookie("presented-token"), response);

      expect(cookies.clearSession).toHaveBeenCalledWith(response);
      expect(sessions.endSession).toHaveBeenCalledWith("presented-token");
      // Cookies first: the caller ends up signed out even if the revocation fails.
      expect(calls).toEqual(["clearSession", "endSession"]);
    });

    it("answers 204, so the response carries no body", () => {
      expect(
        reflector.get<number | undefined>(HTTP_CODE_METADATA, AuthController.prototype.logout),
      ).toBe(204);
    });
  });

  describe("Scenario: Sign-out is idempotent", () => {
    it("succeeds with no session at all and still clears the cookies", async () => {
      const { controller, cookies, sessions, response } = await harness();

      await expect(
        controller.logout(requestWithRefreshCookie(), response),
      ).resolves.toBeUndefined();

      expect(cookies.clearSession).toHaveBeenCalledWith(response);
      expect(sessions.endSession).toHaveBeenCalledWith(undefined);
    });
  });

  describe("Scenario: Session restored on reload", () => {
    it("returns the caller from the id the guard established", async () => {
      const { controller, auth } = await harness();

      const body = await controller.me({ id: "usr_1" });

      expect(auth.getSessionUser).toHaveBeenCalledWith("usr_1");
      expect(body).toEqual(sessionUser);
      expect(sessionUserSchema.safeParse(body).success).toBe(true);
    });
  });

  describe("Requirement: Endpoints are protected by default", () => {
    it.each(["register", "login", "refresh", "logout"] as const)(
      "marks %s public, because it must be reachable without a session",
      (handler) => {
        expect(
          reflector.get<boolean | undefined>(IS_PUBLIC_KEY, AuthController.prototype[handler]),
        ).toBe(true);
      },
    );

    it("leaves GET /auth/me protected, so an expired session answers 401", () => {
      expect(
        reflector.get<boolean | undefined>(IS_PUBLIC_KEY, AuthController.prototype.me),
      ).toBeUndefined();
    });

    it("does not mark the whole controller public", () => {
      // A class-level marker would open every handler added here later, including ones
      // nobody thought about.
      expect(reflector.get<boolean | undefined>(IS_PUBLIC_KEY, AuthController)).toBeUndefined();
    });
  });

  describe("Requirement: Credential endpoints are rate limited", () => {
    it("throttles registration and login to the same small budget", () => {
      expect(throttleLimitFor(AuthController.prototype.register)).toBe(10);
      expect(throttleLimitFor(AuthController.prototype.login)).toBe(10);
    });

    it("throttles refresh more generously, since the token is not guessable", () => {
      expect(throttleLimitFor(AuthController.prototype.refresh)).toBe(60);
    });

    it("leaves GET /auth/me on the application-wide baseline", () => {
      expect(throttleLimitFor(AuthController.prototype.me)).toBeUndefined();
    });
  });
});

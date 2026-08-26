import type { CookieOptions } from "express";
import { ConfigService } from "../config/config.service";
import {
  ACCESS_COOKIE_NAME,
  ACCESS_COOKIE_PATH,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  SessionCookies,
  type CookieResponse,
} from "./cookies";

/** Everything else the schema demands, so the cookie policy is the only thing that varies. */
const baseEnv = {
  DATABASE_URL: "postgresql://user:pass@localhost:6543/db",
  DIRECT_URL: "postgresql://user:pass@localhost:5432/db",
  WEB_APP_URL: "http://localhost:3000",
  CORS_ORIGINS: "http://localhost:3000",
  JWT_ACCESS_SECRET: "a-test-secret-of-at-least-thirty-two-chars",
};

/** Plain HTTP, two ports of one site: Lax is sent, Secure would drop the cookie. */
const localPolicy = { COOKIE_SECURE: "false", COOKIE_SAMESITE: "lax" };

/** Genuinely cross-site over HTTPS: None is required, and only accepted alongside Secure. */
const productionPolicy = { COOKIE_SECURE: "true", COOKIE_SAMESITE: "none" };

function sessionCookies(policy: Record<string, string>): SessionCookies {
  return new SessionCookies(new ConfigService({ ...baseEnv, ...policy }));
}

type WrittenCookie = { name: string; value: string; options: CookieOptions };

function recordingResponse(): { response: CookieResponse; written: WrittenCookie[] } {
  const written: WrittenCookie[] = [];

  return {
    written,
    response: {
      cookie(name, value, options) {
        written.push({ name, value, options });
      },
    },
  };
}

function cookieNamed(written: WrittenCookie[], name: string): WrittenCookie {
  const match = written.find((cookie) => cookie.name === name);

  if (!match) {
    const names = written.map((cookie) => cookie.name).join(", ");
    throw new Error(`Expected a cookie named "${name}"; got ${names || "none"}`);
  }

  return match;
}

describe("SessionCookies", () => {
  describe("httpOnly", () => {
    it.each([
      ["local development", localPolicy],
      ["production", productionPolicy],
    ])("marks both session cookies httpOnly in %s", (_environment, policy) => {
      const cookies = sessionCookies(policy);

      expect(cookies.accessCookieOptions().httpOnly).toBe(true);
      expect(cookies.refreshCookieOptions().httpOnly).toBe(true);
    });

    it("keeps httpOnly true even when configuration relaxes everything it can", () => {
      // httpOnly is not configurable on purpose: no environment, and no env file, may make
      // a session token readable from document.cookie.
      const cookies = sessionCookies({ COOKIE_SECURE: "false", COOKIE_SAMESITE: "none" });

      expect(cookies.accessCookieOptions().httpOnly).toBe(true);
      expect(cookies.refreshCookieOptions().httpOnly).toBe(true);
    });
  });

  describe("secure and sameSite come from configuration", () => {
    it("uses the local pair over plain HTTP", () => {
      const cookies = sessionCookies(localPolicy);

      for (const options of [cookies.accessCookieOptions(), cookies.refreshCookieOptions()]) {
        expect(options.secure).toBe(false);
        expect(options.sameSite).toBe("lax");
      }
    });

    it("uses the cross-site pair in production", () => {
      const cookies = sessionCookies(productionPolicy);

      for (const options of [cookies.accessCookieOptions(), cookies.refreshCookieOptions()]) {
        expect(options.secure).toBe(true);
        expect(options.sameSite).toBe("none");
      }
    });

    it("follows configuration rather than NODE_ENV", () => {
      // The two must stay independent: a production-mode process behind a local proxy still
      // needs the local cookie pair, and an isProd branch could not express that.
      const cookies = sessionCookies({ ...localPolicy, NODE_ENV: "production" });

      expect(cookies.accessCookieOptions().secure).toBe(false);
      expect(cookies.accessCookieOptions().sameSite).toBe("lax");
    });

    it("leaves the domain unset so a cookie stays on the host that issued it", () => {
      const cookies = sessionCookies(productionPolicy);

      expect(cookies.accessCookieOptions().domain).toBeUndefined();
      expect(cookies.refreshCookieOptions().domain).toBeUndefined();
    });
  });

  describe("scope", () => {
    it("scopes the refresh cookie to the refresh endpoint", () => {
      expect(sessionCookies(localPolicy).refreshCookieOptions().path).toBe(REFRESH_COOKIE_PATH);
      expect(REFRESH_COOKIE_PATH).toBe("/api/auth/refresh");
    });

    it("uses the same refresh path in every environment", () => {
      // A path that differed by environment would make the cookie work locally and vanish in
      // production, and the failure reads as a broken session rather than as configuration.
      expect(sessionCookies(productionPolicy).refreshCookieOptions().path).toBe(
        sessionCookies(localPolicy).refreshCookieOptions().path,
      );
    });

    it("leaves the access cookie site-wide so it accompanies every API call", () => {
      expect(sessionCookies(localPolicy).accessCookieOptions().path).toBe(ACCESS_COOKIE_PATH);
      expect(ACCESS_COOKIE_PATH).toBe("/");
    });
  });

  describe("lifetime", () => {
    it("derives each max-age from the configured TTL, in milliseconds", () => {
      // The TTLs come from configuration rather than a constant in this file, so the
      // cookie's maxAge and the token's own exp cannot drift apart.
      const cookies = sessionCookies({
        ...localPolicy,
        ACCESS_TOKEN_TTL_SECONDS: "300",
        REFRESH_TOKEN_TTL_SECONDS: "86400",
      });

      expect(cookies.accessCookieOptions().maxAge).toBe(300 * 1000);
      expect(cookies.refreshCookieOptions().maxAge).toBe(86_400 * 1000);
    });

    it("outlives the access token with the refresh token, which is what refresh is for", () => {
      const cookies = sessionCookies(localPolicy);
      const access = cookies.accessCookieOptions().maxAge ?? 0;
      const refresh = cookies.refreshCookieOptions().maxAge ?? 0;

      expect(refresh).toBeGreaterThan(access);
    });
  });

  describe("setSession", () => {
    it("writes both tokens under their cookie names", () => {
      const { response, written } = recordingResponse();

      sessionCookies(localPolicy).setSession(response, {
        accessToken: "access.jwt.value",
        refreshToken: "refresh.opaque.value",
      });

      expect(written).toHaveLength(2);
      expect(cookieNamed(written, ACCESS_COOKIE_NAME).value).toBe("access.jwt.value");
      expect(cookieNamed(written, REFRESH_COOKIE_NAME).value).toBe("refresh.opaque.value");
    });

    it("applies the scoped options to each cookie it writes", () => {
      const { response, written } = recordingResponse();
      const cookies = sessionCookies(productionPolicy);

      cookies.setSession(response, { accessToken: "a", refreshToken: "r" });

      expect(cookieNamed(written, ACCESS_COOKIE_NAME).options).toEqual(
        cookies.accessCookieOptions(),
      );
      expect(cookieNamed(written, REFRESH_COOKIE_NAME).options).toEqual(
        cookies.refreshCookieOptions(),
      );
    });
  });

  describe("clearSession", () => {
    it("expires both cookies in the past", () => {
      const { response, written } = recordingResponse();

      sessionCookies(localPolicy).clearSession(response);

      expect(written).toHaveLength(2);

      for (const name of [ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME]) {
        const cleared = cookieNamed(written, name);

        expect(cleared.value).toBe("");
        expect(cleared.options.expires).toBeInstanceOf(Date);
        expect(cleared.options.expires?.getTime()).toBeLessThan(Date.now());
        // A max-age would win over the expiry date and revive the cookie.
        expect(cleared.options.maxAge).toBeUndefined();
      }
    });

    it("clears each cookie on the path it was set on", () => {
      // A browser matches on name and path; clearing the refresh cookie at "/" would leave
      // the real one at /api/auth/refresh in place and the session silently resumable.
      const { response, written } = recordingResponse();

      sessionCookies(localPolicy).clearSession(response);

      expect(cookieNamed(written, ACCESS_COOKIE_NAME).options.path).toBe(ACCESS_COOKIE_PATH);
      expect(cookieNamed(written, REFRESH_COOKIE_NAME).options.path).toBe(REFRESH_COOKIE_PATH);
    });

    it("repeats the attributes used when setting, so the browser accepts the removal", () => {
      const { response, written } = recordingResponse();
      const cookies = sessionCookies(productionPolicy);

      cookies.clearSession(response);

      const cleared = cookieNamed(written, REFRESH_COOKIE_NAME).options;

      expect(cleared.httpOnly).toBe(true);
      expect(cleared.secure).toBe(true);
      expect(cleared.sameSite).toBe("none");
    });

    it("needs no session to clear, so logout stays idempotent", () => {
      // Nothing is read from the request: an expired, revoked or absent session must still
      // produce a response that tells the browser to drop whatever it is holding.
      const { response, written } = recordingResponse();
      const cookies = sessionCookies(localPolicy);

      expect(() => {
        cookies.clearSession(response);
        cookies.clearSession(response);
      }).not.toThrow();

      expect(written).toHaveLength(4);
    });
  });
});

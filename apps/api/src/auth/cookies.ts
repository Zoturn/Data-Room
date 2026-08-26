import { Injectable } from "@nestjs/common";
import type { CookieOptions } from "express";
import { ConfigService } from "../config/config.service";

export const ACCESS_COOKIE_NAME = "access_token";
export const REFRESH_COOKIE_NAME = "refresh_token";

/** The access cookie travels with every API call, so it is scoped to the whole site. */
export const ACCESS_COOKIE_PATH = "/";

/**
 * The refresh cookie is scoped to the one endpoint that consumes it, so it is absent from
 * every ordinary request: a token that is never sent cannot be captured by a proxy, a log,
 * or a mistake in some unrelated handler. The path carries the global `api` prefix because
 * the browser matches it against the request path it will actually send, and it is the same
 * in every environment so a rotated session behaves identically locally and in production.
 */
export const REFRESH_COOKIE_PATH = "/api/auth/refresh";

/*
 * Token lifetimes are NOT declared here. They come from the env schema, so a cookie's
 * `maxAge` and the token's own `exp` are derived from one value — declared in two places
 * they drift, and the symptom is a cookie the browser discarded still holding a token the
 * server accepts, or the reverse.
 */

export type SessionTokens = { accessToken: string; refreshToken: string };

/**
 * The only part of an HTTP response this module touches. Express's `Response` satisfies it
 * structurally, and a test can record what was written without constructing a real one.
 */
export type CookieResponse = {
  cookie(name: string, value: string, options: CookieOptions): void;
};

/**
 * The single place that knows the shape of a session cookie. Nothing else sets cookie
 * options — spread across call sites the policy drifts, and a cookie whose attributes
 * disagree between the set and the clear can never be cleared.
 */
@Injectable()
export class SessionCookies {
  constructor(private readonly config: ConfigService) {}

  private baseCookie(): CookieOptions {
    return {
      // Unconditional, in every environment: this is what keeps a token out of
      // `document.cookie`, so an XSS bug cannot read the session out of the page.
      httpOnly: true,
      // Policy, not code. Production is genuinely cross-site — the browser app on one host
      // calling the API on another — so it needs SameSite=None, which browsers honour only
      // alongside Secure, which needs HTTPS. Locally there is no HTTPS and the pair differs
      // only by port, which is not part of a site, so Lax without Secure is correct. An
      // `isProd` branch here would put the same decision in two places; copying the
      // production pair to a developer's machine drops every cookie silently, and the login
      // looks successful right up until the next request arrives anonymous.
      secure: this.config.get("COOKIE_SECURE"),
      sameSite: this.config.get("COOKIE_SAMESITE"),
      // `domain` is deliberately left unset, which scopes each cookie to the exact host that
      // issued it rather than sharing it with every sibling subdomain.
    };
  }

  accessCookieOptions(): CookieOptions {
    return {
      ...this.baseCookie(),
      path: ACCESS_COOKIE_PATH,
      // Express counts maxAge in milliseconds; the token TTLs are the source of truth, so
      // the cookie cannot outlive the credential it carries.
      maxAge: this.config.get("ACCESS_TOKEN_TTL_SECONDS") * 1000,
    };
  }

  refreshCookieOptions(): CookieOptions {
    return {
      ...this.baseCookie(),
      path: REFRESH_COOKIE_PATH,
      maxAge: this.config.get("REFRESH_TOKEN_TTL_SECONDS") * 1000,
    };
  }

  setSession(response: CookieResponse, tokens: SessionTokens): void {
    response.cookie(ACCESS_COOKIE_NAME, tokens.accessToken, this.accessCookieOptions());
    response.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, this.refreshCookieOptions());
  }

  /**
   * Clearing reads nothing from the request, so signing out works for a caller whose session
   * has expired, was already revoked, or never existed — logout has to stay idempotent, and
   * a browser holding a stale cookie must be told to drop it either way.
   */
  clearSession(response: CookieResponse): void {
    response.cookie(ACCESS_COOKIE_NAME, "", this.expiredCookie(ACCESS_COOKIE_PATH));
    response.cookie(REFRESH_COOKIE_NAME, "", this.expiredCookie(REFRESH_COOKIE_PATH));
  }

  /**
   * A cookie is removed by overwriting it, not by deleting it: the browser drops it only
   * when the replacement matches on name, path and domain and carries an expiry in the past.
   * The other attributes are kept identical to the ones used when setting so the two can
   * never diverge. `maxAge` is omitted rather than zeroed, because Express derives `expires`
   * from it and would overwrite the date that does the work.
   */
  private expiredCookie(path: string): CookieOptions {
    return { ...this.baseCookie(), path, expires: new Date(0) };
  }
}

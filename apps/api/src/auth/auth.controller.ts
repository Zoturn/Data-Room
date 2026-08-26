import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  loginInputSchema,
  registerInputSchema,
  type LoginInput,
  type RegisterInput,
  type SessionUser,
} from "@data-room/shared";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { InvalidRefreshTokenError } from "./auth.errors";
import { AuthService } from "./auth.service";
import { REFRESH_COOKIE_NAME, SessionCookies, type CookieResponse } from "./cookies";
import { CurrentUser } from "./current-user.decorator";
import { UnauthenticatedError, type AuthUser, type AuthenticatedRequest } from "./jwt-auth.guard";
import { Public } from "./public.decorator";
import { SessionService } from "./session.service";
import { TokenService, type IssuedSession } from "./token.service";

/**
 * The window every credential limit below is measured over. One minute is long enough that
 * a human retrying a mistyped password never notices it and short enough that a blocked
 * client recovers without support.
 */
const CREDENTIAL_WINDOW_MS = 60_000;

/**
 * Password attempts per window, per client, per endpoint. Ten covers a person who cannot
 * remember which password they used; it does not cover a dictionary.
 */
const CREDENTIAL_ATTEMPTS = 10;

/**
 * Refresh is not a guessing target — the token is 256 random bits — so the limit here is
 * only a ceiling on abuse. It is well above what a legitimate client can produce, because
 * the client refreshes once per access-token expiry and coalesces concurrent attempts.
 */
const REFRESH_ATTEMPTS = 60;

/**
 * Registration, sign-in, session refresh and sign-out.
 *
 * Every handler is thin on purpose: validate, delegate, write cookies, return the user. The
 * rules are in `AuthService`, the token mechanics in `TokenService`, and the cookie policy
 * in `SessionCookies` — this file is the only place that knows any of them are reached over
 * HTTP. The session travels in httpOnly cookies alone, so no response body ever contains a
 * token: what comes back describes who was signed in, and is not itself a credential.
 *
 * `@Res({ passthrough: true })` is typed as `CookieResponse` rather than express's
 * `Response`, because setting a cookie is the only thing these handlers do to the
 * response. Narrowing the type is what keeps a handler from quietly taking the response
 * over and sending its own body, which would bypass the exception filter and the one
 * error envelope every client depends on.
 */
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly cookies: SessionCookies,
  ) {}

  /**
   * `@Public()` because an account cannot be created by someone who already has one. Rate
   * limited so the 409 on a taken address — unavoidable if registration is to work at all —
   * cannot be used to walk the address space and enumerate who is registered.
   */
  @Public()
  @Throttle({ default: { limit: CREDENTIAL_ATTEMPTS, ttl: CREDENTIAL_WINDOW_MS } })
  @Post("register")
  async register(
    @Body(new ZodValidationPipe(registerInputSchema)) input: RegisterInput,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<SessionUser> {
    const { user, session } = await this.auth.register(input);
    this.cookies.setSession(response, session);
    return user;
  }

  /**
   * `@Public()` for the obvious reason, and rate limited because this is the endpoint an
   * attacker brute-forces. Every failure path answers one uniform 401 from `AuthService`.
   */
  @Public()
  @Throttle({ default: { limit: CREDENTIAL_ATTEMPTS, ttl: CREDENTIAL_WINDOW_MS } })
  @HttpCode(HttpStatus.OK)
  @Post("login")
  async login(
    @Body(new ZodValidationPipe(loginInputSchema)) input: LoginInput,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<SessionUser> {
    const { user, session } = await this.auth.login(input);
    this.cookies.setSession(response, session);
    return user;
  }

  /**
   * Exchange the refresh cookie for a new pair.
   *
   * `@Public()` because the whole point is to be reachable with an expired access token —
   * the refresh cookie is the credential here, and `TokenService.rotate` is what verifies
   * it. The path matches `REFRESH_COOKIE_PATH`, which is why the browser sends the cookie
   * to this endpoint and to no other.
   *
   * The response body is the session user rather than nothing, so a client that refreshes
   * on a cold start learns who it is without a second round trip — and because resolving it
   * proves the account behind the token still exists.
   */
  @Public()
  @Throttle({ default: { limit: REFRESH_ATTEMPTS, ttl: CREDENTIAL_WINDOW_MS } })
  @HttpCode(HttpStatus.OK)
  @Post("refresh")
  async refresh(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<SessionUser> {
    const presented = request.cookies?.[REFRESH_COOKIE_NAME];

    // Cookie only. A refresh token accepted from a body or a query string would end up in
    // access logs and Referer headers — see auth-and-guards.md rule 5.
    if (presented === undefined || presented.length === 0) throw new InvalidRefreshTokenError();

    let session: IssuedSession;
    try {
      session = await this.tokens.rotate(presented);
    } catch (error) {
      // A rejected refresh token will never be accepted again — it is expired, revoked, or
      // its family has just been killed by reuse detection. Clearing the cookies stops the
      // browser presenting a dead token on every subsequent request, which would otherwise
      // look to the server like a client retrying a replay. Anything else (a database
      // outage, say) leaves the session alone: it may well still be valid.
      if (error instanceof UnauthenticatedError) this.cookies.clearSession(response);
      throw error;
    }

    this.cookies.setSession(response, session);
    return this.auth.getSessionUser(session.userId);
  }

  /**
   * `@Public()` — the one `@Public()` here that is not obvious, so: sign-out must succeed
   * when the session has already expired. Behind the guard it could not, because an expired
   * access token is exactly the state a user is in when they come back to a tab and sign
   * out, and a 401 would leave them unable to end a session that is still refreshable. The
   * endpoint takes no privileged action: it destroys only the credentials the caller
   * presented, so an anonymous request accomplishes nothing.
   *
   * Cookies are cleared before the revocation is attempted, so the caller is signed out
   * even if the database is unreachable — see `SessionService.endSession`.
   */
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post("logout")
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<void> {
    this.cookies.clearSession(response);
    await this.sessions.endSession(request.cookies?.[REFRESH_COOKIE_NAME]);
  }

  /**
   * The only source of session truth for the frontend. Protected by the global guard, so an
   * absent or expired token answers 401 — which the client reads as "signed out", not as a
   * failure. Returns what `sessionUserSchema` permits and nothing else: the schema is
   * `.strict()`, so credential material cannot ride along even by accident.
   */
  @Get("me")
  async me(@CurrentUser() user: AuthUser): Promise<SessionUser> {
    return this.auth.getSessionUser(user.id);
  }
}

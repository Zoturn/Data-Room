import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UnauthenticatedError } from "./auth.errors";
import { ACCESS_COOKIE_NAME } from "./cookies";
import { IS_PUBLIC_KEY } from "./public.decorator";

/**
 * The caller, exactly as far as the access token proves them.
 *
 * Only the id, because only the id is signed: the access token's claims are `sub`, `iat`
 * and `exp`. Deliberately not `SessionUser` from the shared package — that carries a
 * display name and which sign-in methods are linked, and filling those in would mean a
 * database read on every single request, which is what the token exists to avoid. A
 * handler that needs more than an id asks a service for it; `GET /auth/me` is that read.
 */
export type AuthUser = {
  id: string;
};

/**
 * The slice of the Express request this module reads and writes. Typed structurally rather
 * than as `Request & { ... }` because express's own `cookies` is `any`, and intersecting
 * with it would quietly reintroduce `any` at the one place a token is read.
 */
export type AuthenticatedRequest = {
  cookies?: Record<string, string | undefined>;
  user?: AuthUser;
};

/** The one claim the guard acts on. `sub` is the user id. */
export type VerifiedAccessClaims = {
  sub: string;
};

/**
 * Everything the guard needs from the token service, expressed as an abstract class so it
 * doubles as a Nest injection token. The guard therefore knows nothing about JWT framing,
 * signing keys or the clock, and a unit test substitutes a stub instead of minting real
 * tokens. `TokenService` satisfies this shape, so the module binds it with `useExisting`.
 *
 * An implementation must *throw* for an expired, tampered or wrongly signed token.
 * Returning claims for a token that failed verification would defeat the entire guard.
 */
export abstract class AccessTokenVerifier {
  abstract verifyAccessToken(token: string): VerifiedAccessClaims | Promise<VerifiedAccessClaims>;
}

/**
 * No usable session. One error for every reason — absent cookie, expired token, bad
 * signature — because distinguishing them tells an attacker which probe got closer.
 */
/**
 * The default-deny guard. Registered once, globally, so protection is what happens when a
 * new endpoint is added and nobody thinks about authentication; exposure requires someone
 * to write `@Public()` and justify it.
 *
 * It answers only "may this caller proceed". What the caller may then see belongs to the
 * services and, later, to the access resolver.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: AccessTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Handler before class, so a `@Public()` controller can still be read route by route.
    // An undecorated route yields `undefined`, and only an explicit `true` opens anything —
    // any other metadata value fails closed rather than being coerced to "public".
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // Cookie only. A token accepted from a query string or a body would end up in access
    // logs, Referer headers and pasted URLs — see auth-and-guards.md.
    const token = request.cookies?.[ACCESS_COOKIE_NAME];

    if (token === undefined || token.length === 0) throw new UnauthenticatedError();

    let claims: VerifiedAccessClaims;
    try {
      claims = await this.verifier.verifyAccessToken(token);
    } catch {
      // The reason is swallowed on purpose: the caller learns that they are not signed in
      // and nothing else. This runs before any handler, so a rejected request never looks
      // the requested resource up and cannot reveal whether it exists.
      throw new UnauthenticatedError();
    }

    request.user = { id: claims.sub };
    return true;
  }
}

// Re-exported so callers of the guard need not know where the error is declared.
export { UnauthenticatedError };

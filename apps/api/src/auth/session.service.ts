import { Injectable, Logger } from "@nestjs/common";
import { RefreshTokenStore, TokenService, hashRefreshToken } from "./token.service";

/**
 * Ending a session, as opposed to starting one.
 *
 * Sign-out has to resolve which token family the caller is holding, which means a lookup by
 * token hash — a repository call, and controllers do not make those. It lives apart from
 * `AuthService` because nothing here is about identity: it never reads a user, and it works
 * just as well for a caller whose account no longer exists.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly refreshTokens: RefreshTokenStore,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Revoke the family the presented refresh token belongs to.
   *
   * Only this family, never every family the user owns: signing out on a laptop must not
   * end the session on a phone. The family is the session.
   *
   * Absent or unrecognised input is not a failure. Sign-out must succeed for a caller whose
   * session already expired, was already revoked, or never existed — otherwise the one
   * action a worried user reaches for is the one that reports an error. The token is looked
   * up by hash because that is the only form the database holds.
   */
  async endSession(presentedRefreshToken: string | undefined): Promise<void> {
    if (presentedRefreshToken === undefined || presentedRefreshToken.length === 0) return;

    try {
      const presented = await this.refreshTokens.findByTokenHash(
        hashRefreshToken(presentedRefreshToken),
      );
      if (presented === null) return;

      await this.tokens.revokeFamily(presented.familyId);
    } catch (error) {
      // The deliberate exception to "never swallow an error": by the time this runs the
      // caller's cookies have already been cleared, so they *are* signed out and there is
      // nothing they could retry — a second sign-out would arrive with no token at all.
      // Re-raising would turn a successful sign-out into a 500 the user cannot act on. The
      // residual risk is a live family that now only time can end, so it is logged as an
      // error rather than a warning. Never logs the token or its hash.
      this.logger.error(
        "Sign-out could not revoke the refresh token family; it will remain valid until it expires.",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

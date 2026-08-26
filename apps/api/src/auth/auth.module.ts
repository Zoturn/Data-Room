import { Module } from "@nestjs/common";
import { ConfigService } from "../config/config.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { SessionCookies } from "./cookies";
import { AccessTokenVerifier } from "./jwt-auth.guard";
import { PasswordService } from "./password.service";
import { PrismaRefreshTokenStore } from "./refresh-token.store";
import { SessionService } from "./session.service";
import { AUTH_TOKEN_OPTIONS, RefreshTokenStore, TokenService } from "./token.service";
import type { AuthTokenOptions } from "./token.service";
import { UserRepository } from "./user.repository";

/**
 * Identity: accounts, credentials, sessions and the tokens that carry them.
 *
 * Two of the bindings here are the seam that keeps this module testable. `RefreshTokenStore`
 * and `AccessTokenVerifier` are abstract classes rather than interfaces, so they are both
 * the contract and the injection token: `TokenService` depends on the port, not on Prisma,
 * and `JwtAuthGuard` depends on "something that verifies a token", not on JWT framing.
 *
 * `AccessTokenVerifier` uses `useExisting` rather than `useClass` deliberately — the guard
 * and the controller must share one `TokenService`, because a second instance would repeat
 * the secret-length check at boot and, more importantly, make "the same service" a thing
 * nobody could rely on.
 */
@Module({
  controllers: [AuthController],
  providers: [
    PasswordService,
    TokenService,
    SessionCookies,
    AuthService,
    SessionService,
    UserRepository,
    { provide: RefreshTokenStore, useClass: PrismaRefreshTokenStore },
    { provide: AccessTokenVerifier, useExisting: TokenService },
    {
      provide: AUTH_TOKEN_OPTIONS,
      // Token lifetimes are configuration, so the cookie's `maxAge` and the token's own
      // `exp` are derived from one value. `TokenService` names them for what they are and
      // never learns what the environment variables are called.
      useFactory: (config: ConfigService): AuthTokenOptions => ({
        accessTokenSecret: config.get("JWT_ACCESS_SECRET"),
        accessTokenTtlSeconds: config.get("ACCESS_TOKEN_TTL_SECONDS"),
        refreshTokenTtlSeconds: config.get("REFRESH_TOKEN_TTL_SECONDS"),
        rotationGraceSeconds: config.get("REFRESH_ROTATION_GRACE_SECONDS"),
      }),
      inject: [ConfigService],
    },
  ],
  // `AccessTokenVerifier` is exported because the global guard is constructed in the root
  // module and resolves its dependencies there. Exporting the verifier rather than
  // `TokenService` keeps the guard's reach to exactly one method.
  exports: [AuthService, AccessTokenVerifier],
})
export class AuthModule {}

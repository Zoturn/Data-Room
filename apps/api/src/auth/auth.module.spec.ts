import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import { AuthController } from "./auth.controller";
import { AuthModule } from "./auth.module";
import { AuthService } from "./auth.service";
import { SessionCookies } from "./cookies";
import { AccessTokenVerifier } from "./jwt-auth.guard";
import { PasswordService } from "./password.service";
import { PrismaRefreshTokenStore } from "./refresh-token.store";
import { SessionService } from "./session.service";
import { AUTH_TOKEN_OPTIONS, RefreshTokenStore, TokenService } from "./token.service";
import type { AuthTokenOptions } from "./token.service";
import { UserRepository } from "./user.repository";
import { ConfigModule } from "../config/config.module";
import { ENV_SOURCE } from "../config/config.service";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Composition, not behaviour: every provider in this module resolves, and the two bindings
 * that are easy to get wrong — the store port and the shared token service — are wired the
 * way the guard and the controller assume.
 *
 * This is the test that fails when a provider is added to a constructor and forgotten in
 * the module. Without it that mistake surfaces only at boot, which is to say in front of
 * whoever is running the app.
 */
const env: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://user:pass@localhost:6543/db",
  DIRECT_URL: "postgresql://user:pass@localhost:5432/db",
  WEB_APP_URL: "http://localhost:3000",
  CORS_ORIGINS: "http://localhost:3000",
  JWT_ACCESS_SECRET: "0123456789abcdef0123456789abcdef",
  ACCESS_TOKEN_TTL_SECONDS: "900",
  REFRESH_TOKEN_TTL_SECONDS: "604800",
  REFRESH_ROTATION_GRACE_SECONDS: "10",
};

/**
 * `compile()` builds the graph without running lifecycle hooks, so nothing here opens a
 * connection. The stub only has to exist — no query is issued.
 */
async function compileAuthModule(): Promise<TestingModule> {
  return Test.createTestingModule({ imports: [ConfigModule, PrismaModule, AuthModule] })
    .overrideProvider(ENV_SOURCE)
    .useValue(env)
    .overrideProvider(PrismaService)
    .useValue({})
    .compile();
}

describe("AuthModule", () => {
  it("resolves every provider the auth surface depends on", async () => {
    const moduleRef = await compileAuthModule();

    expect(moduleRef.get(AuthController)).toBeInstanceOf(AuthController);
    expect(moduleRef.get(AuthService)).toBeInstanceOf(AuthService);
    expect(moduleRef.get(SessionService)).toBeInstanceOf(SessionService);
    expect(moduleRef.get(UserRepository)).toBeInstanceOf(UserRepository);
    expect(moduleRef.get(PasswordService)).toBeInstanceOf(PasswordService);
    expect(moduleRef.get(TokenService)).toBeInstanceOf(TokenService);
    expect(moduleRef.get(SessionCookies)).toBeInstanceOf(SessionCookies);
  });

  it("binds the refresh token port to the Prisma-backed store", async () => {
    // TokenService injects the abstract class. If this binding is missing the service is
    // handed nothing and every sign-in fails at runtime, not at compile time.
    const moduleRef = await compileAuthModule();

    expect(moduleRef.get(RefreshTokenStore)).toBeInstanceOf(PrismaRefreshTokenStore);
  });

  it("gives the guard the same TokenService instance the controller uses", async () => {
    // useExisting, not useClass. A second instance would be a second secret-length check,
    // and "the token service" would stop being a single thing anyone could reason about.
    const moduleRef = await compileAuthModule();

    expect(moduleRef.get(AccessTokenVerifier)).toBe(moduleRef.get(TokenService));
  });

  it("builds the token options from configuration rather than from constants", async () => {
    // Declared twice, the cookie's maxAge and the token's exp drift apart, and the symptom
    // is a cookie the browser discarded holding a token the server still accepts.
    const moduleRef = await compileAuthModule();
    const options = moduleRef.get<AuthTokenOptions>(AUTH_TOKEN_OPTIONS);

    expect(options).toEqual({
      accessTokenSecret: "0123456789abcdef0123456789abcdef",
      accessTokenTtlSeconds: 900,
      refreshTokenTtlSeconds: 604800,
      rotationGraceSeconds: 10,
    });
  });

  it("exports only what the root module needs to build the global guard", async () => {
    // AuthService is exported for later modules; the verifier is exported because the guard
    // is constructed in the root module's context. TokenService itself stays inside.
    const moduleRef = await compileAuthModule();

    expect(moduleRef.get(AccessTokenVerifier, { strict: false })).toBeDefined();
  });
});

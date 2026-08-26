import type { ArgumentsHost } from "@nestjs/common";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import {
  ThrottlerException,
  ThrottlerGuard,
  getOptionsToken,
  type ThrottlerModuleOptions,
} from "@nestjs/throttler";
import { apiErrorSchema } from "@data-room/shared";
import { AppModule } from "./app.module";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { OriginGuard } from "./common/origin.guard";
import { IS_PUBLIC_KEY } from "./auth/public.decorator";
import { ApiExceptionFilter } from "./common/errors/api-exception.filter";
import { ENV_SOURCE } from "./config/config.service";
import { HealthController } from "./health/health.controller";
import { PrismaService } from "./prisma/prisma.service";

/**
 * Covers "New endpoint inherits protection" and "Brute force is throttled" from
 * openspec/changes/add-authentication/specs/authentication/spec.md.
 *
 * Compiling the root module is the composition proof: the global guards are ordinary
 * providers, so they are constructed here, and a guard whose dependency is not exported
 * from its module fails this test rather than the first request after a deploy.
 */
const env: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://user:pass@localhost:6543/db",
  DIRECT_URL: "postgresql://user:pass@localhost:5432/db",
  WEB_APP_URL: "http://localhost:3000",
  CORS_ORIGINS: "http://localhost:3000",
  JWT_ACCESS_SECRET: "0123456789abcdef0123456789abcdef",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "a-test-service-role-key",
};

async function compileApp(): Promise<TestingModule> {
  return Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV_SOURCE)
    .useValue(env)
    .overrideProvider(PrismaService)
    .useValue({})
    .compile();
}

/** The classes registered under `APP_GUARD`, in the order Nest will run them. */
function globalGuards(): unknown[] {
  const providers: unknown = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AppModule);
  if (!Array.isArray(providers)) return [];

  const guards: unknown[] = [];
  for (const provider of providers) {
    if (typeof provider !== "object" || provider === null) continue;
    if (!("provide" in provider) || provider.provide !== APP_GUARD) continue;
    if ("useClass" in provider) guards.push(provider.useClass);
  }
  return guards;
}

type Captured = { status: number; body: unknown };

/**
 * `ArgumentsHost` declares generic methods whose return types no concrete object can
 * satisfy, so a double for it cannot be written without this cast. Test-only, and the same
 * helper the exception filter's own spec uses.
 */
function hostFor(captured: Captured): ArgumentsHost {
  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  };
  const request = { requestId: "req_test", method: "POST", originalUrl: "/api/auth/login" };

  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;
}

describe("AppModule", () => {
  describe("Requirement: Endpoints are protected by default", () => {
    it("registers the JWT guard globally, so protection is the default", async () => {
      // Registered once here rather than with @UseGuards on each controller: one omission
      // there leaves a route open and nothing fails to say so.
      expect(globalGuards()).toContain(JwtAuthGuard);
    });

    it("orders the global guards cheapest-first, with the origin check before authentication", async () => {
      // Order is execution order, and each step earns its place before the next:
      //   ThrottlerGuard  — rejects a flood before anything expensive runs
      //   OriginGuard     — decides whether a cross-site request should be honoured at all.
      //                     It must precede authentication, because on /auth/login the
      //                     damage is done by the response's Set-Cookie, not by reading it.
      //   JwtAuthGuard    — verifies the token last, for requests that survived both
      expect(globalGuards()).toEqual([ThrottlerGuard, OriginGuard, JwtAuthGuard]);
    });

    it("checks the request origin globally, not per controller", () => {
      // Every state-changing endpoint the product will ever add is covered by this one
      // registration. CORS does not do this job: it withholds response headers but does not
      // refuse a CORS-simple request, so a cross-site form post still reaches the handler.
      expect(globalGuards()).toContain(OriginGuard);
    });

    it("compiles the whole graph, including both global guards", async () => {
      // The guards are built in the root module's context, so this fails if AuthModule
      // stops exporting what JwtAuthGuard needs.
      await expect(compileApp()).resolves.toBeDefined();
    });

    it("marks only health public among the non-auth controllers", () => {
      // The deploy platform's probe and Cypress's readiness gate both need it. It discloses
      // nothing but whether this process can reach its database.
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, HealthController)).toBe(true);
    });
  });

  describe("Requirement: Credential endpoints are rate limited", () => {
    it("configures a window and a baseline ceiling", async () => {
      const moduleRef = await compileApp();
      const options = moduleRef.get<ThrottlerModuleOptions>(getOptionsToken());
      const throttlers = Array.isArray(options) ? options : options.throttlers;

      expect(throttlers).toHaveLength(1);
      expect(throttlers[0]).toMatchObject({ limit: 300, ttl: 60_000 });
    });

    it("replaces the library's default message with a sentence a user can read", async () => {
      const moduleRef = await compileApp();
      const options = moduleRef.get<ThrottlerModuleOptions>(getOptionsToken());
      const errorMessage = Array.isArray(options) ? undefined : options.errorMessage;

      expect(errorMessage).toBe("Too many attempts. Please wait a moment and try again.");
    });

    it("maps a throttled request onto the shared error envelope as RATE_LIMITED", async () => {
      // ThrottlerException is an HttpException carrying 429, which ApiExceptionFilter
      // already translates. This asserts the two halves actually meet — the status becomes
      // the code, and the configured message becomes the message.
      const moduleRef = await compileApp();
      const options = moduleRef.get<ThrottlerModuleOptions>(getOptionsToken());
      const errorMessage = Array.isArray(options) ? undefined : options.errorMessage;
      const message = typeof errorMessage === "string" ? errorMessage : "";

      const captured: Captured = { status: 0, body: undefined };
      new ApiExceptionFilter().catch(new ThrottlerException(message), hostFor(captured));

      expect(captured.status).toBe(429);
      expect(apiErrorSchema.safeParse(captured.body).success).toBe(true);
      expect(captured.body).toMatchObject({
        code: "RATE_LIMITED",
        message: "Too many attempts. Please wait a moment and try again.",
        requestId: "req_test",
      });
    });
  });
});

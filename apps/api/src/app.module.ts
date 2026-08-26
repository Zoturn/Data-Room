import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthModule } from "./auth/auth.module";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { ConfigModule } from "./config/config.module";
import { PrismaModule } from "./prisma/prisma.module";
import { HealthModule } from "./health/health.module";
import { OriginGuard } from "./common/origin.guard";
import { RequestIdMiddleware } from "./common/request-id.middleware";

/** The window every rate limit is measured over, here and on the credential endpoints. */
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * The baseline ceiling per client per endpoint. Deliberately far above anything an
 * interface produces — it exists so that a new endpoint is rate limited because nobody did
 * anything, in the same way a new endpoint is authenticated because nobody did anything.
 * The credential endpoints tighten it with `@Throttle`; see `AuthController`.
 */
const BASELINE_REQUESTS_PER_WINDOW = 300;

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    // In-memory, so the limit is per instance. With more than one instance this needs a
    // shared store — a real change, not a config tweak. See auth-and-guards.md rule 13.
    ThrottlerModule.forRoot({
      throttlers: [{ limit: BASELINE_REQUESTS_PER_WINDOW, ttl: RATE_LIMIT_WINDOW_MS }],
      // Without this the client would receive "ThrottlerException: Too Many Requests",
      // which is a class name, not a sentence. The status is already 429, which
      // ApiExceptionFilter turns into `code: "RATE_LIMITED"`; this supplies the `message`
      // half of the same envelope.
      errorMessage: "Too many attempts. Please wait a moment and try again.",
    }),
    AuthModule,
    HealthModule,
  ],
  providers: [
    // Order is execution order. The limiter runs first so a flood is rejected before any
    // token verification is attempted — the cheap check guards the expensive one.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Before authentication, because this decides whether the request should be honoured at
    // all. CORS does not: it withholds response headers, it does not refuse a CORS-simple
    // request, so a cross-site form post still reaches the handler and its Set-Cookie still
    // lands. On /auth/login that means signing a victim into the attacker's account.
    { provide: APP_GUARD, useClass: OriginGuard },
    // Registered once, globally, so an endpoint is protected because nobody did anything.
    // Exposure requires an explicit `@Public()`, which is a security decision with a reason
    // attached. Per-controller `@UseGuards` is the anti-pattern this replaces: one omission
    // and a route is open, and nothing fails to tell you.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}

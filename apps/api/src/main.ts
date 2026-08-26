import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { ApiExceptionFilter } from "./common/errors/api-exception.filter";
import { ConfigService } from "./config/config.service";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  app.setGlobalPrefix("api");
  app.useGlobalFilters(new ApiExceptionFilter());
  app.use(cookieParser());

  // Credentialed CORS needs an explicit origin — a wildcard is refused by the browser
  // whenever cookies are involved. See apps/api/.claude/rules/auth-and-guards.md.
  app.enableCors({
    origin: config.get("CORS_ORIGINS"),
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept"],
    exposedHeaders: ["x-request-id"],
  });

  app.enableShutdownHooks();

  const port = config.get("PORT");

  // Bind every interface, not just the loopback. A container platform's proxy reaches the
  // process from outside the container, and a default bind leaves it unreachable — the
  // service reports healthy while every request returns 502 "Application failed to respond".
  await app.listen(port, "0.0.0.0");

  new Logger("Bootstrap").log(`API listening on 0.0.0.0:${port}, routes under /api`);
}

// A configuration failure must stop the process before it listens, so a broken deploy
// fails loudly instead of serving errors that look like application bugs.
bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  // The Nest logger may not exist yet at this point, so write straight to stderr.
  console.error(`\nAPI failed to start.\n\n${message}\n`);
  process.exit(1);
});

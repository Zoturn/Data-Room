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
  await app.listen(port);

  new Logger("Bootstrap").log(`API listening on http://localhost:${port}/api`);
}

// A configuration failure must stop the process before it listens, so a broken deploy
// fails loudly instead of serving errors that look like application bugs.
bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  // The Nest logger may not exist yet at this point, so write straight to stderr.
  console.error(`\nAPI failed to start.\n\n${message}\n`);
  process.exit(1);
});

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * The only holder of a Prisma connection. Repositories inject this; nothing else does.
 * See apps/api/.claude/rules/nestjs-architecture.md.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    // Connect eagerly so a healthy start is a real one, but do not let a database
    // outage stop the process: the spec requires GET /health to answer 503 with
    // "database": "down", which is impossible if the app never listens. Prisma
    // reconnects on demand, so a later request recovers by itself.
    try {
      await this.$connect();
      this.logger.log("Database connected");
    } catch (error) {
      this.logger.error(
        `Database unavailable at startup; serving in degraded mode. ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Close the pool on shutdown so a redeploy does not leave connections behind —
    // Supabase's pooler has a modest connection ceiling.
    await this.$disconnect();
  }

  /** Cheap round trip used by the health endpoint. */
  async isReachable(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.warn(`Database unreachable: ${error instanceof Error ? error.message : error}`);
      return false;
    }
  }
}

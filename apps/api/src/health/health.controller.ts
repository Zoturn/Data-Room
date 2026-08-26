import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import { PrismaService } from "../prisma/prisma.service";

type HealthBody = {
  status: "ok" | "degraded";
  database: "up" | "down";
};

/**
 * Unauthenticated by design: deploy platforms poll it, and Cypress uses it as a readiness
 * gate before running a spec. It reports database reachability rather than just "the process
 * is alive", because a paused Supabase project is the failure a reviewer is most likely to hit.
 */
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthBody> {
    const databaseUp = await this.prisma.isReachable();

    if (!databaseUp) {
      res.status(503);
      return { status: "degraded", database: "down" };
    }

    return { status: "ok", database: "up" };
  }
}

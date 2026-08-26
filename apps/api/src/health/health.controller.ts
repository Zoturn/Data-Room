import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import { Public } from "../auth/public.decorator";
import { PrismaService } from "../prisma/prisma.service";

type HealthBody = {
  status: "ok" | "degraded";
  database: "up" | "down";
};

/**
 * Unauthenticated by design: deploy platforms poll it, and Cypress uses it as a readiness
 * gate before running a spec. It reports database reachability rather than just "the process
 * is alive", because a paused Supabase project is the failure a reviewer is most likely to hit.
 *
 * `@Public()` is the security decision: the global JWT guard would otherwise answer 401 to
 * the platform's health probe and to Cypress's readiness gate, and a service that cannot
 * report its own health gets restarted forever. It discloses only whether this process can
 * reach its database — no identity, no resource, nothing about who or what exists.
 */
@Public()
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

import { Test } from "@nestjs/testing";
import type { Response } from "express";
import { HealthController } from "./health.controller";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Named after the scenarios in
 * openspec/changes/add-project-foundation/specs/platform-foundation/spec.md, so the mapping
 * from requirement to test is visible.
 *
 * No database is needed: the controller takes PrismaService by injection, so the degraded
 * path is a stub returning false.
 */
type StubResponse = Response & { statusCode?: number };

function stubResponse(): StubResponse {
  const recorded: { statusCode?: number } = {};
  return {
    status(code: number) {
      recorded.statusCode = code;
      return this;
    },
    get statusCode() {
      return recorded.statusCode;
    },
  } as unknown as StubResponse;
}

async function controllerWith(isReachable: () => Promise<boolean>): Promise<HealthController> {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: PrismaService, useValue: { isReachable } }],
  }).compile();

  return moduleRef.get(HealthController);
}

describe("HealthController", () => {
  describe("Scenario: Healthy service", () => {
    it("reports ok and does not override the status code", async () => {
      const controller = await controllerWith(async () => true);
      const res = stubResponse();

      const body = await controller.check(res);

      expect(body).toEqual({ status: "ok", database: "up" });
      expect(res.statusCode).toBeUndefined();
    });
  });

  describe("Scenario: Database unavailable", () => {
    it("responds 503 and says the database is down", async () => {
      // This is the branch the deploy platform's health check and the Cypress readiness
      // gate both depend on. A refactor that drops the status(503) would otherwise leave
      // every suite green while the API reported success over a dead database.
      const controller = await controllerWith(async () => false);
      const res = stubResponse();

      const body = await controller.check(res);

      expect(res.statusCode).toBe(503);
      expect(body).toEqual({ status: "degraded", database: "down" });
    });
  });
});

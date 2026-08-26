import { PrismaService } from "./prisma.service";

/**
 * `isReachable` is what GET /health reports on. It must turn a connection failure into
 * `false` rather than letting it propagate — a throw here would surface as a 500 instead
 * of the specified 503, and the platform's health check would read it as an outage of the
 * service rather than of its database.
 */
describe("PrismaService.isReachable", () => {
  const originalUrl = process.env["DATABASE_URL"];

  beforeAll(() => {
    // Prisma validates the datasource URL when the client is constructed. This is never
    // connected to — every query below is stubbed.
    process.env["DATABASE_URL"] ??= "postgresql://user:pass@localhost:5432/db";
  });

  afterAll(() => {
    if (originalUrl === undefined) delete process.env["DATABASE_URL"];
    else process.env["DATABASE_URL"] = originalUrl;
  });

  it("reports true when the round trip succeeds", async () => {
    const service = new PrismaService();
    jest.spyOn(service, "$queryRaw").mockResolvedValue([{ "?column?": 1 }]);

    await expect(service.isReachable()).resolves.toBe(true);
  });

  it("reports false instead of throwing when the database is unreachable", async () => {
    const service = new PrismaService();
    jest
      .spyOn(service, "$queryRaw")
      .mockRejectedValue(new Error("Can't reach database server at localhost:5432"));
    jest.spyOn(service["logger"], "warn").mockImplementation(() => undefined);

    await expect(service.isReachable()).resolves.toBe(false);
  });
});

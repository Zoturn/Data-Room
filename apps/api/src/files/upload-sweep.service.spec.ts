import { Test } from "@nestjs/testing";
import { ConfigService, ENV_SOURCE } from "../config/config.service";
import { InMemoryStorageService } from "../storage/in-memory-storage.service";
import { StorageService } from "../storage/storage.service";
import { BlobReleaseQueue } from "./blob-release.queue";
import { BlobReleaseService } from "./blob-release.service";
import { FilesRepository } from "./files.repository";
import { UploadSweepService } from "./upload-sweep.service";

/**
 * The sweep's two promises: it is safe to run twice, and it never destroys a committed file.
 *
 * Both are properties of the *sequence* — the row is deleted before its object, and only the
 * run that removed the row may release the bytes — so they are tested through `sweep()` with a
 * substituted repository rather than through the timer, which exists only to call this.
 */
type Reservation = { id: string; storageKey: string | null };

type RepositoryStub = {
  findExpiredReservations: jest.Mock<Promise<Reservation[]>, [Date, number]>;
  deleteReservation: jest.Mock<Promise<boolean>, [string]>;
};

const STALE: Reservation[] = [
  { id: "11111111-1111-4111-8111-111111111111", storageKey: "room-a/file-one" },
  { id: "22222222-2222-4222-8222-222222222222", storageKey: "room-a/file-two" },
];

function buildRepository(stale: Reservation[] = STALE): RepositoryStub {
  const remaining = [...stale];

  return {
    // Drains, so a second run finds nothing — which is what the real query does once the rows
    // are gone, and the only honest way to test "safe to run twice".
    findExpiredReservations: jest.fn<Promise<Reservation[]>, [Date, number]>(async () => {
      const batch = remaining.splice(0, remaining.length);
      return batch;
    }),
    deleteReservation: jest.fn<Promise<boolean>, [string]>().mockResolvedValue(true),
  };
}

type Harness = {
  sweep: UploadSweepService;
  storage: InMemoryStorageService;
  queue: BlobReleaseQueue;
  repository: RepositoryStub;
};

async function buildHarness(repository: RepositoryStub = buildRepository()): Promise<Harness> {
  const storage = new InMemoryStorageService();

  const moduleRef = await Test.createTestingModule({
    providers: [
      UploadSweepService,
      BlobReleaseService,
      BlobReleaseQueue,
      ConfigService,
      { provide: FilesRepository, useValue: repository },
      { provide: StorageService, useValue: storage },
      {
        provide: ENV_SOURCE,
        useValue: {
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://user:pass@localhost:6543/db",
          DIRECT_URL: "postgresql://user:pass@localhost:5432/db",
          WEB_APP_URL: "https://app.test",
          CORS_ORIGINS: "https://app.test",
          JWT_ACCESS_SECRET: "a-test-secret-of-at-least-thirty-two-chars",
          SUPABASE_URL: "https://project.supabase.co",
          SUPABASE_SECRET_KEY: "a-test-service-role-key",
        },
      },
    ],
  }).compile();

  return {
    sweep: moduleRef.get(UploadSweepService),
    storage,
    queue: moduleRef.get(BlobReleaseQueue),
    repository,
  };
}

describe("UploadSweepService", () => {
  describe("Requirement: The sweep reclaims abandoned reservations", () => {
    it("expires every stale reservation and releases its object", async () => {
      const { sweep, storage } = await buildHarness();
      storage.putObject("room-a/file-one", new Uint8Array([1]), "application/pdf");
      storage.putObject("room-a/file-two", new Uint8Array([2]), "application/pdf");

      const report = await sweep.sweep();

      expect(report.expiredReservations).toBe(2);
      expect(report.releasedObjects).toBe(2);
      expect(await storage.statObject("room-a/file-one")).toBeNull();
    });

    it("leaves a reservation with no object alone rather than releasing a key it never had", async () => {
      const { sweep } = await buildHarness(buildRepository([{ id: "abc", storageKey: null }]));

      const report = await sweep.sweep();

      expect(report.expiredReservations).toBe(1);
      expect(report.releasedObjects).toBe(0);
    });
  });

  describe("Requirement: The sweep is safe to run twice", () => {
    it("changes nothing on a second run over the same data", async () => {
      const { sweep } = await buildHarness();

      const first = await sweep.sweep();
      const second = await sweep.sweep();

      expect(first.expiredReservations).toBe(2);
      // Idempotence is the property that lets this be a dumb timer rather than a job with
      // state: a second pass finds no expired rows and an empty queue, and reports nothing.
      expect(second).toEqual({
        expiredReservations: 0,
        releasedObjects: 0,
        deferredObjects: 0,
      });
    });
  });

  describe("Requirement: A commit that wins the race keeps its bytes", () => {
    it("does not release the object of a reservation that committed mid-sweep", async () => {
      const repository = buildRepository();
      // The delete matched nothing: between the scan and here, this row went READY.
      repository.deleteReservation.mockResolvedValue(false);

      const { sweep, storage } = await buildHarness(repository);
      storage.putObject("room-a/file-one", new Uint8Array([1]), "application/pdf");

      const report = await sweep.sweep();

      expect(report.expiredReservations).toBe(0);
      expect(report.releasedObjects).toBe(0);
      // The committed file's bytes are exactly where its READY row expects them.
      expect(await storage.statObject("room-a/file-one")).not.toBeNull();
    });
  });

  describe("Requirement: Deletions storage refused are retried, not forgotten", () => {
    it("drains the queue and reports what storage still would not take", async () => {
      const { sweep, storage, queue } = await buildHarness(buildRepository([]));
      jest.spyOn(storage, "deleteObject").mockRejectedValue(new Error("storage unavailable"));
      queue.record("room-a/orphan");

      const report = await sweep.sweep();

      expect(report.releasedObjects).toBe(0);
      // Re-recorded rather than dropped, so the next run tries again.
      expect(report.deferredObjects).toBe(1);
    });
  });
});

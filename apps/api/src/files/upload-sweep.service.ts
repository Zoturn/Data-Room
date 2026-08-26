import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "../config/config.service";
import { BlobReleaseQueue } from "./blob-release.queue";
import { BlobReleaseService } from "./blob-release.service";
import { FilesRepository } from "./files.repository";

/**
 * How many reservations one run expires. Bounded so a backlog is drained over several runs
 * rather than in one long transaction that holds the database busy — the next run takes the
 * rest, which is exactly what "safe to run twice" buys.
 */
const SWEEP_BATCH = 200;

/** How often the timer fires. Well below the reservation window, so nothing waits long. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** What one run did, so a caller — or a test — can assert on it rather than on log lines. */
export type SweepReport = {
  expiredReservations: number;
  releasedObjects: number;
  /** Keys that storage still refused; back on the queue for the next run. */
  deferredObjects: number;
};

/**
 * The cleanup routine: expire abandoned reservations and retry deletions storage refused.
 *
 * Idempotent by construction. A second run over the same data finds no expired rows and an
 * empty queue, so it changes nothing and reports nothing — which is the property that lets
 * this be a dumb timer rather than a job with state.
 *
 * It never touches a `READY` node. Every delete carries the `PENDING` clause, so a commit
 * that lands between the scan and the delete simply wins, and its object is left alone.
 *
 * In-process and therefore per instance: with more than one API instance this needs a lock or
 * an external scheduler, because two timers would race over the same rows. Harmless today —
 * the delete guard makes a lost race a no-op — but it would double the storage calls.
 */
@Injectable()
export class UploadSweepService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(UploadSweepService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly files: FilesRepository,
    private readonly blobs: BlobReleaseService,
    private readonly queue: BlobReleaseQueue,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    // Not under test: a timer that outlives a suite keeps Jest's process alive, and the sweep
    // is exercised by calling `sweep()` directly, which is the honest way to test it anyway.
    if (this.config.get("NODE_ENV") === "test") return;

    this.timer = setInterval(() => {
      void this.sweep().catch((error: unknown) => {
        // A failed sweep is not a failed request. It logs and the next tick tries again.
        this.logger.error(
          `Sweep failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, SWEEP_INTERVAL_MS);

    // The process must still be able to exit while this timer is pending.
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  async sweep(): Promise<SweepReport> {
    // One run at a time. Overlapping runs would both scan the same rows; the delete guard
    // makes that safe but not free.
    if (this.running) return { expiredReservations: 0, releasedObjects: 0, deferredObjects: 0 };
    this.running = true;

    try {
      const expired = await this.expireReservations();
      const retried = await this.retryFailedReleases();

      return {
        expiredReservations: expired.expiredReservations,
        releasedObjects: expired.releasedObjects + retried,
        deferredObjects: this.queue.size,
      };
    } finally {
      this.running = false;
    }
  }

  /**
   * Reservations past the upload window: the row first, then — only if this run is the one
   * that removed the row — its object. A reservation that committed in the meantime is no
   * longer `PENDING`, the delete matches nothing, and its bytes are left where they belong.
   */
  private async expireReservations(): Promise<Omit<SweepReport, "deferredObjects">> {
    const cutoff = new Date(Date.now() - this.config.get("UPLOAD_RESERVATION_TTL_SECONDS") * 1000);
    const stale = await this.files.findExpiredReservations(cutoff, SWEEP_BATCH);

    let expiredReservations = 0;
    let releasedObjects = 0;

    for (const reservation of stale) {
      // Deleted one at a time rather than by `id: { in: [...] }`, because a batch delete
      // reports only a count — it cannot say *which* rows were still `PENDING`, and this run
      // must not delete the object of one that raced to `READY`.
      const removed = await this.files.deleteReservation(reservation.id);
      if (!removed) continue;

      expiredReservations += 1;

      // A reservation with no key never had an object to release.
      if (reservation.storageKey === null) continue;
      if (await this.blobs.release(reservation.storageKey)) releasedObjects += 1;
    }

    if (expiredReservations > 0) {
      this.logger.log(`Expired ${expiredReservations} abandoned upload reservation(s).`);
    }

    return { expiredReservations, releasedObjects };
  }

  /**
   * The other half: keys whose object survived its node because storage was unavailable at
   * the time. Draining and re-recording is what keeps one run from retrying the same key in a
   * loop of its own — a key that fails again is simply next run's problem.
   */
  private async retryFailedReleases(): Promise<number> {
    const keys = this.queue.drain();
    if (keys.length === 0) return 0;

    // `release` re-records whatever still fails, so the queue rebuilds itself from the
    // failures alone rather than from the whole batch.
    return this.blobs.releaseAll(keys);
  }
}

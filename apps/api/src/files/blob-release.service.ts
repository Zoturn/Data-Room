import { Injectable, Logger } from "@nestjs/common";
import { StorageService } from "../storage/storage.service";
import { BlobReleaseQueue } from "./blob-release.queue";

/**
 * The one way an object is removed from storage.
 *
 * Every caller has already committed a metadata change by the time it gets here, so this
 * never throws: a storage outage must not surface as a failed delete for an owner whose file
 * is already gone (file-upload-storage.md rule 10). The key is parked on the queue instead
 * and the sweep retries it.
 *
 * It is also idempotent by construction — deleting an object that is already gone is not an
 * error at the provider, and a key the queue holds twice is one entry.
 */
@Injectable()
export class BlobReleaseService {
  private readonly logger = new Logger(BlobReleaseService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly queue: BlobReleaseQueue,
  ) {}

  /** Best-effort. Returns whether the object is gone now rather than queued for later. */
  async release(key: string): Promise<boolean> {
    try {
      await this.storage.deleteObject(key);
      return true;
    } catch (error) {
      this.queue.record(key);
      // The key, never a signed URL: a URL in a log line is a credential with a lifetime
      // (file-upload-storage.md rule 8).
      this.logger.warn(
        `Storage object ${key} could not be released; queued for the sweep. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  /** The subtree case: a folder deletion frees every object below it. */
  async releaseAll(keys: readonly string[]): Promise<number> {
    let released = 0;

    for (const key of keys) {
      if (await this.release(key)) released += 1;
    }

    return released;
  }
}

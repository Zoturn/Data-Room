import { Injectable } from "@nestjs/common";

/**
 * Storage keys whose object could not be deleted at the moment the metadata went away.
 *
 * Deleting a row is transactional; deleting an object is a network call that can time out.
 * The two must not be tied together — a storage outage must never resurrect a file the owner
 * has already confirmed deleting (file-upload-storage.md rule 10) — so the key is parked here
 * and the sweep retries it.
 *
 * In memory, and therefore per instance: a restart forgets the queue and its objects become
 * orphans that nothing points at. That is an accepted cost at one instance and one bucket,
 * and the durable replacement is named in the change's design — a `pending_blob_deletions`
 * table drained by the same sweep. The seam is this class, so that swap touches nothing else.
 */
@Injectable()
export class BlobReleaseQueue {
  private readonly keys = new Set<string>();

  /** A set, so recording the same key twice queues one retry rather than two. */
  record(key: string): void {
    this.keys.add(key);
  }

  /**
   * Hands over everything queued and empties the queue in one step. The caller re-records
   * whatever still fails, which is what keeps one sweep run from retrying the same key
   * forever inside its own loop.
   */
  drain(): string[] {
    const pending = [...this.keys];
    this.keys.clear();

    return pending;
  }

  get size(): number {
    return this.keys.size;
  }
}

/**
 * The seam between this application and whatever holds the bytes.
 *
 * Everything above it — the upload pipeline, the sweep, the folder delete — talks in keys and
 * signed URLs and knows nothing about Supabase. That is what lets Jest exercise the whole
 * pipeline against `InMemoryStorageService` without a network, and what would make swapping
 * the provider a change to this directory alone.
 */

/** A URL that carries its own authorisation, and the moment it stops working. */
export type SignedUrl = {
  url: string;
  expiresAt: Date;
};

/** What the provider reports about a stored object. `contentType` is often absent; size never is. */
export type ObjectStat = {
  sizeBytes: number;
  contentType: string | null;
};

/**
 * An abstract class rather than an interface, because Nest resolves providers by runtime
 * token and an interface leaves nothing behind to inject. Consumers depend on this type and
 * receive whichever implementation `StorageModule` bound.
 */
export abstract class StorageService {
  /** A URL the browser may PUT to. Bytes never pass through this process. */
  abstract createUploadUrl(
    key: string,
    contentType: string,
    ttlSeconds: number,
  ): Promise<SignedUrl>;

  /** A URL the browser may GET. Minted only after access has already been checked. */
  abstract createDownloadUrl(key: string, ttlSeconds: number): Promise<SignedUrl>;

  /** Idempotent: removing an object that is already gone is a success, not an error. */
  abstract deleteObject(key: string): Promise<void>;

  /** `null` when there is no such object — which is how commit learns the PUT never landed. */
  abstract statObject(key: string): Promise<ObjectStat | null>;

  /**
   * The first `length` bytes. A range read rather than a full download because the only
   * caller wants five bytes of magic number, and fetching 50 MB to look at five of them
   * would make every commit as slow as the upload it follows.
   */
  abstract readRange(key: string, length: number): Promise<Uint8Array>;
}

/**
 * Where one file's bytes live.
 *
 * Built from two generated ids and never from the user's file name. A name is display
 * metadata: it can contain `/`, `..`, a NUL byte or 200 characters of Unicode, and any of
 * those reaching a storage path is a way to write outside the intended prefix or to collide
 * with another room's object (file-upload-storage.md rule 3). The name is stored in the
 * database column that is meant to hold it, and nowhere else.
 *
 * The room prefix is what makes a whole Data Room's objects listable and removable as one
 * unit, without a join back to the database.
 */
export function storageKeyFor(dataRoomId: string, nodeId: string): string {
  return `${dataRoomId}/${nodeId}`;
}

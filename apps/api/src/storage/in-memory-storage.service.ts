import { Injectable } from "@nestjs/common";
import { StorageService, type ObjectStat, type SignedUrl } from "./storage.service";

/**
 * The Jest double for storage, exported from `src` rather than from a test folder because
 * every module that touches files needs it and a fake living in one suite's directory gets
 * copied into the next.
 *
 * It is a real implementation of the contract, not a stub of one: `putObject` is what a PUT
 * to a signed upload URL would have done, so a spec can drive the whole intent → PUT → commit
 * sequence and the pipeline cannot tell the difference. That is the only way the commit
 * checks — the object is there, it is this big, it starts with these bytes — are exercised at
 * all, since none of them looks at the request.
 */
@Injectable()
export class InMemoryStorageService extends StorageService {
  private readonly objects = new Map<string, { body: Uint8Array; contentType: string | null }>();

  /**
   * Signed URLs the tests can assert on without parsing. The host is unroutable on purpose:
   * a spec that accidentally lets one reach the network fails loudly instead of hanging.
   */
  private readonly origin = "https://storage.invalid";

  /** Set by a spec to make the next call fail, which is how the retry paths are reached. */
  failNextDelete = false;

  createUploadUrl(key: string, contentType: string, ttlSeconds: number): Promise<SignedUrl> {
    // The content type is part of the signature at the real provider, so it is recorded here
    // too — a spec that PUTs a different one is making a mistake worth catching.
    return Promise.resolve({
      url: `${this.origin}/upload/${encodeURI(key)}?type=${encodeURIComponent(contentType)}`,
      expiresAt: this.expiryFor(ttlSeconds),
    });
  }

  createDownloadUrl(key: string, ttlSeconds: number): Promise<SignedUrl> {
    return Promise.resolve({
      url: `${this.origin}/download/${encodeURI(key)}`,
      expiresAt: this.expiryFor(ttlSeconds),
    });
  }

  deleteObject(key: string): Promise<void> {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      return Promise.reject(new Error("Storage is unavailable."));
    }

    // Not an error when nothing is there. The real provider behaves the same way, and the
    // sweep depends on it: retrying a deletion that already succeeded must be a no-op.
    this.objects.delete(key);
    return Promise.resolve();
  }

  statObject(key: string): Promise<ObjectStat | null> {
    const stored = this.objects.get(key);
    if (stored === undefined) return Promise.resolve(null);

    return Promise.resolve({ sizeBytes: stored.body.length, contentType: stored.contentType });
  }

  readRange(key: string, length: number): Promise<Uint8Array> {
    const stored = this.objects.get(key);
    // An empty read rather than a throw, matching a provider answering 416 for a range past
    // the end of a missing object: the caller decides what absence means.
    if (stored === undefined) return Promise.resolve(new Uint8Array(0));

    return Promise.resolve(stored.body.slice(0, length));
  }

  /** Stands in for the browser's PUT to the signed URL. */
  putObject(key: string, body: Uint8Array, contentType: string | null = null): void {
    this.objects.set(key, { body, contentType });
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }

  get storedKeys(): string[] {
    return [...this.objects.keys()];
  }

  clear(): void {
    this.objects.clear();
    this.failNextDelete = false;
  }

  private expiryFor(ttlSeconds: number): Date {
    return new Date(Date.now() + ttlSeconds * 1000);
  }
}

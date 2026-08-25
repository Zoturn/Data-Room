---
paths:
  - "apps/api/src/storage/**/*.ts"
  - "apps/api/src/files/**/*.ts"
---

# File upload and blob storage

**Scope:** the storage boundary, the upload pipeline, and the lifecycle of stored objects.

## Rules

1. File bytes never pass through the API process. Uploads go browser → storage via a signed URL; downloads go storage → browser via a signed URL. The API moves metadata and permissions only.
2. All provider access goes through the `StorageService` interface. Nothing outside `src/storage/` imports the Supabase SDK, so the provider stays replaceable and Jest can substitute an in-memory fake.
3. Storage keys are server-generated as `dataRoomId/nodeId` and never derived from a user-supplied name. A file name is display metadata; it must not be able to influence where bytes land.
4. Uploads are three steps — intent, PUT, commit — and the intent reserves a `PENDING` node **before** any bytes exist. The reservation is what holds the name; two concurrent uploads of the same name are arbitrated by the unique index, not by a check-then-insert.
5. Type is verified at commit by reading the stored object's first bytes and requiring `%PDF-`. A declared content type or an extension is a client hint, never the authority.
6. Size is enforced twice: at intent from the declared size, and at commit from the object's real size. Only the second one is trustworthy.
7. A failed commit deletes both the reservation and the uploaded object. A file that cannot be validated must leave nothing behind.
8. Signed URLs are short-lived and single-purpose. Never log a full signed URL, never cache one past its expiry, and never hand one user a URL minted for another.
9. Check access _before_ signing a download URL. Signing first and authorising afterwards has already leaked the object.
10. Blob deletion is best-effort and idempotent, performed after the metadata transaction commits. A storage failure must not roll back a delete the user has confirmed; record the key and let the sweep retry it.
11. The sweep expires stale `PENDING` reservations and retries failed deletions. It must be safe to run twice and must never touch a `READY` node. It runs in-process today — with more than one instance it needs a lock or an external scheduler.
12. `PENDING` nodes are excluded from every listing, search and share query. A reservation is not a file.

## Examples

```ts
export interface SignedUpload {
  url: string;
  expiresAt: Date;
}

export abstract class StorageService {
  abstract createUploadUrl(
    key: string,
    opts: { contentType: string; maxBytes: number },
  ): Promise<SignedUpload>;
  abstract createDownloadUrl(
    key: string,
    opts: { fileName: string; ttlSeconds: number },
  ): Promise<string>;
  abstract readRange(key: string, start: number, end: number): Promise<Buffer>;
  abstract statObject(key: string): Promise<{ sizeBytes: number } | null>;
  abstract deleteObject(key: string): Promise<void>;
}
```

```ts
// commit: the object is the source of truth, not the client
const head = await this.storage.readRange(node.storageKey, 0, 4);
if (!head.subarray(0, 5).equals(PDF_MAGIC)) {
  await this.discardReservation(node);
  throw new UnsupportedFileTypeError();
}
```

## Anti-patterns

- `@UseInterceptors(FileInterceptor(...))` streaming uploads through the API.
- Trusting `file.mimetype` from the client as the type check.
- Building a storage key from the file name.
- Deleting a node inside a transaction that also awaits a storage call.
- Issuing a download URL and then checking whether the caller was allowed to have it.

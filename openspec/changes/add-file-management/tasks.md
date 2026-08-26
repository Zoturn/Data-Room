## 1. Data model

- [ ] 1.1 Extend `Node` with `storageKey`, `contentType`, `checksum` and `uploadState` (`PENDING` | `READY`)
- [ ] 1.2 Add the partial index on `uploadState = 'PENDING'` for the sweep, and exclude `PENDING` rows from every listing query
- [ ] 1.3 Add the check constraint that `FILE` rows carry storage columns and `FOLDER` rows do not
- [ ] 1.4 Run the migration

## 2. Storage module

- [ ] 2.1 Define the `StorageService` interface: `createUploadUrl`, `createDownloadUrl`, `deleteObject`, `statObject`, `readRange`
- [ ] 2.2 Implement it over Supabase Storage with a private bucket and configured expiries
- [ ] 2.3 Implement the in-memory fake used by Jest
- [ ] 2.4 Implement the key layout `dataRoomId/nodeId` and prove it ignores the user-supplied name
- [ ] 2.5 Add bucket provisioning to the deployment runbook: private bucket, allowed MIME `application/pdf`, size limit at the bucket as well as in the API

## 3. Upload pipeline

- [ ] 3.1 Implement name conflict resolution: split stem and extension, probe the next free ` (n)` index, retry once on unique violation
- [ ] 3.2 `POST /files/upload-intent` — validate name, declared type and size, reserve the `PENDING` node, return the signed URL, the reserved name and the expiry
- [ ] 3.3 `POST /files/:id/commit` — confirm the object exists, sniff `%PDF-`, record the real size, flip to `READY`, delete the reservation and object on failure
- [ ] 3.4 Enforce the maximum size at intent and re-check the actual size at commit
- [ ] 3.5 Implement the sweep: expire `PENDING` reservations past the window, delete their objects, retry previously failed blob deletions, idempotently

## 4. File endpoints

- [ ] 4.1 `GET /files/:id` — metadata plus breadcrumbs
- [ ] 4.2 `GET /files/:id/content-url` — check access first, then issue a short-lived signed download URL
- [ ] 4.3 `PATCH /files/:id` — rename the stem, preserve the extension, resolve conflicts
- [ ] 4.4 `POST /files/:id/move` — validate the destination folder and Data Room, resolve the name, update parent, path and depth in one transaction
- [ ] 4.5 `DELETE /files/:id` — delete the node, release the blob best-effort
- [ ] 4.6 Return the resolved name on every operation that renamed something implicitly

## 5. Upload experience

- [ ] 5.1 Build the XHR upload transport: promise wrapper, `upload.onprogress`, `abort()`, typed errors
- [ ] 5.2 Build the upload queue store: per-file state, bounded concurrency, cancel, retry
- [ ] 5.3 Build the drop zone over the folder view with a highlighted target naming the destination, plus a file picker fallback
- [ ] 5.4 Support dropping onto a folder row to upload into that folder
- [ ] 5.5 Build the upload panel: one row per file with progress, resolved name, error and per-row cancel/retry
- [ ] 5.6 Reject non-PDF and oversized files client-side before requesting an intent, with a message naming the limit
- [ ] 5.7 Warn before navigating away while uploads are in flight
- [ ] 5.8 Refresh the folder listing as each file commits, without disturbing scroll position

## 6. File interface

- [ ] 6.1 Build the file viewer route: inline PDF from the signed URL, file name in the header, download action, and a fallback when the browser cannot render it
- [ ] 6.2 Handle an expired content URL by requesting a fresh one
- [ ] 6.3 Build the rename dialog editing the stem only, with the extension shown and preserved
- [ ] 6.4 Build the move dialog: folder picker within the Data Room, disallow non-folder targets, report the resolved name
- [ ] 6.5 Build the delete confirmation naming the file
- [ ] 6.6 Add the "file is no longer available" state for a file deleted while open
- [ ] 6.7 Virtualise the contents list so a folder of many thousands of rows stays responsive

## 7. Tests

- [ ] 7.1 Jest — conflict resolution: first, repeated, case-insensitive, extension preserved, unicode names
- [ ] 7.2 Jest — magic-byte validation accepts a real PDF and rejects a renamed non-PDF
- [ ] 7.3 Jest — commit failure removes the reservation and the object
- [ ] 7.4 Jest — move validation: non-folder target, cross-Data-Room target, same-folder no-op, path and depth after the move
- [ ] 7.5 Jest — sweep expires only stale `PENDING` rows and is safe to run twice
- [ ] 7.6 Cypress API — intent → PUT → commit happy path; oversized and disguised files rejected; concurrent same-name uploads both survive under distinct names
- [ ] 7.7 Cypress API — content URL is refused for a user without access
- [ ] 7.8 Cypress component — upload row progress, cancel, retry and error rendering
- [ ] 7.9 Cypress e2e — drag and drop several PDFs, watch per-file progress, see them listed, view one, rename, move, delete

## 8. Close out

- [ ] 8.1 Add the storage variables to `.env.example` and the bucket setup to the README
- [ ] 8.2 Write the 100,000-file answer into the README's "How it scales" section
- [ ] 8.3 Run `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e` clean
- [ ] 8.4 Run `openspec validate --all --strict`
- [ ] 8.5 Archive the change and act on everything the docs-sync hook reports

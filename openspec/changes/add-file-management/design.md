## Context

The tree exists and is owner-scoped. This change adds the payload: PDFs, stored in Supabase Storage, represented as `FILE` nodes so they inherit naming, listing, moving and — next change — sharing without a second code path. The brief calls out the upload experience specifically (multiple files, drag-and-drop, per-file progress), and the README must explain what happens when one Data Room holds 100,000 files, which is answered below.

The binding constraint is that the API runs on a small instance: streaming hundreds of megabytes through it is both slow and a memory risk, so the bytes must not go through the API at all.

## Goals / Non-Goals

**Goals:**
- Uploads that never block on the API process and never lose one file because another failed.
- Name conflicts resolved predictably, in a way a user recognises from every desktop file manager.
- A listing that stays fast at six figures of files.
- Files that cannot lie about their type, and blobs that do not outlive their rows.

**Non-Goals:**
- Resumable or chunked uploads for very large files. PDFs in this product are tens of megabytes.
- Thumbnails, text extraction, or full-text search of document content.
- Non-PDF types. The brief says PDF is enough; the validation is written so widening it is a configuration change.
- Copying files, and file versioning — versioning is deliberately deferred to `add-search-and-versioning`.

## Decisions

### Three-step upload: reserve → PUT → commit
`POST /files/upload-intent` validates the name, type and size, resolves conflicts, inserts a `PENDING` file node and returns `{ nodeId, uploadUrl, expiresAt }`. The browser PUTs the bytes to storage with progress from `XMLHttpRequest`'s `upload.onprogress`. `POST /files/:id/commit` verifies the object exists, sniffs its magic bytes, records the real size and flips the node to `READY`.

Reserving the node before the bytes exist is what makes conflict resolution correct: the unique index on `(parentId, normalizedName)` decides the winner between two simultaneous `report.pdf` uploads at reservation time, not after both have already spent bandwidth.
*Alternatives:* multipart POST through the API (simplest, and it puts every byte through a 512 MB instance — plus platform request-body limits); direct upload with no reservation (nothing holds the name, so two uploads race and the second overwrites); client-side signed URL minting (requires shipping storage credentials to the browser, which is disqualifying).

### Progress comes from XHR, not `fetch`
`fetch` still has no upload progress event. The upload transport is therefore `XMLHttpRequest`, wrapped in a promise, with `abort()` wired to the cancel control. This is the one place in the frontend that does not use the shared `fetch` client, and the rule says why.

### PDF verified by magic bytes at commit
The client filters by extension and declared MIME for a fast, friendly rejection, but the authoritative check reads the first bytes of the stored object at commit and requires `%PDF-`. Declared content type is attacker-controlled; the file that is actually stored is not.
*Cost:* one small ranged read from storage per upload — acceptable, and it makes "disguised file is caught" a real guarantee rather than a hope.

### Conflicts suffix, they do not reject
`report.pdf` → `report (1).pdf`, extension preserved, comparison case-insensitive. The brief asks that same-name uploads be handled; rejecting a 30-file drop because one name repeats is hostile, and silently overwriting destroys data. Suffixing is what Finder, Explorer and Drive all do, so it needs no explanation. The counter probes the next free index and relies on the unique index to arbitrate races, retrying once on violation.
*Alternative:* 409 and let the user rename (fine for one file, miserable for a batch); overwrite (silent data loss in a document vault — never).
*Note:* `add-search-and-versioning` offers versioning as an opt-in alternative for this same collision; the suffixing path stays the default.

### The extension is not part of the editable name
Rename edits the stem and re-attaches the original extension, so a user cannot turn `report.pdf` into `report` and break its viewer association. The dialog pre-selects the stem only.

### Answering the README: one Data Room with 100,000 files
Nothing in the model changes; four things carry the load.

*Listing stays per-folder and keyset-paginated.* The UI never asks for "all files in the Data Room" — it asks for the children of one folder, ordered by `(type, name, id)`, with the cursor encoding that tuple:

```sql
SELECT * FROM nodes
WHERE parent_id = $1 AND (type, name, id) > ($2, $3, $4)
ORDER BY type, name, id
LIMIT $5;
```

Cost is proportional to the page, not to the folder, and not to the Data Room. Deep offsets never appear because there is no page-number affordance; the list is infinite-scroll.

*The indexes are the ones the queries actually use.* `(parentId, type, name, id)` for listing and its cursor; unique `(parentId, normalizedName)` for conflicts; `(dataRoomId, path text_pattern_ops)` for subtree aggregates, recursive delete and scoped search. Every hot query is an index range scan.

*Counts are not `COUNT(*)`.* A precise total over 100,000 rows on every folder open is wasted work: the header shows the subtree aggregate, computed from the path prefix and cached briefly, and is the first thing to become a maintained rollup (see `add-data-room-tree`'s design) when the scan cost stops being trivial.

*The client renders a window, not a list.* 100,000 DOM rows is a frontend failure independent of the database, so the contents list virtualises and fetches pages as the viewport advances.

What would change beyond this point: search moves from `ILIKE` to a trigram or tsvector index (that is `add-search-and-versioning`), aggregates become maintained counters, and blob cleanup becomes a queued job rather than a post-commit best-effort call.

### Move rewrites the path prefix in one transaction
A move validates that the destination is a `FOLDER` in the same Data Room, rejects a destination inside the moved node's own subtree (a file cannot contain anything, but the same method serves folder moves later), resolves the name at the destination, then updates the node's `parentId`, `path` and `depth` and rewrites descendants with a single prefix replacement. The storage key never changes, so moving is metadata-only and instant regardless of file size.

### Blob release is best-effort and swept
Deleting metadata is transactional; deleting objects is not, because a storage timeout must not resurrect a file the user deleted. Failed keys are recorded and re-attempted by the cleanup routine, which also expires `PENDING` reservations older than the upload window — that is what frees an abandoned name.

## Risks / Trade-offs

- **A `PENDING` node holds a name that may never be used.** A user who opens the picker and walks away blocks that name until the sweep. → Short reservation window, sweep on a timer, and `PENDING` rows never appear in listings.
- **The commit can be skipped.** A client that uploads bytes and never commits leaves an object with no `READY` row. → The sweep deletes reservation and object together; the object key is derived from the node id, so nothing is guessed.
- **Signed URL expiry versus slow connections.** A large file on a poor link can outlive its upload URL. → Expiry sized to the maximum file size at a pessimistic bandwidth, and the client re-requests an intent on an expiry error rather than failing the file.
- **The browser PUTs to a different origin than the API.** On S3 or R2 this would need a bucket CORS policy, and getting it wrong shows up as an opaque browser error. Supabase's hosted Storage exposes no CORS configuration at all and responds permissively by default, so there is nothing to set — but that also means an upload failure that *looks* like CORS is always something else (an expired signed URL, or a content type the bucket's allowed-MIME list rejects). → The deployment runbook says so explicitly, so nobody burns an afternoon looking for a setting that does not exist. Swapping to S3 later would reintroduce the requirement.
- **Inline PDF rendering varies by browser.** → Render in an object/iframe with the signed URL and fall back to an explicit download when the browser will not display it.
- **The storage service key is a full-bucket credential.** → Server-side only, never in the frontend bundle, and asserted by a test that greps the built client.

## Migration Plan

Additive migration adding nullable `storageKey`, `contentType`, `checksum` and `uploadState` to `nodes`, plus a partial index on `uploadState = 'PENDING'` for the sweep. Existing folder rows are unaffected. Provision the Supabase bucket as private before deploying the API, with its own allowed-MIME list (`application/pdf`) and size limit set at the bucket. Those duplicate the API's checks on purpose: the bucket is the last line, so a bug in commit-time validation still cannot store the wrong thing.

Rollback drops the columns and the bucket; only demo files exist at this stage.

## Open Questions

- Should the sweep run as an in-process interval or an external scheduled call? Interval is simplest at one instance; the rule notes the multi-instance caveat.
- Is a client-side page count worth showing in the viewer? Only if the PDF is parsed client-side — deferred unless the viewer feels bare.

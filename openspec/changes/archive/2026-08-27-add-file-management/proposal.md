## Why

A Data Room without documents is an empty filing cabinet. The tree exists; this change puts real PDFs in it, stored in blob storage rather than in the database, with the upload experience the brief singles out — several files at once, dropped onto the page, each showing its own progress.

## What Changes

- Add a storage abstraction over Supabase Storage with one implementation behind an interface, so the provider is swappable and can be faked in Jest.
- Upload in three steps: the API validates and reserves a node and issues a short-lived signed upload URL, the browser PUTs the bytes straight to storage, and the API commits the metadata. File bytes never pass through the API process.
- Extend `Node` with the file columns — storage key, MIME type, size, checksum and upload state — so a file is a node and inherits naming, listing, moving and sharing unchanged.
- Accept PDFs only, enforced by declared type, extension and magic-byte sniffing at commit, with a configurable size ceiling.
- Resolve name conflicts inside a folder by suffixing — `report.pdf`, `report (1).pdf` — chosen deliberately over rejecting the upload, and applied while preserving the extension.
- View a file in the UI through a short-lived signed download URL rendered inline, with an explicit download action.
- Rename a file, keeping its extension and resolving conflicts the same way.
- Move a file to another folder, rejecting a move into a non-folder or across Data Rooms, and resolving name conflicts at the destination.
- Delete a file and release its blob.
- Sweep reserved-but-never-committed uploads so abandoned rows and orphaned blobs do not accumulate.
- Build the upload experience: a drop zone over the folder view, a file picker, a queue with per-file progress, cancel, retry, and a clear per-file error state — plus the file viewer, rename and move dialogs, and the delete confirmation.

## Capabilities

### New Capabilities
- `file-storage`: the blob storage contract — signed upload and download URLs, key layout, lifecycle and orphan cleanup.
- `files`: file nodes — upload, validation, conflict resolution, viewing, renaming, moving and deletion.

### Modified Capabilities
None. `Node` gains columns, but no existing requirement changes behaviour.

## Impact

- `Node` gains nullable file columns and an upload-state column; a new migration.
- New dependency on the Supabase Storage client; new environment variables for the bucket, URL and service key.
- The service key grants full bucket access and must stay server-side only.
- Answers the README's second scaling question (100,000 files: listing, pagination, indexes) in this change's design.

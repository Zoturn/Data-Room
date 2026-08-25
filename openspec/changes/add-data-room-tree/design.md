## Context

This change introduces the domain itself: an owned Data Room and the hierarchy inside it. Every later change extends this shape — files become nodes, shares point at nodes, search filters nodes, versions hang off file nodes — so the modelling decisions here are the expensive ones to get wrong. The README must also answer how subtree size and item count are computed, and that answer is a direct consequence of the tree representation chosen below.

## Goals / Non-Goals

**Goals:**
- One representation that serves listing, breadcrumbs, subtree aggregates, recursive delete, moving and permission inheritance without a different trick for each.
- Cheap breadcrumbs and cheap subtree queries — both are on the hot path of the UI.
- Name collisions decided by the database, not by an application read-then-write race.
- A delete confirmation that states the true consequence before anything is destroyed.

**Non-Goals:**
- Trash, restore, or soft-delete recovery for folders. The brief asks for delete with a warning.
- Multiple Data Rooms per user in the UI. The model permits it; the interface shows one.
- Copying or duplicating subtrees.
- Per-folder permissions for other users — that is `add-sharing`.

## Decisions

### One `Node` table for folders and files
`Node { id, dataRoomId, parentId, type: FOLDER|FILE, name, normalizedName, path, depth, sizeBytes, createdAt, updatedAt }`, with file-specific storage columns added by the next change. Sharing, moving, naming, ordering and deletion then have one implementation instead of two near-identical ones, and a share can point at "a node" without a polymorphic target.
*Alternatives:* separate `Folder` and `File` tables (each row narrower and file columns not nullable, but every tree operation doubles and sharing needs a polymorphic reference); a document/JSON tree (fast to read whole, hopeless for pagination and per-node sharing).
*Cost accepted:* file columns are nullable on folder rows; a check constraint keeps them honest.

### Materialised path of ids, not names
`path` stores the ancestor id chain, `/<rootId>/<childId>/`, with `depth` alongside it. Two properties follow, both of which matter:
- **Rename is a single-row update.** Names never appear in a path, so renaming a folder with 50,000 descendants touches one row.
- **Subtree queries are one indexed range scan.** `WHERE path LIKE '/a/b/%'` on a `text_pattern_ops` index answers delete, aggregate and search-within-folder alike.

Breadcrumbs parse the ids out of the path and fetch them with one `WHERE id IN (...)`, so depth does not cost round trips.
*Alternatives:* adjacency list alone (trivial writes, but breadcrumbs and subtrees need recursive CTEs on every read — and the recursive delete of 100,000 rows is where that hurts); name-based paths (human-readable, but a rename rewrites the entire subtree); closure table (the most flexible, at one row per ancestor-descendant pair — the write amplification is not worth it here); Postgres `ltree` (a good fit, but Prisma has no native type for it and every query would drop to raw SQL).

### Name uniqueness enforced by a database constraint
A generated `normalizedName` column (trimmed, `lower()`, Unicode-normalised) with a unique index on `(parentId, normalizedName)`. The application catches the unique-violation and maps it to `409 NAME_CONFLICT`. A read-then-write check would let two concurrent uploads of `report.pdf` both pass their check and both insert.
*Alternative:* a case-sensitive unique index — cheaper, and it would let `Reports` and `reports` sit side by side in a folder, which reads as a bug.

### Answering the README: subtree size and item count
Two mechanisms, and the README explains why both exist.

*Now — computed on read.* One aggregate over the path prefix:

```sql
SELECT count(*) FILTER (WHERE type = 'FILE')   AS files,
       count(*) FILTER (WHERE type = 'FOLDER') AS folders,
       coalesce(sum(size_bytes), 0)            AS bytes
FROM nodes
WHERE data_room_id = $1 AND path LIKE $2 || '%';
```

With the `(dataRoomId, path)` index this is an index range scan over exactly the subtree — a few milliseconds at MVP scale, and correct by construction with no invariant to maintain. It is what the deletion preview calls, so the number in the confirmation dialog is never stale.

*At scale — denormalised rollups.* When a subtree reaches the tens of thousands, scanning it on every folder open stops being free. The path model upgrades without a schema rewrite: keep `descendantFileCount`, `descendantFolderCount` and `descendantBytes` on each folder, and on insert, delete or move apply the delta to every ancestor — the ancestors are already in the moved node's `path`, so it is one `UPDATE ... WHERE id = ANY(ancestors)` in the same transaction, bounded by depth rather than by subtree size. The trade is exactness for latency: counters can drift under partial failure, so a periodic reconciliation job recomputes them from the same prefix aggregate. MVP ships the exact query and documents the rollup as the next step, because correctness is worth more than milliseconds at 500 files and the reviewer asked how it scales, not that it already does.

### Recursive delete is one statement in one transaction
`DELETE FROM nodes WHERE data_room_id = $1 AND (id = $2 OR path LIKE $3 || '%')`, having first collected the storage keys of the files being removed so blobs can be released after the commit. Blob deletion is best-effort and idempotent: a failed storage call must not roll back the metadata delete, so orphans are swept rather than transacted.
*Alternative:* `ON DELETE CASCADE` on `parentId` — elegant, but it recurses row by row and yields no list of storage keys to clean up.

### Delete preview is a separate endpoint
The confirmation dialog calls `GET /folders/:id/deletion-preview` and states real numbers — "12 folders and 143 files (2.3 GB) will be permanently deleted". A generic "are you sure" tells the user nothing they did not already know.

### Provisioning on read, idempotently
The Data Room and its root folder are created on first access inside a transaction with a unique constraint on `(ownerId)` for the default room, so two simultaneous first requests produce one room and the loser reads the winner's row. A new user never sees a setup step.

### 404, never 403, for someone else's node
Returning 403 confirms that an id exists. For a product whose premise is confidentiality, the absence of that signal is worth the slightly less precise error.

## Risks / Trade-offs

- **The path is a maintained invariant.** Any code that reparents a node must rewrite the subtree prefix in the same transaction, or the tree silently corrupts. → Moves go through one repository method, no controller writes `parentId` directly, and a Jest test asserts every descendant's path after a move.
- **`LIKE` prefix matching needs the right index and the right escaping.** A path containing `%` or `_` would match too much. → Ids are UUIDs, so the alphabet is safe by construction, and the index is declared with `text_pattern_ops` so the prefix scan is used.
- **Read-time aggregates degrade on huge subtrees.** → Documented above, with the rollup migration path and a reconciliation job.
- **Depth is bounded arbitrarily.** A limit of 20 keeps paths short and breadcrumbs sane, and will annoy someone eventually. → The limit is configuration, and the error names it.
- **Deleting a folder someone is currently viewing.** → Their next request 404s; the UI turns that into "This folder is no longer available" with a route back to the parent, and the shared view gets the same treatment in `add-sharing`.

## Migration Plan

Additive migration creating `data_rooms` and `nodes` with indexes on `(dataRoomId, parentId, normalizedName)` unique, `(dataRoomId, path)` with `text_pattern_ops`, and `(parentId, type, name)` for listing. No backfill — the tables are new. Existing users are provisioned lazily on their next request, so no data migration step is needed.

Rollback drops both tables; only demo data exists at this point.

## Open Questions

- Should the Data Room root be a real `Node` row or a virtual parent? Leaning real row: it makes "share the whole Data Room" identical to "share a folder", which simplifies `add-sharing`.
- Should aggregates be part of every listing response, or fetched separately on demand? Separate for now — folder listing should not pay for a subtree scan per row.

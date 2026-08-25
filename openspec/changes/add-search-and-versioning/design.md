## Context

Everything the brief requires is built. This change adds the two features it names as extra credit, under an explicit instruction to time-box them. Both attach to structures that already exist — search filters `Node`, versions hang off a `FILE` node — so neither forces a remodel, and either can be dropped without leaving a hole.

One thing is not optional: search must obey the sharing model. A search endpoint that matches on name and forgets to resolve access would quietly undo the security boundary the previous change established, which is why the design below starts from the permission filter rather than from the matching.

## Goals / Non-Goals

**Goals:**
- Find a file by name in a large room, quickly, without ever returning something the caller cannot open.
- Version history that answers "what did this document say last week" without changing how unversioned files behave.
- Both features additive: cutting them leaves the MVP exactly as it was.

**Non-Goals:**
- Full-text search of PDF contents. That needs extraction, a job queue and a tsvector pipeline — a change of its own.
- Fuzzy or typo-tolerant matching, search ranking beyond a sensible order, or saved searches.
- Automatic versioning on every upload, diffing between versions, or version comments.
- Version retention limits and pruning.

## Decisions

### Search is a permission filter with a name match bolted on
The query starts from what the caller may read, not from what matches:
- **Owner:** `dataRoomId = :room`.
- **Share recipient:** `path LIKE :shareRoot || '%'` — the shared subtree, expressed as the same prefix predicate used everywhere else.
- **Scoped search:** the same prefix predicate with the current folder's path.

The name predicate is then `ANDed` on. Because the access scope is always a path prefix, there is one shape of query for every caller type, and adding a new caller type cannot accidentally widen it.
*Alternative:* match first and filter results afterwards — needs an access check per row, breaks pagination (a page of 20 can shrink to 3 after filtering), and leaks existence through timing and result counts.

### Trigram index, not `LIKE '%q%'` on its own
`pg_trgm` with a GIN index on `lower(name)` makes infix matching an index lookup. Substring matching is what users expect — searching `q4` should find `2024-Q4-report.pdf` — and a plain leading-wildcard `LIKE` cannot use a btree, so at 100,000 rows it degrades into a scan.
*Alternatives:* `tsvector` full-text search (excellent for prose, awkward for filenames, where `2024-Q4-report.pdf` tokenises badly); prefix-only matching on a btree (fast, and it fails the most common way people search); client-side filtering (only correct when the client already holds every row, which is exactly what pagination prevents).
*Caveat:* trigram indexes want a query of at least three characters, which is why a minimum query length is specified rather than arbitrary.

### Search results carry their container, resolved within scope
Each result reports the folder containing it. For a recipient, that container is re-rooted at the share root — the same re-rooting the shared view already applies to breadcrumbs — so a result can never name a folder above the share.

### Versions are rows; the node keeps pointing at the current one
`FileVersion { id, nodeId, versionNumber, storageKey, sizeBytes, contentType, checksum, uploadedBy, createdAt }`, and `Node` keeps `storageKey` and `sizeBytes` mirroring the current version. Every existing read path — listing, viewer, content URL, sharing — continues to work untouched, and versioning becomes strictly additive. The mirror is denormalisation, and it is worth it: the alternative is a join on the hottest query in the product to answer "what does this file currently contain".
*Alternatives:* versions as sibling `Node` rows (they would show up in listings, searches and shares as separate files — wrong); storage-provider object versioning (no history in the database, no restore semantics, and provider-specific).

### Versioning is a choice at commit, not a mode
The upload intent reports the collision and the client asks the owner: keep both, or save as a new version. The decision travels on the commit call. Nothing about the default path changes, which is what makes this change safe to cut — with the feature disabled, every collision suffixes, exactly as `add-file-management` specified.
*Alternative:* a per-folder "versioned" setting — more state, more explaining, and the decision is naturally per-upload.

### Restore adds a version, it does not rewind
Restoring version 2 copies its reference forward as a new current version rather than deleting versions 3 and 4. History stays append-only, which is the property that makes a document vault trustworthy: nothing a user did can erase what was there.

### Versions own distinct objects
Each version has its own storage key, so a new version never overwrites earlier bytes. Deleting a file releases every version's object, which extends the existing key-collection step in `deleteSubtree` rather than adding a second cleanup path.

## Risks / Trade-offs

- **Search is the easiest place to leak.** → The permission prefix is applied in the same repository method that runs the match; there is no code path that matches names without one. The Cypress suite searches as owner, recipient, stranger and anonymous, asserting on what is *absent*.
- **Trigram indexes are large and slow to write.** At MVP scale this is invisible; at millions of rows it costs on every insert. → Noted in the rule; the index is on `lower(name)` only, not on paths or content.
- **The `Node.storageKey` mirror can drift from the current version.** → One service method performs "set current version", updating both in a single transaction; nothing else writes those columns, and a Jest test asserts they agree after add and after restore.
- **Version bytes accumulate with no retention policy.** → Acknowledged as out of scope; the README names retention as the next step for real use.
- **Both features are cuttable, and half-built features are worse than absent ones.** → They are specified as two independent capabilities so one can ship without the other, and neither is referenced by any earlier change.

## Migration Plan

Enable `pg_trgm` and create the GIN index on `lower(name)` — index creation on an existing table should be concurrent so it does not lock writes. Add `file_versions` with a unique `(nodeId, versionNumber)` and an index on `nodeId`. Backfill one version row per existing file from its current storage key, inside the same migration, so history is complete rather than starting from empty for files uploaded before this change.

Rollback drops `file_versions` and the index; `Node.storageKey` is unaffected, so files keep working.

## Open Questions

- Should folders be searchable alongside files, or files only? Currently both, with a type filter — folders are cheap to include and useful to find.
- Should search be room-wide by default with a "search this folder" toggle, or scoped by default? Leaning room-wide by default, since scoped search is the narrower need.

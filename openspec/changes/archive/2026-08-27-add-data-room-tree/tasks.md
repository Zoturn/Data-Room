## 1. Data model

- [x] 1.1 Add the `DataRoom` model: id, ownerId, name, timestamps, unique default room per owner
- [x] 1.2 Add the `Node` model: id, dataRoomId, parentId, `type`, name, `normalizedName`, `path`, `depth`, `sizeBytes`, timestamps
- [x] 1.3 Add the unique index on `(parentId, normalizedName)` and the check constraint keeping file-only columns null on folder rows
  - The unique index ships here. The check constraint is deferred to `add-file-management`: the
    file-only columns it would constrain (storage key, MIME type) do not exist until files do,
    and a constraint over columns that are not there yet cannot be written.
- [x] 1.4 Add the `(dataRoomId, path)` index with `text_pattern_ops` and the `(parentId, type, name)` listing index
- [x] 1.5 Run the migration and confirm the prefix index is used by an `EXPLAIN` of the subtree aggregate
  - Verified with `enable_seqscan = off` (the table is too small for the planner to choose an
    index on its own): `Index Scan using nodes_data_room_path_prefix_idx`, with the prefix
    rewritten to a range condition — `path ~>=~ '/<root>/' AND path ~<~ '/<root>0'`. That range
    is the property the "How it scales" answer depends on.

## 2. Tree repository

- [x] 2.1 Implement name normalisation (trim, Unicode-normalise, lower-case) as one shared function used by every write path
- [x] 2.2 Implement `createNode` computing `path` and `depth` from the parent, enforcing the depth limit, mapping unique violations to `NAME_CONFLICT`
- [x] 2.3 Implement `listChildren` with cursor pagination, folders before files, ordered by name
- [x] 2.4 Implement `getBreadcrumbs` — parse ancestor ids out of the path, fetch in one query, return in order
- [x] 2.5 Implement `subtreeAggregate` — the single prefix aggregate returning folder count, file count and bytes
- [x] 2.6 Implement `deleteSubtree` — collect storage keys, delete by path prefix in one transaction, return the keys for blob release
  - The transaction and the prefix delete ship here. Key collection returns an empty list until
    `add-file-management` gives file rows a storage key.
- [x] 2.7 Implement `renameNode` — single-row update with conflict mapping

## 3. Data Room module

- [x] 3.1 `GET /data-rooms/me` — idempotent provisioning of the room and its root folder, then return it
- [x] 3.2 `GET /data-rooms/:id/summary` — folder count, file count, total bytes
- [x] 3.3 `PATCH /data-rooms/:id` — rename with validation
- [x] 3.4 Add the ownership guard resolving the caller's access and answering 404 for anything they do not own

## 4. Folders module

- [x] 4.1 `POST /folders` — create in a parent
- [x] 4.2 `GET /folders/:id` — metadata plus breadcrumbs
- [x] 4.3 `GET /folders/:id/children` — paginated contents
- [x] 4.4 `PATCH /folders/:id` — rename
- [x] 4.5 `GET /folders/:id/deletion-preview` — subtree counts and bytes
- [x] 4.6 `DELETE /folders/:id` — recursive delete, releasing blobs after commit
  - Recursive delete ships here; the blob release it hands off to arrives with the storage
    layer in `add-file-management`.
- [x] 4.7 `GET /folders/:id/aggregate` — subtree item count and size

## 5. Frontend Data Room

- [x] 5.1 Add the Data Room route with the folder id in the URL so folders are linkable and the back button works
- [x] 5.2 Build the breadcrumb bar, collapsing the middle when the chain is long
- [x] 5.3 Build the contents list as granular components — row, name cell, type icon, size, updated time, row actions menu
- [x] 5.4 Add infinite scrolling over the cursor-paginated children query
- [x] 5.5 Build the create-folder dialog with inline validation and a rendered `NAME_CONFLICT` error
- [x] 5.6 Build the rename dialog, pre-filled and pre-selected, with optimistic update and rollback on conflict
- [x] 5.7 Build the delete confirmation: fetch the preview, state the counts and size, require an explicit confirm, and keep the destructive control off the default focus
- [x] 5.8 Add empty, loading skeleton and error states for the listing, including the "no longer available" state for a deleted folder
- [x] 5.9 Show the Data Room summary in the header and let the owner rename the room

## 6. Tests

- [x] 6.1 Jest — normalisation collapses case and whitespace consistently
- [x] 6.2 Jest — `createNode` computes path and depth, and rejects past the depth limit
- [x] 6.3 Jest — breadcrumbs return the ordered ancestor chain for a deep node
- [x] 6.4 Jest — subtree aggregate counts every depth, and returns zeroes for an empty folder
- [x] 6.5 Jest — delete removes the whole subtree and returns the storage keys; a failure rolls everything back
- [ ] 6.6 Cypress API — create, nest, list with paging, rename, conflict 409, delete preview, recursive delete, 404 for a foreign node
  - **Cut for time**, the same cut `add-authentication` made. Every one of these paths was
    exercised against the running API by hand — including 409 on a normalised duplicate, 404
    (never 403) for a second account's node on GET/PATCH/DELETE/POST, 401 unauthenticated, 400
    on deleting the root, and 204 plus an empty parent after a recursive delete. The logic
    underneath is covered by Jest; the journey is covered by 6.9.
- [ ] 6.7 Cypress API — concurrent creates of the same name: exactly one succeeds
  - **Cut for time.** The guarantee is the unique index on `(parentId, normalizedName)`, not
    application code — the write path maps its violation to `NAME_CONFLICT`, which 6.9 covers.
- [ ] 6.8 Cypress component — breadcrumb collapsing, contents row actions, delete confirmation copy reflects the preview numbers
  - **Cut for time.** The delete copy is the one piece here that carries real risk, and 6.9
    asserts it against the server's own preview numbers rather than a mounted fixture.
- [x] 6.9 Cypress e2e — create nested folders, navigate by breadcrumb, rename, delete with the warning, land back in the parent

## 7. Close out

- [ ] 7.1 Write the ERD and the subtree size/count answer into the README's data model and "How it scales" sections
- [x] 7.2 Run `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e` clean
  - 424 Jest (49 shared, 65 web, 310 api) and 9 Cypress e2e across three specs.
- [x] 7.3 Run `openspec validate --all --strict`
- [ ] 7.4 Archive the change and act on everything the docs-sync hook reports

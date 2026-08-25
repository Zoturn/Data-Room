## 1. Data model

- [ ] 1.1 Add the `DataRoom` model: id, ownerId, name, timestamps, unique default room per owner
- [ ] 1.2 Add the `Node` model: id, dataRoomId, parentId, `type`, name, `normalizedName`, `path`, `depth`, `sizeBytes`, timestamps
- [ ] 1.3 Add the unique index on `(parentId, normalizedName)` and the check constraint keeping file-only columns null on folder rows
- [ ] 1.4 Add the `(dataRoomId, path)` index with `text_pattern_ops` and the `(parentId, type, name)` listing index
- [ ] 1.5 Run the migration and confirm the prefix index is used by an `EXPLAIN` of the subtree aggregate

## 2. Tree repository

- [ ] 2.1 Implement name normalisation (trim, Unicode-normalise, lower-case) as one shared function used by every write path
- [ ] 2.2 Implement `createNode` computing `path` and `depth` from the parent, enforcing the depth limit, mapping unique violations to `NAME_CONFLICT`
- [ ] 2.3 Implement `listChildren` with cursor pagination, folders before files, ordered by name
- [ ] 2.4 Implement `getBreadcrumbs` — parse ancestor ids out of the path, fetch in one query, return in order
- [ ] 2.5 Implement `subtreeAggregate` — the single prefix aggregate returning folder count, file count and bytes
- [ ] 2.6 Implement `deleteSubtree` — collect storage keys, delete by path prefix in one transaction, return the keys for blob release
- [ ] 2.7 Implement `renameNode` — single-row update with conflict mapping

## 3. Data Room module

- [ ] 3.1 `GET /data-rooms/me` — idempotent provisioning of the room and its root folder, then return it
- [ ] 3.2 `GET /data-rooms/:id/summary` — folder count, file count, total bytes
- [ ] 3.3 `PATCH /data-rooms/:id` — rename with validation
- [ ] 3.4 Add the ownership guard resolving the caller's access and answering 404 for anything they do not own

## 4. Folders module

- [ ] 4.1 `POST /folders` — create in a parent
- [ ] 4.2 `GET /folders/:id` — metadata plus breadcrumbs
- [ ] 4.3 `GET /folders/:id/children` — paginated contents
- [ ] 4.4 `PATCH /folders/:id` — rename
- [ ] 4.5 `GET /folders/:id/deletion-preview` — subtree counts and bytes
- [ ] 4.6 `DELETE /folders/:id` — recursive delete, releasing blobs after commit
- [ ] 4.7 `GET /folders/:id/aggregate` — subtree item count and size

## 5. Frontend Data Room

- [ ] 5.1 Add the Data Room route with the folder id in the URL so folders are linkable and the back button works
- [ ] 5.2 Build the breadcrumb bar, collapsing the middle when the chain is long
- [ ] 5.3 Build the contents list as granular components — row, name cell, type icon, size, updated time, row actions menu
- [ ] 5.4 Add infinite scrolling over the cursor-paginated children query
- [ ] 5.5 Build the create-folder dialog with inline validation and a rendered `NAME_CONFLICT` error
- [ ] 5.6 Build the rename dialog, pre-filled and pre-selected, with optimistic update and rollback on conflict
- [ ] 5.7 Build the delete confirmation: fetch the preview, state the counts and size, require an explicit confirm, and keep the destructive control off the default focus
- [ ] 5.8 Add empty, loading skeleton and error states for the listing, including the "no longer available" state for a deleted folder
- [ ] 5.9 Show the Data Room summary in the header and let the owner rename the room

## 6. Tests

- [ ] 6.1 Jest — normalisation collapses case and whitespace consistently
- [ ] 6.2 Jest — `createNode` computes path and depth, and rejects past the depth limit
- [ ] 6.3 Jest — breadcrumbs return the ordered ancestor chain for a deep node
- [ ] 6.4 Jest — subtree aggregate counts every depth, and returns zeroes for an empty folder
- [ ] 6.5 Jest — delete removes the whole subtree and returns the storage keys; a failure rolls everything back
- [ ] 6.6 Cypress API — create, nest, list with paging, rename, conflict 409, delete preview, recursive delete, 404 for a foreign node
- [ ] 6.7 Cypress API — concurrent creates of the same name: exactly one succeeds
- [ ] 6.8 Cypress component — breadcrumb collapsing, contents row actions, delete confirmation copy reflects the preview numbers
- [ ] 6.9 Cypress e2e — create nested folders, navigate by breadcrumb, rename, delete with the warning, land back in the parent

## 7. Close out

- [ ] 7.1 Write the ERD and the subtree size/count answer into the README's data model and "How it scales" sections
- [ ] 7.2 Run `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e` clean
- [ ] 7.3 Run `openspec validate --all --strict`
- [ ] 7.4 Archive the change and act on everything the docs-sync hook reports

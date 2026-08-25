## 1. Search — data layer

- [ ] 1.1 Enable `pg_trgm` and add the GIN index on `lower(name)`, created concurrently
- [ ] 1.2 Implement `searchNodes(scope, query, filters, cursor)` where `scope` is always a path prefix or a Data Room id, with the name predicate applied on top
- [ ] 1.3 Derive the scope from the caller: owner → Data Room, recipient → share root path, scoped search → current folder path
- [ ] 1.4 Enforce the minimum query length and return the container folder for each result
- [ ] 1.5 Confirm with `EXPLAIN` that the trigram index is used

## 2. Search — API

- [ ] 2.1 `GET /search` — query, optional folder scope, type filter, sort, cursor pagination
- [ ] 2.2 `GET /public/shares/:token/search` — the same, confined to the shared subtree
- [ ] 2.3 Re-root each result's container within the caller's scope so nothing above it is named
- [ ] 2.4 Return 404 or an empty result for a Data Room the caller cannot read

## 3. Search — interface

- [ ] 3.1 Add the search field to the app shell with debounced input and a visible clear action
- [ ] 3.2 Build the result list: name, type icon, containing folder, updated time, size
- [ ] 3.3 Add type filter and sort controls, reflected in the URL so a search is linkable
- [ ] 3.4 Navigate from a result to the file viewer or the folder contents
- [ ] 3.5 Add empty, loading, error and too-short-query states
- [ ] 3.6 Discard stale responses so a slow earlier request cannot overwrite newer results
- [ ] 3.7 Add search to the shared view, scoped to the share

## 4. Versioning — data layer

- [ ] 4.1 Add the `FileVersion` model with a unique `(nodeId, versionNumber)` and an index on `nodeId`
- [ ] 4.2 Backfill one version row per existing file from its current storage key
- [ ] 4.3 Implement `setCurrentVersion` — the only method that writes `Node.storageKey` and `sizeBytes`, in one transaction with the version row
- [ ] 4.4 Extend subtree deletion to collect every version's storage key

## 5. Versioning — API

- [ ] 5.1 Report the collision and the available choices from `POST /files/upload-intent`
- [ ] 5.2 Accept the resolution on commit: suffix (default) or add as a new version of the existing file
- [ ] 5.3 `GET /files/:id/versions` — history, newest first, current marked, access-resolved
- [ ] 5.4 `GET /files/:id/versions/:versionId/content-url` — signed URL after the same access check as the file
- [ ] 5.5 `POST /files/:id/versions/:versionId/restore` — owner only, appends a new current version without deleting any

## 6. Versioning — interface

- [ ] 6.1 Build the collision prompt at upload: keep both, or save as a new version, decided per file in a batch
- [ ] 6.2 Build the version history panel in the file viewer: number, size, upload time, uploader, current marker
- [ ] 6.3 View and download an earlier version, labelled clearly as not current
- [ ] 6.4 Add restore with a confirmation explaining that history is preserved
- [ ] 6.5 Hide version write actions from read-only viewers, and show a single-version file without implying anything is missing

## 7. Tests

- [ ] 7.1 Jest — search scope construction for owner, recipient and folder-scoped callers
- [ ] 7.2 Jest — minimum query length, case-insensitive infix matching, type filter and sort
- [ ] 7.3 Jest — version numbering, current-version mirror stays consistent after add and restore
- [ ] 7.4 Jest — restore appends rather than truncating history
- [ ] 7.5 Jest — deleting a versioned file collects every version's key
- [ ] 7.6 Cypress API — search as owner, recipient, stranger and anonymous, asserting on absent results; scoped search; paging
- [ ] 7.7 Cypress API — versioned upload, history, earlier-version content URL, restore, refusal for a read-only user
- [ ] 7.8 Cypress component — search input debounce and result rows; version history panel
- [ ] 7.9 Cypress e2e — search across a room and open a result; upload a colliding file as a new version, view history, restore

## 8. README and final delivery

- [ ] 8.1 Write the design decisions section, drawing on the six change design documents
- [ ] 8.2 Publish the ERD covering User, RefreshToken, DataRoom, Node, Share, ShareGrant and FileVersion
- [ ] 8.3 Write the three "How it scales" answers: subtree size and count, one room with 100,000 files, and viewer/editor roles without remodelling
- [ ] 8.4 Write setup instructions: prerequisites, install, environment variables, database migration, running both apps, running Jest and Cypress
- [ ] 8.5 Write the note on where and how AI was used
- [ ] 8.6 Record both hosted URLs and a short tour of what to try first
- [ ] 8.7 State the deliberate cuts: no password reset, no email delivery of invitations, no version retention, PDF only

## 9. Close out

- [ ] 9.1 Verify the deployed pair end to end: sign in, upload, share publicly, open the link signed out, revoke, search, version
- [ ] 9.2 Run `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e` clean
- [ ] 9.3 Run `openspec validate --all --strict`
- [ ] 9.4 Archive the change and act on everything the docs-sync hook reports
- [ ] 9.5 Final documentation pass: confirm all three `CLAUDE.md` files, every rule and the README match the shipped system

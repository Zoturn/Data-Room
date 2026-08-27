## Why

The Data Room itself does not exist yet. Everything the brief asks for — nesting folders, uploading files into them, sharing a subtree read-only — rests on one hierarchy and one ownership boundary, so the tree and its access rules have to be right before files or sharing are built on top of them.

## What Changes

- Add a `DataRoom` owned by a user, created automatically on first sign-in so a new user lands in a working room rather than an empty setup screen.
- Add a single `Node` table holding both folders and files, discriminated by `type`, with `parentId`, a materialised `path` and a `depth`. Files reuse this table in the next change, which keeps naming, ordering, moving and sharing on one code path.
- Enforce sibling name uniqueness case-insensitively within a parent, with a documented normalisation so `Reports` and `reports` cannot coexist.
- Create folders, nest them to a bounded depth, and list a folder's direct contents with cursor pagination, folders before files, ordered by name.
- Return breadcrumbs for any folder from the materialised path in a single query.
- Rename a folder, rejecting a name that collides with a sibling.
- Delete a folder and its whole subtree, preceded by a preview endpoint that reports exactly how many folders and files and how many bytes will be removed, so the confirmation dialog can state the real consequence.
- Report aggregate size and item count for any folder's subtree.
- Build the frontend Data Room: breadcrumb bar, contents list, create/rename dialogs, a destructive-delete confirmation that names what will be lost, plus empty, loading and error states.

## Capabilities

### New Capabilities
- `data-room`: the owned root container, its provisioning, and the ownership boundary that makes it invisible to everyone else.
- `folders`: the node hierarchy — creation, nesting, listing, breadcrumbs, renaming, recursive deletion and subtree aggregates.

### Modified Capabilities
None.

## Impact

- New `DataRoom` and `Node` tables and their indexes; `Node` is the table the file, sharing, search and versioning changes all extend.
- The materialised `path` becomes a maintained invariant: any future move or rename must rewrite the subtree's paths in the same transaction.
- Answers the README's first scaling question (subtree size and item count) in this change's design.

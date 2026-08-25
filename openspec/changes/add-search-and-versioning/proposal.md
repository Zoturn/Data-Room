## Why

The brief names two extra-credit features and asks that they be attempted only if time remains: finding a file by name anywhere in the Data Room, and keeping versions when a name collides instead of suffixing. Both are worth having — a 100,000-file room is unnavigable by clicking, and "here is the corrected Q4 report" is the most ordinary thing that happens in due diligence. This change is explicitly the last one and may be dropped in whole or in part without affecting the MVP.

## What Changes

- Add filename search across a Data Room, scoped to what the caller may actually read, so search can never become a way to discover files a share does not cover.
- Search from a folder as well as from the room root, restricting results to that subtree.
- Add filtering by type and a sort choice, with results paginated on the same cursor envelope as every other list.
- Add a search entry point in the app shell with debounced input, result rows showing each file's containing folder, a path to navigate there, empty and error states, and no results leaking into a shared view beyond its subtree.
- Add a trigram index so filename matching stays an index lookup rather than a scan at six figures of rows.
- Add opt-in file versioning: when an upload's name collides in the destination folder, the owner may store it as a new version of the existing file instead of taking a suffixed name.
- Keep every version's bytes, expose the version history of a file, allow viewing and downloading an earlier version, and allow restoring one as the current version.
- Keep the existing suffixing behaviour as the default, so the choice is additive and the MVP path is untouched.
- Assemble the final README: design decisions, ERD, the three "How it scales" answers, setup instructions, hosted URLs and the note on where AI was used.

## Capabilities

### New Capabilities
- `file-search`: permission-scoped filename search and filtering across a Data Room or a subtree.
- `file-versioning`: optional version history for a file, created on name collision, with restore.

### Modified Capabilities
None. Versioning is offered as an alternative resolution at upload time; the existing conflict-suffixing requirement remains the default and is unchanged.

## Impact

- New `FileVersion` table; the current version's storage key stays on the file node so existing read paths do not change.
- A trigram index and the `pg_trgm` extension on the database.
- Search must call the same access resolver as every other read — a search endpoint that queries by name without it would undo the sharing model.
- This change carries the README assembly and the final deployment verification, so it should be archived last even if its features are cut.

## ADDED Requirements

### Requirement: Folder creation and nesting
An owner SHALL be able to create a folder inside their Data Room's root or inside any existing folder. The system SHALL enforce a maximum nesting depth and MUST reject creation under a parent that does not exist or belongs to another Data Room.

#### Scenario: Folder created in the root
- **WHEN** the owner creates a folder named `Financials` in the root
- **THEN** it appears in the root listing with an empty content count

#### Scenario: Folder nested in another folder
- **WHEN** the owner creates `2024` inside `Financials`
- **THEN** `2024` is listed inside `Financials` and its breadcrumb reads root → Financials → 2024

#### Scenario: Depth limit is enforced
- **WHEN** creation would exceed the configured maximum depth
- **THEN** the response is 400 with `code: "MAX_DEPTH_EXCEEDED"` and no folder is created

#### Scenario: Foreign parent is refused
- **WHEN** the owner creates a folder naming a parent in another user's Data Room
- **THEN** the response is 404 and nothing is created

### Requirement: Sibling name uniqueness
Within one parent, names SHALL be unique after normalisation — trimmed and compared without regard to case. A colliding create or rename MUST fail with a distinct, machine-readable conflict code rather than silently renaming.

#### Scenario: Case-insensitive collision is refused
- **WHEN** a folder named `Reports` exists and the owner creates `reports` in the same parent
- **THEN** the response is 409 with `code: "NAME_CONFLICT"`

#### Scenario: Same name in different parents is allowed
- **WHEN** `Reports` exists in the root and the owner creates `Reports` inside `Financials`
- **THEN** both folders exist

#### Scenario: Surrounding whitespace does not create a near-duplicate
- **WHEN** the owner submits `"  Reports  "` alongside an existing `Reports`
- **THEN** the name is trimmed, the collision is detected, and the response is 409

#### Scenario: Concurrent creates do not both succeed
- **WHEN** two requests create the same folder name in the same parent simultaneously
- **THEN** exactly one succeeds and the other responds 409

### Requirement: Folder contents listing
The system SHALL list the direct children of a folder with cursor pagination, ordering folders before files and then by name, and SHALL report for each child its type, name, updated time, and — for files — its size.

#### Scenario: Ordering is stable
- **WHEN** a folder containing folders and files is listed
- **THEN** all folders appear before any file, each group ordered by name

#### Scenario: Paging through a large folder
- **WHEN** a folder holds more children than one page
- **THEN** the first response returns a `nextCursor`, and following it returns the remaining children exactly once each

#### Scenario: Empty folder
- **WHEN** a folder with no children is listed
- **THEN** the response contains an empty item list and a null cursor, and the UI shows an empty state offering folder creation and upload

### Requirement: Breadcrumb navigation
For any folder the system SHALL return the ordered ancestor chain from the Data Room root to that folder, resolvable in a single query.

#### Scenario: Deep folder returns its full chain
- **WHEN** the owner opens a folder four levels deep
- **THEN** the breadcrumb lists the root and every ancestor in order, each navigable

#### Scenario: Root folder
- **WHEN** the root folder is opened
- **THEN** the breadcrumb contains only the Data Room root entry

### Requirement: Folder rename
An owner SHALL be able to rename a folder. A rename MUST preserve the folder's contents, and every descendant MUST remain reachable with breadcrumbs reflecting the new name.

#### Scenario: Rename keeps children reachable
- **WHEN** a folder holding nested folders and files is renamed
- **THEN** the new name is listed, and every descendant remains reachable with a breadcrumb showing the new name

#### Scenario: Colliding rename is refused
- **WHEN** the new name matches a sibling after normalisation
- **THEN** the response is 409 with `code: "NAME_CONFLICT"` and the folder keeps its old name

#### Scenario: Rename is atomic
- **WHEN** a rename fails partway through
- **THEN** no change is persisted and the folder keeps its previous name

### Requirement: Deletion preview
Before deleting a folder the system SHALL report how many folders and files the deletion would remove and how many bytes would be freed, counting the entire subtree.

#### Scenario: Preview counts the whole subtree
- **WHEN** the owner requests the deletion preview for a folder containing nested folders and files
- **THEN** the response reports the total descendant folder count, file count and byte size

#### Scenario: Confirmation states the consequence
- **WHEN** the owner triggers deletion of a non-empty folder in the UI
- **THEN** the confirmation dialog names the folder and states how many folders and files will be permanently deleted
- **AND** the destructive action is not the default focused control

#### Scenario: Empty folder needs no alarming warning
- **WHEN** the owner deletes an empty folder
- **THEN** the confirmation states that the folder is empty

### Requirement: Recursive folder deletion
Deleting a folder SHALL delete that folder and every descendant folder and file in one atomic operation, and the stored blobs of deleted files MUST be released.

#### Scenario: Subtree disappears
- **WHEN** the owner confirms deletion of a folder with nested content
- **THEN** the folder and all descendants are gone from every listing
- **AND** a request for any descendant responds 404

#### Scenario: Failure leaves the tree intact
- **WHEN** deletion fails partway through
- **THEN** the transaction rolls back and the whole subtree remains

#### Scenario: Blobs are not orphaned
- **WHEN** a subtree containing uploaded files is deleted
- **THEN** the corresponding stored objects are removed or queued for removal

#### Scenario: Someone is viewing the folder as it is deleted
- **WHEN** a user with read access has the folder open and the owner deletes it
- **THEN** their next request responds 404 and the UI explains that the item is no longer available instead of showing a broken view

### Requirement: Subtree aggregates
For any folder the system SHALL report the total number of items and the total size in bytes of its entire subtree, not just its direct children.

#### Scenario: Aggregate spans all depths
- **WHEN** the owner requests aggregates for a folder whose files sit three levels below it
- **THEN** the reported item count and total size include those files

#### Scenario: Aggregate updates after a change
- **WHEN** a file is added to a nested folder
- **THEN** the ancestor folder's reported size and item count increase accordingly

### Requirement: Tree operations are owner-only
Creating, renaming, deleting and listing SHALL be permitted only for the owner of the containing Data Room until sharing grants access, and an unauthorised attempt MUST respond 404 rather than 403.

#### Scenario: Stranger cannot list a folder
- **WHEN** a signed-in user requests the contents of a folder in another user's Data Room
- **THEN** the response is 404

#### Scenario: Stranger cannot delete
- **WHEN** a signed-in user attempts to delete a folder they do not own
- **THEN** the response is 404 and the folder is untouched

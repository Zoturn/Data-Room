## ADDED Requirements

### Requirement: Versioning offered on name conflict
When an upload's name collides with an existing file in the destination folder, the owner SHALL be offered the choice of saving it as a new version of that file instead of taking a suffixed name. Suffixing remains the default when no choice is made.

#### Scenario: Owner chooses to version
- **WHEN** the owner uploads `report.pdf` into a folder already holding `report.pdf` and chooses to keep it as a new version
- **THEN** no second file appears in the folder, and `report.pdf` now shows the newly uploaded content

#### Scenario: Owner chooses to keep both
- **WHEN** the owner chooses to keep both files
- **THEN** the new upload is stored under a suffixed name and both files exist independently

#### Scenario: Default is unchanged
- **WHEN** an upload collides and no explicit choice is made
- **THEN** the file is stored under a suffixed name exactly as before

#### Scenario: Choice applies per file in a batch
- **WHEN** several files in one batch collide
- **THEN** the owner can decide for each, and files that do not collide are unaffected

### Requirement: Version history
A file SHALL retain each stored version with its size, content type, upload time and uploader, numbered in ascending order, with exactly one version marked current.

#### Scenario: History lists every version
- **WHEN** the owner opens a file's version history
- **THEN** every version is listed newest first, with its number, size and upload time, and the current one marked

#### Scenario: New version becomes current
- **WHEN** a new version is added
- **THEN** it becomes the current version and the previous one remains in the history

#### Scenario: Single-version file
- **WHEN** a file has only ever been uploaded once
- **THEN** its history shows one version and the interface does not imply anything is missing

### Requirement: Reading an earlier version
A user who may read a file SHALL be able to view and download any of its earlier versions, and version access MUST follow exactly the same permission rules as the file itself.

#### Scenario: Owner opens an earlier version
- **WHEN** the owner selects a previous version
- **THEN** that version's content is displayed, clearly labelled as not current

#### Scenario: Recipient may read versions of a shared file
- **WHEN** a user with read access to a shared file opens its history
- **THEN** they can view earlier versions of that file

#### Scenario: No access means no versions
- **WHEN** a user without access requests a version of a file
- **THEN** the response is 404 and no content URL is issued

### Requirement: Restoring a version
The owner SHALL be able to make an earlier version current again. Restoring MUST NOT delete any version; it adds to the history rather than rewriting it.

#### Scenario: Restore makes an old version current
- **WHEN** the owner restores version 2 of a file with four versions
- **THEN** the file's current content is that of version 2

#### Scenario: History is preserved
- **WHEN** a version is restored
- **THEN** every previously stored version is still listed and readable

#### Scenario: Only the owner may restore
- **WHEN** a user with read-only access attempts to restore a version
- **THEN** the request is refused and the current version is unchanged

### Requirement: Version storage lifecycle
Each version SHALL own a distinct stored object, and deleting a file SHALL release the objects of every one of its versions.

#### Scenario: Versions do not overwrite each other
- **WHEN** a new version of a file is stored
- **THEN** the earlier version's bytes remain intact and independently readable

#### Scenario: Deleting the file removes every version
- **WHEN** a file with several versions is deleted
- **THEN** every version's stored object is released

#### Scenario: Size reflects the current version
- **WHEN** a folder listing shows a versioned file
- **THEN** the size shown is that of the current version

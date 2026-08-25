## ADDED Requirements

### Requirement: Multiple file upload
An owner SHALL be able to upload several files at once into a folder, by selecting them or by dropping them onto the folder view. Each file in a batch SHALL succeed or fail independently.

#### Scenario: Batch upload
- **WHEN** the owner drops five PDFs onto a folder
- **THEN** all five upload and appear in that folder's listing

#### Scenario: One failure does not sink the batch
- **WHEN** one file in a batch of five fails to upload
- **THEN** the other four complete and only the failed one shows an error with a retry action

#### Scenario: Drop target is unmistakable
- **WHEN** files are dragged over the folder view
- **THEN** the drop target is highlighted and names the destination folder

#### Scenario: Dropping onto a folder row
- **WHEN** files are dropped onto a folder row rather than the open folder
- **THEN** they upload into that folder

### Requirement: Per-file upload progress
The interface SHALL show each queued file's own progress from 0% to completion, its final state, and SHALL let the user cancel an in-flight upload and retry a failed one.

#### Scenario: Independent progress
- **WHEN** several files upload together
- **THEN** each row shows its own percentage advancing independently

#### Scenario: Cancel mid-flight
- **WHEN** the user cancels an uploading file
- **THEN** the transfer stops, no file node is left behind, and the other uploads continue

#### Scenario: Retry after failure
- **WHEN** the user retries a failed upload
- **THEN** a fresh upload is attempted without re-selecting the file

#### Scenario: Navigation during upload is not silently destructive
- **WHEN** the user navigates away while uploads are in flight
- **THEN** they are warned that leaving cancels the remaining uploads

### Requirement: File type and size validation
The system SHALL accept only PDF files and SHALL enforce a maximum file size. Type MUST be verified against the file's actual content, not only its declared type or extension, and an invalid file MUST leave no node behind.

#### Scenario: Non-PDF is refused
- **WHEN** the owner selects a `.docx` file
- **THEN** it is rejected before any upload URL is issued, with a message naming the accepted type

#### Scenario: Disguised file is caught
- **WHEN** a file named `report.pdf` does not contain PDF content
- **THEN** the commit is refused with `code: "UNSUPPORTED_FILE_TYPE"` and no file node is created

#### Scenario: Oversized file is refused
- **WHEN** a file exceeds the configured maximum size
- **THEN** it is rejected with `code: "FILE_TOO_LARGE"` and a message stating the limit

### Requirement: Upload name conflict resolution
When an uploaded file's name already exists in the destination folder, the system SHALL store it under a suffixed name that preserves the extension, rather than failing or overwriting. The resolved name MUST be reported to the client and MUST itself be unique.

#### Scenario: First conflict is suffixed
- **WHEN** `report.pdf` is uploaded into a folder that already contains `report.pdf`
- **THEN** the new file is stored as `report (1).pdf` and the existing file is untouched

#### Scenario: Repeated conflicts keep counting
- **WHEN** `report.pdf` is uploaded into a folder containing `report.pdf` and `report (1).pdf`
- **THEN** the new file is stored as `report (2).pdf`

#### Scenario: Conflict ignores case
- **WHEN** `Report.PDF` is uploaded into a folder containing `report.pdf`
- **THEN** the name is treated as a conflict and suffixed

#### Scenario: Simultaneous uploads of one name
- **WHEN** two uploads of `report.pdf` into the same folder commit at the same time
- **THEN** both files exist under distinct names and neither is lost

#### Scenario: User is told what happened
- **WHEN** an upload is stored under a suffixed name
- **THEN** the interface shows the name the file was actually saved as

### Requirement: Viewing a file
A user with access SHALL be able to view a PDF inside the application without downloading it first, and SHALL also be able to download it explicitly.

#### Scenario: Inline view
- **WHEN** a user with access opens a file
- **THEN** the PDF renders in the application with the file's name shown

#### Scenario: Explicit download
- **WHEN** the user chooses download
- **THEN** the file is downloaded under its display name

#### Scenario: Unreadable content is handled
- **WHEN** the viewer cannot render the document
- **THEN** an error state offers download instead of showing a blank frame

### Requirement: File rename
An owner SHALL be able to rename a file. The extension SHALL be preserved, and a name colliding with a sibling MUST be resolved by the same suffixing rule used for uploads.

#### Scenario: Rename succeeds
- **WHEN** the owner renames `report.pdf` to `q4-report.pdf`
- **THEN** the listing shows the new name and the file's content is unchanged

#### Scenario: Extension is preserved
- **WHEN** the owner submits a new name without an extension
- **THEN** the original extension is retained

#### Scenario: Colliding rename is resolved
- **WHEN** the owner renames a file to a name already used in that folder
- **THEN** the file is saved under a suffixed name and the interface reports the result

### Requirement: Moving a file
An owner SHALL be able to move a file to another folder within the same Data Room. The destination MUST be a folder in the same Data Room, and a name collision at the destination MUST be resolved by suffixing.

#### Scenario: Move to another folder
- **WHEN** the owner moves a file from `Financials` to `Legal`
- **THEN** it disappears from `Financials`, appears in `Legal`, and its content is unchanged

#### Scenario: Move into a file is refused
- **WHEN** the move target is a file rather than a folder
- **THEN** the response is 400 with `code: "INVALID_MOVE_TARGET"` and nothing moves

#### Scenario: Move across Data Rooms is refused
- **WHEN** the destination folder belongs to a different Data Room
- **THEN** the response is 404 and nothing moves

#### Scenario: Collision at the destination
- **WHEN** the destination already holds a file with the same name
- **THEN** the moved file is stored under a suffixed name

#### Scenario: Move to the current folder is harmless
- **WHEN** a file is moved to the folder it already sits in
- **THEN** the operation succeeds with no change and no spurious rename

### Requirement: File deletion
An owner SHALL be able to delete a file after confirming, and the file's stored bytes SHALL be released.

#### Scenario: Delete removes the file
- **WHEN** the owner confirms deletion of a file
- **THEN** it disappears from the listing and requesting it responds 404

#### Scenario: Confirmation precedes deletion
- **WHEN** the owner triggers delete
- **THEN** a confirmation naming the file is shown before anything is removed

#### Scenario: Viewer sees the file vanish
- **WHEN** a user has the file open and the owner deletes it
- **THEN** their next action reports that the file is no longer available and returns them to the folder

### Requirement: File metadata in listings
A file SHALL report its name, size in bytes, content type and last-updated time wherever it is listed, and only committed files SHALL appear.

#### Scenario: Listing shows size and time
- **WHEN** a folder containing files is listed
- **THEN** each file shows a human-readable size and a last-updated time

#### Scenario: In-flight uploads are not listed as files
- **WHEN** an upload has been reserved but not committed
- **THEN** it does not appear in the folder listing as a stored file

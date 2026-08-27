## ADDED Requirements

### Requirement: Data Room ownership
A Data Room SHALL belong to exactly one owning user and SHALL NOT be readable or modifiable by any other user unless access has been granted. A request for a Data Room the caller does not own MUST respond 404 rather than 403, so the existence of another user's room is not disclosed.

#### Scenario: Owner opens their Data Room
- **WHEN** the owner requests their Data Room
- **THEN** the response contains its id, name and root folder id

#### Scenario: Another user is not told it exists
- **WHEN** a signed-in user requests a Data Room owned by someone else
- **THEN** the response is 404 with `code: "NOT_FOUND"`

#### Scenario: Listing is scoped to the caller
- **WHEN** a user lists their Data Rooms
- **THEN** only rooms they own are returned

### Requirement: Automatic provisioning
The system SHALL ensure every authenticated user has a Data Room with a root folder, creating it on first access, and provisioning MUST be idempotent under concurrent requests.

#### Scenario: First sign-in lands in a usable room
- **WHEN** a newly registered user opens the application
- **THEN** a Data Room with an empty root folder exists and is displayed

#### Scenario: Concurrent first requests create one room
- **WHEN** two requests for a new user's Data Room arrive at the same time
- **THEN** exactly one Data Room is created and both requests return it

### Requirement: Data Room summary
A Data Room SHALL report the total number of folders, the total number of files and the total size in bytes of everything it contains.

#### Scenario: Summary reflects the whole tree
- **WHEN** the owner requests the Data Room summary
- **THEN** the counts and total size include items at every depth, not only the root

#### Scenario: Empty room
- **WHEN** a Data Room contains nothing
- **THEN** the summary reports zero folders, zero files and zero bytes

### Requirement: Data Room rename
The owner SHALL be able to rename their Data Room; the name MUST be non-empty after trimming and MUST be length-bounded.

#### Scenario: Rename succeeds
- **WHEN** the owner submits a new, valid Data Room name
- **THEN** the Data Room is renamed and the new name appears in the breadcrumb root

#### Scenario: Blank name is refused
- **WHEN** the owner submits a name that is empty or only whitespace
- **THEN** the response is 400 with `code: "VALIDATION_FAILED"` and the name is unchanged

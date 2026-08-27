## ADDED Requirements

### Requirement: Storage provider abstraction
File bytes SHALL be stored in blob storage, never in the database, and all storage access MUST go through one interface offering signed upload URLs, signed download URLs, object deletion and object metadata. No module outside the storage implementation MAY call the provider SDK directly.

#### Scenario: Provider is replaceable
- **WHEN** the storage implementation is swapped for another provider
- **THEN** no file, folder or sharing module changes

#### Scenario: Tests run without a network
- **WHEN** Jest suites exercise upload and delete paths
- **THEN** an in-memory fake satisfies the same interface and no external call is made

### Requirement: Opaque storage keys
Every stored object SHALL be addressed by a server-generated key that includes the Data Room and node identifiers and MUST NOT be derived from the user-supplied file name.

#### Scenario: Renaming does not move bytes
- **WHEN** a file is renamed
- **THEN** its storage key is unchanged and no object is copied

#### Scenario: Names cannot escape the key space
- **WHEN** a file is uploaded with a name containing slashes or traversal sequences
- **THEN** the generated key is unaffected and no object is written outside the Data Room prefix

### Requirement: Signed upload URLs
The API SHALL issue short-lived, single-purpose signed upload URLs that let the browser send bytes directly to storage. Storage credentials MUST never reach the client, and an expired URL MUST be rejected by the provider.

#### Scenario: Browser uploads directly
- **WHEN** a client requests an upload URL and PUTs the file to it
- **THEN** the object is stored and the bytes never pass through the API process

#### Scenario: Expired URL fails
- **WHEN** an upload is attempted with a URL past its expiry
- **THEN** the upload is rejected and the client is told to request a fresh URL

#### Scenario: Credentials stay server-side
- **WHEN** the frontend bundle is inspected
- **THEN** it contains no storage service key

### Requirement: Signed download URLs
Reading a file SHALL be served by a short-lived signed download URL issued only after the caller's access has been checked. Download URLs MUST NOT be cached beyond their lifetime or shared between users.

#### Scenario: Authorised read
- **WHEN** a user with access requests a file's content URL
- **THEN** a signed URL is returned and the PDF loads

#### Scenario: Unauthorised read is refused before signing
- **WHEN** a user without access requests a file's content URL
- **THEN** the response is 404 and no URL is issued

#### Scenario: Link expires
- **WHEN** a signed download URL is used after its expiry
- **THEN** storage refuses it and the UI requests a fresh URL

### Requirement: Blob lifecycle follows the node
Deleting a file node SHALL release its stored object, and deleting a folder SHALL release the objects of every file in its subtree. A storage failure MUST NOT roll back the metadata deletion.

#### Scenario: Deleted file frees its object
- **WHEN** a file is deleted
- **THEN** its stored object is removed

#### Scenario: Storage outage does not block deletion
- **WHEN** object removal fails while deleting a node
- **THEN** the node is still deleted and the object is recorded for a later sweep

### Requirement: Orphan and abandoned-upload cleanup
Uploads that are reserved but never committed SHALL expire, and their reservations and any partially stored objects MUST be removable by a repeatable, idempotent cleanup routine.

#### Scenario: Abandoned upload disappears
- **WHEN** a client requests an upload URL and never commits
- **THEN** after the expiry window the reservation no longer occupies the file name and any stored bytes are removed

#### Scenario: Cleanup is safe to repeat
- **WHEN** the cleanup routine runs twice over the same data
- **THEN** the second run makes no further change and reports no error

#### Scenario: Committed files are never swept
- **WHEN** cleanup runs while a committed file exists
- **THEN** that file and its object are untouched

# sharing Specification

## Purpose
TBD - created by archiving change add-sharing. Update Purpose after archive.
## Requirements
### Requirement: Sharing any item
An owner SHALL be able to share their Data Room, any folder within it, or any single file. Only the owner MAY create, modify or revoke a share.

#### Scenario: Share a whole Data Room
- **WHEN** the owner shares the Data Room
- **THEN** the recipient can read every folder and file it contains, at any depth

#### Scenario: Share a folder
- **WHEN** the owner shares a folder
- **THEN** the recipient can read that folder and everything nested inside it, and nothing outside it

#### Scenario: Share a single file
- **WHEN** the owner shares one file
- **THEN** the recipient can read that file and cannot list the folder containing it

#### Scenario: Only the owner may share
- **WHEN** a user with read access attempts to share the item onward
- **THEN** the request is refused and no share is created

### Requirement: Public link sharing
A share in `PUBLIC_LINK` mode SHALL be readable by anyone holding its link, without signing in. The link token MUST be generated from a cryptographically secure source with enough entropy to resist guessing, and MUST NOT be derived from the item's id or name.

#### Scenario: Anonymous visitor reads a public link
- **WHEN** a signed-out visitor opens a public share link
- **THEN** the shared item is displayed without a sign-in prompt

#### Scenario: Token cannot be guessed from the item
- **WHEN** a share token is inspected
- **THEN** it is unpredictable and reveals neither the node id nor the file name

#### Scenario: Wrong token reveals nothing
- **WHEN** a visitor opens a link with an invalid or unknown token
- **THEN** the response is 404 and gives no hint whether the token ever existed

#### Scenario: Public pages are not indexed
- **WHEN** a crawler requests a public share page
- **THEN** the response instructs it not to index the content

### Requirement: Permissioned sharing
A share in `RESTRICTED` mode SHALL be readable only by the specific people the owner has granted access to, identified by email address and matched case-insensitively. A recipient MUST sign in to read it.

#### Scenario: Granted user reads the item
- **WHEN** a user whose email holds a grant signs in and opens the share
- **THEN** the shared item is displayed

#### Scenario: Ungranted user is refused
- **WHEN** a signed-in user without a grant opens the share link
- **THEN** the response is 404 and the content is not disclosed

#### Scenario: Anonymous visitor is asked to sign in
- **WHEN** a signed-out visitor opens a restricted share link
- **THEN** they are prompted to sign in rather than shown the content

#### Scenario: Invitation precedes registration
- **WHEN** the owner grants access to an email address with no account, and that person later registers with it
- **THEN** the grant applies to their new account without the owner doing anything further

#### Scenario: Grant matching ignores case
- **WHEN** access is granted to `Buyer@Acme.com` and the recipient signs in as `buyer@acme.com`
- **THEN** the grant applies

### Requirement: Inherited access
Access granted on a node SHALL extend to every descendant of that node. Resolution MUST consider the node itself and all of its ancestors, and MUST NOT grant access to anything outside the shared subtree.

#### Scenario: Nested content is included
- **WHEN** a folder three levels deep is shared and it contains further nested folders and files
- **THEN** the recipient can read all of them

#### Scenario: Ancestors stay hidden
- **WHEN** a recipient with access to a nested folder requests its parent
- **THEN** the response is 404

#### Scenario: Siblings stay hidden
- **WHEN** a recipient with access to one folder requests a sibling folder
- **THEN** the response is 404

#### Scenario: Newly added content is covered
- **WHEN** the owner uploads a file into an already-shared folder
- **THEN** the existing recipients can read it without a new share

### Requirement: Shared access is read-only
A share SHALL grant reading only. Every write operation — create, rename, move, upload, delete, and sharing onward — MUST remain restricted to the owner, whatever the share's mode or role.

#### Scenario: Recipient cannot upload
- **WHEN** a recipient attempts to upload into a shared folder
- **THEN** the request is refused and nothing is created

#### Scenario: Recipient cannot rename or delete
- **WHEN** a recipient attempts to rename or delete a shared item
- **THEN** the request is refused and the item is unchanged

#### Scenario: Write controls are absent, not merely disabled
- **WHEN** a recipient views a shared folder
- **THEN** the interface shows no upload, rename, move, delete or share controls

### Requirement: Shared view scope
A shared view SHALL present the shared item as its own root: breadcrumbs stop at the shared item, and no ancestor name, sibling name or Data Room name outside the shared subtree is disclosed.

#### Scenario: Breadcrumbs stop at the share root
- **WHEN** a recipient opens a folder nested inside a shared folder
- **THEN** the breadcrumb starts at the shared folder and shows no ancestor above it

#### Scenario: Names outside the share are not leaked
- **WHEN** a recipient reads any response from a shared view
- **THEN** it contains no names or identifiers of items outside the shared subtree

### Requirement: Revocation
The owner SHALL be able to revoke a share at any time, and revocation MUST take effect immediately for both modes. Revoking a share MUST NOT delete the shared content.

#### Scenario: Revoked link stops working
- **WHEN** the owner revokes a public share
- **THEN** the next request using that link responds 404

#### Scenario: Active viewer loses access
- **WHEN** a recipient has the shared item open and the owner revokes access
- **THEN** their next request is refused and the interface explains that access has ended

#### Scenario: Individual grant removed
- **WHEN** the owner removes one recipient from a restricted share
- **THEN** that person loses access and every other recipient keeps theirs

#### Scenario: Content survives revocation
- **WHEN** a share is revoked
- **THEN** the folder or file itself is untouched and still visible to the owner

### Requirement: Share expiry
A share MAY carry an expiry, after which it SHALL stop granting access without any further owner action.

#### Scenario: Expired share is refused
- **WHEN** a share's expiry has passed
- **THEN** requests using it respond 404

#### Scenario: Expiry is visible to the owner
- **WHEN** the owner reviews an item's shares
- **THEN** each share shows its expiry, or that it does not expire

### Requirement: Share management
The owner SHALL be able to see every share on an item — its mode, recipients, expiry and creation time — and to copy a link, add or remove recipients, and revoke.

#### Scenario: Owner reviews access
- **WHEN** the owner opens the share dialog for an item
- **THEN** every active share is listed with its mode and recipients

#### Scenario: Copying the link
- **WHEN** the owner copies a public share link
- **THEN** the link is placed on the clipboard and the interface confirms it

#### Scenario: Shared items are marked in listings
- **WHEN** a folder or file has an active share
- **THEN** the listing shows a shared indicator on that row

### Requirement: Shared item deleted or moved
When shared content is deleted, or moved outside the shared subtree, recipients SHALL lose access and MUST be told clearly rather than shown a broken view.

#### Scenario: Shared folder is deleted while in use
- **WHEN** the owner deletes a folder that is currently open in a recipient's browser
- **THEN** the recipient's next request responds 404 and the interface states that the item is no longer available

#### Scenario: File moved out of a shared folder
- **WHEN** the owner moves a file from a shared folder to an unshared one
- **THEN** recipients of that folder's share can no longer read the file

#### Scenario: File moved into a shared folder
- **WHEN** the owner moves a file into a shared folder
- **THEN** recipients of that share can read it

#### Scenario: Shares die with their target
- **WHEN** a shared item is deleted
- **THEN** its shares and grants are removed with it and cannot be resurrected

### Requirement: Public access is rate limited
Public share endpoints SHALL be rate limited per client so that tokens cannot be probed in bulk.

#### Scenario: Token probing is throttled
- **WHEN** many requests with different invalid tokens arrive from one client
- **THEN** further requests respond 429 until the window resets


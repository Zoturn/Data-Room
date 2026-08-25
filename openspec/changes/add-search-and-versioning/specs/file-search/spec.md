## ADDED Requirements

### Requirement: Filename search
A user SHALL be able to find files and folders by name across a Data Room. Matching MUST be case-insensitive and MUST match on any part of the name, not only its beginning.

#### Scenario: Partial match anywhere in the name
- **WHEN** the user searches for `q4`
- **THEN** `2024-Q4-report.pdf` is among the results

#### Scenario: Case is ignored
- **WHEN** the user searches for `REPORT`
- **THEN** files named `report.pdf` are returned

#### Scenario: No matches
- **WHEN** a search matches nothing
- **THEN** an empty result set is returned and the interface offers to clear the search

#### Scenario: Short or blank query
- **WHEN** the query is empty or shorter than the minimum length
- **THEN** no search is performed and the interface explains what is needed

### Requirement: Search results are permission-scoped
Search SHALL return only items the caller is allowed to read. A user MUST NOT be able to learn that a file exists through search when they could not reach it by navigation.

#### Scenario: Owner searches their own room
- **WHEN** the owner searches
- **THEN** results cover every folder and file in the Data Room

#### Scenario: Recipient search is confined to the share
- **WHEN** a user with access to one shared folder searches
- **THEN** results contain only items inside that shared subtree

#### Scenario: Stranger gets nothing
- **WHEN** a signed-in user with no access searches another user's Data Room
- **THEN** the response is 404 or empty, and no name is disclosed

#### Scenario: Public share search stays in scope
- **WHEN** a search is performed within a public share
- **THEN** only items within the shared subtree are returned

### Requirement: Scoped and filtered search
Search SHALL accept a folder to search within, restricting results to that folder's subtree, and SHALL support filtering by item type and choosing a sort order.

#### Scenario: Search within a folder
- **WHEN** the user searches while inside `Financials`
- **THEN** only items inside `Financials` and its descendants are returned

#### Scenario: Filter to files only
- **WHEN** the user filters results to files
- **THEN** no folders appear in the results

#### Scenario: Sort choice is honoured
- **WHEN** the user sorts results by most recently updated
- **THEN** results are ordered accordingly and paging preserves that order

### Requirement: Search result context
Each result SHALL identify the item, its type, its containing folder and its last-updated time, and SHALL be navigable to that item in place.

#### Scenario: Result shows where it lives
- **WHEN** results are displayed
- **THEN** each row names the folder containing the item

#### Scenario: Navigating to a result
- **WHEN** the user opens a result
- **THEN** the application navigates to that file's viewer or that folder's contents

#### Scenario: Container is not disclosed beyond scope
- **WHEN** a result is shown inside a shared view
- **THEN** the containing folder shown is within the shared subtree and never above it

### Requirement: Search pagination and responsiveness
Search results SHALL use the same cursor pagination envelope as other lists, and the interface SHALL debounce input so typing does not issue a request per keystroke.

#### Scenario: Paging through many matches
- **WHEN** a search matches more items than one page
- **THEN** a cursor is returned and following it yields the remaining results without repetition

#### Scenario: Typing is debounced
- **WHEN** the user types a query quickly
- **THEN** requests are coalesced and stale responses never overwrite newer results

### Requirement: Search performance at scale
Name matching SHALL be served by an index rather than a full scan, so that search stays responsive in a Data Room holding six figures of items.

#### Scenario: Large room stays responsive
- **WHEN** a Data Room holds 100,000 items and a search is performed
- **THEN** the query plan uses the name index and the response returns within the interface's responsiveness budget

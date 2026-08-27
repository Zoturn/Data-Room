## Why

A Data Room exists to be shown to someone else — that is the whole premise of due diligence. The product so far is private to its owner: there is no way to let a counterparty read a document without handing over an account. This change adds read-only sharing of a Data Room, a folder or a single file, in the two modes the brief names, with revocation that takes effect immediately.

## What Changes

- Add a `Share` targeting any node — the Data Room root, a folder, or a file — in one of two modes: `PUBLIC_LINK` (anyone holding the link may read) or `RESTRICTED` (only named people may read), carrying a role that is `VIEWER` today.
- Add a `ShareGrant` naming a recipient by email, bound to a user account when that email signs in, so a person can be invited before they have registered.
- Add access resolution: a caller may read a node when they own it, or when a share exists on that node or on any of its ancestors and their identity satisfies that share's mode. Access granted on a folder covers its whole subtree.
- Make sharing read-only without exception: every write endpoint stays owner-only, so a share can never be escalated into an edit.
- Add a public share route requiring no account, serving only the shared subtree, with breadcrumbs that stop at the shared root so nothing above it is disclosed.
- Add revocation, immediate for both modes, plus optional expiry, and removal of an individual grant without disturbing the rest.
- Add owner-facing management: a share dialog per item, a list of who has access, and the ability to copy, revoke or expire a link.
- Define the behaviour when a shared item is deleted or moved out from under an active viewer.
- Rate-limit and make unguessable the public token, and keep shared views out of search engines.

## Capabilities

### New Capabilities
- `sharing`: share creation and modes, recipient grants, inherited access resolution, the read-only guarantee, public access without an account, and revocation.

### Modified Capabilities
None. The `data-room`, `folders` and `files` requirements were written as owner-only *until access is granted*, so this change satisfies that clause rather than altering it.

## Impact

- New `Share` and `ShareGrant` tables, and a token column that must be indexed and unguessable.
- Every read endpoint moves from "is the caller the owner" to "resolve the caller's access", so the access resolver becomes the most security-sensitive code in the repository and needs the heaviest tests.
- New public, unauthenticated routes — the first endpoints deliberately marked public since auth was introduced.
- Answers the README's third scaling question (extending to per-user viewer/editor roles without remodelling) in this change's design.

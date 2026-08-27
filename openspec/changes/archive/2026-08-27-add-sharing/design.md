## Context

Until now one rule governed every read: *are you the owner?* Sharing replaces it with a resolution step, and that step becomes the security boundary of the whole product — a mistake in it discloses confidential acquisition documents to the wrong party. The brief asks for two modes (public link, named recipients), read-only access, inheritance down a subtree, and revocation, and the README must explain how this extends to viewer/editor roles later without remodelling.

The tree model helps here: because every node already carries its ancestor chain in `path`, "is this node inside something shared with you" is answerable without walking parents one at a time.

## Goals / Non-Goals

**Goals:**
- One access resolver that every read passes through, and no read that bypasses it.
- Inheritance that is cheap — a shared subtree of any depth costs the same lookup.
- Revocation that is immediate, with no cached grant outliving it.
- A shared view that discloses the subtree and nothing above or beside it.

**Non-Goals:**
- Editor or commenter roles. The column exists; only `VIEWER` is issued, and the README explains the upgrade path.
- Password-protected links, watermarking, download disabling, or per-recipient access logs — all real data-room features, none in the brief.
- Email delivery of invitations. Grants are created; the owner sends the link.
- Re-sharing by recipients.

## Decisions

### Shares point at a node, never at a "resource type"
Because folders and files are both `Node` rows, `Share { id, nodeId, mode, role, token, expiresAt, revokedAt, createdBy }` covers all three cases the brief lists — Data Room, folder, file — with no polymorphic target and no branching in the resolver. Sharing the Data Room is sharing its root node, which is why the root is a real row.
*Alternative:* separate `DataRoomShare` / `FolderShare` / `FileShare` tables — three code paths, three resolvers, three chances to get it wrong.

### Resolution reads the ancestor chain, which is already in hand
For node `N`, the candidate shares are those on `N` itself and on every ancestor — and the ancestor ids are literally the segments of `N.path`. One query:

```sql
SELECT * FROM shares
WHERE node_id = ANY($ancestorIdsIncludingSelf)
  AND revoked_at IS NULL
  AND (expires_at IS NULL OR expires_at > now());
```

A `PUBLIC_LINK` share matches when the request carries its token; a `RESTRICTED` share matches when the signed-in user holds a grant on it. Cost is one indexed lookup regardless of depth, and inheritance falls out for free — a file uploaded into a shared folder tomorrow is covered by the same query, with nothing to propagate.
*Alternatives:* recursive walk up `parentId` (a query per level); denormalising grants onto every descendant (fast reads, and a share of a 100,000-file room writes 100,000 rows, with every move needing a re-propagation).

### Grants are stored by email, bound to a user on sign-in
`ShareGrant { id, shareId, email (normalised), userId?, role }`. The owner invites `buyer@acme.com` before that person has an account; when they register or sign in with that address, the grant resolves to their user id. Matching is on the same normalised email used by authentication, so `Buyer@Acme.com` and `buyer@acme.com` are one person.
*Risk accepted:* whoever controls the address gets the access. That is the property email invitations have everywhere, and it is why the restricted mode requires signing in rather than trusting a claimed address.

### Read-only is enforced by shape, not by a role check
Write endpoints keep the owner guard they already have; the access resolver is wired only into read paths. A recipient cannot escalate because there is no code path where a share is consulted for a write. The `role` column exists to make the future explicit, but today nothing reads it for authorisation beyond confirming it is `VIEWER`.

### Answering the README: viewer/editor roles without remodelling
The model is already role-shaped: `Share.role` and `ShareGrant.role` exist, so adding `EDITOR` adds no table and no migration beyond an enum value. What changes is where the resolver is consulted — a single capability matrix maps role → permitted operations (`VIEWER: {read}`, `EDITOR: {read, create, rename, move, upload}`), the write guards call the same resolver instead of the owner check, and the frontend renders controls from the same matrix rather than from `isOwner`. Two properties make this cheap: the grant is per-share and per-user, so different recipients on one share can hold different roles; and resolution already returns the *most permissive* matching share, so a user granted viewer on a Data Room and editor on one folder inside it gets exactly what you would expect. Deliberately deferred, because a role that is not enforced everywhere is worse than no role at all.

### Public routes are a separate, narrow surface
Public share endpoints are marked `@Public()` and accept a token, not a session. They serve only the shared subtree, re-rooting breadcrumbs at the share target so nothing above it is named. Tokens are 256 bits from a CSPRNG, stored with a unique index, and never derived from a node id. Responses carry `X-Robots-Tag: noindex` and the page a `noindex` meta tag.

### Revocation is a timestamp, checked on every request
`revokedAt` and `expiresAt` are evaluated inside the resolver, so revocation takes effect on the next request with nothing to invalidate. The frontend never caches an authorisation decision — it caches data, and a 404 clears it.
*Alternative:* deleting the share row — loses the record that access once existed, which is worth keeping for a document vault.

### Moves and deletes change access implicitly, and that is correct
Access follows the tree. Move a file out of a shared folder and its recipients lose it; move it in and they gain it. Delete a shared node and its shares cascade away. The alternative — pinning access to items that have left the shared subtree — would be a leak with a friendly face. Recipients are shown a plain "no longer available" state rather than a broken view.

## Risks / Trade-offs

- **The resolver is the whole security model.** One read endpoint that queries by id without it leaks documents. → Reads go through one guarded repository method that requires a resolved access context; a Cypress API suite probes every read endpoint as owner, as recipient, as stranger and as anonymous.
- **404-for-everything makes debugging harder.** A recipient who genuinely lost access sees the same thing as a typo'd link. → The UI distinguishes "this link no longer works" from "not found" using the share endpoint's own response, without disclosing anything to a stranger.
- **A public link is a bearer credential.** Forwarded, it grants access to whoever holds it. → That is what the brief asked for; the owner gets expiry, immediate revocation and a visible list of active links, and the share dialog says plainly that anyone with the link can view.
- **Email-based grants trust email control.** → Restricted mode requires sign-in, and the grant binds to the account that proves control of the address.
- **Token probing.** → 256-bit tokens, uniform 404s, and rate limiting on the public surface.
- **Shared subtree scope depends on `path` being correct.** A move that fails to rewrite paths would silently widen or narrow access. → The move invariant tests from `add-file-management` gain an access assertion.

## Migration Plan

Additive migration creating `shares` (unique index on `token`, index on `nodeId`, partial index on active shares) and `share_grants` (unique on `(shareId, email)`, index on `userId`), with `ON DELETE CASCADE` from `nodes` so shares die with their target. No backfill.

Sequence: resolver and tests → wire it into every read endpoint → share management endpoints → public routes → frontend share dialog and shared views. Wiring the resolver before the UI means the read paths are already correct when the first link is generated.

Rollback drops both tables; existing content and ownership are unaffected.

## Open Questions

- Should a restricted share list its other recipients to a recipient? Leaning no — in an acquisition, who else is in the room is itself sensitive.
- Should the owner see when a link was last opened? Useful and cheap, but it is an access log, which is out of scope; revisit if time remains.

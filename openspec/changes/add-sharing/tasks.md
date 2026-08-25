## 1. Data model

- [ ] 1.1 Add the `Share` model: id, nodeId, `mode` (`PUBLIC_LINK` | `RESTRICTED`), `role` (`VIEWER`), token, `expiresAt`, `revokedAt`, createdBy, timestamps
- [ ] 1.2 Add the `ShareGrant` model: id, shareId, normalised email, optional userId, `role`
- [ ] 1.3 Add the unique index on `Share.token`, the index on `Share.nodeId`, the unique `(shareId, email)` and the index on `ShareGrant.userId`
- [ ] 1.4 Cascade shares and grants from `nodes` so they die with their target
- [ ] 1.5 Run the migration

## 2. Access resolver

- [ ] 2.1 Implement `resolveAccess(nodeId, principal)` — owner, public token, or granted user — returning the effective role, the matched share and the share root, or no access
- [ ] 2.2 Derive the ancestor id list from `path` and match candidate shares in one query, excluding revoked and expired
- [ ] 2.3 Return the most permissive match when several shares apply
- [ ] 2.4 Add the capability matrix (`VIEWER: {read}`) and read authorisation from it, not from scattered conditionals
- [ ] 2.5 Add the guarded read method every read path must call, so a raw find-by-id cannot reach a controller

## 3. Wiring existing reads

- [ ] 3.1 Route folder metadata, children and breadcrumbs through the resolver
- [ ] 3.2 Route file metadata and the content URL through the resolver
- [ ] 3.3 Route Data Room reads through the resolver
- [ ] 3.4 Re-root breadcrumbs at the share root and strip anything above it from every response
- [ ] 3.5 Confirm every write endpoint still requires ownership and never consults a share

## 4. Share management endpoints

- [ ] 4.1 `POST /nodes/:id/shares` — create a share in either mode, generating a 256-bit token
- [ ] 4.2 `GET /nodes/:id/shares` — list active shares with mode, recipients, expiry and creation time
- [ ] 4.3 `POST /shares/:id/grants` — add recipients by email, normalised, idempotent per address
- [ ] 4.4 `DELETE /shares/:id/grants/:grantId` — remove one recipient
- [ ] 4.5 `PATCH /shares/:id` — set or clear an expiry
- [ ] 4.6 `DELETE /shares/:id` — revoke, immediately and without touching content
- [ ] 4.7 Bind pending grants to a user when that email registers or signs in

## 5. Public share surface

- [ ] 5.1 `GET /public/shares/:token` — resolve the share and return the shared root, or 404
- [ ] 5.2 `GET /public/shares/:token/nodes/:id` and `/children` — serve only within the shared subtree
- [ ] 5.3 `GET /public/shares/:token/files/:id/content-url` — signed URL after resolution
- [ ] 5.4 Mark the public routes `@Public()`, rate limit them, and return uniform 404s for unknown, revoked and expired tokens
- [ ] 5.5 Send `X-Robots-Tag: noindex` on public responses

## 6. Owner-facing interface

- [ ] 6.1 Build the share dialog: choose mode, generate and copy a link, state plainly that anyone with the link can view
- [ ] 6.2 Build recipient management: add by email with validation, list, remove
- [ ] 6.3 Add expiry selection and display
- [ ] 6.4 Add revoke with a confirmation that says access ends immediately and content is kept
- [ ] 6.5 Add the shared indicator to folder and file rows, and a way to reach the dialog from the row menu

## 7. Recipient-facing interface

- [ ] 7.1 Build the public share route: no chrome that implies ownership, breadcrumbs rooted at the shared item
- [ ] 7.2 Render a shared folder's contents and a shared file's viewer read-only, with no write controls present at all
- [ ] 7.3 Prompt sign-in for a restricted share opened while signed out, returning to the share afterwards
- [ ] 7.4 Show "this link no longer works" for a revoked or expired share, and "no longer available" when the item was deleted or moved out of scope
- [ ] 7.5 Add the `noindex` meta tag to shared pages

## 8. Tests

- [ ] 8.1 Jest — resolver truth table: owner, public token, granted user, ungranted user, anonymous, revoked, expired, ancestor share, sibling, parent
- [ ] 8.2 Jest — most permissive match wins when shares overlap
- [ ] 8.3 Jest — grant binding on registration, case-insensitive email matching
- [ ] 8.4 Jest — moving a node in and out of a shared subtree changes access accordingly
- [ ] 8.5 Cypress API — every read endpoint probed as owner, recipient, stranger and anonymous
- [ ] 8.6 Cypress API — every write endpoint refused for a recipient
- [ ] 8.7 Cypress API — revocation and expiry take effect on the next request; unknown tokens return uniform 404s; probing is throttled
- [ ] 8.8 Cypress component — share dialog modes, recipient list, revoke confirmation
- [ ] 8.9 Cypress e2e — owner shares a folder publicly, an anonymous visitor reads it, the owner revokes, the visitor is refused
- [ ] 8.10 Cypress e2e — owner grants a second account, that user signs in and reads, is removed, and loses access

## 9. Close out

- [ ] 9.1 Write the sharing model and the viewer/editor extension answer into the README's ERD and "How it scales" sections
- [ ] 9.2 Run `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e` clean
- [ ] 9.3 Run `openspec validate --all --strict`
- [ ] 9.4 Archive the change and act on everything the docs-sync hook reports

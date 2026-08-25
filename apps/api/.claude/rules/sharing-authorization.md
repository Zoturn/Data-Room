---
paths:
  - "apps/api/src/sharing/**/*.ts"
  - "apps/api/src/**/*access*.ts"
  - "apps/api/src/search/**/*.ts"
---

# Sharing and access resolution

**Scope:** who may read what. This is the security boundary of the product — a mistake here discloses confidential documents to the wrong party.

## Rules

1. Every read passes through `resolveAccess(nodeId, principal)`. There is no second way to decide whether a caller may see something, and no controller may reach a node without an access context.
2. Resolution considers the node itself **and every ancestor**, taken from `Node.path`, in one query. Never walk parents in a loop, and never denormalise grants onto descendants.
3. A share matches only when it is neither revoked nor expired. Both are evaluated on every request, so revocation takes effect immediately with nothing to invalidate.
4. `PUBLIC_LINK` matches when the request carries that share's token. `RESTRICTED` matches when the signed-in user holds a grant on it, compared on the normalised email. An anonymous caller never satisfies a restricted share.
5. When several shares apply, the most permissive wins — a user who is a viewer on the Data Room and something stronger on one folder gets the stronger access inside that folder.
6. Sharing grants **read only**. Write endpoints keep the ownership guard and must never consult the resolver. There is deliberately no code path in which a share authorises a mutation.
7. Only the owner may create, modify or revoke a share. A recipient cannot share onward.
8. A shared response is re-rooted at the share target: breadcrumbs start there, and no ancestor name, sibling name or Data Room name from outside the shared subtree appears in any payload.
9. Denials are 404 with a uniform body — for a wrong token, a revoked share, an expired share and a node the caller cannot see alike. Never distinguish them to an unauthenticated caller.
10. Tokens are 256 bits from a CSPRNG, unique-indexed, and never derived from a node id or a name.
11. Search obeys the same boundary by construction: the scope is always a path prefix or a Data Room id, and the name predicate is `AND`ed onto it. Never match names first and filter results afterwards — that leaks existence through counts and timing, and breaks pagination.
12. Access changes with the tree, and that is intended: moving a node out of a shared subtree removes access, moving one in grants it, and deleting a node cascades its shares away.

## Examples

```ts
// one query, whatever the depth
const ancestorIds = [...idsFromPath(node.path), node.id];
const shares = await this.prisma.share.findMany({
  where: {
    nodeId: { in: ancestorIds },
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  },
});
```

```ts
// scope first, match second — search can never widen the boundary
const scope = access.shareRoot
  ? Prisma.sql`path LIKE ${access.shareRoot} || '%'`
  : Prisma.sql`data_room_id = ${access.dataRoomId}::uuid`;
```

## Anti-patterns

- A read endpoint that calls `findUnique` by id and checks `ownerId` inline.
- Consulting a share to decide whether a write is allowed.
- Returning 403 for a share the caller does not hold.
- Different responses for "unknown token" and "revoked token" on the public surface.
- Caching a resolved access decision anywhere — revocation must not have a window.
- Searching by name and then filtering the page by permission.

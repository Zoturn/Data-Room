import { Injectable } from "@nestjs/common";
import type { ShareRole } from "@data-room/shared";
import type { AuthUser } from "../auth/jwt-auth.guard";
import { ancestorIdsOf } from "../folders/folders.repository";
import { hashShareToken, isShareTokenShaped } from "./share-token";

/**
 * The slice of a node that deciding access needs: which node is being asked for, the ancestor
 * chain it hangs under, and who owns the room holding it.
 *
 * `path` rather than `parentId` is the whole reason resolution is one query: a node's path is
 * already the ordered list of its ancestors' ids, so "is this inside something shared with
 * you" is answerable without a round trip per level (see design.md, "Resolution reads the
 * ancestor chain, which is already in hand").
 */
export type OwnedNode = {
  id: string;
  path: string;
  ownerId: string;
};

/**
 * A node read from the database with no authorisation decision attached to it yet.
 *
 * Deliberately not a bare record: the read paths' repository methods return this wrapper, so
 * the only way to obtain something a listing or a breadcrumb query will accept is to pass it
 * through `NodeAccessService.requireReadable`. A raw find-by-id therefore cannot reach a
 * controller by accident — it does not have the type the controller's next call needs.
 */
export type NodeWithOwner<T> = {
  node: T;
  ownerId: string;
};

/**
 * Who is asking, as far as a read path is concerned.
 *
 * Both halves are optional and independent: an owner arrives with a session and no token, an
 * anonymous visitor with a token and no session, and a signed-in recipient following a public
 * link with both. Read paths take the principal rather than a user so that the public surface
 * can reuse the same service methods instead of growing a parallel set that has to be kept
 * correct twice.
 */
export type ReadPrincipal = {
  user: AuthUser | null;
  token: string | null;
};

/**
 * The outcome of a resolution.
 *
 * `rootNodeId` is the node the matched share points at — the top of what this caller may see.
 * Every response re-roots its breadcrumbs there, so nothing above the shared item is named.
 */
export type Access =
  | { kind: "owner" }
  | { kind: "share"; shareId: string; role: ShareRole; rootNodeId: string }
  | { kind: "none" };

export const NO_ACCESS: Access = { kind: "none" };

/**
 * What a role may do. One capability today, because sharing is read-only.
 *
 * A matrix rather than conditionals scattered through the services: when `EDITOR` arrives it
 * is a row here plus the write guards calling the resolver, and there is one place to read to
 * learn what a role means. A conditional per call site is how a role ends up enforced in four
 * places and forgotten in the fifth.
 */
export type Capability = "read";

const CAPABILITIES: Readonly<Record<ShareRole, readonly Capability[]>> = {
  VIEWER: ["read"],
};

/**
 * Whether an access grants a capability. The owner is deliberately not a row in the matrix:
 * owning the room is not a role, and giving it one would make it expressible for an owner to
 * hold less than everything.
 */
export function can(access: Access, capability: Capability): boolean {
  if (access.kind === "owner") return true;
  if (access.kind === "none") return false;

  return CAPABILITIES[access.role].includes(capability);
}

/**
 * How permissive a role is, for choosing between shares that all apply. Ranked rather than
 * compared by name so that inserting `EDITOR` above `VIEWER` is one line.
 */
const ROLE_RANK: Readonly<Record<ShareRole, number>> = {
  VIEWER: 1,
};

/** A share that survived the active-and-matching filter, as resolution needs to see it. */
export type ShareCandidate = {
  id: string;
  nodeId: string;
  role: ShareRole;
};

/**
 * The one question resolution asks the database.
 *
 * `now` is a parameter rather than read inside the store, so that an expiry boundary is
 * testable without moving the system clock and so everything about one request agrees on what
 * time it was.
 */
export type ShareResolutionQuery = {
  /** The node itself and every ancestor, root first. */
  nodeIds: readonly string[];
  /** Matches a `PUBLIC_LINK` share. Null when the caller presented no link. */
  tokenHash: string | null;
  /** Matches a `RESTRICTED` share through a bound grant. Null when the caller has no session. */
  userId: string | null;
  now: Date;
};

/**
 * Everything the resolver needs from the database, as an abstract class so it doubles as an
 * injection token and a unit test can substitute an in-memory double.
 *
 * An implementation must apply every filter *in the query* — revoked, expired, and whether the
 * presented principal actually matches. Handing back rows for the caller to sift through would
 * put the security decision in two places, and the second place is where it gets forgotten.
 */
export abstract class ShareResolutionStore {
  abstract findActiveShares(query: ShareResolutionQuery): Promise<ShareCandidate[]>;
}

/**
 * The security boundary of the product: given a node and whoever is asking, what may they do?
 *
 * An abstract class so read paths depend on the decision rather than on Prisma, and so a unit
 * test can state a truth table directly instead of building a database.
 */
export abstract class AccessResolver {
  /** Signed-in caller, optionally carrying a public token. Either half may be absent. */
  abstract resolve(node: OwnedNode, user: AuthUser | null, token: string | null): Promise<Access>;
}

/**
 * Resolution, in one query over the ancestor chain.
 *
 * The order of the two steps is the design. Ownership is answered from the node itself and
 * never consults `shares` — so an owner whose room has no shares at all pays nothing, and no
 * share can ever be the reason an owner is refused. Only when the caller is not the owner does
 * the share lookup happen, and it happens once for the whole chain however deep it is.
 */
@Injectable()
export class ShareAccessResolver extends AccessResolver {
  constructor(private readonly shares: ShareResolutionStore) {
    super();
  }

  override async resolve(
    node: OwnedNode,
    user: AuthUser | null,
    token: string | null,
  ): Promise<Access> {
    if (user !== null && user.id === node.ownerId) return { kind: "owner" };

    // A string that cannot be a token this generator produced is rejected without a round
    // trip, so a probing client cannot use response time to tell "no such share" apart from
    // "not even a token". It decides nothing about access — the hash lookup below does that.
    const tokenHash = token !== null && isShareTokenShaped(token) ? hashShareToken(token) : null;
    const userId = user?.id ?? null;

    // Nothing to match on: an anonymous caller with no link. Answered here rather than left to
    // the store, so that "no principal" can never turn into "no principal filter" in a query.
    if (tokenHash === null && userId === null) return NO_ACCESS;

    // Root first, the node itself last — the order the depth tie-break below depends on.
    const chain = [...ancestorIdsOf(node.path), node.id];

    const candidates = await this.shares.findActiveShares({
      nodeIds: chain,
      tokenHash,
      userId,
      now: new Date(),
    });

    return mostPermissive(candidates, chain);
  }
}

/**
 * The winner when several shares apply — a link to a folder and a named grant on the room
 * above it, say.
 *
 * Most permissive means, in order: the higher role; then the *shallower* share, because the
 * one nearer the root exposes the wider subtree and re-roots breadcrumbs higher; then the
 * lower id, purely so two otherwise identical shares always resolve the same way and a
 * response cannot flip between requests.
 */
function mostPermissive(candidates: readonly ShareCandidate[], chain: readonly string[]): Access {
  let best: ShareCandidate | null = null;
  let bestDepth = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const depth = chain.indexOf(candidate.nodeId);

    // A share on a node outside the chain cannot have come from this query. Skipping it rather
    // than trusting it means a widened `where` clause cannot silently grant access to a
    // sibling subtree; it would have to be noticed as a missing result instead.
    if (depth < 0) continue;

    if (best === null || beats(candidate, depth, best, bestDepth)) {
      best = candidate;
      bestDepth = depth;
    }
  }

  if (best === null) return NO_ACCESS;

  return { kind: "share", shareId: best.id, role: best.role, rootNodeId: best.nodeId };
}

function beats(
  candidate: ShareCandidate,
  depth: number,
  incumbent: ShareCandidate,
  incumbentDepth: number,
): boolean {
  const rank = ROLE_RANK[candidate.role];
  const incumbentRank = ROLE_RANK[incumbent.role];

  if (rank !== incumbentRank) return rank > incumbentRank;
  if (depth !== incumbentDepth) return depth < incumbentDepth;

  return candidate.id < incumbent.id;
}

/**
 * The breadcrumb chain as this caller may see it: everything above the share root removed.
 *
 * An owner keeps the full chain. A recipient of a share on `Financials` sees `Financials` as
 * their root and never learns the name of the room it sits in — which in an acquisition is
 * itself sensitive, since the room is usually named after the target.
 *
 * A root that is not in the chain leaves the chain unchanged. That cannot happen for a
 * resolved access, because the share root is by construction the node or one of its ancestors.
 */
export function rerootBreadcrumbs<T extends { id: string }>(
  breadcrumbs: readonly T[],
  access: Access,
): T[] {
  if (access.kind !== "share") return [...breadcrumbs];

  const start = breadcrumbs.findIndex((crumb) => crumb.id === access.rootNodeId);

  return start < 0 ? [...breadcrumbs] : breadcrumbs.slice(start);
}

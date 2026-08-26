import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  ShareResolutionStore,
  type ShareCandidate,
  type ShareResolutionQuery,
} from "./access.resolver";

/**
 * Explicit columns, so a field added to the model later cannot widen what leaves this
 * repository by accident. `tokenHash` is the one this matters most for: resolution matches on
 * it but never reads it back, so there is no field here for a later refactor to log or
 * serialise (prisma-data-model.md rule 11).
 */
const CANDIDATE_SELECT = {
  id: true,
  nodeId: true,
  role: true,
} satisfies Prisma.ShareSelect;

/**
 * The Prisma side of resolution: one indexed lookup over the node and its ancestors.
 *
 * Every part of the decision is in this `where` clause, and that is deliberate. Reading the
 * candidate shares and then filtering them in TypeScript would work exactly as well until the
 * day someone adds an early `return` above the filter — at which point revoked links start
 * opening documents. Here, a row that comes back has already proven it is active and that it
 * matches the principal who asked.
 */
@Injectable()
export class PrismaShareResolutionStore extends ShareResolutionStore {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  override async findActiveShares(query: ShareResolutionQuery): Promise<ShareCandidate[]> {
    const principals: Prisma.ShareWhereInput[] = [];

    // A public link matches on the hash of the presented token and nothing else — not on the
    // node, not on a session. Whoever holds the link is the principal, which is precisely what
    // "anyone with the link can view" means.
    if (query.tokenHash !== null) {
      principals.push({ mode: "PUBLIC_LINK", tokenHash: query.tokenHash });
    }

    // A restricted share matches through a grant already bound to this account. Binding
    // happens when the person proves they hold the address, at sign-in — an unbound grant
    // names an email nobody has yet demonstrated control of, and matching on it would let an
    // attacker who merely claims the address in.
    if (query.userId !== null) {
      principals.push({ mode: "RESTRICTED", grants: { some: { userId: query.userId } } });
    }

    // No principal, no query. The resolver already refuses this case; returning early here as
    // well means the empty `OR` — which Postgres reads as "match nothing", but which is easy
    // to mis-assemble into "match everything" — is never built at all.
    if (principals.length === 0) return [];

    return this.prisma.share.findMany({
      where: {
        // The node itself and every ancestor. Inheritance is this line: a file uploaded into a
        // shared folder tomorrow is covered with nothing to propagate, because its path
        // already names the folder that carries the share.
        nodeId: { in: [...query.nodeIds] },
        // Revocation is immediate for this reason, and only this reason: there is no cached
        // grant, no session to invalidate and no job to wait for.
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: query.now } }],
        AND: [{ OR: principals }],
      },
      select: CANDIDATE_SELECT,
    });
  }
}

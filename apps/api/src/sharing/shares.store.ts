import { Injectable } from "@nestjs/common";
import { z } from "zod";
import type { Page, Share } from "@data-room/shared";
import { encodeCursor, decodeCursor } from "../common/pagination/cursor";
import { toPage } from "../common/pagination/paginate";
import { COMMITTED_ONLY } from "../folders/folders.repository";
import { PrismaService } from "../prisma/prisma.service";
import { PendingGrantBinder, ShareStore, type NewShare, type ShareRecord } from "./shares.service";

/**
 * Ids reach here straight from a URL, and a non-UUID handed to a `uuid` column raises rather
 * than missing — which would turn a mistyped link into a 500 and, worse, make a malformed id
 * distinguishable from a real one belonging to somebody else. Both must be 404.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Explicit columns, so a field added to the model later cannot widen what leaves this store by
 * accident. `tokenHash` is the field this matters most for: it is absent here, and therefore
 * absent from every record, response and log line downstream, by construction rather than by
 * everybody remembering to strip it.
 */
const SHARE_SELECT = {
  id: true,
  nodeId: true,
  createdBy: true,
  mode: true,
  role: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  node: { select: { name: true } },
  grants: {
    select: { id: true, shareId: true, email: true, userId: true, acceptedAt: true },
    orderBy: { email: "asc" },
  },
} as const;

/**
 * The row shape `SHARE_SELECT` produces, written structurally rather than imported from the
 * generated client, so this file states what it depends on instead of inheriting whatever the
 * model happens to hold.
 */
type ShareRow = {
  id: string;
  nodeId: string;
  createdBy: string;
  mode: Share["mode"];
  role: Share["role"];
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  node: { name: string };
  grants: {
    id: string;
    shareId: string;
    email: string;
    userId: string | null;
    acceptedAt: Date | null;
  }[];
};

function toRecord(row: ShareRow): ShareRecord {
  return {
    id: row.id,
    nodeId: row.nodeId,
    nodeName: row.node.name,
    createdBy: row.createdBy,
    mode: row.mode,
    role: row.role,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    grants: row.grants.map((grant) => ({
      id: grant.id,
      shareId: grant.shareId,
      email: grant.email,
      userId: grant.userId,
      acceptedAt: grant.acceptedAt,
    })),
  };
}

/** Newest first, so the cursor sorts on the same tuple the listing does. */
const shareCursorSchema = z.object({ createdAt: z.string(), id: z.string().uuid() });

function afterShareCursor(cursor: z.infer<typeof shareCursorSchema>) {
  const createdAt = new Date(cursor.createdAt);

  // Two shares created in the same millisecond are common — a client that creates one per
  // recipient does exactly that — so the id breaks the tie and keeps the page boundary stable.
  return {
    OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: cursor.id } }],
  };
}

/**
 * The Prisma-backed `ShareStore`.
 *
 * Ownership is a `where` clause on every method that takes one — `node.dataRoom.ownerId` — and
 * never a check performed on a row that was already read. A share in somebody else's Data Room
 * simply does not match, so the service turns "no row" into a 404 and there is no code path
 * that could answer 403 and thereby confirm the share exists.
 *
 * Ownership follows the *node*, not `createdBy`: a share outlives the session that made it, and
 * the person who may take it back is whoever owns the room today.
 */
@Injectable()
export class PrismaShareStore extends ShareStore {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  /**
   * `COMMITTED_ONLY` matters here: a `PENDING` row is a name reservation, not a file, and a
   * share created against one would either resolve to nothing or, once the sweep removed it,
   * cascade away — both of which look to an owner like sharing silently failed.
   */
  override async findOwnedNode(nodeId: string, ownerId: string): Promise<{ id: string } | null> {
    if (!isUuid(nodeId)) return null;

    return this.prisma.node.findFirst({
      where: { AND: [{ id: nodeId, dataRoom: { ownerId } }, COMMITTED_ONLY] },
      select: { id: true },
    });
  }

  /**
   * The share and its grants as one unit. If a grant insert fails, the share must not exist
   * either — a restricted share with no recipients is indistinguishable from one whose
   * recipients were lost, and the owner would have no reason to look.
   */
  override async createShare(share: NewShare): Promise<ShareRecord> {
    const row = await this.prisma.share.create({
      // Columns listed one by one rather than spread from the input, so a field added to
      // `NewShare` later cannot reach a column without somebody deciding that it should.
      data: {
        nodeId: share.nodeId,
        createdBy: share.createdBy,
        mode: share.mode,
        tokenHash: share.tokenHash,
        expiresAt: share.expiresAt,
        grants: { create: share.emails.map((email) => ({ email })) },
      },
      select: SHARE_SELECT,
    });

    return toRecord(row);
  }

  override async findOwnedShare(shareId: string, ownerId: string): Promise<ShareRecord | null> {
    if (!isUuid(shareId)) return null;

    const row = await this.prisma.share.findFirst({
      where: { id: shareId, node: { dataRoom: { ownerId } } },
      select: SHARE_SELECT,
    });

    return row === null ? null : toRecord(row);
  }

  override async listSharesForNode(
    nodeId: string,
    ownerId: string,
    limit: number,
    cursor: string | undefined,
  ): Promise<Page<ShareRecord>> {
    const after =
      cursor === undefined ? undefined : afterShareCursor(decodeCursor(cursor, shareCursorSchema));

    // The owner predicate is repeated even though the caller resolved the node first: this is
    // the query that returns the rows, and a filter that lives only in an earlier statement is
    // one refactor away from being the filter that was dropped.
    const rows = await this.prisma.share.findMany({
      where:
        after === undefined
          ? { nodeId, node: { dataRoom: { ownerId } } }
          : {
              AND: [{ nodeId, node: { dataRoom: { ownerId } } }, after],
            },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      // One more than asked for: the extra row is what proves another page exists, so no
      // COUNT(*) is needed to decide whether to hand back a cursor.
      take: limit + 1,
      select: SHARE_SELECT,
    });

    return toPage(rows, limit, toRecord, (row) =>
      encodeCursor({ createdAt: row.createdAt.toISOString(), id: row.id }),
    );
  }

  /**
   * `revokedAt` is set only while it is null, so two simultaneous revocations agree on when
   * access ended rather than the later one moving the timestamp forward. The re-read is what
   * returns the row either way — the loser of that race has nothing to complain about, because
   * the share is revoked, which is what it asked for.
   */
  override async revoke(shareId: string, revokedAt: Date): Promise<ShareRecord> {
    await this.prisma.share.updateMany({
      where: { id: shareId, revokedAt: null },
      data: { revokedAt },
    });

    return this.require(shareId);
  }

  override async setExpiry(shareId: string, expiresAt: Date | null): Promise<ShareRecord> {
    const row = await this.prisma.share.update({
      where: { id: shareId },
      data: { expiresAt },
      select: SHARE_SELECT,
    });

    return toRecord(row);
  }

  /**
   * `skipDuplicates` is the idempotence: the unique `(share_id, email)` index decides, so two
   * requests adding the same recipient leave one grant and neither fails. A read-then-write
   * check would let both through.
   */
  override async addGrants(shareId: string, emails: string[]): Promise<ShareRecord> {
    await this.prisma.shareGrant.createMany({
      data: emails.map((email) => ({ shareId, email })),
      skipDuplicates: true,
    });

    return this.require(shareId);
  }

  override async removeGrant(shareId: string, grantId: string): Promise<boolean> {
    if (!isUuid(grantId)) return false;

    // `deleteMany` and not `delete`: the share id is part of the predicate, so a grant id from
    // a different share matches nothing and reports false instead of raising. It also makes a
    // repeated delete report false rather than throwing a record-not-found.
    const { count } = await this.prisma.shareGrant.deleteMany({ where: { id: grantId, shareId } });

    return count > 0;
  }

  /**
   * Re-read after a write that returned counts rather than a row. The share was resolved for
   * this owner moments ago and cascades only with its node, so a miss here means the node was
   * deleted mid-request — which is exactly the 404 the absence produces.
   */
  private async require(shareId: string): Promise<ShareRecord> {
    const row = await this.prisma.share.findUniqueOrThrow({
      where: { id: shareId },
      select: SHARE_SELECT,
    });

    return toRecord(row);
  }
}

/**
 * Binds every pending grant for an address to the account that just proved it holds it.
 *
 * A separate provider from the store because it is reached from `AuthService`, and a sign-in
 * has no business being able to create or revoke shares — the narrow port is what says so.
 */
@Injectable()
export class PrismaPendingGrantBinder extends PendingGrantBinder {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  /**
   * `userId: null` in the predicate keeps this idempotent across every subsequent sign-in: once
   * a grant is bound, later sign-ins match nothing and `acceptedAt` keeps recording the first
   * time the recipient turned up rather than the most recent.
   *
   * The email is compared as stored — both sides are normalised by `normalizeEmail`, which is
   * the whole reason `Buyer@Acme.com` and `buyer@acme.com` are one person here.
   */
  override async bindPendingGrants(userId: string, email: string): Promise<number> {
    const { count } = await this.prisma.shareGrant.updateMany({
      where: { email, userId: null },
      data: { userId, acceptedAt: new Date() },
    });

    return count;
  }
}

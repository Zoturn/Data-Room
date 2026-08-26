import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { nodeTypeSchema, type NodeSummary, type Page } from "@data-room/shared";
import { z } from "zod";
import { decodeCursor, encodeCursor } from "../common/pagination/cursor";
import { toPage } from "../common/pagination/paginate";
import {
  COMMITTED_ONLY,
  afterChildCursor,
  isNodeId,
  subtreePrefixOf,
  toNodeSummary,
} from "../folders/folders.repository";
import { PrismaService } from "../prisma/prisma.service";
import { PublicShareStore, type SharedNodeRecord, type SharedRoot } from "./public-shares.service";

/**
 * Explicit columns, so a field added to `Node` later cannot widen what leaves this store by
 * accident. That matters more here than anywhere else in the codebase: everything selected on
 * this path is on its way to somebody outside the organisation.
 */
const SHARED_NODE_COLUMNS = {
  id: true,
  dataRoomId: true,
  parentId: true,
  type: true,
  name: true,
  path: true,
  depth: true,
  sizeBytes: true,
  updatedAt: true,
  storageKey: true,
} satisfies Prisma.NodeSelect;

/**
 * The listing's sort key, and therefore its cursor — the same tuple `FoldersRepository` uses,
 * re-declared because its schema is private to that file while `afterChildCursor` is not. The
 * shape is identical on purpose: a cursor is opaque to a client, and one that meant different
 * things on the owner's surface and the recipient's would be a paging bug nobody could see.
 */
const childCursorSchema = z.object({
  type: nodeTypeSchema,
  name: z.string(),
  id: z.string().uuid(),
});

/**
 * Neither revoked nor expired, evaluated on every request.
 *
 * A `where` clause and not a check on a row that was already read: a revoked share must not
 * match, so the service sees `null` and answers the same 404 an unknown token gets. Written
 * once, here, because two copies of this predicate are two chances for one of them to drift
 * and keep a revoked link alive.
 */
function activeShare(now: Date): Prisma.ShareWhereInput {
  return {
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

/**
 * The Prisma-backed reads behind the public share surface.
 *
 * There is no write method on this class and there must never be one. Read-only is enforced by
 * shape rather than by a role check, and this file is where that shape is visible: a recipient
 * cannot escalate because nothing reachable from a share token can mutate anything.
 */
@Injectable()
export class PrismaPublicShareStore extends PublicShareStore {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  /**
   * `COMMITTED_ONLY` on the node is not defensive padding: a `PENDING` row is a name
   * reservation whose bytes never arrived, and serving one to a recipient would show a
   * document that does not exist and then fail to download.
   */
  override async findActiveShareByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<SharedRoot | null> {
    const row = await this.prisma.share.findFirst({
      where: { AND: [{ tokenHash }, activeShare(now), { node: COMMITTED_ONLY }] },
      select: { id: true, mode: true, node: { select: SHARED_NODE_COLUMNS } },
    });

    if (row === null) return null;

    return { shareId: row.id, mode: row.mode, root: row.node };
  }

  /**
   * The node, scoped to the shared subtree in the query itself.
   *
   * `path startsWith` is the containment test rather than a walk up `parentId`, and it is why
   * a move takes effect immediately: the moment a file's path stops carrying the shared
   * folder's id, this query stops matching it and the recipient gets a 404. The room id is
   * repeated even though the prefix already implies it — a second, cheaper predicate that
   * would have to fail at the same time as the first for anything to leak.
   */
  override async findNodeInSubtree(
    root: SharedNodeRecord,
    nodeId: string,
  ): Promise<SharedNodeRecord | null> {
    // A malformed id handed to a `uuid` column raises rather than missing, which would turn a
    // mistyped link into a 500 and make a bad id distinguishable from a real one. Both are 404.
    if (!isNodeId(nodeId)) return null;

    return this.prisma.node.findFirst({
      where: {
        AND: [
          { id: nodeId, dataRoomId: root.dataRoomId },
          COMMITTED_ONLY,
          { OR: [{ id: root.id }, { path: { startsWith: subtreePrefixOf(root) } }] },
        ],
      },
      select: SHARED_NODE_COLUMNS,
    });
  }

  /**
   * Direct children, folders before files and then by name, with the id breaking ties so the
   * order is total — a cursor over a non-total order silently skips or repeats rows.
   *
   * The caller has already resolved `folder` inside the shared subtree, so `parentId` alone is
   * a sufficient scope here: every child of a node in the subtree is itself in the subtree.
   */
  override async listChildren(
    folder: SharedNodeRecord,
    limit: number,
    cursor: string | undefined,
  ): Promise<Page<NodeSummary>> {
    const after =
      cursor === undefined ? undefined : afterChildCursor(decodeCursor(cursor, childCursorSchema));

    const rows = await this.prisma.node.findMany({
      where:
        after === undefined
          ? { AND: [{ parentId: folder.id }, COMMITTED_ONLY] }
          : { AND: [{ parentId: folder.id }, COMMITTED_ONLY, after] },
      orderBy: [{ type: "asc" }, { name: "asc" }, { id: "asc" }],
      // One more than asked for: the extra row is what proves another page exists, so no
      // COUNT(*) is needed to decide whether to hand back a cursor.
      take: limit + 1,
      select: SHARED_NODE_COLUMNS,
    });

    return toPage(rows, limit, toNodeSummary, (row) =>
      encodeCursor({ type: row.type, name: row.name, id: row.id }),
    );
  }

  /**
   * Names for ids the service has already re-rooted at the share.
   *
   * The room id is applied as a predicate rather than trusted from the id list, so even a bug
   * that let a foreign id through this call could not turn it into a folder name.
   */
  override async namesFor(dataRoomId: string, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();

    const rows = await this.prisma.node.findMany({
      where: { id: { in: ids }, dataRoomId },
      select: { id: true, name: true },
    });

    return new Map(rows.map((row) => [row.id, row.name]));
  }

  /**
   * Whether this account is named on this share.
   *
   * Matched on the bound `userId` **or** the address, because the two answer different halves
   * of the same question: sign-in binds the grants that existed at the time, so a recipient
   * added after they last signed in still holds an unbound grant. Comparing the address as
   * well is what stops that person being told the link does not work until they sign out and
   * back in again. Both sides are normalised — that is why `Buyer@Acme.com` and
   * `buyer@acme.com` are one person here.
   */
  override async holdsGrant(shareId: string, userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (user === null) return false;

    const grant = await this.prisma.shareGrant.findFirst({
      where: { shareId, OR: [{ userId }, { email: user.email }] },
      select: { id: true },
    });

    return grant !== null;
  }
}

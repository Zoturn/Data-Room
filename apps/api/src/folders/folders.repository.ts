import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  nodeTypeSchema,
  normalizeNodeName,
  type Breadcrumb,
  type NodeSummary,
  type NodeType,
  type Page,
  type SubtreeAggregate,
} from "@data-room/shared";
import { z } from "zod";
import { NameConflictError, NotFoundError } from "../common/errors/domain-error";
import { decodeCursor, encodeCursor } from "../common/pagination/cursor";
import { toPage } from "../common/pagination/paginate";
import { PrismaService } from "../prisma/prisma.service";

/**
 * The root folder's path. A node's `path` is the chain of its **ancestors'** ids and never
 * its own, so the root — which has no ancestors — is `/`, and its children are `/<rootId>/`.
 * The subtree of any node X is therefore `X.path + X.id + "/"`, which is what
 * `subtreePrefixOf` returns and what every prefix scan below is anchored on.
 */
export const ROOT_PATH = "/";

/** Depth counts ancestors, so the root sits at 0 and its children at 1. */
export const ROOT_DEPTH = 0;

/**
 * A node as this repository hands one out. `sizeBytes` is still a `bigint` here — the
 * conversion to a JS number happens in `toNodeSummary`, at the edge that produces a
 * response, so nothing inside the tree does size arithmetic in a lossy type.
 */
export type NodeRecord = {
  id: string;
  dataRoomId: string;
  parentId: string | null;
  type: NodeType;
  name: string;
  path: string;
  depth: number;
  sizeBytes: bigint;
  updatedAt: Date;
};

/**
 * Explicit columns, so a field added to the model later (a storage key, a mime type) cannot
 * widen what leaves this repository by accident. See prisma-data-model.md rule 11.
 */
const NODE_COLUMNS = {
  id: true,
  dataRoomId: true,
  parentId: true,
  type: true,
  name: true,
  path: true,
  depth: true,
  sizeBytes: true,
  updatedAt: true,
} satisfies Prisma.NodeSelect;

const UNIQUE_VIOLATION = "P2002";
const RECORD_NOT_FOUND = "P2025";

/**
 * Ids are UUIDs by design: the alphabet of a `path` has to be closed, or an id containing
 * `%` or `_` would make a subtree `LIKE` match past its own subtree.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function isNodeId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * The `LIKE` anchor for everything under a node — aggregate, delete, and later search. It
 * doubles as the `path` of that node's direct children, which is the whole point of storing
 * ancestors rather than self: one string serves both, and neither mentions a name.
 */
export function subtreePrefixOf(node: { id: string; path: string }): string {
  return `${node.path}${node.id}/`;
}

/**
 * The same anchor as a complete `LIKE` pattern, passed to Postgres as **one** parameter.
 *
 * Not `path LIKE $1 || '%'`: a concatenation is an expression, and the planner rewrites a
 * prefix `LIKE` into an index range scan only when the pattern is a constant. Under a
 * parameter it is, under `$1 || '%'` it never is — so that form would quietly sequential-scan
 * every node in the room and waste the `text_pattern_ops` index the migration exists for.
 *
 * Appending `%` by hand is safe here and only here: the prefix is a chain of UUIDs and
 * slashes, so it cannot contain a `%` or `_` of its own to escape.
 */
export function subtreePatternOf(node: { id: string; path: string }): string {
  return `${subtreePrefixOf(node)}%`;
}

/**
 * The ancestor ids, root first, parsed straight out of a path. This is what makes a
 * breadcrumb one query instead of one query per level.
 */
export function ancestorIdsOf(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

export function toNodeSummary(node: NodeRecord): NodeSummary {
  return {
    id: node.id,
    type: node.type,
    name: node.name,
    updatedAt: node.updatedAt.toISOString(),
    // Safe: a single file's size is bounded far below Number.MAX_SAFE_INTEGER, and the
    // contract carries sizes as numbers. Sums stay in SQL, where they stay exact.
    sizeBytes: Number(node.sizeBytes),
  };
}

/** The listing's sort key, and therefore its cursor: folders first, then name, then id. */
const childCursorSchema = z.object({
  type: nodeTypeSchema,
  name: z.string(),
  id: z.string().uuid(),
});

type ChildCursor = z.infer<typeof childCursorSchema>;

/**
 * The keyset condition for "strictly after this row" in the listing order.
 *
 * Written out per type rather than as `type > $cursorType` because Prisma's enum filters
 * have no ordering operators — and because with two members the explicit form says what the
 * order actually is: every remaining FOLDER, then every FILE.
 */
export function afterChildCursor(cursor: ChildCursor): Prisma.NodeWhereInput {
  const sameType: Prisma.NodeWhereInput[] = [
    { type: cursor.type, name: { gt: cursor.name } },
    { type: cursor.type, name: cursor.name, id: { gt: cursor.id } },
  ];

  return cursor.type === "FOLDER" ? { OR: [...sameType, { type: "FILE" }] } : { OR: sameType };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION;
}

function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === RECORD_NOT_FOUND;
}

/**
 * A count or a byte total as Postgres returns it. `count()` is a bigint and `sum()` a
 * numeric, so both are cast to bigint in SQL and narrowed here — no `as`, and a shape the
 * driver did not promise fails loudly instead of becoming `NaN` in a confirmation dialog.
 */
function toTotal(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`Aggregate returned a value that is not a number: ${String(value)}`);
}

/**
 * Every Prisma call for the tree. Nothing outside this class writes `parentId`, `path` or
 * `depth` — a stale path corrupts sharing, search and deletion at once, so there is exactly
 * one place where the arithmetic happens (prisma-data-model.md rule 4).
 *
 * Ownership is a `where` clause here, not a guard: every lookup joins to the owning room, so
 * a foreign id simply does not match and the service turns "no row" into 404. There is no
 * code path that can answer 403 and thereby confirm that someone else's folder exists.
 */
@Injectable()
export class FoldersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A folder, only if the caller owns the Data Room holding it. Returns `null` for a
   * non-existent id, a foreign id and a malformed id alike — the last of those because a
   * non-UUID would otherwise reach the `uuid` column and raise, turning a mistyped URL into
   * a 500 rather than a 404.
   */
  async findFolderForOwner(id: string, ownerId: string): Promise<NodeRecord | null> {
    if (!isNodeId(id)) return null;

    return this.prisma.node.findFirst({
      where: { id, type: "FOLDER", dataRoom: { ownerId } },
      select: NODE_COLUMNS,
    });
  }

  /**
   * Insert a child of `parent`, deriving its position in the tree from the parent alone.
   *
   * Sibling uniqueness is the database's, not this method's: a `findFirst` check first would
   * let two concurrent creates of `Reports` both pass and both insert. The unique index on
   * `(parent_id, normalized_name)` is what actually decides, and the translation below is how
   * the loser becomes a 409.
   */
  async createFolder(parent: NodeRecord, name: string): Promise<NodeSummary> {
    try {
      const created = await this.prisma.node.create({
        data: {
          id: randomUUID(),
          dataRoomId: parent.dataRoomId,
          parentId: parent.id,
          type: "FOLDER",
          name,
          normalizedName: normalizeNodeName(name),
          path: subtreePrefixOf(parent),
          depth: parent.depth + 1,
        },
        select: NODE_COLUMNS,
      });

      return toNodeSummary(created);
    } catch (error) {
      // `(parent_id, normalized_name)` is the only unique index this insert can trip.
      if (!isUniqueViolation(error)) throw error;
      throw new NameConflictError(name);
    }
  }

  /**
   * A single-row update, however large the subtree. Names never appear in a `path`, so
   * renaming a folder with 50,000 descendants leaves every descendant's path untouched and
   * every one of them reachable.
   */
  async renameNode(id: string, name: string): Promise<NodeSummary> {
    try {
      const updated = await this.prisma.node.update({
        where: { id },
        data: { name, normalizedName: normalizeNodeName(name) },
        select: NODE_COLUMNS,
      });

      return toNodeSummary(updated);
    } catch (error) {
      if (isRecordNotFound(error)) throw new NotFoundError("Folder not found");
      if (!isUniqueViolation(error)) throw error;
      throw new NameConflictError(name);
    }
  }

  /**
   * Direct children, folders before files and then by name, with the id breaking ties so the
   * order is total — a cursor over a non-total order silently skips or repeats rows.
   *
   * The enum's declaration order (`FOLDER`, `FILE`) is what puts folders first under
   * `type asc`; Postgres orders an enum by declaration, not alphabetically.
   */
  async listChildren(
    folder: NodeRecord,
    limit: number,
    cursor: string | undefined,
  ): Promise<Page<NodeSummary>> {
    const after =
      cursor === undefined ? undefined : afterChildCursor(decodeCursor(cursor, childCursorSchema));

    const rows = await this.prisma.node.findMany({
      where:
        after === undefined ? { parentId: folder.id } : { AND: [{ parentId: folder.id }, after] },
      orderBy: [{ type: "asc" }, { name: "asc" }, { id: "asc" }],
      // One more than asked for: the extra row is what proves another page exists, so no
      // COUNT(*) is needed to decide whether to hand back a cursor.
      take: limit + 1,
      select: NODE_COLUMNS,
    });

    return toPage(rows, limit, toNodeSummary, (row) =>
      encodeCursor({ type: row.type, name: row.name, id: row.id }),
    );
  }

  /**
   * The ordered ancestor chain, root first and the node itself last.
   *
   * The ids are already in the node's own `path`, so this is one `IN` lookup at any depth —
   * never a walk up `parentId`, which costs a round trip per level on the hottest read in
   * the interface.
   */
  async breadcrumbsFor(node: NodeRecord): Promise<Breadcrumb[]> {
    const ancestorIds = ancestorIdsOf(node.path);
    const self: Breadcrumb = { id: node.id, name: node.name };

    if (ancestorIds.length === 0) return [self];

    const ancestors = await this.prisma.node.findMany({
      where: { id: { in: ancestorIds }, dataRoomId: node.dataRoomId },
      select: { id: true, name: true },
    });

    const namesById = new Map(ancestors.map((ancestor) => [ancestor.id, ancestor.name]));

    // Ordered by the path, not by whatever order the rows came back in.
    const chain: Breadcrumb[] = [];
    for (const id of ancestorIds) {
      const name = namesById.get(id);
      // An ancestor missing here means the subtree is being deleted underneath this read.
      // The caller's next request 404s and the interface says so; a crumb list that omits a
      // vanished hop is better than a 500 on the way there.
      if (name !== undefined) chain.push({ id, name });
    }

    chain.push(self);
    return chain;
  }

  /**
   * Everything below a node, counted at every depth, in one indexed range scan.
   *
   * Raw because Prisma cannot express `count(*) FILTER (...)` or a prefix predicate — see
   * prisma-data-model.md rule 12. Both totals are cast to `bigint` in SQL so the driver
   * returns one type rather than `numeric` for the sum, and the prefix is a closed alphabet
   * of hex and slashes, so no `LIKE` metacharacter can widen the match.
   *
   * Computed on read rather than kept as a counter: at MVP scale this is milliseconds, and a
   * number that is derived cannot drift. The denormalised rollup and its reconciliation job
   * are documented in the change's design.md as the next step, not as today's problem.
   */
  async subtreeAggregate(node: NodeRecord): Promise<SubtreeAggregate> {
    const pattern = subtreePatternOf(node);

    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT count(*) FILTER (WHERE type = 'FILE')::bigint   AS files,
             count(*) FILTER (WHERE type = 'FOLDER')::bigint AS folders,
             coalesce(sum(size_bytes), 0)::bigint            AS bytes
      FROM nodes
      WHERE data_room_id = ${node.dataRoomId}::uuid AND path LIKE ${pattern}
    `;

    const row = rows[0];
    // An aggregate over zero rows still returns one row of zeroes, so an empty result means
    // the query did not run as expected rather than that the folder is empty.
    if (row === undefined) throw new Error("Subtree aggregate returned no row");

    return {
      folders: toTotal(row["folders"]),
      files: toTotal(row["files"]),
      bytes: toTotal(row["bytes"]),
    };
  }

  /**
   * Delete a node and its entire subtree in one statement, inside one transaction, and hand
   * back the storage keys of the files removed so their blobs can be released after commit.
   *
   * One statement rather than `ON DELETE CASCADE`: the cascade recurses row by row and yields
   * no list of keys to clean up. Everything is inside a transaction so a failure part-way
   * leaves the whole subtree intact — there is no state in which half a folder is gone.
   */
  async deleteSubtree(node: NodeRecord): Promise<string[]> {
    const pattern = subtreePatternOf(node);

    return this.prisma.$transaction(async (tx) => {
      // TODO(add-file-management): select `storage_key` from the FILE rows in this subtree
      // before the delete and return it here. The column arrives with that change; until
      // then no node owns a blob, so there is nothing to release and the seam stays in
      // place rather than being retrofitted through the service later.
      const releasedKeys: string[] = [];

      await tx.$executeRaw`
        DELETE FROM nodes
        WHERE data_room_id = ${node.dataRoomId}::uuid
          AND (id = ${node.id}::uuid OR path LIKE ${pattern})
      `;

      return releasedKeys;
    });
  }
}

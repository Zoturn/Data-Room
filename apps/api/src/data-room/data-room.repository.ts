import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { normalizeNodeName, type DataRoom } from "@data-room/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ROOT_DEPTH, ROOT_PATH, isNodeId } from "../folders/folders.repository";

const UNIQUE_VIOLATION = "P2002";

/**
 * The room and the id of its root folder — everything the interface needs to open it. The
 * root is a real `Node` row rather than a virtual parent, so "share the whole Data Room" will
 * be the same operation as sharing a folder.
 *
 * `take: 1` on a relation filtered to `parentId: null`: a room has exactly one root, and
 * asking for one row says so.
 */
const DATA_ROOM_COLUMNS = {
  id: true,
  name: true,
  nodes: { where: { parentId: null }, select: { id: true }, take: 1 },
} satisfies Prisma.DataRoomSelect;

type DataRoomRow = {
  id: string;
  name: string;
  nodes: Array<{ id: string }>;
};

function toDataRoom(row: DataRoomRow): DataRoom {
  const root = row.nodes[0];

  // Provisioning writes the room and its root in one statement, so a room without a root is
  // not a state the application can reach — it is a corrupted database, and saying so is
  // more useful than returning a response with an id nobody can open.
  if (root === undefined) throw new Error(`Data Room ${row.id} has no root folder`);

  return { id: row.id, name: row.name, rootFolderId: root.id };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION;
}

/**
 * Every Prisma call for a Data Room. Rooms are addressed by their owner, so a caller can only
 * ever reach their own — ownership is a `where` clause, not a check that could be forgotten.
 */
@Injectable()
export class DataRoomRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByOwner(ownerId: string): Promise<DataRoom | null> {
    const row = await this.prisma.dataRoom.findUnique({
      where: { ownerId },
      select: DATA_ROOM_COLUMNS,
    });

    return row === null ? null : toDataRoom(row);
  }

  /**
   * A room by id, but only the caller's. A foreign or malformed id matches nothing and the
   * service turns that into 404 — never 403, which would confirm the room exists.
   */
  async findForOwner(id: string, ownerId: string): Promise<DataRoom | null> {
    if (!isNodeId(id)) return null;

    const row = await this.prisma.dataRoom.findFirst({
      where: { id, ownerId },
      select: DATA_ROOM_COLUMNS,
    });

    return row === null ? null : toDataRoom(row);
  }

  /**
   * Create the room and its root folder, or report that someone else already did.
   *
   * One nested write, so both rows land in one implicit transaction: a room can never exist
   * without the folder the interface opens. The unique index on `owner_id` is what makes this
   * idempotent under concurrency — two simultaneous first requests both attempt the insert,
   * one wins, and the loser gets `null` here and re-reads the winner's row. A check-then-insert
   * would let both pass and leave the user with two rooms.
   *
   * The root's `path` and `depth` come from the tree module's own constants rather than being
   * restated: they are the invariant every prefix scan depends on, and there is one definition
   * of it (prisma-data-model.md rule 3).
   */
  async provision(ownerId: string, name: string): Promise<DataRoom | null> {
    try {
      const row = await this.prisma.dataRoom.create({
        data: {
          id: randomUUID(),
          ownerId,
          name,
          nodes: {
            create: {
              id: randomUUID(),
              type: "FOLDER",
              name,
              normalizedName: normalizeNodeName(name),
              path: ROOT_PATH,
              depth: ROOT_DEPTH,
            },
          },
        },
        select: DATA_ROOM_COLUMNS,
      });

      return toDataRoom(row);
    } catch (error) {
      // `owner_id` is the only unique column this insert writes, so a violation means a
      // concurrent request provisioned the room first. That is a success for the caller.
      if (!isUniqueViolation(error)) throw error;
      return null;
    }
  }

  /**
   * Rename the room and its root folder together, in one transaction.
   *
   * The breadcrumb's first crumb is the root folder's name, so leaving it behind would show
   * the old name at the top of every folder in the room. Two rows, one name, one write — this
   * is the only place outside the tree repository that touches a `Node`, and it touches only
   * the name: `parentId`, `path` and `depth` remain the tree's alone.
   */
  async rename(id: string, name: string): Promise<DataRoom> {
    const [row] = await this.prisma.$transaction([
      this.prisma.dataRoom.update({
        where: { id },
        data: { name },
        select: DATA_ROOM_COLUMNS,
      }),
      this.prisma.node.updateMany({
        where: { dataRoomId: id, parentId: null },
        data: { name, normalizedName: normalizeNodeName(name) },
      }),
    ]);

    return toDataRoom(row);
  }
}

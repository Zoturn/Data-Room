import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  normalizeNodeName,
  type Breadcrumb,
  type NodeSummary,
  type NodeType,
} from "@data-room/shared";
import { NameConflictError, NotFoundError } from "../common/errors/domain-error";
import { PrismaService } from "../prisma/prisma.service";
import { storageKeyFor } from "../storage/storage.service";
import {
  ancestorIdsOf,
  isNodeId,
  subtreePatternOf,
  subtreePrefixOf,
  toNodeSummary,
} from "../folders/folders.repository";
import { nthCandidateName } from "./file-name";

/**
 * Pure helpers are imported from the folders repository rather than reimplemented: a file
 * and a folder are the same row in the same table, and two copies of the path arithmetic
 * would be two places to be wrong about a subtree. Nothing injectable crosses over — this
 * module owns its own queries, so there is no cycle between the two Nest modules.
 */

/**
 * Mirrors the Prisma enum without importing it, in the same way `NodeType` comes from the
 * shared package rather than the client. It keeps this file compiling before `prisma
 * generate` has caught up with a migration, and the literals are checked against the
 * generated types wherever they reach a `where` clause anyway.
 */
export type UploadState = "PENDING" | "READY";

/**
 * A file row as this repository hands one out — the tree columns plus what upload added.
 * `sizeBytes` stays a `bigint` here for the same reason it does in the folder repository:
 * the narrowing to a JS number happens at the edge that builds a response.
 */
export type FileRecord = {
  id: string;
  dataRoomId: string;
  parentId: string | null;
  type: NodeType;
  name: string;
  path: string;
  depth: number;
  sizeBytes: bigint;
  createdAt: Date;
  updatedAt: Date;
  storageKey: string | null;
  contentType: string | null;
  uploadState: UploadState | null;
};

/** A reservation that has been resolved to a real, free name and now holds it. */
export type ReservedFile = FileRecord & { storageKey: string };

const FILE_COLUMNS = {
  id: true,
  dataRoomId: true,
  parentId: true,
  type: true,
  name: true,
  path: true,
  depth: true,
  sizeBytes: true,
  createdAt: true,
  updatedAt: true,
  storageKey: true,
  contentType: true,
  uploadState: true,
} satisfies Prisma.NodeSelect;

const UNIQUE_VIOLATION = "P2002";
const RECORD_NOT_FOUND = "P2025";

/**
 * Rows a listing may show: every folder, and every file whose bytes have been committed.
 *
 * Written as an explicit `OR` rather than `uploadState: { not: "PENDING" }` because a folder
 * carries `NULL` there, and `NOT (upload_state = 'PENDING')` is `NULL` — not `true` — for a
 * NULL column. That form would silently hide every folder in the room.
 */
export const COMMITTED_ONLY: Prisma.NodeWhereInput = {
  OR: [{ uploadState: null }, { uploadState: "READY" }],
};

/**
 * How many ` (n)` candidates one probe asks about. Batched rather than one query per index
 * so a folder holding a long collision family costs a handful of round trips, and bounded so
 * a pathological folder cannot turn one upload into an unbounded scan.
 */
const NAME_PROBE_BATCH = 32;
const NAME_PROBE_LIMIT = 1024;

/** Two attempts: probe, insert, and one more probe if the index arbitrated against us. */
const CONFLICT_RETRIES = 2;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION;
}

function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === RECORD_NOT_FOUND;
}

/**
 * Every Prisma call the file module makes.
 *
 * Ownership is a `where` clause on every lookup, never a guard: a file in someone else's
 * Data Room simply does not match, and the service turns "no row" into 404. There is no code
 * path here that can answer 403 and thereby confirm the id is real.
 */
@Injectable()
export class FilesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A committed file the caller owns. A `PENDING` row is deliberately invisible: it is a name
   * reservation, not a file, so opening, renaming, moving or deleting one is a 404 exactly
   * like an id that was never real (file-upload-storage.md rule 12).
   */
  async findFileForOwner(id: string, ownerId: string): Promise<FileRecord | null> {
    if (!isNodeId(id)) return null;

    return this.prisma.node.findFirst({
      where: { id, type: "FILE", uploadState: "READY", dataRoom: { ownerId } },
      select: FILE_COLUMNS,
    });
  }

  /**
   * The reservation a commit is about to close, and only if this caller is the one who made
   * it. The ownership clause is what stops a second user committing bytes into a name someone
   * else reserved; the `PENDING` clause is what stops the same upload committing twice.
   */
  async findReservationForOwner(id: string, ownerId: string): Promise<FileRecord | null> {
    if (!isNodeId(id)) return null;

    return this.prisma.node.findFirst({
      where: { id, type: "FILE", uploadState: "PENDING", dataRoom: { ownerId } },
      select: FILE_COLUMNS,
    });
  }

  /** A folder the caller owns — the destination of an upload or a move. */
  async findFolderForOwner(id: string, ownerId: string): Promise<FileRecord | null> {
    if (!isNodeId(id)) return null;

    return this.prisma.node.findFirst({
      where: { id, type: "FOLDER", dataRoom: { ownerId } },
      select: FILE_COLUMNS,
    });
  }

  /**
   * Any node the caller owns, whatever its type. A move needs this rather than
   * `findFolderForOwner`: a destination that is a file must answer `INVALID_MOVE_TARGET`,
   * which is only distinguishable from "no such node" once the row has been read.
   */
  async findNodeForOwner(id: string, ownerId: string): Promise<FileRecord | null> {
    if (!isNodeId(id)) return null;

    return this.prisma.node.findFirst({
      where: { id, dataRoom: { ownerId } },
      select: FILE_COLUMNS,
    });
  }

  /**
   * The first free name in a collision family — the requested name itself when nothing holds
   * it, otherwise `report (1).pdf`, `report (2).pdf` and so on.
   *
   * Reservations count as taken. That is the point of reserving before any byte is sent: two
   * simultaneous uploads of `report.pdf` see each other here, and whichever loses the race is
   * arbitrated by the unique index rather than by this probe.
   *
   * `excludeId` is the node being renamed or moved, so a file keeps its own name instead of
   * colliding with itself and drifting to `report (1).pdf` on every no-op save.
   */
  async findAvailableName(
    parentId: string,
    requestedName: string,
    excludeId?: string,
  ): Promise<string> {
    for (let start = 0; start < NAME_PROBE_LIMIT; start += NAME_PROBE_BATCH) {
      // Insertion order is ascending index order, which is what makes the first free entry
      // below the *lowest* free suffix rather than an arbitrary one.
      const candidates = new Map<string, string>();
      for (let index = start; index < start + NAME_PROBE_BATCH; index += 1) {
        const candidate = nthCandidateName(requestedName, index);
        candidates.set(normalizeNodeName(candidate), candidate);
      }

      const taken = await this.prisma.node.findMany({
        where: {
          parentId,
          normalizedName: { in: [...candidates.keys()] },
          ...(excludeId === undefined ? {} : { NOT: { id: excludeId } }),
        },
        select: { normalizedName: true },
      });

      const occupied = new Set(taken.map((row) => row.normalizedName));

      for (const [normalized, candidate] of candidates) {
        if (!occupied.has(normalized)) return candidate;
      }
    }

    // A thousand files sharing one name is not a collision any more, it is a client fault.
    throw new NameConflictError(requestedName);
  }

  /**
   * Insert the `PENDING` node that holds the name while the browser sends bytes.
   *
   * The storage key is derived from the generated node id, never from the name, so a name
   * containing slashes or `..` cannot steer where the object lands (file-upload-storage.md
   * rule 3). The id is generated here rather than by the database precisely so the key can be
   * computed before the insert.
   */
  async reserveFile(
    parent: FileRecord,
    requestedName: string,
    contentType: string,
    sizeBytes: number,
  ): Promise<ReservedFile> {
    for (let attempt = 0; attempt < CONFLICT_RETRIES; attempt += 1) {
      const name = await this.findAvailableName(parent.id, requestedName);
      const id = randomUUID();
      const storageKey = storageKeyFor(parent.dataRoomId, id);

      try {
        const created = await this.prisma.node.create({
          data: {
            id,
            dataRoomId: parent.dataRoomId,
            parentId: parent.id,
            type: "FILE",
            name,
            normalizedName: normalizeNodeName(name),
            path: subtreePrefixOf(parent),
            depth: parent.depth + 1,
            // The client's claim, kept so the reservation is not sizeless in a listing it
            // never appears in anyway. Commit overwrites it with what storage really holds.
            sizeBytes: BigInt(sizeBytes),
            storageKey,
            contentType,
            uploadState: "PENDING",
          },
          select: FILE_COLUMNS,
        });

        return { ...created, storageKey };
      } catch (error) {
        // `(parent_id, normalized_name)` is the only unique index this insert can trip, and
        // tripping it means another upload took the name between the probe and the insert.
        // Probing again is the whole retry: the next index is free by then.
        if (!isUniqueViolation(error)) throw error;
      }
    }

    throw new NameConflictError(requestedName);
  }

  /**
   * Close the reservation: record what storage actually holds and make the row visible.
   *
   * `updateMany` with the `PENDING` clause rather than `update` by id, so the state change is
   * the condition and not just the effect. A second commit — or a sweep that expired this
   * reservation mid-flight — updates zero rows and gets `null` back, which the service turns
   * into `UPLOAD_EXPIRED`. There is no window in which a file commits twice.
   */
  async markReady(
    id: string,
    sizeBytes: number,
    checksum: string | null,
  ): Promise<NodeSummary | null> {
    const { count } = await this.prisma.node.updateMany({
      where: { id, uploadState: "PENDING" },
      data: { sizeBytes: BigInt(sizeBytes), checksum, uploadState: "READY" },
    });

    if (count === 0) return null;

    const committed = await this.prisma.node.findUnique({ where: { id }, select: FILE_COLUMNS });

    return committed === null ? null : toNodeSummary(committed);
  }

  /**
   * Rename to the first free name in the family, so a collision suffixes rather than fails —
   * the same rule uploads follow, because a user renaming into a taken name has the same
   * problem as a user uploading into one.
   */
  async renameFile(file: FileRecord, requestedName: string): Promise<NodeSummary> {
    if (file.parentId === null) throw new NotFoundError("That file is no longer available.");
    const parentId = file.parentId;

    for (let attempt = 0; attempt < CONFLICT_RETRIES; attempt += 1) {
      const name = await this.findAvailableName(parentId, requestedName, file.id);

      try {
        const updated = await this.prisma.node.update({
          where: { id: file.id },
          data: { name, normalizedName: normalizeNodeName(name) },
          select: FILE_COLUMNS,
        });

        return toNodeSummary(updated);
      } catch (error) {
        if (isRecordNotFound(error)) throw new NotFoundError("That file is no longer available.");
        if (!isUniqueViolation(error)) throw error;
      }
    }

    throw new NameConflictError(requestedName);
  }

  /**
   * Re-parent a node and rewrite its position in the tree, in one transaction.
   *
   * The storage key is untouched, which is what makes a move metadata-only and instant
   * regardless of file size. The descendant rewrite matches nothing for a file — a file
   * contains nothing — but it is the same arithmetic a folder move needs, and writing it once
   * here is what keeps a later folder move from growing a second, divergent copy.
   */
  async moveFile(file: FileRecord, target: FileRecord): Promise<NodeSummary> {
    const oldPrefix = subtreePrefixOf(file);
    const oldPattern = subtreePatternOf(file);
    const newParentPath = subtreePrefixOf(target);
    const depthDelta = target.depth + 1 - file.depth;

    for (let attempt = 0; attempt < CONFLICT_RETRIES; attempt += 1) {
      const name = await this.findAvailableName(target.id, file.name, file.id);

      try {
        return await this.prisma.$transaction(async (tx) => {
          const moved = await tx.node.update({
            where: { id: file.id },
            data: {
              parentId: target.id,
              path: newParentPath,
              depth: target.depth + 1,
              name,
              normalizedName: normalizeNodeName(name),
            },
            select: FILE_COLUMNS,
          });

          const newPrefix = `${newParentPath}${file.id}/`;

          // One statement for the whole subtree: replace the moved node's old prefix with its
          // new one, leaving each descendant's own tail intact. `substring` is 1-indexed,
          // hence the +1. Names never appear in a path, so nothing here depends on them.
          //
          // Both parameters are cast to `int` because Prisma binds a JS number as `bigint`,
          // and Postgres has no `substring(text, bigint)` — the statement fails to resolve a
          // function before it ever looks at a row, so a move that matched no descendants
          // failed just as loudly as one that matched thousands.
          await tx.$executeRaw`
            UPDATE nodes
            SET path = ${newPrefix} || substring(path from ${oldPrefix.length + 1}::int),
                depth = depth + ${depthDelta}::int
            WHERE data_room_id = ${file.dataRoomId}::uuid AND path LIKE ${oldPattern}
          `;

          return toNodeSummary(moved);
        });
      } catch (error) {
        if (isRecordNotFound(error)) throw new NotFoundError("That file is no longer available.");
        if (!isUniqueViolation(error)) throw error;
      }
    }

    throw new NameConflictError(file.name);
  }

  /**
   * Remove the row and report the key whose object is now unreferenced. The object itself is
   * released outside any transaction — a storage timeout must not roll back a deletion the
   * owner has already confirmed (file-upload-storage.md rule 10).
   */
  async deleteFile(id: string): Promise<string | null> {
    try {
      const deleted = await this.prisma.node.delete({
        where: { id },
        select: { storageKey: true },
      });

      return deleted.storageKey;
    } catch (error) {
      if (isRecordNotFound(error)) throw new NotFoundError("That file is no longer available.");
      throw error;
    }
  }

  /**
   * The ordered ancestor chain, root first and the file itself last. The ids are already in
   * the file's own `path`, so this is one lookup at any depth rather than a walk up `parentId`.
   */
  async breadcrumbsFor(node: FileRecord): Promise<Breadcrumb[]> {
    const ancestorIds = ancestorIdsOf(node.path);
    const self: Breadcrumb = { id: node.id, name: node.name };

    if (ancestorIds.length === 0) return [self];

    const ancestors = await this.prisma.node.findMany({
      where: { id: { in: ancestorIds }, dataRoomId: node.dataRoomId },
      select: { id: true, name: true },
    });

    const namesById = new Map(ancestors.map((ancestor) => [ancestor.id, ancestor.name]));

    const chain: Breadcrumb[] = [];
    for (const id of ancestorIds) {
      const name = namesById.get(id);
      // A missing ancestor means the subtree is being deleted underneath this read. A crumb
      // list short one hop is better than a 500 on the way to a 404 the next click gives.
      if (name !== undefined) chain.push({ id, name });
    }

    chain.push(self);
    return chain;
  }

  /**
   * Reservations whose upload window has passed. Ordered oldest first and bounded, so one
   * sweep run is a bounded amount of work whatever has accumulated; the next run takes the
   * rest.
   */
  async findExpiredReservations(
    before: Date,
    limit: number,
  ): Promise<Array<{ id: string; storageKey: string | null }>> {
    return this.prisma.node.findMany({
      where: { uploadState: "PENDING", createdAt: { lt: before } },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: { id: true, storageKey: true },
    });
  }

  /**
   * Delete one expired reservation, but only while it is still a reservation.
   *
   * The `PENDING` clause is the race guard: a commit that landed between the scan and this
   * call leaves zero rows deleted, and the caller learns — from the `false` — that it must
   * not go on to delete that object. Deleting the row before the object, and only then the
   * object, is the order that cannot strand a `READY` row with no bytes behind it.
   */
  async deleteReservation(id: string): Promise<boolean> {
    const { count } = await this.prisma.node.deleteMany({
      where: { id, uploadState: "PENDING" },
    });

    return count === 1;
  }
}

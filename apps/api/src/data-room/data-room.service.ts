import { Injectable } from "@nestjs/common";
import type { DataRoom, RenameInput, SubtreeAggregate } from "@data-room/shared";
import type { AuthUser } from "../auth/jwt-auth.guard";
import { NotFoundError } from "../common/errors/domain-error";
import { FoldersService } from "../folders/folders.service";
import { DataRoomRepository } from "./data-room.repository";

/**
 * What a room is called before anyone renames it. Neutral rather than derived from the
 * owner's name, which would put a personal name in a breadcrumb shared with a counterparty.
 */
export const DEFAULT_DATA_ROOM_NAME = "My Data Room";

/**
 * The owned container. One room per user, created the first time they ask for it, and
 * reachable by nobody else.
 */
@Injectable()
export class DataRoomService {
  constructor(
    private readonly rooms: DataRoomRepository,
    private readonly folders: FoldersService,
  ) {}

  /**
   * The room for this caller, provisioned on the spot if it is their first request.
   *
   * Read, create, read again. The second read is not defensive noise: it is the concurrency
   * case. Two simultaneous first requests both miss, both attempt the insert, and the unique
   * `owner_id` index rejects one of them — that request then reads the row the winner just
   * wrote, so both callers receive the same room and exactly one exists. A new user never
   * sees a setup step, and a double-clicked sign-in never produces two rooms.
   */
  async getOrProvision(user: AuthUser): Promise<DataRoom> {
    const existing = await this.rooms.findByOwner(user.id);
    if (existing !== null) return existing;

    const provisioned = await this.rooms.provision(user.id, DEFAULT_DATA_ROOM_NAME);
    if (provisioned !== null) return provisioned;

    const winner = await this.rooms.findByOwner(user.id);

    // `provision` returns null only because the owner already has a room, so it is there.
    // If it is not, the database is contradicting itself and a 500 is the honest answer.
    if (winner === null) throw new Error(`Data Room for ${user.id} vanished during provisioning`);

    return winner;
  }

  /**
   * Folders, files and bytes for the whole room, at every depth.
   *
   * Resolving the room first is what makes a foreign id a 404 rather than a leak; the totals
   * themselves are the aggregate over the root folder, asked of the module that owns the tree
   * rather than re-implemented here against the same table.
   */
  async summary(user: AuthUser, roomId: string): Promise<SubtreeAggregate> {
    const room = await this.requireRoom(user, roomId);

    return this.folders.subtreeAggregate(user, room.rootFolderId);
  }

  /**
   * Rename the room. The name is already trimmed and length-checked by the shared schema, so
   * a blank submission never reaches this method — it is a 400 at the pipe.
   */
  async rename(user: AuthUser, roomId: string, input: RenameInput): Promise<DataRoom> {
    const room = await this.requireRoom(user, roomId);

    return this.rooms.rename(room.id, input.name);
  }

  private async requireRoom(user: AuthUser, roomId: string): Promise<DataRoom> {
    const room = await this.rooms.findForOwner(roomId, user.id);

    if (room === null) throw new NotFoundError("That Data Room is no longer available.");

    return room;
  }
}

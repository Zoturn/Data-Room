import { Test } from "@nestjs/testing";
import type { DataRoom, SubtreeAggregate } from "@data-room/shared";
import type { AuthUser } from "../auth/jwt-auth.guard";
import { NotFoundError } from "../common/errors/domain-error";
import { FoldersService } from "../folders/folders.service";
import { DataRoomRepository } from "./data-room.repository";
import { DEFAULT_DATA_ROOM_NAME, DataRoomService } from "./data-room.service";

/**
 * Covers, from openspec/changes/add-data-room-tree/specs/data-room/spec.md:
 *   "First sign-in lands in a usable room", "Concurrent first requests create one room",
 *   "Another user is not told it exists", "Summary reflects the whole tree" and "Empty room".
 */
const OWNER: AuthUser = { id: "99999999-9999-4999-8999-999999999999" };
const ROOM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROOT_ID = "11111111-1111-4111-8111-111111111111";

const ROOM: DataRoom = { id: ROOM_ID, name: DEFAULT_DATA_ROOM_NAME, rootFolderId: ROOT_ID };

type RoomsStub = {
  findByOwner: jest.Mock<Promise<DataRoom | null>, [string]>;
  findForOwner: jest.Mock<Promise<DataRoom | null>, [string, string]>;
  provision: jest.Mock<Promise<DataRoom | null>, [string, string]>;
  rename: jest.Mock<Promise<DataRoom>, [string, string]>;
};

type FoldersStub = {
  subtreeAggregate: jest.Mock<Promise<SubtreeAggregate>, [AuthUser, string]>;
};

function buildRooms(): RoomsStub {
  return {
    findByOwner: jest.fn<Promise<DataRoom | null>, [string]>().mockResolvedValue(ROOM),
    findForOwner: jest.fn<Promise<DataRoom | null>, [string, string]>().mockResolvedValue(ROOM),
    provision: jest.fn<Promise<DataRoom | null>, [string, string]>().mockResolvedValue(ROOM),
    rename: jest.fn<Promise<DataRoom>, [string, string]>().mockResolvedValue(ROOM),
  };
}

function buildFolders(): FoldersStub {
  return {
    subtreeAggregate: jest
      .fn<Promise<SubtreeAggregate>, [AuthUser, string]>()
      .mockResolvedValue({ folders: 0, files: 0, bytes: 0 }),
  };
}

async function buildService(rooms: RoomsStub, folders: FoldersStub): Promise<DataRoomService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      DataRoomService,
      { provide: DataRoomRepository, useValue: rooms },
      { provide: FoldersService, useValue: folders },
    ],
  }).compile();

  return moduleRef.get(DataRoomService);
}

describe("DataRoomService", () => {
  describe("Requirement: Automatic provisioning", () => {
    it("returns the existing room without provisioning anything", async () => {
      const rooms = buildRooms();
      const service = await buildService(rooms, buildFolders());

      await expect(service.getOrProvision(OWNER)).resolves.toEqual(ROOM);
      expect(rooms.provision).not.toHaveBeenCalled();
    });

    it("provisions a room with a root folder on a new user's first request", async () => {
      const rooms = buildRooms();
      rooms.findByOwner.mockResolvedValueOnce(null);
      const service = await buildService(rooms, buildFolders());

      const room = await service.getOrProvision(OWNER);

      // A new user is dropped straight into a usable room — there is no setup step to skip.
      expect(rooms.provision).toHaveBeenCalledWith(OWNER.id, DEFAULT_DATA_ROOM_NAME);
      expect(room.rootFolderId).toBe(ROOT_ID);
    });

    it("returns the winner's room when a concurrent request provisioned first", async () => {
      const rooms = buildRooms();
      // Both requests miss, both attempt the insert, and the unique owner_id index rejects
      // this one — which then reads the row the winner wrote.
      rooms.findByOwner.mockResolvedValueOnce(null);
      rooms.provision.mockResolvedValue(null);
      const service = await buildService(rooms, buildFolders());

      await expect(service.getOrProvision(OWNER)).resolves.toEqual(ROOM);

      // One insert attempted, one room in existence, and this caller still got a room.
      expect(rooms.provision).toHaveBeenCalledTimes(1);
      expect(rooms.findByOwner).toHaveBeenCalledTimes(2);
    });
  });

  describe("Requirement: Data Room summary", () => {
    it("reports the totals for the whole tree, taken from the root's subtree", async () => {
      const rooms = buildRooms();
      const folders = buildFolders();
      folders.subtreeAggregate.mockResolvedValue({ folders: 4, files: 31, bytes: 12_582_912 });
      const service = await buildService(rooms, folders);

      await expect(service.summary(OWNER, ROOM_ID)).resolves.toEqual({
        folders: 4,
        files: 31,
        bytes: 12_582_912,
      });

      // One prefix aggregate, owned by the module that owns the table — not a second copy of
      // the same SQL living here.
      expect(folders.subtreeAggregate).toHaveBeenCalledWith(OWNER, ROOT_ID);
    });

    it("reports zeroes for an empty room", async () => {
      const service = await buildService(buildRooms(), buildFolders());

      await expect(service.summary(OWNER, ROOM_ID)).resolves.toEqual({
        folders: 0,
        files: 0,
        bytes: 0,
      });
    });
  });

  describe("Requirement: Data Room ownership", () => {
    it("does not tell a stranger the room exists", async () => {
      const rooms = buildRooms();
      const folders = buildFolders();
      rooms.findForOwner.mockResolvedValue(null);
      const service = await buildService(rooms, folders);

      await expect(service.summary(OWNER, ROOM_ID)).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404,
      });
      // Nothing about the room is read, so nothing about it can leak through timing either.
      expect(folders.subtreeAggregate).not.toHaveBeenCalled();
    });

    it("refuses to rename a room the caller does not own", async () => {
      const rooms = buildRooms();
      rooms.findForOwner.mockResolvedValue(null);
      const service = await buildService(rooms, buildFolders());

      await expect(service.rename(OWNER, ROOM_ID, { name: "Theirs" })).rejects.toBeInstanceOf(
        NotFoundError,
      );
      expect(rooms.rename).not.toHaveBeenCalled();
    });
  });

  describe("Requirement: Data Room rename", () => {
    it("renames the room the caller owns", async () => {
      const rooms = buildRooms();
      const service = await buildService(rooms, buildFolders());

      await service.rename(OWNER, ROOM_ID, { name: "Project Atlas" });

      expect(rooms.rename).toHaveBeenCalledWith(ROOM_ID, "Project Atlas");
    });
  });
});

import { Test } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ROOT_DEPTH, ROOT_PATH } from "../folders/folders.repository";
import { DataRoomRepository } from "./data-room.repository";

/**
 * Covers, from openspec/changes/add-data-room-tree/specs/data-room/spec.md:
 *   "First sign-in lands in a usable room", "Concurrent first requests create one room",
 *   "Another user is not told it exists" and "Rename succeeds".
 *
 * Prisma is substituted, because what is worth asserting here is the JavaScript either side
 * of the query: the root row provisioning derives, the translation of a unique violation into
 * "someone else won", and the fact that renaming the room carries its root folder with it.
 * The queries themselves run against a real database in the Cypress API specs.
 */
const OWNER_ID = "99999999-9999-4999-8999-999999999999";
const ROOM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROOT_ID = "11111111-1111-4111-8111-111111111111";

type RoomRow = { id: string; name: string; nodes: Array<{ id: string }> };

const ROOM_ROW: RoomRow = { id: ROOM_ID, name: "My Data Room", nodes: [{ id: ROOT_ID }] };

type CreateArgs = { data: Record<string, unknown> };
type UpdateManyArgs = { where: Record<string, unknown>; data: Record<string, unknown> };

type FakePrisma = {
  dataRoom: {
    findUnique: jest.Mock<Promise<RoomRow | null>, [unknown]>;
    findFirst: jest.Mock<Promise<RoomRow | null>, [unknown]>;
    create: jest.Mock<Promise<RoomRow>, [CreateArgs]>;
    update: jest.Mock<Promise<RoomRow>, [unknown]>;
  };
  node: {
    updateMany: jest.Mock<Promise<{ count: number }>, [UpdateManyArgs]>;
  };
  $transaction: jest.Mock<Promise<unknown[]>, [Array<Promise<unknown>>]>;
};

function buildPrisma(): FakePrisma {
  return {
    dataRoom: {
      findUnique: jest.fn<Promise<RoomRow | null>, [unknown]>().mockResolvedValue(ROOM_ROW),
      findFirst: jest.fn<Promise<RoomRow | null>, [unknown]>().mockResolvedValue(ROOM_ROW),
      create: jest.fn<Promise<RoomRow>, [CreateArgs]>().mockResolvedValue(ROOM_ROW),
      update: jest.fn<Promise<RoomRow>, [unknown]>().mockResolvedValue(ROOM_ROW),
    },
    node: {
      updateMany: jest
        .fn<Promise<{ count: number }>, [UpdateManyArgs]>()
        .mockResolvedValue({ count: 1 }),
    },
    $transaction: jest
      .fn<Promise<unknown[]>, [Array<Promise<unknown>>]>()
      .mockImplementation((operations) => Promise.all(operations)),
  };
}

async function buildRepository(prisma: FakePrisma): Promise<DataRoomRepository> {
  const moduleRef = await Test.createTestingModule({
    providers: [DataRoomRepository, { provide: PrismaService, useValue: prisma }],
  }).compile();

  return moduleRef.get(DataRoomRepository);
}

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6.2.1",
  });
}

/** The `data` the room insert was called with, without reaching into the mock at every site. */
function createdData(prisma: FakePrisma): Record<string, unknown> {
  const call = prisma.dataRoom.create.mock.calls[0];
  if (call === undefined) throw new Error("dataRoom.create was never called");
  return call[0].data;
}

describe("DataRoomRepository.provision", () => {
  it("creates the room and its root folder in one write", async () => {
    const prisma = buildPrisma();
    const repository = await buildRepository(prisma);

    await expect(repository.provision(OWNER_ID, "My Data Room")).resolves.toEqual({
      id: ROOM_ID,
      name: "My Data Room",
      rootFolderId: ROOT_ID,
    });

    // One nested write, so a room can never exist without the folder the interface opens.
    const data = createdData(prisma);
    expect(data).toMatchObject({ ownerId: OWNER_ID, name: "My Data Room" });
    expect(data["nodes"]).toMatchObject({
      create: {
        type: "FOLDER",
        name: "My Data Room",
        normalizedName: "my data room",
        path: ROOT_PATH,
        depth: ROOT_DEPTH,
      },
    });
  });

  it("reports that a concurrent request provisioned first rather than failing", async () => {
    const prisma = buildPrisma();
    prisma.dataRoom.create.mockRejectedValue(uniqueViolation());
    const repository = await buildRepository(prisma);

    // `owner_id` is the only unique column this insert writes, so the violation means the
    // other request won. The caller re-reads the winner's row; nobody sees an error.
    await expect(repository.provision(OWNER_ID, "My Data Room")).resolves.toBeNull();
  });

  it("lets an unrelated database failure through", async () => {
    const prisma = buildPrisma();
    prisma.dataRoom.create.mockRejectedValue(new Error("connection reset"));
    const repository = await buildRepository(prisma);

    await expect(repository.provision(OWNER_ID, "My Data Room")).rejects.toThrow("connection reset");
  });
});

describe("DataRoomRepository.findForOwner", () => {
  it("answers nothing for a malformed id without asking the database", async () => {
    const prisma = buildPrisma();
    const repository = await buildRepository(prisma);

    // A non-UUID would otherwise reach a `uuid` column and raise, turning a mistyped URL
    // into a 500 where the service owes the caller a 404.
    await expect(repository.findForOwner("not-an-id", OWNER_ID)).resolves.toBeNull();
    expect(prisma.dataRoom.findFirst).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the caller, so a foreign room simply does not match", async () => {
    const prisma = buildPrisma();
    const repository = await buildRepository(prisma);

    await repository.findForOwner(ROOM_ID, OWNER_ID);

    expect(prisma.dataRoom.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ROOM_ID, ownerId: OWNER_ID } }),
    );
  });

  it("refuses to hand back a room whose root folder is missing", async () => {
    const prisma = buildPrisma();
    prisma.dataRoom.findFirst.mockResolvedValue({ ...ROOM_ROW, nodes: [] });
    const repository = await buildRepository(prisma);

    // Provisioning writes both rows together, so this is a corrupted database rather than a
    // state the application can reach — saying so beats returning an id nobody can open.
    await expect(repository.findForOwner(ROOM_ID, OWNER_ID)).rejects.toThrow("no root folder");
  });
});

describe("DataRoomRepository.rename", () => {
  it("carries the root folder's name with the room, in one transaction", async () => {
    const prisma = buildPrisma();
    const repository = await buildRepository(prisma);

    await expect(repository.rename(ROOM_ID, "Project Atlas")).resolves.toMatchObject({
      id: ROOM_ID,
      rootFolderId: ROOT_ID,
    });

    // The first breadcrumb is the root folder's name. Leaving it behind would show the old
    // name at the top of every folder in the room.
    expect(prisma.node.updateMany).toHaveBeenCalledWith({
      where: { dataRoomId: ROOM_ID, parentId: null },
      data: { name: "Project Atlas", normalizedName: "project atlas" },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

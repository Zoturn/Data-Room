import { Test } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import { NameConflictError } from "../common/errors/domain-error";
import { PrismaService } from "../prisma/prisma.service";
import {
  FoldersRepository,
  ROOT_DEPTH,
  ROOT_PATH,
  afterChildCursor,
  ancestorIdsOf,
  isNodeId,
  subtreePatternOf,
  subtreePrefixOf,
  toNodeSummary,
  type NodeRecord,
} from "./folders.repository";

/**
 * Covers the path arithmetic behind every subtree operation, from
 * openspec/changes/add-data-room-tree/specs/folders/spec.md:
 *   "Folder nested in another folder", "Deep folder returns its full chain", "Root folder",
 *   "Case-insensitive collision is refused" and "Concurrent creates do not both succeed".
 *
 * Prisma is substituted here — deliberately, and only for the two methods whose behaviour is
 * JavaScript rather than SQL: the `path`/`depth` a create derives from its parent, and the
 * order a breadcrumb is assembled in. The queries themselves (the prefix scan, the keyset
 * page, the recursive delete) are exercised against a real database by the Cypress API specs,
 * because a mocked query proves nothing about a query.
 */
const ROOM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROOT_ID = "11111111-1111-4111-8111-111111111111";
const FINANCIALS_ID = "22222222-2222-4222-8222-222222222222";
const YEAR_ID = "33333333-3333-4333-8333-333333333333";

const UPDATED_AT = new Date("2026-03-01T12:00:00.000Z");

const root: NodeRecord = {
  id: ROOT_ID,
  dataRoomId: ROOM_ID,
  parentId: null,
  type: "FOLDER",
  name: "My Data Room",
  path: ROOT_PATH,
  depth: ROOT_DEPTH,
  sizeBytes: 0n,
  updatedAt: UPDATED_AT,
};

const financials: NodeRecord = {
  ...root,
  id: FINANCIALS_ID,
  parentId: ROOT_ID,
  name: "Financials",
  path: subtreePrefixOf(root),
  depth: 1,
};

const year: NodeRecord = {
  ...financials,
  id: YEAR_ID,
  parentId: FINANCIALS_ID,
  name: "2024",
  path: subtreePrefixOf(financials),
  depth: 2,
};

type NodeCreateArgs = { data: Record<string, unknown> };

type FakePrisma = {
  node: {
    create: jest.Mock<Promise<NodeRecord>, [NodeCreateArgs]>;
    findMany: jest.Mock<Promise<Array<{ id: string; name: string }>>, [unknown]>;
  };
};

function buildPrisma(): FakePrisma {
  return {
    node: {
      create: jest.fn<Promise<NodeRecord>, [NodeCreateArgs]>().mockResolvedValue(year),
      findMany: jest
        .fn<Promise<Array<{ id: string; name: string }>>, [unknown]>()
        .mockResolvedValue([]),
    },
  };
}

async function buildRepository(prisma: FakePrisma): Promise<FoldersRepository> {
  const moduleRef = await Test.createTestingModule({
    providers: [FoldersRepository, { provide: PrismaService, useValue: prisma }],
  }).compile();

  return moduleRef.get(FoldersRepository);
}

/** The `data` a `node.create` was called with, without reaching into the mock at every site. */
function createdData(prisma: FakePrisma): Record<string, unknown> {
  const call = prisma.node.create.mock.calls[0];
  if (call === undefined) throw new Error("node.create was never called");
  return call[0].data;
}

describe("tree path arithmetic", () => {
  it("anchors the root at `/` with no ancestors", () => {
    // A node's path is the chain of its ancestors and never its own id, so the root — which
    // has none — is the empty chain. Everything below depends on this.
    expect(ancestorIdsOf(root.path)).toEqual([]);
    expect(root.depth).toBe(0);
  });

  it("makes a child's path the parent's subtree prefix", () => {
    // One string serves two jobs: the child's path and the parent's LIKE anchor.
    expect(subtreePrefixOf(root)).toBe(`/${ROOT_ID}/`);
    expect(financials.path).toBe(`/${ROOT_ID}/`);
    expect(year.path).toBe(`/${ROOT_ID}/${FINANCIALS_ID}/`);
  });

  it("reads the ordered ancestor chain straight out of a deep path", () => {
    expect(ancestorIdsOf(year.path)).toEqual([ROOT_ID, FINANCIALS_ID]);
  });

  it("prefixes a subtree so that a sibling with a longer id cannot be swept in", () => {
    // The trailing slash is what stops `/root/22.../` matching `/root/22...9/`. Without it a
    // recursive delete would take a neighbouring subtree with it.
    expect(subtreePrefixOf(financials).endsWith("/")).toBe(true);
    expect(subtreePrefixOf(year).startsWith(subtreePrefixOf(financials))).toBe(true);
  });

  it("hands the subtree LIKE pattern over as one parameter, `%` included", () => {
    // `path LIKE $1 || '%'` is an expression, and the planner only turns a prefix LIKE into
    // an index range scan when the pattern is a constant — so the `%` belongs on this side.
    expect(subtreePatternOf(financials)).toBe(`/${ROOT_ID}/${FINANCIALS_ID}/%`);
    expect(subtreePatternOf(financials).startsWith(subtreePrefixOf(financials))).toBe(true);
  });

  it("accepts only UUID ids, keeping the LIKE alphabet free of metacharacters", () => {
    // An id containing `%` or `_` would make a prefix match reach past its own subtree.
    expect(isNodeId(FINANCIALS_ID)).toBe(true);
    expect(isNodeId("100%")).toBe(false);
    expect(isNodeId("../etc")).toBe(false);
  });

  it("hands a size to the contract as a number, not a bigint", () => {
    const summary = toNodeSummary({ ...year, sizeBytes: 2_048n });

    expect(summary.sizeBytes).toBe(2048);
    expect(summary.updatedAt).toBe("2026-03-01T12:00:00.000Z");
  });
});

describe("children keyset", () => {
  it("continues from a folder into the remaining folders and then every file", () => {
    const after = afterChildCursor({ type: "FOLDER", name: "Financials", id: FINANCIALS_ID });

    // Folders sort before files, so everything of the other type is still ahead.
    expect(after).toEqual({
      OR: [
        { type: "FOLDER", name: { gt: "Financials" } },
        { type: "FOLDER", name: "Financials", id: { gt: FINANCIALS_ID } },
        { type: "FILE" },
      ],
    });
  });

  it("does not reach back to folders once the page has entered the files", () => {
    const after = afterChildCursor({ type: "FILE", name: "report.pdf", id: YEAR_ID });

    // Including folders here would repeat every folder on the second page.
    expect(after).toEqual({
      OR: [
        { type: "FILE", name: { gt: "report.pdf" } },
        { type: "FILE", name: "report.pdf", id: { gt: YEAR_ID } },
      ],
    });
  });
});

describe("FoldersRepository.createFolder", () => {
  it("derives the child's path and depth from the parent alone", async () => {
    const prisma = buildPrisma();
    const repository = await buildRepository(prisma);

    await repository.createFolder(financials, "2024");

    expect(createdData(prisma)).toMatchObject({
      dataRoomId: ROOM_ID,
      parentId: FINANCIALS_ID,
      type: "FOLDER",
      name: "2024",
      path: `/${ROOT_ID}/${FINANCIALS_ID}/`,
      depth: 2,
    });
  });

  it("writes the normalised name the unique index compares on", async () => {
    const prisma = buildPrisma();
    const repository = await buildRepository(prisma);

    await repository.createFolder(root, "  Quarterly   Reports  ");

    // `name` is what the owner typed; `normalizedName` is what decides a collision. Case and
    // runs of whitespace collapse, so `Quarterly Reports` cannot sit beside this one.
    expect(createdData(prisma)).toMatchObject({
      name: "  Quarterly   Reports  ",
      normalizedName: "quarterly reports",
    });
  });

  it("turns the unique-index violation into NAME_CONFLICT rather than a 500", async () => {
    const prisma = buildPrisma();
    prisma.node.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "6.2.1",
      }),
    );
    const repository = await buildRepository(prisma);

    // This is the concurrency path: two simultaneous creates of the same name both reach the
    // insert, and the database decides. The loser must read as a conflict, not as a fault.
    await expect(repository.createFolder(root, "reports")).rejects.toBeInstanceOf(
      NameConflictError,
    );
    await expect(repository.createFolder(root, "reports")).rejects.toMatchObject({
      code: "NAME_CONFLICT",
      status: 409,
    });
  });

  it("lets an unrelated database failure through untranslated", async () => {
    const prisma = buildPrisma();
    prisma.node.create.mockRejectedValue(new Error("connection reset"));
    const repository = await buildRepository(prisma);

    // Swallowing this as a conflict would tell the owner their folder name was taken when
    // the database was simply unreachable.
    await expect(repository.createFolder(root, "Reports")).rejects.toThrow("connection reset");
  });
});

describe("FoldersRepository.breadcrumbsFor", () => {
  it("returns only itself for the root", async () => {
    const prisma = buildPrisma();
    const repository = await buildRepository(prisma);

    await expect(repository.breadcrumbsFor(root)).resolves.toEqual([
      { id: ROOT_ID, name: "My Data Room" },
    ]);
    // No ancestors means no lookup at all.
    expect(prisma.node.findMany).not.toHaveBeenCalled();
  });

  it("orders a deep chain by the path, not by the order the rows came back in", async () => {
    const prisma = buildPrisma();
    // Postgres returns an `IN` result in whatever order it likes; the path is the authority.
    prisma.node.findMany.mockResolvedValue([
      { id: FINANCIALS_ID, name: "Financials" },
      { id: ROOT_ID, name: "My Data Room" },
    ]);
    const repository = await buildRepository(prisma);

    await expect(repository.breadcrumbsFor(year)).resolves.toEqual([
      { id: ROOT_ID, name: "My Data Room" },
      { id: FINANCIALS_ID, name: "Financials" },
      { id: YEAR_ID, name: "2024" },
    ]);
  });

  it("fetches every ancestor in one query, however deep the folder", async () => {
    const prisma = buildPrisma();
    prisma.node.findMany.mockResolvedValue([
      { id: ROOT_ID, name: "My Data Room" },
      { id: FINANCIALS_ID, name: "Financials" },
    ]);
    const repository = await buildRepository(prisma);

    await repository.breadcrumbsFor(year);

    // One round trip, not one per level: the ids are already in the path.
    expect(prisma.node.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.node.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [ROOT_ID, FINANCIALS_ID] }, dataRoomId: ROOM_ID },
      }),
    );
  });

  it("skips an ancestor that disappeared mid-read instead of failing the request", async () => {
    const prisma = buildPrisma();
    // The owner deleted the middle folder while this read was in flight. The caller's next
    // request will 404; this one should not be a 500 on the way there.
    prisma.node.findMany.mockResolvedValue([{ id: ROOT_ID, name: "My Data Room" }]);
    const repository = await buildRepository(prisma);

    await expect(repository.breadcrumbsFor(year)).resolves.toEqual([
      { id: ROOT_ID, name: "My Data Room" },
      { id: YEAR_ID, name: "2024" },
    ]);
  });
});

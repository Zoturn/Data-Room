import { Test } from "@nestjs/testing";
import type { Breadcrumb, NodeSummary, Page, PageQuery, SubtreeAggregate } from "@data-room/shared";
import type { AuthUser } from "../auth/jwt-auth.guard";
import {
  NameConflictError,
  NotFoundError,
  ValidationFailedError,
} from "../common/errors/domain-error";
import { BlobReleaseService } from "../files/blob-release.service";
import { FoldersRepository, ROOT_DEPTH, ROOT_PATH, type NodeRecord } from "./folders.repository";
import { FoldersService, MAX_FOLDER_DEPTH, MaxDepthExceededError } from "./folders.service";

/**
 * Covers, from openspec/changes/add-data-room-tree/specs/folders/spec.md:
 *   "Depth limit is enforced", "Foreign parent is refused", "Concurrent creates do not both
 *   succeed", "Preview counts the whole subtree", "Subtree disappears", "Stranger cannot list
 *   a folder" and "Stranger cannot delete".
 *
 * The repository is substituted: what is under test here is the decisions the service makes
 * — which failures it raises, and what it refuses to do at all — not the SQL underneath.
 */
const OWNER: AuthUser = { id: "99999999-9999-4999-8999-999999999999" };
const ROOM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROOT_ID = "11111111-1111-4111-8111-111111111111";
const FINANCIALS_ID = "22222222-2222-4222-8222-222222222222";

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
  path: `/${ROOT_ID}/`,
  depth: 1,
};

const CREATED: NodeSummary = {
  id: "33333333-3333-4333-8333-333333333333",
  type: "FOLDER",
  name: "2024",
  updatedAt: UPDATED_AT.toISOString(),
  sizeBytes: 0,
};

const EMPTY_PAGE: Page<NodeSummary> = { items: [], nextCursor: null };
const FIRST_PAGE: PageQuery = { limit: 50 };

type RepositoryStub = {
  findFolderForOwner: jest.Mock<Promise<NodeRecord | null>, [string, string]>;
  createFolder: jest.Mock<Promise<NodeSummary>, [NodeRecord, string]>;
  renameNode: jest.Mock<Promise<NodeSummary>, [string, string]>;
  listChildren: jest.Mock<Promise<Page<NodeSummary>>, [NodeRecord, number, string | undefined]>;
  breadcrumbsFor: jest.Mock<Promise<Breadcrumb[]>, [NodeRecord]>;
  subtreeAggregate: jest.Mock<Promise<SubtreeAggregate>, [NodeRecord]>;
  deleteSubtree: jest.Mock<Promise<string[]>, [NodeRecord]>;
};

function buildRepository(): RepositoryStub {
  return {
    findFolderForOwner: jest
      .fn<Promise<NodeRecord | null>, [string, string]>()
      .mockResolvedValue(financials),
    createFolder: jest.fn<Promise<NodeSummary>, [NodeRecord, string]>().mockResolvedValue(CREATED),
    renameNode: jest.fn<Promise<NodeSummary>, [string, string]>().mockResolvedValue(CREATED),
    listChildren: jest
      .fn<Promise<Page<NodeSummary>>, [NodeRecord, number, string | undefined]>()
      .mockResolvedValue(EMPTY_PAGE),
    breadcrumbsFor: jest.fn<Promise<Breadcrumb[]>, [NodeRecord]>().mockResolvedValue([]),
    subtreeAggregate: jest
      .fn<Promise<SubtreeAggregate>, [NodeRecord]>()
      .mockResolvedValue({ folders: 0, files: 0, bytes: 0 }),
    deleteSubtree: jest.fn<Promise<string[]>, [NodeRecord]>().mockResolvedValue([]),
  };
}

type BlobsStub = {
  releaseAll: jest.Mock<Promise<number>, [readonly string[]]>;
};

function buildBlobs(): BlobsStub {
  return { releaseAll: jest.fn<Promise<number>, [readonly string[]]>().mockResolvedValue(0) };
}

async function buildService(
  repository: RepositoryStub,
  blobs: BlobsStub = buildBlobs(),
): Promise<FoldersService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      FoldersService,
      { provide: FoldersRepository, useValue: repository },
      { provide: BlobReleaseService, useValue: blobs },
    ],
  }).compile();

  return moduleRef.get(FoldersService);
}

describe("FoldersService", () => {
  describe("Requirement: Folder creation and nesting", () => {
    it("creates the folder under the resolved parent", async () => {
      const repository = buildRepository();
      const service = await buildService(repository);

      await expect(
        service.createFolder(OWNER, { parentId: FINANCIALS_ID, name: "2024" }),
      ).resolves.toEqual(CREATED);

      // The parent record itself is handed down, so path and depth are derived from a row
      // that was just read — never from anything the client sent.
      expect(repository.createFolder).toHaveBeenCalledWith(financials, "2024");
    });

    it("refuses to nest past the depth limit, and creates nothing", async () => {
      const repository = buildRepository();
      repository.findFolderForOwner.mockResolvedValue({ ...financials, depth: MAX_FOLDER_DEPTH });
      const service = await buildService(repository);

      await expect(
        service.createFolder(OWNER, { parentId: FINANCIALS_ID, name: "Deeper" }),
      ).rejects.toBeInstanceOf(MaxDepthExceededError);
      expect(repository.createFolder).not.toHaveBeenCalled();
    });

    it("names the limit in the error, so the message is actionable", async () => {
      const error = new MaxDepthExceededError(MAX_FOLDER_DEPTH);

      expect(error.code).toBe("MAX_DEPTH_EXCEEDED");
      expect(error.status).toBe(400);
      expect(error.message).toContain(String(MAX_FOLDER_DEPTH));
    });

    it("answers 404 for a parent in someone else's Data Room, never 403", async () => {
      const repository = buildRepository();
      // The lookup is owner-scoped, so a foreign parent is indistinguishable from one that
      // never existed — which is the point.
      repository.findFolderForOwner.mockResolvedValue(null);
      const service = await buildService(repository);

      await expect(
        service.createFolder(OWNER, { parentId: FINANCIALS_ID, name: "2024" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
      expect(repository.createFolder).not.toHaveBeenCalled();
    });

    it("lets the database decide a name collision rather than checking first", async () => {
      const repository = buildRepository();
      repository.createFolder.mockRejectedValue(new NameConflictError("Reports"));
      const service = await buildService(repository);

      await expect(
        service.createFolder(OWNER, { parentId: FINANCIALS_ID, name: "reports" }),
      ).rejects.toBeInstanceOf(NameConflictError);

      // No read-then-write check: two concurrent creates must both reach the insert, so that
      // the unique index — not the application — decides which one wins.
      expect(repository.listChildren).not.toHaveBeenCalled();
      expect(repository.createFolder).toHaveBeenCalledTimes(1);
    });
  });

  describe("Requirement: Folder contents listing and breadcrumbs", () => {
    it("returns the folder, its chain and the first page together", async () => {
      const repository = buildRepository();
      repository.findFolderForOwner.mockResolvedValue(financials);
      repository.breadcrumbsFor.mockResolvedValue([
        { id: ROOT_ID, name: "My Data Room" },
        { id: FINANCIALS_ID, name: "Financials" },
      ]);
      const service = await buildService(repository);

      const contents = await service.getContents(OWNER, FINANCIALS_ID, FIRST_PAGE);

      expect(contents.folder).toMatchObject({ id: FINANCIALS_ID, name: "Financials" });
      // Root first, the folder itself last — the bar renders straight from this array.
      expect(contents.breadcrumbs.at(0)?.id).toBe(ROOT_ID);
      expect(contents.breadcrumbs.at(-1)?.id).toBe(FINANCIALS_ID);
      expect(contents.children).toEqual(EMPTY_PAGE);
    });

    it("passes the cursor through untouched so paging continues where it stopped", async () => {
      const repository = buildRepository();
      const service = await buildService(repository);

      await service.listChildren(OWNER, FINANCIALS_ID, { limit: 25, cursor: "opaque-cursor" });

      expect(repository.listChildren).toHaveBeenCalledWith(financials, 25, "opaque-cursor");
    });

    it("answers 404 when a stranger lists a folder they do not own", async () => {
      const repository = buildRepository();
      repository.findFolderForOwner.mockResolvedValue(null);
      const service = await buildService(repository);

      await expect(service.listChildren(OWNER, FINANCIALS_ID, FIRST_PAGE)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      expect(repository.listChildren).not.toHaveBeenCalled();
    });
  });

  describe("Requirement: Folder rename", () => {
    it("renames a folder in one row", async () => {
      const repository = buildRepository();
      const service = await buildService(repository);

      await service.renameFolder(OWNER, FINANCIALS_ID, { name: "Finance" });

      expect(repository.renameNode).toHaveBeenCalledWith(FINANCIALS_ID, "Finance");
    });

    it("refuses to rename the root, which is the Data Room's own name", async () => {
      const repository = buildRepository();
      repository.findFolderForOwner.mockResolvedValue(root);
      const service = await buildService(repository);

      // One name with two owners would let the header and the breadcrumb disagree.
      await expect(
        service.renameFolder(OWNER, ROOT_ID, { name: "Anything" }),
      ).rejects.toBeInstanceOf(ValidationFailedError);
      expect(repository.renameNode).not.toHaveBeenCalled();
    });
  });

  describe("Requirement: Deletion preview and recursive deletion", () => {
    it("previews the real subtree counts, so the dialog states the true consequence", async () => {
      const repository = buildRepository();
      repository.subtreeAggregate.mockResolvedValue({
        folders: 12,
        files: 143,
        bytes: 2_469_606_195,
      });
      const service = await buildService(repository);

      await expect(service.deletionPreview(OWNER, FINANCIALS_ID)).resolves.toEqual({
        folders: 12,
        files: 143,
        bytes: 2_469_606_195,
      });
      expect(repository.subtreeAggregate).toHaveBeenCalledWith(financials);
    });

    it("reports zeroes for an empty folder, so the confirmation is not alarming", async () => {
      const repository = buildRepository();
      const service = await buildService(repository);

      await expect(service.deletionPreview(OWNER, FINANCIALS_ID)).resolves.toEqual({
        folders: 0,
        files: 0,
        bytes: 0,
      });
    });

    it("deletes the subtree through the one prefix statement", async () => {
      const repository = buildRepository();
      const service = await buildService(repository);

      await expect(service.deleteFolder(OWNER, FINANCIALS_ID)).resolves.toBeUndefined();

      expect(repository.deleteSubtree).toHaveBeenCalledWith(financials);
    });

    it("releases the blob of every file the subtree contained", async () => {
      const repository = buildRepository();
      const keys = [`${ROOM_ID}/aaaa`, `${ROOM_ID}/bbbb`];
      repository.deleteSubtree.mockResolvedValue(keys);
      const blobs = buildBlobs();
      const service = await buildService(repository, blobs);

      await service.deleteFolder(OWNER, FINANCIALS_ID);

      // Nothing else ever learns these keys: the rows carrying them have just been deleted,
      // and the sweep only looks at reservations. A miss here is a PDF that stays in the
      // bucket for good.
      expect(blobs.releaseAll).toHaveBeenCalledWith(keys);
    });

    it("leaves the tree intact when the delete fails", async () => {
      const repository = buildRepository();
      repository.deleteSubtree.mockRejectedValue(new Error("deadlock detected"));
      const service = await buildService(repository);

      // The repository runs the delete inside a transaction, so a failure here means nothing
      // was persisted. The service must not paper over it with a 204.
      await expect(service.deleteFolder(OWNER, FINANCIALS_ID)).rejects.toThrow("deadlock detected");
    });

    it("does not release any object when the delete fails", async () => {
      const repository = buildRepository();
      repository.deleteSubtree.mockRejectedValue(new Error("deadlock detected"));
      const blobs = buildBlobs();
      const service = await buildService(repository, blobs);

      await expect(service.deleteFolder(OWNER, FINANCIALS_ID)).rejects.toThrow("deadlock");

      // The rows are still there. Deleting their bytes would leave rows pointing at nothing.
      expect(blobs.releaseAll).not.toHaveBeenCalled();
    });

    it("refuses to delete the root, which would leave a room with nothing to open", async () => {
      const repository = buildRepository();
      repository.findFolderForOwner.mockResolvedValue(root);
      const service = await buildService(repository);

      await expect(service.deleteFolder(OWNER, ROOT_ID)).rejects.toBeInstanceOf(
        ValidationFailedError,
      );
      expect(repository.deleteSubtree).not.toHaveBeenCalled();
    });

    it("answers 404 and touches nothing when a stranger attempts a delete", async () => {
      const repository = buildRepository();
      repository.findFolderForOwner.mockResolvedValue(null);
      const service = await buildService(repository);

      await expect(service.deleteFolder(OWNER, FINANCIALS_ID)).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404,
      });
      // Asserting on the absence: the folder must be untouched, not merely unreported.
      expect(repository.deleteSubtree).not.toHaveBeenCalled();
    });
  });
});

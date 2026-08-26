import { Test } from "@nestjs/testing";
import type { Breadcrumb, NodeSummary } from "@data-room/shared";
import type { AuthUser } from "../auth/jwt-auth.guard";
import { ConfigService, ENV_SOURCE } from "../config/config.service";
import { InMemoryStorageService } from "../storage/in-memory-storage.service";
import { StorageService, storageKeyFor } from "../storage/storage.service";
import { BlobReleaseQueue } from "./blob-release.queue";
import { BlobReleaseService } from "./blob-release.service";
import { FilesRepository, type FileRecord, type ReservedFile } from "./files.repository";
import { FilesService } from "./files.service";
import { AccessResolver, type Access, type NodeWithOwner } from "../sharing/access.resolver";
import { NodeAccessService } from "../sharing/node-access.service";

/**
 * The security decisions this service makes: what a commit is allowed to accept, and who is
 * allowed to reach a file at all.
 *
 * The repository is substituted, as in `folders.service.spec.ts` — what is under test is the
 * order of the checks and which failures they raise, not the SQL. Storage is *not*
 * substituted: `InMemoryStorageService` is a real implementation of the contract, and every
 * assertion below is about what the pipeline concluded from the stored object rather than
 * from the request, so a stub of it would be testing the stub.
 */
const OWNER: AuthUser = { id: "99999999-9999-4999-8999-999999999999" };
const ROOM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ROOM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROOT_ID = "11111111-1111-4111-8111-111111111111";
const FOLDER_ID = "22222222-2222-4222-8222-222222222222";
const FILE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_FOLDER_ID = "44444444-4444-4444-8444-444444444444";

const UPDATED_AT = new Date("2026-03-01T12:00:00.000Z");

const folder: FileRecord = {
  id: FOLDER_ID,
  dataRoomId: ROOM_ID,
  parentId: ROOT_ID,
  type: "FOLDER",
  name: "Financials",
  path: `/${ROOT_ID}/`,
  depth: 1,
  sizeBytes: 0n,
  createdAt: UPDATED_AT,
  updatedAt: UPDATED_AT,
  storageKey: null,
  contentType: null,
  uploadState: null,
};

const RESERVED_KEY = storageKeyFor(ROOM_ID, FILE_ID);

/**
 * Reserved just now. The window is real time — a fixture dated like the rest of them would
 * make every commit below fail as expired, which is a property worth testing deliberately
 * rather than everywhere by accident.
 */
const RESERVED_AT = new Date();

const reservation: ReservedFile = {
  ...folder,
  createdAt: RESERVED_AT,
  id: FILE_ID,
  parentId: FOLDER_ID,
  type: "FILE",
  name: "report.pdf",
  path: `${folder.path}${FOLDER_ID}/`,
  depth: 2,
  sizeBytes: 1024n,
  storageKey: RESERVED_KEY,
  contentType: "application/pdf",
  uploadState: "PENDING",
};

const committedFile: FileRecord = { ...reservation, uploadState: "READY" };

const SUMMARY: NodeSummary = {
  id: FILE_ID,
  type: "FILE",
  name: "report.pdf",
  updatedAt: UPDATED_AT.toISOString(),
  sizeBytes: 1024,
};

/** A PDF as far as the commit check is concerned: the signature, then anything. */
function pdfBytes(trailing = "\n%%EOF\n"): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7${trailing}`);
}

type RepositoryStub = {
  findFileForOwner: jest.Mock<Promise<FileRecord | null>, [string, string]>;
  findFileForRead: jest.Mock<Promise<NodeWithOwner<FileRecord> | null>, [string]>;
  findReservationForOwner: jest.Mock<Promise<FileRecord | null>, [string, string]>;
  findFolderForOwner: jest.Mock<Promise<FileRecord | null>, [string, string]>;
  findNodeForOwner: jest.Mock<Promise<FileRecord | null>, [string, string]>;
  reserveFile: jest.Mock<Promise<ReservedFile>, [FileRecord, string, string, number]>;
  markReady: jest.Mock<Promise<NodeSummary | null>, [string, number, string | null]>;
  renameFile: jest.Mock<Promise<NodeSummary>, [FileRecord, string]>;
  moveFile: jest.Mock<Promise<NodeSummary>, [FileRecord, FileRecord]>;
  deleteFile: jest.Mock<Promise<string | null>, [string]>;
  deleteReservation: jest.Mock<Promise<boolean>, [string]>;
  breadcrumbsFor: jest.Mock<Promise<Breadcrumb[]>, [FileRecord]>;
};

function buildRepository(): RepositoryStub {
  return {
    findFileForOwner: jest
      .fn<Promise<FileRecord | null>, [string, string]>()
      .mockResolvedValue(committedFile),
    // The read path loads the node with its owner and lets NodeAccessService decide; the
    // owner-scoped lookup above still serves the write paths.
    findFileForRead: jest
      .fn<Promise<NodeWithOwner<FileRecord> | null>, [string]>()
      .mockResolvedValue({ node: committedFile, ownerId: OWNER.id }),
    findReservationForOwner: jest
      .fn<Promise<FileRecord | null>, [string, string]>()
      .mockResolvedValue(reservation),
    findFolderForOwner: jest
      .fn<Promise<FileRecord | null>, [string, string]>()
      .mockResolvedValue(folder),
    findNodeForOwner: jest
      .fn<Promise<FileRecord | null>, [string, string]>()
      .mockResolvedValue(folder),
    reserveFile: jest
      .fn<Promise<ReservedFile>, [FileRecord, string, string, number]>()
      .mockResolvedValue(reservation),
    markReady: jest
      .fn<Promise<NodeSummary | null>, [string, number, string | null]>()
      .mockResolvedValue(SUMMARY),
    renameFile: jest.fn<Promise<NodeSummary>, [FileRecord, string]>().mockResolvedValue(SUMMARY),
    moveFile: jest.fn<Promise<NodeSummary>, [FileRecord, FileRecord]>().mockResolvedValue(SUMMARY),
    deleteFile: jest.fn<Promise<string | null>, [string]>().mockResolvedValue(RESERVED_KEY),
    deleteReservation: jest.fn<Promise<boolean>, [string]>().mockResolvedValue(true),
    breadcrumbsFor: jest.fn<Promise<Breadcrumb[]>, [FileRecord]>().mockResolvedValue([]),
  };
}

type Harness = {
  service: FilesService;
  storage: InMemoryStorageService;
  repository: RepositoryStub;
};

async function buildHarness(repository: RepositoryStub = buildRepository()): Promise<Harness> {
  const storage = new InMemoryStorageService();

  const moduleRef = await Test.createTestingModule({
    providers: [
      // The real access service over a resolver that answers "owner": these specs are about
      // what the service does once a caller may read, and substituting the access service
      // itself would stop exercising the door every read path goes through.
      NodeAccessService,
      {
        provide: AccessResolver,
        useValue: { resolve: (): Promise<Access> => Promise.resolve({ kind: "owner" }) },
      },
      FilesService,
      BlobReleaseService,
      BlobReleaseQueue,
      ConfigService,
      { provide: FilesRepository, useValue: repository },
      { provide: StorageService, useValue: storage },
      {
        provide: ENV_SOURCE,
        useValue: {
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://user:pass@localhost:6543/db",
          DIRECT_URL: "postgresql://user:pass@localhost:5432/db",
          WEB_APP_URL: "https://app.test",
          CORS_ORIGINS: "https://app.test",
          JWT_ACCESS_SECRET: "a-test-secret-of-at-least-thirty-two-chars",
          SUPABASE_URL: "https://project.supabase.co",
          SUPABASE_SECRET_KEY: "a-test-service-role-key",
        },
      },
    ],
  }).compile();

  return { service: moduleRef.get(FilesService), storage, repository };
}

describe("FilesService", () => {
  describe("Requirement: A commit is decided by the stored object", () => {
    it("refuses an object stored as HTML, however the bytes begin", async () => {
      const { service, storage, repository } = await buildHarness();
      // The signature check alone passes this: the first five bytes really are `%PDF-`. What
      // makes it an attack is what the object will be *served* as — a signed download URL
      // hands this to the browser as a page, on the storage origin, straight from the
      // viewer's own "Open in a new tab".
      storage.putObject(RESERVED_KEY, pdfBytes("<script>alert(1)</script>"), "text/html");

      await expect(service.commitUpload(OWNER, FILE_ID)).rejects.toMatchObject({
        code: "UNSUPPORTED_FILE_TYPE",
        status: 400,
      });

      expect(repository.markReady).not.toHaveBeenCalled();
      // Nothing survives for a second attempt: neither the held name nor the bytes.
      expect(repository.deleteReservation).toHaveBeenCalledWith(FILE_ID);
      expect(storage.has(RESERVED_KEY)).toBe(false);
    });

    it("refuses an object with no content type at all", async () => {
      const { service, storage } = await buildHarness();
      // Fail closed. The header decides how the bytes are interpreted, and an upload that
      // never pinned it down is not one to hand out a URL for later.
      storage.putObject(RESERVED_KEY, pdfBytes(), null);

      await expect(service.commitUpload(OWNER, FILE_ID)).rejects.toMatchObject({
        code: "UNSUPPORTED_FILE_TYPE",
      });
    });

    it("accepts a content type carrying parameters", async () => {
      const { service, storage } = await buildHarness();
      storage.putObject(RESERVED_KEY, pdfBytes(), "Application/PDF; charset=binary");

      await expect(service.commitUpload(OWNER, FILE_ID)).resolves.toEqual(SUMMARY);
    });

    it("refuses bytes that are not a PDF, however the object is labelled", async () => {
      const { service, storage, repository } = await buildHarness();
      storage.putObject(
        RESERVED_KEY,
        new TextEncoder().encode("MZ not a document at all"),
        "application/pdf",
      );

      await expect(service.commitUpload(OWNER, FILE_ID)).rejects.toMatchObject({
        code: "UNSUPPORTED_FILE_TYPE",
      });

      expect(repository.markReady).not.toHaveBeenCalled();
      expect(storage.has(RESERVED_KEY)).toBe(false);
    });

    it("refuses an object larger than the limit, whatever the intent declared", async () => {
      const { service, storage, repository } = await buildHarness();
      // The size at intent is a client claim; this is the number that cannot be wrong, and it
      // is read after the bytes have landed rather than before.
      const oversized = new Uint8Array(50 * 1024 * 1024 + 1);
      oversized.set(pdfBytes(""), 0);
      storage.putObject(RESERVED_KEY, oversized, "application/pdf");

      await expect(service.commitUpload(OWNER, FILE_ID)).rejects.toMatchObject({
        code: "FILE_TOO_LARGE",
        status: 413,
      });

      expect(repository.markReady).not.toHaveBeenCalled();
      expect(storage.has(RESERVED_KEY)).toBe(false);
    });

    it("commits a real PDF, recording the stored size rather than the declared one", async () => {
      const { service, storage, repository } = await buildHarness();
      storage.putObject(RESERVED_KEY, pdfBytes(), "application/pdf");

      await expect(service.commitUpload(OWNER, FILE_ID)).resolves.toEqual(SUMMARY);

      expect(repository.markReady).toHaveBeenCalledWith(FILE_ID, pdfBytes().length, null);
      expect(storage.has(RESERVED_KEY)).toBe(true);
    });

    it("refuses a reservation whose window has passed, and takes its bytes with it", async () => {
      const repository = buildRepository();
      repository.findReservationForOwner.mockResolvedValue({
        ...reservation,
        createdAt: new Date(Date.now() - 2 * 3600 * 1000),
      });
      const { service, storage } = await buildHarness(repository);
      storage.putObject(RESERVED_KEY, pdfBytes(), "application/pdf");

      await expect(service.commitUpload(OWNER, FILE_ID)).rejects.toMatchObject({
        code: "UPLOAD_EXPIRED",
        status: 410,
      });

      expect(repository.markReady).not.toHaveBeenCalled();
      expect(storage.has(RESERVED_KEY)).toBe(false);
    });

    it("will not let a stranger commit someone else's reservation", async () => {
      const repository = buildRepository();
      // Ownership is the `where` clause, so for another caller the reservation is simply not
      // there. The interesting half is what must *not* follow from that.
      repository.findReservationForOwner.mockResolvedValue(null);
      const { service, storage } = await buildHarness(repository);
      storage.putObject(RESERVED_KEY, pdfBytes(), "application/pdf");

      await expect(service.commitUpload(OWNER, FILE_ID)).rejects.toMatchObject({
        code: "UPLOAD_EXPIRED",
      });

      expect(repository.deleteReservation).not.toHaveBeenCalled();
      expect(repository.markReady).not.toHaveBeenCalled();
      // A stranger's failed commit must not delete the owner's bytes either.
      expect(storage.has(RESERVED_KEY)).toBe(true);
    });

    it("releases the object when the sweep expired the reservation mid-check", async () => {
      const repository = buildRepository();
      repository.markReady.mockResolvedValue(null);
      const { service, storage } = await buildHarness(repository);
      storage.putObject(RESERVED_KEY, pdfBytes(), "application/pdf");

      await expect(service.commitUpload(OWNER, FILE_ID)).rejects.toMatchObject({
        code: "UPLOAD_EXPIRED",
      });

      // The row has gone, so the object is unreferenced and must not be left behind.
      expect(storage.has(RESERVED_KEY)).toBe(false);
    });
  });

  describe("Requirement: A signed URL follows the access check", () => {
    it("does not mint a download URL for a file the caller does not own", async () => {
      const repository = buildRepository();
      repository.findFileForOwner.mockResolvedValue(null);
      const { service, storage } = await buildHarness(repository);
      const signing = jest.spyOn(storage, "createDownloadUrl");

      await expect(service.getContentUrl(OWNER, FILE_ID)).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404,
      });

      // The order is the authorisation: a signed URL carries its own credentials, so one
      // minted before the check has handed the file over whatever the response then says.
      expect(signing).not.toHaveBeenCalled();
    });

    it("mints one for the owner, over the key the row holds", async () => {
      const { service, storage } = await buildHarness();
      // The stored object, because signing re-reads it: the signed upload URL outlives the
      // commit, so what the bucket holds now is the only thing worth trusting on a read path.
      storage.putObject(RESERVED_KEY, pdfBytes(), "application/pdf");
      const signing = jest.spyOn(storage, "createDownloadUrl");

      const issued = await service.getContentUrl(OWNER, FILE_ID);

      expect(signing).toHaveBeenCalledWith(RESERVED_KEY, 300);
      expect(issued.url).toContain(RESERVED_KEY);
    });
  });

  describe("Requirement: A file moves only within its own Data Room", () => {
    it("refuses a destination in another Data Room as absent", async () => {
      const repository = buildRepository();
      repository.findNodeForOwner.mockResolvedValue({
        ...folder,
        id: OTHER_FOLDER_ID,
        dataRoomId: OTHER_ROOM_ID,
      });
      const { service } = await buildHarness(repository);

      await expect(
        service.moveFile(OWNER, FILE_ID, { parentId: OTHER_FOLDER_ID }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

      expect(repository.moveFile).not.toHaveBeenCalled();
    });

    it("refuses a destination that is a file", async () => {
      const repository = buildRepository();
      repository.findNodeForOwner.mockResolvedValue(committedFile);
      const { service } = await buildHarness(repository);

      await expect(service.moveFile(OWNER, FILE_ID, { parentId: FILE_ID })).rejects.toMatchObject({
        code: "INVALID_MOVE_TARGET",
        status: 400,
      });

      expect(repository.moveFile).not.toHaveBeenCalled();
    });
  });

  describe("Requirement: The upload URL is signed for a key built from ids", () => {
    it("signs the reserved key and never the submitted name", async () => {
      const { service, storage } = await buildHarness();
      const signing = jest.spyOn(storage, "createUploadUrl");

      const intent = await service.createUploadIntent(OWNER, {
        parentId: FOLDER_ID,
        name: "../../../other-room/statement.pdf",
        contentType: "application/pdf",
        sizeBytes: 1024,
      });

      // The name reaches the database column that holds it and nowhere else: the object lands
      // under this room's prefix whatever the client called the file.
      expect(signing).toHaveBeenCalledWith(RESERVED_KEY, "application/pdf", 300);
      expect(intent.uploadUrl).not.toContain("statement.pdf");
      expect(intent.uploadUrl).not.toContain("..");
    });
  });
});

import { Test } from "@nestjs/testing";
import type { NodeSummary, Page } from "@data-room/shared";
import { UnauthenticatedError } from "../auth/auth.errors";
import { AccessTokenVerifier, type VerifiedAccessClaims } from "../auth/jwt-auth.guard";
import { NotFoundError } from "../common/errors/domain-error";
import { ConfigService } from "../config/config.service";
import { ROOT_DEPTH, ROOT_PATH } from "../folders/folders.repository";
import { StorageService, type ObjectStat, type SignedUrl } from "../storage/storage.service";
import {
  PublicShareStore,
  PublicSharesService,
  scopedAncestorIds,
  type SharedNodeRecord,
  type SharedRoot,
} from "./public-shares.service";
import { generateShareToken, hashShareToken } from "./share-token";

/**
 * Covers, from openspec/changes/add-sharing/specs/sharing/spec.md: the public surface's
 * uniform 404, the sign-in prompt for a restricted link, subtree scoping, and breadcrumbs
 * re-rooted at the share target.
 *
 * The store is substituted because what is under test is the order of the decisions and which
 * failure each one raises — not the SQL, which is scoped in the store itself and exercised
 * against a real database by the Cypress API suite. Storage is substituted too, which it is
 * not in `files.service.spec.ts`: the cases that matter here are an object that vanished and
 * an object that stopped being a PDF, and neither is reachable through a working storage.
 */
const ROOM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROOT_ID = "11111111-1111-4111-8111-111111111111";
const SHARED_FOLDER_ID = "22222222-2222-4222-8222-222222222222";
const NESTED_FOLDER_ID = "33333333-3333-4333-8333-333333333333";
const FILE_ID = "44444444-4444-4444-8444-444444444444";
const SIBLING_ID = "55555555-5555-4555-8555-555555555555";
const SHARE_ID = "66666666-6666-4666-8666-666666666666";
const VIEWER_ID = "77777777-7777-4777-8777-777777777777";

const UPDATED_AT = new Date("2026-03-01T12:00:00.000Z");
const DOWNLOAD_TTL_SECONDS = 300;

/** A real token, so the shape check under test is the one production uses. */
const TOKEN = generateShareToken();
const SESSION_COOKIE = "a.valid.access.token";

const room: SharedNodeRecord = {
  id: ROOT_ID,
  dataRoomId: ROOM_ID,
  parentId: null,
  type: "FOLDER",
  name: "Project Neptune",
  path: ROOT_PATH,
  depth: ROOT_DEPTH,
  sizeBytes: 0n,
  updatedAt: UPDATED_AT,
  storageKey: null,
};

const sharedFolder: SharedNodeRecord = {
  ...room,
  id: SHARED_FOLDER_ID,
  parentId: ROOT_ID,
  name: "Financials",
  path: `/${ROOT_ID}/`,
  depth: 1,
};

const nestedFolder: SharedNodeRecord = {
  ...sharedFolder,
  id: NESTED_FOLDER_ID,
  parentId: SHARED_FOLDER_ID,
  name: "2025",
  path: `/${ROOT_ID}/${SHARED_FOLDER_ID}/`,
  depth: 2,
};

const nestedFile: SharedNodeRecord = {
  ...nestedFolder,
  id: FILE_ID,
  parentId: NESTED_FOLDER_ID,
  type: "FILE",
  name: "audit.pdf",
  path: `/${ROOT_ID}/${SHARED_FOLDER_ID}/${NESTED_FOLDER_ID}/`,
  depth: 3,
  sizeBytes: 2048n,
  storageKey: `${ROOM_ID}/${FILE_ID}`,
};

/** Beside the shared folder, not under it. The one thing a link must never reach sideways. */
const sibling: SharedNodeRecord = {
  ...sharedFolder,
  id: SIBLING_ID,
  name: "Board minutes",
};

const publicShare: SharedRoot = { shareId: SHARE_ID, mode: "PUBLIC_LINK", root: sharedFolder };
const restrictedShare: SharedRoot = { shareId: SHARE_ID, mode: "RESTRICTED", root: sharedFolder };

const EMPTY_PAGE: Page<NodeSummary> = { items: [], nextCursor: null };
const PAGE_LIMIT = 50;

const PDF_STAT: ObjectStat = { sizeBytes: 2048, contentType: "application/pdf" };
const SIGNED: SignedUrl = {
  url: "https://storage.example.test/audit.pdf?token=abc",
  expiresAt: new Date("2026-03-01T12:05:00.000Z"),
};

type StoreStub = {
  findActiveShareByTokenHash: jest.Mock<Promise<SharedRoot | null>, [string, Date]>;
  findNodeInSubtree: jest.Mock<Promise<SharedNodeRecord | null>, [SharedNodeRecord, string]>;
  listChildren: jest.Mock<
    Promise<Page<NodeSummary>>,
    [SharedNodeRecord, number, string | undefined]
  >;
  namesFor: jest.Mock<Promise<Map<string, string>>, [string, string[]]>;
  holdsGrant: jest.Mock<Promise<boolean>, [string, string]>;
};

type StorageStub = {
  statObject: jest.Mock<Promise<ObjectStat | null>, [string]>;
  createDownloadUrl: jest.Mock<Promise<SignedUrl>, [string, number]>;
};

type VerifierStub = {
  verifyAccessToken: jest.Mock<VerifiedAccessClaims, [string]>;
};

async function buildService(): Promise<{
  service: PublicSharesService;
  store: StoreStub;
  storage: StorageStub;
  verifier: VerifierStub;
}> {
  const store: StoreStub = {
    findActiveShareByTokenHash: jest.fn().mockResolvedValue(publicShare),
    findNodeInSubtree: jest.fn().mockResolvedValue(null),
    listChildren: jest.fn().mockResolvedValue(EMPTY_PAGE),
    namesFor: jest.fn().mockResolvedValue(new Map()),
    holdsGrant: jest.fn().mockResolvedValue(false),
  };

  const storage: StorageStub = {
    statObject: jest.fn().mockResolvedValue(PDF_STAT),
    createDownloadUrl: jest.fn().mockResolvedValue(SIGNED),
  };

  const verifier: VerifierStub = {
    verifyAccessToken: jest.fn((token: string) => {
      if (token !== SESSION_COOKIE) throw new Error("bad token");

      return { sub: VIEWER_ID };
    }),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      PublicSharesService,
      { provide: PublicShareStore, useValue: store },
      { provide: StorageService, useValue: storage },
      { provide: ConfigService, useValue: { get: () => DOWNLOAD_TTL_SECONDS } },
      { provide: AccessTokenVerifier, useValue: verifier },
    ],
  }).compile();

  return { service: moduleRef.get(PublicSharesService), store, storage, verifier };
}

describe("scopedAncestorIds", () => {
  it("has no ancestors to name when the node is the share target itself", () => {
    expect(scopedAncestorIds(SHARED_FOLDER_ID, sharedFolder)).toEqual([]);
  });

  /**
   * The disclosure assertion: the Data Room's own id is above the share, so it is absent. A
   * recipient must not learn that "Financials" sits inside "Project Neptune".
   */
  it("starts at the share target and omits everything above it", () => {
    expect(scopedAncestorIds(SHARED_FOLDER_ID, nestedFile)).toEqual([
      SHARED_FOLDER_ID,
      NESTED_FOLDER_ID,
    ]);
    expect(scopedAncestorIds(SHARED_FOLDER_ID, nestedFile)).not.toContain(ROOT_ID);
  });

  it("refuses a sibling, an ancestor and a node from another room", () => {
    expect(scopedAncestorIds(SHARED_FOLDER_ID, sibling)).toBeNull();
    expect(scopedAncestorIds(SHARED_FOLDER_ID, room)).toBeNull();
    expect(scopedAncestorIds(SHARED_FOLDER_ID, { id: "x", path: "/other/" })).toBeNull();
  });
});

describe("PublicSharesService", () => {
  describe("resolving a token", () => {
    it("answers a token that could never have been minted without touching the database", async () => {
      const { service, store } = await buildService();

      await expect(
        service.viewRoot("not-a-token", undefined, PAGE_LIMIT, undefined),
      ).rejects.toThrow(NotFoundError);
      expect(store.findActiveShareByTokenHash).not.toHaveBeenCalled();
    });

    /**
     * Unknown, revoked and expired all reach the service as the same `null`, which is the
     * point: the store's predicate is what makes them indistinguishable, and nothing above it
     * can tell them apart even if it wanted to.
     */
    it("answers 404 for a token the store does not resolve", async () => {
      const { service, store } = await buildService();
      store.findActiveShareByTokenHash.mockResolvedValue(null);

      await expect(service.viewRoot(TOKEN, undefined, PAGE_LIMIT, undefined)).rejects.toThrow(
        NotFoundError,
      );
    });

    it("looks the token up by its hash and never by the token itself", async () => {
      const { service, store } = await buildService();

      await service.viewRoot(TOKEN, undefined, PAGE_LIMIT, undefined);

      const [presented] = store.findActiveShareByTokenHash.mock.calls[0] ?? [];
      expect(presented).toBe(hashShareToken(TOKEN));
      expect(presented).not.toBe(TOKEN);
    });
  });

  describe("a restricted share", () => {
    it("asks an anonymous caller to sign in rather than pretending the link is broken", async () => {
      const { service, store } = await buildService();
      store.findActiveShareByTokenHash.mockResolvedValue(restrictedShare);

      await expect(service.viewRoot(TOKEN, undefined, PAGE_LIMIT, undefined)).rejects.toThrow(
        UnauthenticatedError,
      );
    });

    it("treats an unusable session cookie as anonymous rather than failing", async () => {
      const { service, store } = await buildService();
      store.findActiveShareByTokenHash.mockResolvedValue(restrictedShare);

      await expect(service.viewRoot(TOKEN, "expired", PAGE_LIMIT, undefined)).rejects.toThrow(
        UnauthenticatedError,
      );
    });

    it("answers 404 — not 403 — for a signed-in caller who holds no grant", async () => {
      const { service, store } = await buildService();
      store.findActiveShareByTokenHash.mockResolvedValue(restrictedShare);

      await expect(service.viewRoot(TOKEN, SESSION_COOKIE, PAGE_LIMIT, undefined)).rejects.toThrow(
        NotFoundError,
      );
      expect(store.holdsGrant).toHaveBeenCalledWith(SHARE_ID, VIEWER_ID);
    });

    it("serves the recipient named on it", async () => {
      const { service, store } = await buildService();
      store.findActiveShareByTokenHash.mockResolvedValue(restrictedShare);
      store.holdsGrant.mockResolvedValue(true);

      const view = await service.viewRoot(TOKEN, SESSION_COOKIE, PAGE_LIMIT, undefined);

      expect(view.node.id).toBe(SHARED_FOLDER_ID);
    });

    /** A public link is a bearer credential: whoever holds it reads, session or not. */
    it("never asks a public link who is holding it", async () => {
      const { service, store } = await buildService();

      await service.viewRoot(TOKEN, undefined, PAGE_LIMIT, undefined);

      expect(store.holdsGrant).not.toHaveBeenCalled();
    });
  });

  describe("what a recipient sees", () => {
    it("roots the breadcrumb at the shared folder and lists its children", async () => {
      const { service, store } = await buildService();
      const child: NodeSummary = {
        id: NESTED_FOLDER_ID,
        type: "FOLDER",
        name: "2025",
        updatedAt: UPDATED_AT.toISOString(),
        sizeBytes: 0,
      };
      store.listChildren.mockResolvedValue({ items: [child], nextCursor: null });

      const view = await service.viewRoot(TOKEN, undefined, PAGE_LIMIT, undefined);

      expect(view.breadcrumbs).toEqual([{ id: SHARED_FOLDER_ID, name: "Financials" }]);
      expect(view.children?.items).toEqual([child]);
      expect(view.canDownload).toBe(true);
    });

    it("re-roots a nested breadcrumb, naming nothing above the share", async () => {
      const { service, store } = await buildService();
      store.findNodeInSubtree.mockResolvedValue(nestedFile);
      store.namesFor.mockResolvedValue(
        new Map([
          [SHARED_FOLDER_ID, "Financials"],
          [NESTED_FOLDER_ID, "2025"],
        ]),
      );

      const view = await service.viewNode(TOKEN, FILE_ID, undefined, PAGE_LIMIT, undefined);

      expect(view.breadcrumbs).toEqual([
        { id: SHARED_FOLDER_ID, name: "Financials" },
        { id: NESTED_FOLDER_ID, name: "2025" },
        { id: FILE_ID, name: "audit.pdf" },
      ]);
      expect(store.namesFor).toHaveBeenCalledWith(ROOM_ID, [SHARED_FOLDER_ID, NESTED_FOLDER_ID]);
    });

    /** A shared file says nothing about the folder it sits in — not even that it is empty. */
    it("returns no children for a file", async () => {
      const { service, store } = await buildService();
      store.findActiveShareByTokenHash.mockResolvedValue({
        ...publicShare,
        root: nestedFile,
      });

      const view = await service.viewRoot(TOKEN, undefined, PAGE_LIMIT, undefined);

      expect(view.children).toBeNull();
      expect(store.listChildren).not.toHaveBeenCalled();
    });

    it("answers 404 for a node the store did not find inside the subtree", async () => {
      const { service, store } = await buildService();
      store.findNodeInSubtree.mockResolvedValue(null);

      await expect(
        service.viewNode(TOKEN, SIBLING_ID, undefined, PAGE_LIMIT, undefined),
      ).rejects.toThrow(NotFoundError);
    });

    /**
     * The store and the re-rooting are independent checks on the same rule. If a change to the
     * query ever let a node through that the path says is outside, this is what catches it.
     */
    it("answers 404 when the store and the path disagree about containment", async () => {
      const { service, store } = await buildService();
      store.findNodeInSubtree.mockResolvedValue(sibling);

      await expect(
        service.viewNode(TOKEN, SIBLING_ID, undefined, PAGE_LIMIT, undefined),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("downloading a shared file", () => {
    it("signs only after the share and the subtree have both resolved", async () => {
      const { service, store, storage } = await buildService();
      store.findNodeInSubtree.mockResolvedValue(nestedFile);

      const content = await service.contentUrl(TOKEN, FILE_ID, undefined);

      expect(content).toEqual({ url: SIGNED.url, expiresAt: SIGNED.expiresAt.toISOString() });
      expect(storage.createDownloadUrl).toHaveBeenCalledWith(
        nestedFile.storageKey,
        DOWNLOAD_TTL_SECONDS,
      );
    });

    it("refuses to sign a folder", async () => {
      const { service, store, storage } = await buildService();
      store.findNodeInSubtree.mockResolvedValue(nestedFolder);

      await expect(service.contentUrl(TOKEN, NESTED_FOLDER_ID, undefined)).rejects.toThrow(
        NotFoundError,
      );
      expect(storage.createDownloadUrl).not.toHaveBeenCalled();
    });

    it("refuses to sign an object that is no longer there", async () => {
      const { service, store, storage } = await buildService();
      store.findNodeInSubtree.mockResolvedValue(nestedFile);
      storage.statObject.mockResolvedValue(null);

      await expect(service.contentUrl(TOKEN, FILE_ID, undefined)).rejects.toThrow(NotFoundError);
      expect(storage.createDownloadUrl).not.toHaveBeenCalled();
    });

    /**
     * The upload URL outlives the commit, so a committed row can end up pointing at HTML. On
     * this route the browser that would render it belongs to somebody outside the company.
     */
    it("refuses to sign an object that has stopped being a PDF", async () => {
      const { service, store, storage } = await buildService();
      store.findNodeInSubtree.mockResolvedValue(nestedFile);
      storage.statObject.mockResolvedValue({ sizeBytes: 12, contentType: "text/html" });

      await expect(service.contentUrl(TOKEN, FILE_ID, undefined)).rejects.toThrow(NotFoundError);
      expect(storage.createDownloadUrl).not.toHaveBeenCalled();
    });

    it("refuses a revoked share before it looks at the file at all", async () => {
      const { service, store, storage } = await buildService();
      store.findActiveShareByTokenHash.mockResolvedValue(null);

      await expect(service.contentUrl(TOKEN, FILE_ID, undefined)).rejects.toThrow(NotFoundError);
      expect(store.findNodeInSubtree).not.toHaveBeenCalled();
      expect(storage.statObject).not.toHaveBeenCalled();
    });
  });
});

import { Test } from "@nestjs/testing";
import { shareSchema, type Page } from "@data-room/shared";
import type { AuthUser } from "../auth/jwt-auth.guard";
import { NotFoundError, ValidationFailedError } from "../common/errors/domain-error";
import { ConfigService, ENV_SOURCE } from "../config/config.service";
import { hashShareToken } from "./share-token";
import {
  ShareStore,
  SharesService,
  normalizeGrantEmails,
  type NewShare,
  type ShareGrantRecord,
  type ShareRecord,
} from "./shares.service";

const WEB_APP_URL = "https://app.test";
const LINK_PREFIX = `${WEB_APP_URL}/shared/`;

const OWNER: AuthUser = { id: "11111111-1111-4111-8111-111111111111" };
const STRANGER: AuthUser = { id: "22222222-2222-4222-8222-222222222222" };

const FOLDER = "33333333-3333-4333-8333-333333333333";
const FOREIGN_FOLDER = "44444444-4444-4444-8444-444444444444";

const TOMORROW = new Date(Date.now() + 86_400_000).toISOString();
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString();

/** Ids the contract's `uuid()` accepts, so a response can be parsed rather than eyeballed. */
function fakeUuid(prefix: string, sequence: number): string {
  return `${prefix.padStart(8, "0")}-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

/**
 * The store, in memory.
 *
 * A double rather than Prisma because what is under test is the service's decisions — who is
 * refused, what is normalised, when a link is produced. The queries themselves are the
 * repository's business and are covered against a real database.
 *
 * It keeps `tokenHashes` deliberately: proving that what was written is a hash and not the
 * token is impossible against a store that discards it.
 */
class InMemoryShareStore extends ShareStore {
  readonly nodes = new Map<string, { ownerId: string; name: string }>();
  readonly shares: ShareRecord[] = [];
  readonly tokenHashes = new Map<string, string>();
  private sequence = 0;

  override async findOwnedNode(nodeId: string, ownerId: string): Promise<{ id: string } | null> {
    const node = this.nodes.get(nodeId);

    return node !== undefined && node.ownerId === ownerId ? { id: nodeId } : null;
  }

  override async createShare(share: NewShare): Promise<ShareRecord> {
    this.sequence += 1;
    const id = fakeUuid("5", this.sequence);

    const record: ShareRecord = {
      id,
      nodeId: share.nodeId,
      nodeName: this.nodes.get(share.nodeId)?.name ?? "Unnamed",
      createdBy: share.createdBy,
      mode: share.mode,
      role: "VIEWER",
      expiresAt: share.expiresAt,
      revokedAt: null,
      // Spaced a millisecond apart, so "newest first" is a stable assertion rather than a
      // race between two rows written in the same tick.
      createdAt: new Date(Date.UTC(2026, 0, 1) + this.sequence),
      grants: share.emails.map((email) => this.newGrant(id, email)),
    };

    this.tokenHashes.set(id, share.tokenHash);
    this.shares.push(record);

    return record;
  }

  override async findOwnedShare(shareId: string, ownerId: string): Promise<ShareRecord | null> {
    const share = this.shares.find((candidate) => candidate.id === shareId);
    if (share === undefined) return null;

    return this.nodes.get(share.nodeId)?.ownerId === ownerId ? share : null;
  }

  override async listSharesForNode(
    nodeId: string,
    ownerId: string,
    limit: number,
    cursor: string | undefined,
  ): Promise<Page<ShareRecord>> {
    const matching = this.shares
      .filter(
        (share) => share.nodeId === nodeId && this.nodes.get(share.nodeId)?.ownerId === ownerId,
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

    const start = cursor === undefined ? 0 : Number(cursor);
    const items = matching.slice(start, start + limit);

    return { items, nextCursor: start + limit < matching.length ? String(start + limit) : null };
  }

  override async revoke(shareId: string, revokedAt: Date): Promise<ShareRecord> {
    const share = this.require(shareId);
    if (share.revokedAt === null) share.revokedAt = revokedAt;

    return share;
  }

  override async setExpiry(shareId: string, expiresAt: Date | null): Promise<ShareRecord> {
    const share = this.require(shareId);
    share.expiresAt = expiresAt;

    return share;
  }

  override async addGrants(shareId: string, emails: string[]): Promise<ShareRecord> {
    const share = this.require(shareId);

    for (const email of emails) {
      // The unique `(share_id, email)` index, stated in the terms this double can express.
      if (!share.grants.some((grant) => grant.email === email)) {
        share.grants.push(this.newGrant(shareId, email));
      }
    }

    return share;
  }

  override async removeGrant(shareId: string, grantId: string): Promise<boolean> {
    const share = this.shares.find((candidate) => candidate.id === shareId);
    if (share === undefined) return false;

    const index = share.grants.findIndex((grant) => grant.id === grantId);
    if (index === -1) return false;

    share.grants.splice(index, 1);

    return true;
  }

  private newGrant(shareId: string, email: string): ShareGrantRecord {
    this.sequence += 1;

    return { id: fakeUuid("6", this.sequence), shareId, email, userId: null, acceptedAt: null };
  }

  private require(shareId: string): ShareRecord {
    const share = this.shares.find((candidate) => candidate.id === shareId);
    if (share === undefined) throw new Error(`no share ${shareId}`);

    return share;
  }
}

type Harness = {
  service: SharesService;
  store: InMemoryShareStore;
};

async function buildHarness(): Promise<Harness> {
  const store = new InMemoryShareStore();
  store.nodes.set(FOLDER, { ownerId: OWNER.id, name: "Financials" });
  store.nodes.set(FOREIGN_FOLDER, { ownerId: STRANGER.id, name: "Not yours" });

  const moduleRef = await Test.createTestingModule({
    providers: [
      SharesService,
      ConfigService,
      { provide: ShareStore, useValue: store },
      {
        provide: ENV_SOURCE,
        useValue: {
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://user:pass@localhost:6543/db",
          DIRECT_URL: "postgresql://user:pass@localhost:5432/db",
          WEB_APP_URL,
          CORS_ORIGINS: WEB_APP_URL,
          JWT_ACCESS_SECRET: "a-test-secret-of-at-least-thirty-two-chars",
          SUPABASE_URL: "https://project.supabase.co",
          SUPABASE_SECRET_KEY: "a-test-service-role-key",
        },
      },
    ],
  }).compile();

  return { service: moduleRef.get(SharesService), store };
}

/** A public share of the owner's folder, with no expiry and no recipients. */
async function publicShare(service: SharesService) {
  return service.createShare(OWNER, {
    nodeId: FOLDER,
    mode: "PUBLIC_LINK",
    expiresAt: null,
    emails: [],
  });
}

/** A restricted share of the owner's folder, for the addresses given. */
async function restrictedShare(service: SharesService, emails: string[]) {
  return service.createShare(OWNER, {
    nodeId: FOLDER,
    mode: "RESTRICTED",
    expiresAt: null,
    emails,
  });
}

/** The failure, described the way a client would observe it. */
function describeFailure(error: unknown): { name: string; code: string; status: number } {
  if (!(error instanceof NotFoundError) && !(error instanceof ValidationFailedError)) {
    throw new Error(`Expected a domain error, received ${String(error)}`);
  }

  return { name: error.name, code: error.code, status: error.status };
}

async function capture(action: Promise<unknown>): Promise<unknown> {
  try {
    await action;
  } catch (error) {
    return error;
  }

  throw new Error("the call was expected to fail and did not");
}

const NOT_FOUND = { name: "NotFoundError", code: "NOT_FOUND", status: 404 };
const VALIDATION_FAILED = { name: "ValidationFailedError", code: "VALIDATION_FAILED", status: 400 };

describe("SharesService", () => {
  describe("Requirement: A share link is shown once and never again", () => {
    it("returns a link carrying 256 bits of token at creation", async () => {
      const { service } = await buildHarness();

      const share = await publicShare(service);
      const token = share.url?.slice(LINK_PREFIX.length) ?? "";

      expect(share.url).toBe(`${LINK_PREFIX}${token}`);
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
    });

    it("stores the hash and not the token", async () => {
      const { service, store } = await buildHarness();

      const share = await publicShare(service);
      const token = share.url?.slice(LINK_PREFIX.length) ?? "";

      expect(store.tokenHashes.get(share.id)).toBe(hashShareToken(token));
      expect(store.tokenHashes.get(share.id)).not.toBe(token);
    });

    it("gives every later reading of the same share a null url", async () => {
      const { service } = await buildHarness();

      const created = await publicShare(service);
      const listed = await service.listShares(OWNER, FOLDER, 20, undefined);
      const revoked = await service.revokeShare(OWNER, created.id);

      // The plaintext no longer exists anywhere, so no later response can rebuild the link.
      expect(listed.items[0]?.url).toBeNull();
      expect(revoked.url).toBeNull();
    });

    it("mints a different token for every share", async () => {
      const { service } = await buildHarness();

      const [first, second] = [await publicShare(service), await publicShare(service)];

      expect(first.url).not.toBe(second.url);
    });
  });

  describe("Requirement: A restricted share is opened by a link too", () => {
    it("returns the link once, so the owner can send the invitation somewhere", async () => {
      const { service, store } = await buildHarness();

      const share = await restrictedShare(service, ["buyer@acme.com"]);

      // The owner has to be able to send this. Holding it is not access: opening a restricted
      // share still requires signing in as an address the owner named, which is the whole
      // difference between the two modes.
      expect(share.url).toBe(`${LINK_PREFIX}${share.url?.slice(LINK_PREFIX.length) ?? ""}`);
      expect(share.url).not.toBeNull();
      expect(store.tokenHashes.get(share.id)).toEqual(expect.any(String));
    });

    it("gives every later reading of a restricted share a null url, as for a public one", async () => {
      const { service } = await buildHarness();

      await restrictedShare(service, ["buyer@acme.com"]);
      const listed = await service.listShares(OWNER, FOLDER, 20, undefined);

      // The store keeps a hash and cannot produce the original, so a link cannot reach a log,
      // a list response or a support query after the moment it was created.
      expect(listed.items[0]?.url).toBeNull();
    });

    it("refuses recipients on a public link rather than dropping them", async () => {
      const { service } = await buildHarness();

      const failure = await capture(
        service.createShare(OWNER, {
          nodeId: FOLDER,
          mode: "PUBLIC_LINK",
          expiresAt: null,
          emails: ["buyer@acme.com"],
        }),
      );

      // Quietly ignoring the list would leave the owner believing only that person can see it.
      expect(describeFailure(failure)).toEqual(VALIDATION_FAILED);
    });
  });

  describe("Requirement: Grant emails use the identity rule authentication uses", () => {
    it("treats Buyer@Acme.com and buyer@acme.com as one person", async () => {
      const { service } = await buildHarness();

      const share = await restrictedShare(service, [
        "Buyer@Acme.com",
        "buyer@acme.com",
        "  BUYER@acme.com  ",
      ]);

      expect(share.grants.map((grant) => grant.email)).toEqual(["buyer@acme.com"]);
    });

    it("normalises and de-duplicates while preserving the order the owner typed", () => {
      expect(normalizeGrantEmails(["B@x.com", "a@x.com", "b@X.com"])).toEqual([
        "b@x.com",
        "a@x.com",
      ]);
    });

    it("adds a recipient idempotently, whatever case the owner typed", async () => {
      const { service } = await buildHarness();

      const share = await restrictedShare(service, ["buyer@acme.com"]);
      const after = await service.addGrants(OWNER, share.id, ["BUYER@ACME.COM", "legal@acme.com"]);

      expect(after.grants.map((grant) => grant.email)).toEqual([
        "buyer@acme.com",
        "legal@acme.com",
      ]);
    });

    it("reports a recipient as unaccepted until they sign in", async () => {
      const { service } = await buildHarness();

      const share = await restrictedShare(service, ["buyer@acme.com"]);

      expect(share.grants[0]?.acceptedAt).toBeNull();
      expect(share.grants[0]?.role).toBe("VIEWER");
    });
  });

  describe("Requirement: Only the node's owner may manage a share", () => {
    it("answers 404, not 403, when the node belongs to somebody else", async () => {
      const { service } = await buildHarness();

      const failure = await capture(
        service.createShare(OWNER, {
          nodeId: FOREIGN_FOLDER,
          mode: "PUBLIC_LINK",
          expiresAt: null,
          emails: [],
        }),
      );

      // 403 would confirm the folder exists, which is itself a disclosure during diligence.
      expect(describeFailure(failure)).toEqual(NOT_FOUND);
    });

    it("answers a node that never existed exactly as it answers a foreign one", async () => {
      const { service } = await buildHarness();

      const missing = await capture(
        service.createShare(OWNER, {
          nodeId: fakeUuid("9", 1),
          mode: "PUBLIC_LINK",
          expiresAt: null,
          emails: [],
        }),
      );
      const foreign = await capture(
        service.createShare(OWNER, {
          nodeId: FOREIGN_FOLDER,
          mode: "PUBLIC_LINK",
          expiresAt: null,
          emails: [],
        }),
      );

      expect(describeFailure(missing)).toEqual(describeFailure(foreign));
    });

    it("refuses to list, revoke or amend a share the caller does not own", async () => {
      const { service } = await buildHarness();

      const share = await restrictedShare(service, ["buyer@acme.com"]);
      const grantId = share.grants[0]?.id ?? "";

      const failures = await Promise.all([
        capture(service.listShares(STRANGER, FOLDER, 20, undefined)),
        capture(service.revokeShare(STRANGER, share.id)),
        capture(service.addGrants(STRANGER, share.id, ["mole@acme.com"])),
        capture(service.setExpiry(STRANGER, share.id, TOMORROW)),
        capture(service.removeGrant(STRANGER, share.id, grantId)),
      ]);
      const after = await service.listShares(OWNER, FOLDER, 20, undefined);

      expect(failures.map(describeFailure)).toEqual(failures.map(() => NOT_FOUND));
      // Asserting on what is absent as well: nothing the stranger asked for took effect.
      expect(after.items[0]?.grants.map((grant) => grant.email)).toEqual(["buyer@acme.com"]);
      expect(after.items[0]?.revokedAt).toBeNull();
      expect(after.items[0]?.expiresAt).toBeNull();
    });

    it("does not let a grant id from one share strip a recipient from another", async () => {
      const { service } = await buildHarness();

      const target = await restrictedShare(service, ["buyer@acme.com"]);
      const other = await restrictedShare(service, ["legal@acme.com"]);

      const failure = await capture(
        service.removeGrant(OWNER, target.id, other.grants[0]?.id ?? ""),
      );

      expect(describeFailure(failure)).toEqual(NOT_FOUND);
    });

    it("removes a recipient the owner names on their own share", async () => {
      const { service } = await buildHarness();

      const share = await restrictedShare(service, ["buyer@acme.com", "legal@acme.com"]);
      await service.removeGrant(OWNER, share.id, share.grants[0]?.id ?? "");

      const after = await service.listShares(OWNER, FOLDER, 20, undefined);

      expect(after.items[0]?.grants.map((grant) => grant.email)).toEqual(["legal@acme.com"]);
    });
  });

  describe("Requirement: Revocation ends access immediately and keeps the content", () => {
    it("stamps revokedAt and leaves both the share and its node in place", async () => {
      const { service, store } = await buildHarness();

      const created = await publicShare(service);
      const revoked = await service.revokeShare(OWNER, created.id);
      const listed = await service.listShares(OWNER, FOLDER, 20, undefined);

      expect(revoked.revokedAt).not.toBeNull();
      // "This link was turned off on the 4th" is the answer an owner needs during diligence,
      // so a revoked row stays in the listing rather than vanishing from it.
      expect(listed.items.map((share) => share.id)).toEqual([created.id]);
      expect(store.nodes.has(FOLDER)).toBe(true);
    });

    it("is idempotent, keeping the instant access actually ended", async () => {
      const { service } = await buildHarness();

      const created = await publicShare(service);
      const first = await service.revokeShare(OWNER, created.id);
      const second = await service.revokeShare(OWNER, created.id);

      expect(second.revokedAt).toBe(first.revokedAt);
    });
  });

  describe("Requirement: An expiry is a future instant, or none at all", () => {
    it("refuses an expiry that has already passed", async () => {
      const { service } = await buildHarness();

      const failure = await capture(
        service.createShare(OWNER, {
          nodeId: FOLDER,
          mode: "PUBLIC_LINK",
          expiresAt: YESTERDAY,
          emails: [],
        }),
      );

      // Almost always a timezone mistake in a client, and one that looks from the owner's
      // side exactly like sharing succeeded.
      expect(describeFailure(failure)).toEqual(VALIDATION_FAILED);
    });

    it("sets and then clears an expiry on an existing share", async () => {
      const { service } = await buildHarness();

      const created = await publicShare(service);
      const dated = await service.setExpiry(OWNER, created.id, TOMORROW);
      const cleared = await service.setExpiry(OWNER, created.id, null);

      expect(dated.expiresAt).toBe(new Date(TOMORROW).toISOString());
      expect(cleared.expiresAt).toBeNull();
    });

    it("refuses to move an expiry into the past on an existing share", async () => {
      const { service } = await buildHarness();

      const created = await publicShare(service);
      const failure = await capture(service.setExpiry(OWNER, created.id, YESTERDAY));

      expect(describeFailure(failure)).toEqual(VALIDATION_FAILED);
    });
  });

  describe("Requirement: Shares of one node are listed newest first, one page at a time", () => {
    it("pages without repeating or losing a share", async () => {
      const { service } = await buildHarness();

      await publicShare(service);
      await publicShare(service);
      await publicShare(service);

      const first = await service.listShares(OWNER, FOLDER, 2, undefined);
      const second = await service.listShares(OWNER, FOLDER, 2, first.nextCursor ?? undefined);

      expect(first.items).toHaveLength(2);
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
      expect(new Set([...first.items, ...second.items].map((share) => share.id)).size).toBe(3);
    });

    it("emits the shape the contract describes", async () => {
      const { service } = await buildHarness();

      await service.createShare(OWNER, {
        nodeId: FOLDER,
        mode: "RESTRICTED",
        expiresAt: TOMORROW,
        emails: ["buyer@acme.com"],
      });

      const listed = await service.listShares(OWNER, FOLDER, 20, undefined);

      // Parsed rather than eyeballed: the share dialog and the public surface both build on
      // this schema, and a field renamed here would otherwise surface as a runtime undefined.
      expect(() => shareSchema.parse(listed.items[0])).not.toThrow();
      expect(listed.items[0]?.nodeName).toBe("Financials");
    });
  });
});

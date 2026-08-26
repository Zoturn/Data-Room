import { Test } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { RefreshTokenAlreadyRotatedError } from "./auth.errors";
import { PrismaRefreshTokenStore } from "./refresh-token.store";
import { RefreshTokenStore, hashRefreshToken, type NewRefreshToken } from "./token.service";

/**
 * No database: Prisma is replaced by the fake table below, which models only the three
 * behaviours this store leans on — `null` in a WHERE clause meaning IS NULL, `updateMany`
 * reporting how many rows it matched, and a failed transaction rolling its writes back.
 * Those are the mechanisms the rotation race and the family revocation are built out of, so
 * a fake that got them wrong would prove nothing.
 *
 * The queries themselves — that the guard really serialises two concurrent rotations under
 * Postgres — are exercised against a real server in the Cypress API specs. See
 * apps/api/.claude/rules/testing.md: a repository's SQL is not something a mock can vouch for.
 */

type RefreshTokenRow = {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
  createdAt: Date;
};

type FindUniqueArgs = { where: { id?: string; tokenHash?: string } };
type CreateArgs = {
  data: { userId: string; familyId: string; tokenHash: string; expiresAt: Date };
};
type UpdateManyArgs = {
  where: { id?: string; familyId?: string; replacedById?: null; revokedAt?: null };
  data: { revokedAt?: Date; replacedById?: string };
};
type DeleteManyArgs = { where: { expiresAt: { lte: Date } } };

const USER_ID = "11111111-1111-4111-8111-111111111111";
const FAMILY_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_FAMILY_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-08-26T12:00:00.000Z");
const LATER = new Date("2026-08-26T12:00:05.000Z");
const EXPIRY = new Date("2026-09-26T12:00:00.000Z");

/** Only the columns the store may filter on are honoured — `null` means IS NULL. */
function matchesWhere(row: RefreshTokenRow, where: UpdateManyArgs["where"]): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.familyId !== undefined && row.familyId !== where.familyId) return false;
  if (where.replacedById === null && row.replacedById !== null) return false;
  if (where.revokedAt === null && row.revokedAt !== null) return false;
  return true;
}

function createPrismaFake() {
  const rows: RefreshTokenRow[] = [];
  let issued = 0;

  const findUnique = jest.fn(async (args: FindUniqueArgs): Promise<RefreshTokenRow | null> => {
    const found = rows.find(
      (row) =>
        (args.where.id !== undefined && row.id === args.where.id) ||
        (args.where.tokenHash !== undefined && row.tokenHash === args.where.tokenHash),
    );
    return found ?? null;
  });

  const create = jest.fn(async (args: CreateArgs): Promise<RefreshTokenRow> => {
    issued += 1;
    const row: RefreshTokenRow = {
      id: `minted-${issued}`,
      userId: args.data.userId,
      familyId: args.data.familyId,
      tokenHash: args.data.tokenHash,
      expiresAt: args.data.expiresAt,
      // Column defaults: a new row is live and unspent.
      revokedAt: null,
      replacedById: null,
      createdAt: NOW,
    };
    rows.push(row);
    return row;
  });

  const updateMany = jest.fn(async (args: UpdateManyArgs): Promise<{ count: number }> => {
    let count = 0;
    for (const row of rows) {
      if (!matchesWhere(row, args.where)) continue;
      if (args.data.revokedAt !== undefined) row.revokedAt = args.data.revokedAt;
      if (args.data.replacedById !== undefined) row.replacedById = args.data.replacedById;
      count += 1;
    }
    return { count };
  });

  const deleteMany = jest.fn(async (args: DeleteManyArgs): Promise<{ count: number }> => {
    const survivors = rows.filter(
      (row) => row.expiresAt.getTime() > args.where.expiresAt.lte.getTime(),
    );
    const count = rows.length - survivors.length;
    rows.splice(0, rows.length, ...survivors);
    return { count };
  });

  const refreshToken = { findUnique, create, updateMany, deleteMany };

  const $transaction = jest.fn(
    async (run: (tx: { refreshToken: typeof refreshToken }) => unknown) => {
      const snapshot = rows.map((row) => ({ ...row }));
      try {
        return await run({ refreshToken });
      } catch (error) {
        // Postgres would discard everything the aborted transaction wrote; restoring the
        // snapshot lets a test assert that the loser of a rotation race leaves nothing behind.
        rows.splice(0, rows.length, ...snapshot);
        throw error;
      }
    },
  );

  return { rows, refreshToken, $transaction };
}

type PrismaFake = ReturnType<typeof createPrismaFake>;

/** A plaintext token and its stored form, exactly as `TokenService` would produce them. */
const FAMILY_STARTED_AT = new Date("2026-01-01T00:00:00.000Z");

function mintToken(): { plaintext: string; input: NewRefreshToken } {
  const plaintext = randomBytes(32).toString("base64url");
  return {
    plaintext,
    input: {
      userId: USER_ID,
      familyId: FAMILY_ID,
      tokenHash: hashRefreshToken(plaintext),
      expiresAt: EXPIRY,
      familyStartedAt: FAMILY_STARTED_AT,
    },
  };
}

function seedRow(prisma: PrismaFake, row: Partial<RefreshTokenRow> & { id: string }): void {
  prisma.rows.push({
    userId: USER_ID,
    familyId: FAMILY_ID,
    tokenHash: `hash-of-${row.id}`,
    expiresAt: EXPIRY,
    revokedAt: null,
    replacedById: null,
    createdAt: NOW,
    ...row,
  });
}

/** Narrows without a non-null assertion, and fails loudly when the row is missing. */
function rowById(prisma: PrismaFake, id: string): RefreshTokenRow {
  const found = prisma.rows.find((row) => row.id === id);
  if (found === undefined) throw new Error(`No row ${id} in the fake table`);
  return found;
}

/** Everything the store has ever sent to Prisma, flattened for a substring search. */
function everyQuery(prisma: PrismaFake): string {
  return JSON.stringify([
    prisma.refreshToken.findUnique.mock.calls,
    prisma.refreshToken.create.mock.calls,
    prisma.refreshToken.updateMany.mock.calls,
    prisma.refreshToken.deleteMany.mock.calls,
  ]);
}

describe("PrismaRefreshTokenStore", () => {
  let prisma: PrismaFake;
  let store: PrismaRefreshTokenStore;

  beforeEach(async () => {
    prisma = createPrismaFake();
    const moduleRef = await Test.createTestingModule({
      providers: [PrismaRefreshTokenStore, { provide: PrismaService, useValue: prisma }],
    }).compile();
    store = moduleRef.get(PrismaRefreshTokenStore);
  });

  it("satisfies the RefreshTokenStore port, so the module can bind it in place of a fake", () => {
    expect(store).toBeInstanceOf(RefreshTokenStore);
  });

  describe("create", () => {
    it("writes the hash and never the plaintext", async () => {
      const token = mintToken();

      await store.create(token.input);

      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: {
          userId: USER_ID,
          familyId: FAMILY_ID,
          familyStartedAt: FAMILY_STARTED_AT,
          tokenHash: token.input.tokenHash,
          expiresAt: EXPIRY,
        },
      });
      expect(rowById(prisma, "minted-1").tokenHash).toBe(hashRefreshToken(token.plaintext));
      expect(everyQuery(prisma)).not.toContain(token.plaintext);
    });

    it("returns a live, unspent record in the shape the port declares", async () => {
      const record = await store.create(mintToken().input);

      expect(record).toEqual({
        id: "minted-1",
        userId: USER_ID,
        familyId: FAMILY_ID,
        tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        expiresAt: EXPIRY,
        revokedAt: null,
        replacedById: null,
        createdAt: NOW,
      });
    });

    it("drops any column the port does not declare, so a stray secret cannot ride out", async () => {
      const token = mintToken();
      const leakyRow: RefreshTokenRow & { plaintextToken: string } = {
        id: "minted-1",
        userId: USER_ID,
        familyId: FAMILY_ID,
        tokenHash: token.input.tokenHash,
        expiresAt: EXPIRY,
        revokedAt: null,
        replacedById: null,
        createdAt: NOW,
        plaintextToken: token.plaintext,
      };
      prisma.refreshToken.create.mockImplementationOnce(async () => leakyRow);

      const record = await store.create(token.input);

      expect(Object.keys(record).sort()).toEqual([
        "createdAt",
        "expiresAt",
        "familyId",
        "familyStartedAt",
        "id",
        "replacedById",
        "revokedAt",
        "tokenHash",
        "userId",
      ]);
      expect(JSON.stringify(record)).not.toContain(token.plaintext);
    });
  });

  describe("findByTokenHash", () => {
    it("looks the token up by its digest, not by anything the client sent", async () => {
      const token = mintToken();
      seedRow(prisma, { id: "row-1", tokenHash: token.input.tokenHash });

      const record = await store.findByTokenHash(token.input.tokenHash);

      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: token.input.tokenHash },
      });
      expect(record?.id).toBe("row-1");
      expect(record?.tokenHash).toBe(token.input.tokenHash);
      expect(everyQuery(prisma)).not.toContain(token.plaintext);
      expect(JSON.stringify(record)).not.toContain(token.plaintext);
    });

    it("returns null for a hash it has never stored", async () => {
      await expect(store.findByTokenHash(hashRefreshToken("never issued"))).resolves.toBeNull();
    });
  });

  describe("findById", () => {
    it("returns the record the successor pointer refers to", async () => {
      seedRow(prisma, { id: "row-7", revokedAt: NOW });

      const record = await store.findById("row-7");

      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({ where: { id: "row-7" } });
      expect(record?.revokedAt).toEqual(NOW);
    });

    it("returns null for an unknown id", async () => {
      await expect(store.findById("row-nope")).resolves.toBeNull();
    });
  });

  describe("rotate", () => {
    it("spends the predecessor and returns a live successor", async () => {
      seedRow(prisma, { id: "row-1" });
      const successor = mintToken();

      const record = await store.rotate("row-1", successor.input, NOW);

      const predecessor = rowById(prisma, "row-1");
      expect(predecessor.replacedById).toBe(record.id);
      expect(predecessor.revokedAt).toEqual(NOW);
      expect(record.revokedAt).toBeNull();
      expect(record.replacedById).toBeNull();
      expect(record.tokenHash).toBe(successor.input.tokenHash);
      expect(everyQuery(prisma)).not.toContain(successor.plaintext);
    });

    it("guards the update on the predecessor being unspent", async () => {
      seedRow(prisma, { id: "row-1" });

      await store.rotate("row-1", mintToken().input, NOW);

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: "row-1", replacedById: null },
        data: { replacedById: "minted-1", revokedAt: NOW },
      });
    });

    it("does both writes inside one transaction", async () => {
      seedRow(prisma, { id: "row-1" });

      await store.rotate("row-1", mintToken().input, NOW);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("rejects a second rotation of the same token", async () => {
      seedRow(prisma, { id: "row-1" });
      await store.rotate("row-1", mintToken().input, NOW);

      await expect(store.rotate("row-1", mintToken().input, LATER)).rejects.toBeInstanceOf(
        RefreshTokenAlreadyRotatedError,
      );
    });

    it("leaves no orphan successor when it loses the race", async () => {
      seedRow(prisma, { id: "row-1" });
      const winner = await store.rotate("row-1", mintToken().input, NOW);

      await expect(store.rotate("row-1", mintToken().input, LATER)).rejects.toThrow();

      // The loser's insert is rolled back with the rest of its transaction, and the
      // predecessor still points at the successor the winner handed to its caller.
      expect(prisma.rows.map((row) => row.id)).toEqual(["row-1", winner.id]);
      expect(rowById(prisma, "row-1").replacedById).toBe(winner.id);
      expect(rowById(prisma, "row-1").revokedAt).toEqual(NOW);
    });

    it("treats a predecessor that no longer exists the same way", async () => {
      await expect(store.rotate("row-gone", mintToken().input, NOW)).rejects.toBeInstanceOf(
        RefreshTokenAlreadyRotatedError,
      );
      expect(prisma.rows).toHaveLength(0);
    });

    it("reports a unique constraint violation as a lost race", async () => {
      seedRow(prisma, { id: "row-1" });
      prisma.refreshToken.updateMany.mockImplementationOnce(() =>
        Promise.reject(
          new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "6.19.3",
          }),
        ),
      );

      await expect(store.rotate("row-1", mintToken().input, NOW)).rejects.toBeInstanceOf(
        RefreshTokenAlreadyRotatedError,
      );
    });

    it("lets an unrelated database failure surface instead of masking it as a race", async () => {
      seedRow(prisma, { id: "row-1" });
      const outage = new Error("connection terminated");
      prisma.refreshToken.updateMany.mockImplementationOnce(() => Promise.reject(outage));

      await expect(store.rotate("row-1", mintToken().input, NOW)).rejects.toBe(outage);
    });
  });

  describe("revokeFamily", () => {
    it("revokes every live token in the family", async () => {
      seedRow(prisma, { id: "row-1" });
      seedRow(prisma, { id: "row-2" });

      await store.revokeFamily(FAMILY_ID, NOW);

      expect(rowById(prisma, "row-1").revokedAt).toEqual(NOW);
      expect(rowById(prisma, "row-2").revokedAt).toEqual(NOW);
    });

    it("touches only that family", async () => {
      seedRow(prisma, { id: "row-1" });
      seedRow(prisma, { id: "row-2", familyId: OTHER_FAMILY_ID });

      await store.revokeFamily(FAMILY_ID, NOW);

      // The other family is another sign-in by the same person; revoking one session must
      // not sign them out of the rest.
      expect(rowById(prisma, "row-2").revokedAt).toBeNull();
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: FAMILY_ID, revokedAt: null },
        data: { revokedAt: NOW },
      });
    });

    it("keeps the timestamp already on a rotated row, because the grace window is measured from it", async () => {
      seedRow(prisma, { id: "row-1", revokedAt: NOW, replacedById: "row-2" });
      seedRow(prisma, { id: "row-2" });

      await store.revokeFamily(FAMILY_ID, LATER);

      expect(rowById(prisma, "row-1").revokedAt).toEqual(NOW);
      expect(rowById(prisma, "row-2").revokedAt).toEqual(LATER);
    });

    it("is idempotent", async () => {
      seedRow(prisma, { id: "row-1" });
      await store.revokeFamily(FAMILY_ID, NOW);

      await expect(store.revokeFamily(FAMILY_ID, LATER)).resolves.toBeUndefined();

      expect(rowById(prisma, "row-1").revokedAt).toEqual(NOW);
    });

    it("succeeds for a family that has no rows at all", async () => {
      await expect(store.revokeFamily(OTHER_FAMILY_ID, NOW)).resolves.toBeUndefined();
    });
  });

  describe("deleteExpired", () => {
    const EXPIRED = new Date("2026-08-25T12:00:00.000Z");

    it("deletes rows past their expiry and keeps the rest, whatever their state", async () => {
      seedRow(prisma, { id: "row-old", expiresAt: EXPIRED });
      seedRow(prisma, { id: "row-revoked", expiresAt: EXPIRED, revokedAt: EXPIRED });
      seedRow(prisma, { id: "row-live" });

      const deleted = await store.deleteExpired(NOW);

      expect(deleted).toBe(2);
      expect(prisma.rows.map((row) => row.id)).toEqual(["row-live"]);
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lte: NOW } },
      });
    });

    it("is safe to run again straight away", async () => {
      seedRow(prisma, { id: "row-old", expiresAt: EXPIRED });
      await store.deleteExpired(NOW);

      await expect(store.deleteExpired(NOW)).resolves.toBe(0);
    });

    it("sweeps against the current time when no clock is supplied", async () => {
      seedRow(prisma, { id: "row-old", expiresAt: EXPIRED });
      seedRow(prisma, { id: "row-live", expiresAt: new Date(Date.now() + 60_000) });

      await expect(store.deleteExpired()).resolves.toBe(1);
      expect(prisma.rows.map((row) => row.id)).toEqual(["row-live"]);
    });
  });

  it("never handles a plaintext token on any path", async () => {
    const first = mintToken();
    const second = mintToken();

    const created = await store.create(first.input);
    const found = await store.findByTokenHash(first.input.tokenHash);
    const rotated = await store.rotate(created.id, second.input, NOW);
    await store.revokeFamily(FAMILY_ID, LATER);
    await store.deleteExpired(NOW);

    const sent = everyQuery(prisma);
    const returned = JSON.stringify([created, found, rotated, prisma.rows]);
    for (const plaintext of [first.plaintext, second.plaintext]) {
      expect(sent).not.toContain(plaintext);
      expect(returned).not.toContain(plaintext);
    }
  });
});

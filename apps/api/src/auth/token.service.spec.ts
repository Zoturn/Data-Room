import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { DomainError } from "../common/errors/domain-error";
import {
  AUTH_TOKEN_OPTIONS,
  InvalidRefreshTokenError,
  RefreshTokenAlreadyRotatedError,
  RefreshTokenStore,
  TokenService,
  hashRefreshToken,
  type AuthTokenOptions,
  type NewRefreshToken,
  type RefreshTokenRecord,
} from "./token.service";
import { UnauthenticatedError } from "./auth.errors";

/**
 * Named after the scenarios in
 * openspec/changes/add-authentication/specs/authentication/spec.md — rotation, reuse
 * detection and the grace window — so the mapping from requirement to test is visible.
 *
 * No database: the service persists through the `RefreshTokenStore` port, so the fake below
 * is the whole of the infrastructure. It models the two constraints the real schema
 * enforces — `replacedById` is unique, and revoking a family leaves an existing `revokedAt`
 * alone — because both of those are load-bearing for the behaviour under test.
 */
class InMemoryRefreshTokenStore extends RefreshTokenStore {
  readonly records = new Map<string, RefreshTokenRecord>();

  async findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    for (const record of this.records.values()) {
      if (record.tokenHash === tokenHash) return { ...record };
    }
    return null;
  }

  async findById(id: string): Promise<RefreshTokenRecord | null> {
    const record = this.records.get(id);
    return record === undefined ? null : { ...record };
  }

  async create(token: NewRefreshToken): Promise<RefreshTokenRecord> {
    const record: RefreshTokenRecord = {
      id: randomUUID(),
      userId: token.userId,
      familyId: token.familyId,
      tokenHash: token.tokenHash,
      expiresAt: token.expiresAt,
      familyStartedAt: token.familyStartedAt,
      revokedAt: null,
      replacedById: null,
      createdAt: new Date(),
    };
    this.records.set(record.id, record);
    return { ...record };
  }

  async rotate(
    predecessorId: string,
    successor: NewRefreshToken,
    rotatedAt: Date,
  ): Promise<RefreshTokenRecord> {
    const predecessor = this.records.get(predecessorId);
    if (predecessor === undefined) throw new Error(`No such token ${predecessorId}`);
    // Stands in for the unique index on replaced_by_id: the loser of a race sees this.
    if (predecessor.replacedById !== null) throw new RefreshTokenAlreadyRotatedError();

    const record = await this.create(successor);
    this.records.set(predecessorId, {
      ...predecessor,
      replacedById: record.id,
      revokedAt: rotatedAt,
    });
    return record;
  }

  async revokeFamily(familyId: string, revokedAt: Date): Promise<void> {
    for (const [id, record] of this.records) {
      if (record.familyId !== familyId) continue;
      if (record.revokedAt !== null) continue;
      this.records.set(id, { ...record, revokedAt });
    }
  }

  /** Test affordance: the rows of one family, oldest first. */
  family(familyId: string): RefreshTokenRecord[] {
    return [...this.records.values()]
      .filter((record) => record.familyId === familyId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }
}

const OPTIONS: AuthTokenOptions = {
  accessTokenSecret: "a-test-secret-long-enough-for-hmac-sha256",
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 60 * 60 * 24 * 30,
  rotationGraceSeconds: 5,
  // Deliberately longer than the refresh TTL, so the absolute cap does not silently mask the
  // idle-timeout behaviour the rest of this suite asserts. One test overrides it to prove
  // the cap actually bites.
  absoluteSessionMaxSeconds: 60 * 60 * 24 * 90,
};

const START = new Date("2026-08-26T12:00:00.000Z");
const USER_ID = "6f0a1d5e-2b7c-4a1f-9e33-8c5b1d0f4a21";
const OTHER_USER_ID = "9d2c7b41-5a6e-4c3d-8f10-2e7a9b4c6d38";

function secondsLater(seconds: number): Date {
  return new Date(START.getTime() + seconds * 1000);
}

async function buildService(store: RefreshTokenStore): Promise<TokenService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      TokenService,
      { provide: AUTH_TOKEN_OPTIONS, useValue: OPTIONS },
      { provide: RefreshTokenStore, useValue: store },
    ],
  }).compile();

  return moduleRef.get(TokenService);
}

describe("TokenService", () => {
  let store: InMemoryRefreshTokenStore;
  let tokens: TokenService;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(START);
    // The reuse path logs a warning by design; keep it out of the test output while still
    // asserting on it where it matters.
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

    store = new InMemoryRefreshTokenStore();
    tokens = await buildService(store);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("Scenario: Issuing a session", () => {
    it("starts a new family per sign-in", async () => {
      const first = await tokens.issue(USER_ID);
      const second = await tokens.issue(USER_ID);

      expect(first.familyId).not.toEqual(second.familyId);
      expect(store.family(first.familyId)).toHaveLength(1);
      expect(store.family(second.familyId)).toHaveLength(1);
    });

    it("stores only the hash, never the refresh token itself", async () => {
      const session = await tokens.issue(USER_ID);
      const stored = store.family(session.familyId)[0];

      expect(stored).toBeDefined();
      expect(stored?.tokenHash).toEqual(hashRefreshToken(session.refreshToken));
      // A dumped database must yield nothing usable: the plaintext appears in no column.
      const serialised = JSON.stringify([...store.records.values()]);
      expect(serialised).not.toContain(session.refreshToken);
    });

    it("mints a refresh token with at least 256 bits of entropy", async () => {
      const session = await tokens.issue(USER_ID);

      // base64url of 32 bytes, unpadded.
      expect(session.refreshToken).toHaveLength(43);
      expect(session.refreshToken).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("dates the refresh token by the configured lifetime", async () => {
      const session = await tokens.issue(USER_ID);

      expect(session.refreshTokenExpiresAt.getTime()).toEqual(
        START.getTime() + OPTIONS.refreshTokenTtlSeconds * 1000,
      );
    });
  });

  describe("Scenario: Access tokens", () => {
    it("round-trips the subject through a signed token", async () => {
      const session = await tokens.issue(USER_ID);

      const claims = tokens.verifyAccessToken(session.accessToken);

      expect(claims.sub).toEqual(USER_ID);
      expect(claims.exp - claims.iat).toEqual(OPTIONS.accessTokenTtlSeconds);
    });

    it("rejects a tampered payload", async () => {
      const session = await tokens.issue(USER_ID);
      const [header, , signature] = session.accessToken.split(".");
      const forgedPayload = Buffer.from(
        JSON.stringify({ sub: OTHER_USER_ID, iat: 0, exp: 9999999999 }),
        "utf8",
      ).toString("base64url");

      expect(() => tokens.verifyAccessToken(`${header}.${forgedPayload}.${signature}`)).toThrow(
        UnauthenticatedError,
      );
    });

    it('rejects an unsigned "alg": "none" token', async () => {
      const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }), "utf8").toString(
        "base64url",
      );
      const payload = Buffer.from(
        JSON.stringify({ sub: OTHER_USER_ID, iat: 0, exp: 9999999999 }),
        "utf8",
      ).toString("base64url");

      expect(() => tokens.verifyAccessToken(`${header}.${payload}.`)).toThrow(UnauthenticatedError);
    });

    it("rejects a token signed with a different secret", async () => {
      const otherStore = new InMemoryRefreshTokenStore();
      const moduleRef = await Test.createTestingModule({
        providers: [
          TokenService,
          {
            provide: AUTH_TOKEN_OPTIONS,
            useValue: { ...OPTIONS, accessTokenSecret: "a-different-secret-of-sufficient-length" },
          },
          { provide: RefreshTokenStore, useValue: otherStore },
        ],
      }).compile();
      const foreign = moduleRef.get(TokenService);

      const foreignToken = foreign.signAccessToken(USER_ID).token;

      expect(() => tokens.verifyAccessToken(foreignToken)).toThrow(UnauthenticatedError);
    });

    it("rejects an expired access token", async () => {
      const session = await tokens.issue(USER_ID);

      jest.setSystemTime(secondsLater(OPTIONS.accessTokenTtlSeconds + 1));

      expect(() => tokens.verifyAccessToken(session.accessToken)).toThrow(UnauthenticatedError);
    });

    it("rejects a malformed token", () => {
      expect(() => tokens.verifyAccessToken("not-a-token")).toThrow(UnauthenticatedError);
      expect(() => tokens.verifyAccessToken("")).toThrow(UnauthenticatedError);
    });

    it("refuses to start with a secret too short to sign with", async () => {
      await expect(
        Test.createTestingModule({
          providers: [
            TokenService,
            { provide: AUTH_TOKEN_OPTIONS, useValue: { ...OPTIONS, accessTokenSecret: "short" } },
            { provide: RefreshTokenStore, useValue: new InMemoryRefreshTokenStore() },
          ],
        }).compile(),
      ).rejects.toThrow(/at least 32 characters/);
    });
  });

  describe("Scenario: Rotating a refresh token", () => {
    it("issues a successor in the same family and revokes the predecessor", async () => {
      const first = await tokens.issue(USER_ID);

      jest.setSystemTime(secondsLater(60));
      const second = await tokens.rotate(first.refreshToken);

      expect(second.refreshToken).not.toEqual(first.refreshToken);
      expect(second.familyId).toEqual(first.familyId);
      expect(second.userId).toEqual(USER_ID);

      const [predecessor, successor] = store.family(first.familyId);
      expect(predecessor?.revokedAt).toEqual(secondsLater(60));
      expect(predecessor?.replacedById).toEqual(successor?.id);
      expect(successor?.revokedAt).toBeNull();
      expect(successor?.tokenHash).toEqual(hashRefreshToken(second.refreshToken));
    });

    it("invalidates the old token once the grace window has passed", async () => {
      const first = await tokens.issue(USER_ID);
      await tokens.rotate(first.refreshToken);

      jest.setSystemTime(secondsLater(OPTIONS.rotationGraceSeconds + 1));

      await expect(tokens.rotate(first.refreshToken)).rejects.toThrow(InvalidRefreshTokenError);
    });

    it("lets the successor rotate in turn", async () => {
      const first = await tokens.issue(USER_ID);
      const second = await tokens.rotate(first.refreshToken);

      jest.setSystemTime(secondsLater(60));
      const third = await tokens.rotate(second.refreshToken);

      expect(third.familyId).toEqual(first.familyId);
      expect(store.family(first.familyId)).toHaveLength(3);
    });
  });

  describe("Scenario: Replaying a rotated token", () => {
    it("revokes the entire family and rejects", async () => {
      const first = await tokens.issue(USER_ID);
      const second = await tokens.rotate(first.refreshToken);
      jest.setSystemTime(secondsLater(OPTIONS.rotationGraceSeconds + 1));

      await expect(tokens.rotate(first.refreshToken)).rejects.toThrow(InvalidRefreshTokenError);

      // The token the legitimate client is holding dies with the rest of the family: we
      // cannot tell victim from thief, so neither of them keeps the session.
      for (const record of store.family(first.familyId)) {
        expect(record.revokedAt).not.toBeNull();
      }
      await expect(tokens.rotate(second.refreshToken)).rejects.toThrow(InvalidRefreshTokenError);
    });

    it("records the theft against the family without logging any token material", async () => {
      const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      const first = await tokens.issue(USER_ID);
      await tokens.rotate(first.refreshToken);
      jest.setSystemTime(secondsLater(OPTIONS.rotationGraceSeconds + 1));

      await expect(tokens.rotate(first.refreshToken)).rejects.toThrow(InvalidRefreshTokenError);

      const logged = warn.mock.calls.map((call) => String(call[0])).join("\n");
      expect(logged).toContain(first.familyId);
      expect(logged).not.toContain(first.refreshToken);
      expect(logged).not.toContain(hashRefreshToken(first.refreshToken));
    });

    it("leaves other families alone", async () => {
      const compromised = await tokens.issue(USER_ID);
      const untouched = await tokens.issue(OTHER_USER_ID);
      await tokens.rotate(compromised.refreshToken);
      jest.setSystemTime(secondsLater(OPTIONS.rotationGraceSeconds + 1));

      await expect(tokens.rotate(compromised.refreshToken)).rejects.toThrow(
        InvalidRefreshTokenError,
      );

      const survivor = await tokens.rotate(untouched.refreshToken);
      expect(survivor.familyId).toEqual(untouched.familyId);
    });

    it("does not resurrect a revoked family through the grace window", async () => {
      // Presenting the same rotated token twice in quick succession must not be a way back
      // in: the first presentation kills the family, and the grace path closes with it.
      const first = await tokens.issue(USER_ID);
      await tokens.rotate(first.refreshToken);
      jest.setSystemTime(secondsLater(OPTIONS.rotationGraceSeconds + 1));
      await expect(tokens.rotate(first.refreshToken)).rejects.toThrow(InvalidRefreshTokenError);

      await expect(tokens.rotate(first.refreshToken)).rejects.toThrow(InvalidRefreshTokenError);
      expect(store.family(first.familyId)).toHaveLength(2);
    });
  });

  describe("Scenario: Concurrent refresh from one client", () => {
    it("accepts the immediately-previous token inside the grace window without revoking", async () => {
      const first = await tokens.issue(USER_ID);
      const second = await tokens.rotate(first.refreshToken);

      jest.setSystemTime(secondsLater(2));
      const retry = await tokens.rotate(first.refreshToken);

      expect(retry.familyId).toEqual(first.familyId);
      // Nothing in the family is revoked except the predecessor that was legitimately spent.
      const live = store.family(first.familyId).filter((record) => record.revokedAt === null);
      expect(live).toHaveLength(2);
      expect(retry.refreshToken).not.toEqual(second.refreshToken);
    });

    it("stops extending a session once the absolute maximum is reached", async () => {
      // The refresh TTL is an IDLE timeout — every rotation pushes it forward. Without an
      // absolute bound a session used regularly never ends, and neither does a stolen token
      // being rotated regularly by someone else. This is the bound that forces a real
      // sign-in eventually.
      const capped = new TokenService(
        { ...OPTIONS, refreshTokenTtlSeconds: 3600, absoluteSessionMaxSeconds: 5400 },
        store,
      );

      const first = await capped.issue(USER_ID);
      const startedAt = store
        .family(first.familyId)
        .map((record) => record.familyStartedAt.getTime())
        .sort()[0];

      // Rotate well into the session; the idle timeout alone would grant a further hour.
      jest.setSystemTime(secondsLater(3000));
      const rotated = await capped.rotate(first.refreshToken);

      const record = store
        .family(first.familyId)
        .find((r) => r.tokenHash === hashRefreshToken(rotated.refreshToken));

      // Capped at the sign-in plus the maximum, NOT at now plus the idle TTL.
      expect(record?.expiresAt.getTime()).toBe((startedAt ?? 0) + 5400 * 1000);
      expect(record?.expiresAt.getTime()).toBeLessThan(Date.now() + 3600 * 1000);
    });

    it("keeps the family clock fixed across rotations rather than resetting it", async () => {
      // If each successor restarted the clock, the cap would slide forward with the session
      // and bound nothing at all.
      const first = await tokens.issue(USER_ID);
      const startedAt = store.family(first.familyId)[0]?.familyStartedAt.getTime();

      jest.setSystemTime(secondsLater(60));
      const second = await tokens.rotate(first.refreshToken);
      jest.setSystemTime(secondsLater(120));
      await tokens.rotate(second.refreshToken);

      const clocks = new Set(
        store.family(first.familyId).map((record) => record.familyStartedAt.getTime()),
      );

      expect(clocks.size).toBe(1);
      expect([...clocks][0]).toBe(startedAt);
    });

    it("caps the grace sibling at the successor's expiry, so a replay gains no lifetime", async () => {
      // Without this, the grace path rewards a replay: the presenter receives a token with a
      // full fresh lifetime and its own rotation chain, never linked back to what it
      // replayed. Both parties then rotate independently, reuse detection never fires again,
      // and a stolen refresh token becomes a permanent parallel session.
      const first = await tokens.issue(USER_ID);
      const second = await tokens.rotate(first.refreshToken);

      jest.setSystemTime(secondsLater(5));
      const sibling = await tokens.rotate(first.refreshToken);

      const successorRecord = store
        .family(first.familyId)
        .find((record) => record.tokenHash === hashRefreshToken(second.refreshToken));
      const siblingRecord = store
        .family(first.familyId)
        .find((record) => record.tokenHash === hashRefreshToken(sibling.refreshToken));

      expect(successorRecord).toBeDefined();
      expect(siblingRecord).toBeDefined();
      // The sibling stands in for the successor; it must not outlive it.
      expect(siblingRecord?.expiresAt.getTime()).toBeLessThanOrEqual(
        successorRecord?.expiresAt.getTime() ?? 0,
      );
    });

    it("leaves the successor from the first request usable", async () => {
      const first = await tokens.issue(USER_ID);
      const second = await tokens.rotate(first.refreshToken);
      jest.setSystemTime(secondsLater(2));
      await tokens.rotate(first.refreshToken);

      jest.setSystemTime(secondsLater(30));
      const third = await tokens.rotate(second.refreshToken);

      expect(third.familyId).toEqual(first.familyId);
    });

    it("survives several parallel refreshes with the same token", async () => {
      // The requests interleave for real here: only one can win the rotation, and the
      // losers must land in the grace window rather than 500 or revoke the family.
      const first = await tokens.issue(USER_ID);

      const results = await Promise.allSettled([
        tokens.rotate(first.refreshToken),
        tokens.rotate(first.refreshToken),
        tokens.rotate(first.refreshToken),
      ]);

      expect(results.every((result) => result.status === "fulfilled")).toBe(true);
      const family = store.family(first.familyId);
      expect(family[0]?.revokedAt).toEqual(START);
      expect(family.filter((record) => record.revokedAt === null)).toHaveLength(3);
    });

    it("treats a retry one second past the window as theft", async () => {
      const first = await tokens.issue(USER_ID);
      await tokens.rotate(first.refreshToken);

      jest.setSystemTime(secondsLater(OPTIONS.rotationGraceSeconds + 1));

      await expect(tokens.rotate(first.refreshToken)).rejects.toThrow(InvalidRefreshTokenError);
      expect(store.family(first.familyId).every((record) => record.revokedAt !== null)).toBe(true);
    });
  });

  describe("Scenario: Rejecting a token that cannot be rotated", () => {
    it("rejects an expired token without revoking the family", async () => {
      const first = await tokens.issue(USER_ID);

      jest.setSystemTime(secondsLater(OPTIONS.refreshTokenTtlSeconds + 1));

      await expect(tokens.rotate(first.refreshToken)).rejects.toThrow(InvalidRefreshTokenError);
      // Expiry is ordinary attrition, not evidence of theft. The row stays as it was.
      expect(store.family(first.familyId)[0]?.revokedAt).toBeNull();
    });

    it("rejects an unknown token and writes nothing", async () => {
      await tokens.issue(USER_ID);
      const before = store.records.size;

      await expect(tokens.rotate("a-token-that-was-never-issued")).rejects.toThrow(
        InvalidRefreshTokenError,
      );

      expect(store.records.size).toEqual(before);
    });

    it("rejects a token from a family that was logged out", async () => {
      const first = await tokens.issue(USER_ID);
      await tokens.revokeFamily(first.familyId);

      await expect(tokens.rotate(first.refreshToken)).rejects.toThrow(InvalidRefreshTokenError);
    });

    it("answers unknown, expired and replayed tokens identically", async () => {
      const expired = await tokens.issue(USER_ID);

      jest.setSystemTime(secondsLater(OPTIONS.refreshTokenTtlSeconds + 1));
      const replayed = await tokens.issue(OTHER_USER_ID);
      await tokens.rotate(replayed.refreshToken);
      jest.setSystemTime(new Date(Date.now() + (OPTIONS.rotationGraceSeconds + 1) * 1000));

      const failures = await Promise.all(
        [expired.refreshToken, replayed.refreshToken, "never-issued"].map((token) =>
          tokens.rotate(token).catch((error: unknown) => error),
        ),
      );

      // A caller must not be able to learn whether a stolen token was ever real, whether it
      // had merely expired, or whether presenting it tripped the alarm.
      const shapes = failures.map((failure) =>
        failure instanceof DomainError
          ? { code: failure.code, status: failure.status, message: failure.message }
          : failure,
      );
      expect(shapes[0]).toEqual({
        code: "UNAUTHENTICATED",
        status: 401,
        message: "Your session has expired. Please sign in again.",
      });
      expect(shapes[1]).toEqual(shapes[0]);
      expect(shapes[2]).toEqual(shapes[0]);
    });
  });

  describe("Scenario: Revoking a family", () => {
    it("kills every token in the family", async () => {
      const first = await tokens.issue(USER_ID);
      const second = await tokens.rotate(first.refreshToken);
      const third = await tokens.rotate(second.refreshToken);

      await tokens.revokeFamily(first.familyId);

      expect(store.family(first.familyId).every((record) => record.revokedAt !== null)).toBe(true);
      await expect(tokens.rotate(third.refreshToken)).rejects.toThrow(InvalidRefreshTokenError);
    });

    it("leaves every other family untouched", async () => {
      const signedOut = await tokens.issue(USER_ID);
      const stillActive = await tokens.issue(USER_ID);

      await tokens.revokeFamily(signedOut.familyId);

      expect(store.family(stillActive.familyId).every((record) => record.revokedAt === null)).toBe(
        true,
      );
      const rotated = await tokens.rotate(stillActive.refreshToken);
      expect(rotated.familyId).toEqual(stillActive.familyId);
    });

    it("is idempotent, so a repeated logout is not an error", async () => {
      const session = await tokens.issue(USER_ID);

      await tokens.revokeFamily(session.familyId);
      await expect(tokens.revokeFamily(session.familyId)).resolves.toBeUndefined();
      await expect(tokens.revokeFamily(randomUUID())).resolves.toBeUndefined();
    });

    it("preserves the rotation timestamp of tokens that were already spent", async () => {
      const first = await tokens.issue(USER_ID);
      await tokens.rotate(first.refreshToken);
      const rotatedAt = store.family(first.familyId)[0]?.revokedAt;

      jest.setSystemTime(secondsLater(600));
      await tokens.revokeFamily(first.familyId);

      // The grace window is measured from this timestamp; overwriting it on revocation
      // would reopen the window for a token that was spent ten minutes ago.
      expect(store.family(first.familyId)[0]?.revokedAt).toEqual(rotatedAt);
    });
  });
});

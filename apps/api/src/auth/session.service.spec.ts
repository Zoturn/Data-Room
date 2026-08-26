import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SessionService } from "./session.service";
import {
  RefreshTokenStore,
  TokenService,
  hashRefreshToken,
  type RefreshTokenRecord,
} from "./token.service";

/**
 * Covers "Sign-out ends the session" and "Sign-out is idempotent" from
 * openspec/changes/add-authentication/specs/authentication/spec.md.
 */
type StoreStub = Pick<RefreshTokenStore, "findByTokenHash">;
type TokensStub = Pick<TokenService, "revokeFamily">;

function record(overrides: Partial<RefreshTokenRecord> = {}): RefreshTokenRecord {
  return {
    id: "rt_1",
    userId: "usr_1",
    familyId: "fam_1",
    tokenHash: "hash",
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    revokedAt: null,
    replacedById: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

async function build(
  store: StoreStub,
  tokens: TokensStub,
): Promise<{ sessions: SessionService; store: StoreStub; tokens: TokensStub }> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      SessionService,
      { provide: RefreshTokenStore, useValue: store },
      { provide: TokenService, useValue: tokens },
    ],
  }).compile();

  return { sessions: moduleRef.get(SessionService), store, tokens };
}

describe("SessionService", () => {
  beforeEach(() => {
    // The best-effort path logs an error on purpose; keep a passing run readable.
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Scenario: Sign-out ends the session", () => {
    it("revokes the family the presented token belongs to", async () => {
      const store: StoreStub = { findByTokenHash: jest.fn(async () => record()) };
      const tokens: TokensStub = { revokeFamily: jest.fn(async () => undefined) };
      const { sessions } = await build(store, tokens);

      await sessions.endSession("plaintext-token");

      expect(tokens.revokeFamily).toHaveBeenCalledWith("fam_1");
      expect(tokens.revokeFamily).toHaveBeenCalledTimes(1);
    });

    it("revokes only that family, never every family the user owns", async () => {
      // Signing out on one device must not end the session on another. The family id is
      // the session; the user id is the person.
      const store: StoreStub = {
        findByTokenHash: jest.fn(async () => record({ userId: "usr_9", familyId: "fam_9" })),
      };
      const tokens: TokensStub = { revokeFamily: jest.fn(async () => undefined) };
      const { sessions } = await build(store, tokens);

      await sessions.endSession("plaintext-token");

      expect(tokens.revokeFamily).toHaveBeenCalledWith("fam_9");
      expect(tokens.revokeFamily).not.toHaveBeenCalledWith("usr_9");
    });

    it("looks the token up by its hash and never hands the plaintext to the store", async () => {
      const store: StoreStub = { findByTokenHash: jest.fn(async () => null) };
      const tokens: TokensStub = { revokeFamily: jest.fn(async () => undefined) };
      const { sessions } = await build(store, tokens);

      await sessions.endSession("plaintext-token");

      expect(store.findByTokenHash).toHaveBeenCalledWith(hashRefreshToken("plaintext-token"));
      expect(store.findByTokenHash).not.toHaveBeenCalledWith("plaintext-token");
    });
  });

  describe("Scenario: Sign-out is idempotent", () => {
    it.each([
      ["no cookie at all", undefined],
      ["an empty cookie", ""],
    ])("succeeds with %s and does not touch the database", async (_name, presented) => {
      const store: StoreStub = { findByTokenHash: jest.fn(async () => null) };
      const tokens: TokensStub = { revokeFamily: jest.fn(async () => undefined) };
      const { sessions } = await build(store, tokens);

      await expect(sessions.endSession(presented)).resolves.toBeUndefined();

      expect(store.findByTokenHash).not.toHaveBeenCalled();
      expect(tokens.revokeFamily).not.toHaveBeenCalled();
    });

    it("succeeds when the token is unknown, expired or already revoked", async () => {
      // All three arrive here identically: the row is gone or was never there. Sign-out is
      // the action a worried user takes, so it must not report a failure.
      const store: StoreStub = { findByTokenHash: jest.fn(async () => null) };
      const tokens: TokensStub = { revokeFamily: jest.fn(async () => undefined) };
      const { sessions } = await build(store, tokens);

      await expect(sessions.endSession("stale-token")).resolves.toBeUndefined();

      expect(tokens.revokeFamily).not.toHaveBeenCalled();
    });

    it("still succeeds, and logs, when the lookup itself fails", async () => {
      const store: StoreStub = {
        findByTokenHash: jest.fn(async () => {
          throw new Error("connection terminated unexpectedly");
        }),
      };
      const tokens: TokensStub = { revokeFamily: jest.fn(async () => undefined) };
      const { sessions } = await build(store, tokens);

      await expect(sessions.endSession("plaintext-token")).resolves.toBeUndefined();

      expect(Logger.prototype.error).toHaveBeenCalled();
    });

    it("still succeeds when the revocation itself fails", async () => {
      const store: StoreStub = { findByTokenHash: jest.fn(async () => record()) };
      const tokens: TokensStub = {
        revokeFamily: jest.fn(async () => {
          throw new Error("connection terminated unexpectedly");
        }),
      };
      const { sessions } = await build(store, tokens);

      await expect(sessions.endSession("plaintext-token")).resolves.toBeUndefined();

      expect(Logger.prototype.error).toHaveBeenCalled();
    });

    it("never writes the token or its hash to the log", async () => {
      const store: StoreStub = {
        findByTokenHash: jest.fn(async () => {
          throw new Error("connection terminated unexpectedly");
        }),
      };
      const tokens: TokensStub = { revokeFamily: jest.fn(async () => undefined) };
      const { sessions } = await build(store, tokens);

      await sessions.endSession("plaintext-token");

      const logged = JSON.stringify(jest.mocked(Logger.prototype.error).mock.calls);
      expect(logged).not.toContain("plaintext-token");
      expect(logged).not.toContain(hashRefreshToken("plaintext-token"));
    });
  });
});

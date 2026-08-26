import { Test } from "@nestjs/testing";
import { PASSWORD_MAX_LENGTH } from "@data-room/shared";
import * as argon2 from "argon2";
import { PasswordService } from "./password.service";
import { ValidationFailedError } from "../common/errors/domain-error";

/**
 * Covers auth-and-guards.md rule 2 — Argon2id, constant-time verify, and a hash that never
 * carries the plaintext.
 *
 * Argon2id is deliberately slow, so every digest these tests need is computed once in
 * `beforeAll` and shared. The generous timeouts are for CI, which is slower than a laptop and
 * would otherwise fail on the default 5s for reasons that have nothing to do with the code.
 */
const SLOW_HASH_TIMEOUT_MS = 30_000;
const PASSWORD = "correct horse battery staple";

async function buildService(): Promise<PasswordService> {
  const moduleRef = await Test.createTestingModule({
    providers: [PasswordService],
  }).compile();

  return moduleRef.get(PasswordService);
}

describe("PasswordService", () => {
  let passwords: PasswordService;
  let digest: string;

  beforeAll(async () => {
    passwords = await buildService();
    digest = await passwords.hash(PASSWORD);
  }, SLOW_HASH_TIMEOUT_MS);

  describe("hash", () => {
    it("returns a digest, never the plaintext", () => {
      expect(digest).not.toBe(PASSWORD);
      expect(digest).not.toContain(PASSWORD);
    });

    it("uses argon2id with the declared cost parameters", () => {
      // The PHC string is the contract with our future selves: it records the algorithm and
      // the cost, which is what lets an old digest still verify after a cost bump.
      expect(digest).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    });

    it(
      "salts every call, so the same password hashes to two different digests",
      async () => {
        const second = await passwords.hash(PASSWORD);

        expect(second).not.toBe(digest);
      },
      SLOW_HASH_TIMEOUT_MS,
    );

    it("refuses a password above the shared maximum rather than hashing it", async () => {
      // Unbounded input is a denial-of-service lever, since the caller chooses the work.
      const overlong = "a".repeat(PASSWORD_MAX_LENGTH + 1);

      await expect(passwords.hash(overlong)).rejects.toBeInstanceOf(ValidationFailedError);
    });
  });

  describe("verify", () => {
    it(
      "accepts the password that produced the digest",
      async () => {
        await expect(passwords.verify(digest, PASSWORD)).resolves.toBe(true);
      },
      SLOW_HASH_TIMEOUT_MS,
    );

    it(
      "rejects a different password",
      async () => {
        await expect(passwords.verify(digest, "wrong password entirely")).resolves.toBe(false);
      },
      SLOW_HASH_TIMEOUT_MS,
    );

    it(
      "rejects a password differing only in case, since passwords are not normalised",
      async () => {
        // Emails are lower-cased before comparison; passwords must not be, or the search
        // space collapses.
        await expect(passwords.verify(digest, PASSWORD.toUpperCase())).resolves.toBe(false);
      },
      SLOW_HASH_TIMEOUT_MS,
    );

    it("returns false for a malformed digest instead of throwing", async () => {
      // argon2.verify throws a TypeError on an unparseable digest. A corrupted column must
      // read as a failed login, not as a 500 that confirms the input reached the hasher.
      const malformed = [
        "",
        "not-a-hash",
        "$argon2id$broken",
        "$argon2id$v=19$m=19456,t=2,p=1$",
        "$notanalgorithm$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2g",
      ];

      for (const candidate of malformed) {
        await expect(passwords.verify(candidate, PASSWORD)).resolves.toBe(false);
      }
    });

    it(
      "returns false for a truncated digest instead of throwing",
      async () => {
        const truncated = digest.slice(0, digest.length - 6);

        await expect(passwords.verify(truncated, PASSWORD)).resolves.toBe(false);
      },
      SLOW_HASH_TIMEOUT_MS,
    );

    it("returns false for an over-long candidate without throwing", async () => {
      const overlong = "a".repeat(PASSWORD_MAX_LENGTH + 1);

      await expect(passwords.verify(digest, overlong)).resolves.toBe(false);
    });

    it(
      "still verifies a digest written with weaker parameters",
      async () => {
        // Raising the cost must not lock existing users out: verify reads the parameters from
        // the digest, not from the current constants.
        const legacy = await argon2.hash(PASSWORD, {
          type: argon2.argon2id,
          memoryCost: 8192,
          timeCost: 1,
          parallelism: 1,
        });

        expect(legacy).not.toMatch(/m=19456,p=1,t=2/);
        await expect(passwords.verify(legacy, PASSWORD)).resolves.toBe(true);
        await expect(passwords.verify(legacy, "wrong password entirely")).resolves.toBe(false);
      },
      SLOW_HASH_TIMEOUT_MS,
    );
  });
});

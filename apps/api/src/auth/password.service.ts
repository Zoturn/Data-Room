import { Injectable } from "@nestjs/common";
import { PASSWORD_MAX_LENGTH } from "@data-room/shared";
import * as argon2 from "argon2";
import { ValidationFailedError } from "../common/errors/domain-error";

/**
 * Cost parameters, measured rather than guessed: on this machine m=19456/t=2/p=1 hashes in
 * ~70ms, and the deploy target (a 512MB free-tier instance) is slower still, so a real login
 * lands around the 100ms mark.
 *
 * Both directions of the trade-off are real. Too cheap and a stolen `passwordHash` column is
 * worth cracking offline on rented GPUs. Too expensive and every login pays the latency while
 * the box holds `memoryCost` per *concurrent* hash — at 19MiB, ten simultaneous logins cost
 * ~190MiB, which a 512MB instance survives. The OWASP-equivalent m=47104/t=1/p=1 measured
 * 95ms here but needs 46MiB a hash, so the same ten logins would exhaust the instance and
 * turn the login endpoint into its own denial-of-service lever. Memory hardness is what
 * defeats GPUs, so the cost was spent on passes rather than on cutting memory further.
 */
const MEMORY_COST_KIB = 19456;
const TIME_COST = 2;
const PARALLELISM = 1;

/**
 * Argon2id hashing and verification. The only place that knows how a password becomes a
 * stored digest; see apps/api/.claude/rules/auth-and-guards.md rule 2.
 */
@Injectable()
export class PasswordService {
  /**
   * Returns a self-describing PHC digest — `$argon2id$v=19$m=...,t=...,p=...$salt$hash`. The
   * salt is generated per call by the library, so the same password never yields the same
   * digest and a stolen column cannot be attacked with one precomputed table.
   */
  async hash(plain: string): Promise<string> {
    // Defence in depth: the DTO already bounds this, but `hash` is reachable from any future
    // caller and Argon2id will faithfully chew through a megabyte-long password.
    if (plain.length > PASSWORD_MAX_LENGTH) {
      throw new ValidationFailedError(`Password must be at most ${PASSWORD_MAX_LENGTH} characters`);
    }

    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: MEMORY_COST_KIB,
      timeCost: TIME_COST,
      parallelism: PARALLELISM,
    });
  }

  /**
   * `argon2.verify` recomputes with the parameters embedded in the *digest*, not the constants
   * above, so raising the cost later leaves existing digests verifiable, and compares with
   * `crypto.timingSafeEqual` — a byte-by-byte `===` would leak the correct prefix through
   * timing.
   *
   * It throws a TypeError on anything it cannot parse (`@phc/format` rejects a digest with no
   * leading `$`). A truncated or corrupted column must read as "wrong password", never as a
   * 500 that tells an attacker their input reached the hasher.
   */
  async verify(hash: string, plain: string): Promise<boolean> {
    // Cannot match any digest we issued, since `hash` refuses to create one above the bound —
    // so refusing early reveals nothing about which account or password is correct.
    if (plain.length > PASSWORD_MAX_LENGTH) return false;

    try {
      return await argon2.verify(hash, plain);
    } catch {
      // Deliberately swallowed, and deliberately not logged: the plaintext is in scope here,
      // and the digest identifies a user. The caller turns this into a uniform 401.
      return false;
    }
  }
}

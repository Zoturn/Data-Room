import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { NotFoundError } from "../common/errors/domain-error";
import { PrismaService } from "../prisma/prisma.service";
import { EmailAlreadyRegisteredError } from "./auth.errors";

/**
 * A user, as the repository hands one out.
 *
 * `passwordHash` is here because `AuthService.login` has to verify against it, and nowhere
 * else. It is dropped by `toSessionUser`, which parses through the `.strict()`
 * `sessionUserSchema` — so a hash cannot reach a response even if a future field is added
 * carelessly. See apps/api/.claude/rules/prisma-data-model.md rule 11.
 */
export type UserRecord = {
  id: string;
  email: string;
  displayName: string;
  /** Argon2id digest. Null for an account that only ever signs in with Google. */
  passwordHash: string | null;
  /** Null until a Google account is linked. */
  googleId: string | null;
};

/** A password registration. The caller has already normalised the email and hashed the password. */
export type NewPasswordUser = {
  email: string;
  passwordHash: string;
  displayName: string;
};

/** A first Google sign-in for an address nobody has registered. No password is ever set. */
export type NewGoogleUser = {
  email: string;
  googleId: string;
  displayName: string;
};

/**
 * Every read is explicit about its columns, so adding a field to the `User` model cannot
 * silently widen what leaves this repository. A `select` is a smaller blast radius than
 * remembering to strip something later.
 */
const USER_COLUMNS = {
  id: true,
  email: true,
  displayName: true,
  passwordHash: true,
  googleId: true,
} satisfies Prisma.UserSelect;

const UNIQUE_VIOLATION = "P2002";
const RECORD_NOT_FOUND = "P2025";

/**
 * Shown when a Google identity is already attached to a different row. Vanishingly rare —
 * it needs two accounts to disagree about who owns one Google subject id — but overwriting
 * the link instead would hand an account to whoever signed in most recently.
 */
const GOOGLE_ID_TAKEN = "That Google account is already linked to a different account.";

/**
 * Which unique index a P2002 tripped, lower-cased, or `null` when the error is not a unique
 * violation at all.
 *
 * Prisma reports `meta.target` as the field names on PostgreSQL, but has reported the raw
 * constraint name (`users_email_key`) in other versions and omits it entirely for some
 * drivers. Matching on a substring survives all three, and an empty string — "it was a
 * unique violation but Prisma did not say which" — is deliberately distinct from `null`.
 */
function uniqueViolationTarget(error: unknown): string | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  if (error.code !== UNIQUE_VIOLATION) return null;

  const target = error.meta?.["target"];
  if (typeof target === "string") return target.toLowerCase();

  if (Array.isArray(target)) {
    // `Array.isArray` narrows to `any[]`; widening to `readonly unknown[]` by assignment
    // puts the elements back under the type checker rather than casting them away.
    const entries: readonly unknown[] = target;
    return entries
      .filter((entry): entry is string => typeof entry === "string")
      .join(",")
      .toLowerCase();
  }

  return "";
}

function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === RECORD_NOT_FOUND;
}

/**
 * Every Prisma call for `User`. Nothing outside this class touches `PrismaService` for a
 * user row, and no Prisma error code escapes it — see apps/api/.claude/rules/
 * nestjs-architecture.md rule 4 and errors-and-validation.md rule 8.
 *
 * Uniqueness is the database's job here, not a read-then-write in the service: two
 * simultaneous registrations for one address both pass a `findUnique` check and both
 * insert. The unique index on `email` is what actually holds, and the translation below is
 * how it becomes a 409.
 */
@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({ where: { id }, select: USER_COLUMNS });
  }

  /** The caller normalises. This compares against the stored, already-normalised column. */
  async findByEmail(email: string): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({ where: { email }, select: USER_COLUMNS });
  }

  async findByGoogleId(googleId: string): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({ where: { googleId }, select: USER_COLUMNS });
  }

  async createWithPassword(input: NewPasswordUser): Promise<UserRecord> {
    try {
      return await this.prisma.user.create({ data: input, select: USER_COLUMNS });
    } catch (error) {
      // `email` is the only unique column this insert writes, so any unique violation is
      // the taken-address case.
      if (uniqueViolationTarget(error) === null) throw error;
      throw new EmailAlreadyRegisteredError();
    }
  }

  async createWithGoogle(input: NewGoogleUser): Promise<UserRecord> {
    try {
      return await this.prisma.user.create({ data: input, select: USER_COLUMNS });
    } catch (error) {
      const target = uniqueViolationTarget(error);
      if (target === null) throw error;
      if (target.includes("google")) throw new EmailAlreadyRegisteredError(GOOGLE_ID_TAKEN);
      throw new EmailAlreadyRegisteredError();
    }
  }

  /**
   * Attach a Google identity to an existing account. The caller has already established that
   * this row has no Google identity yet; the unique index on `google_id` is what settles a
   * race between two callers trying to attach the same one.
   */
  async linkGoogleAccount(userId: string, googleId: string): Promise<UserRecord> {
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: { googleId },
        select: USER_COLUMNS,
      });
    } catch (error) {
      if (isRecordNotFound(error)) throw new NotFoundError("Account not found");
      if (uniqueViolationTarget(error) === null) throw error;
      throw new EmailAlreadyRegisteredError(GOOGLE_ID_TAKEN);
    }
  }
}

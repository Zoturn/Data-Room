import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import {
  normalizeEmail,
  sessionUserSchema,
  type LoginInput,
  type RegisterInput,
  type SessionUser,
} from "@data-room/shared";
import {
  InvalidCredentialsError,
  UnauthenticatedError,
} from "./auth.errors";
import { PendingGrantBinder } from "../sharing/shares.service";
import { PasswordService } from "./password.service";
import { TokenService, type IssuedSession } from "./token.service";
import { UserRepository, type UserRecord } from "./user.repository";

/** A signed-in caller and the tokens that prove it. The controller turns these into cookies. */
export type AuthenticatedSession = {
  user: SessionUser;
  session: IssuedSession;
};

/** Matches the bound in `registerInputSchema`. */
const DISPLAY_NAME_MAX_LENGTH = 100;

/**
 * Falls back to the local part of the address, which is always non-empty for an address that
 * validated — `sessionUserSchema` requires a display name, so there is no "no name" state.
 */
function resolveDisplayName(candidate: string | undefined, email: string): string {
  const offered = candidate?.trim();
  if (offered !== undefined && offered.length > 0) return offered.slice(0, DISPLAY_NAME_MAX_LENGTH);

  const [localPart] = email.split("@");
  const fallback = localPart !== undefined && localPart.length > 0 ? localPart : email;
  return fallback.slice(0, DISPLAY_NAME_MAX_LENGTH);
}

/**
 * Registration, sign-in, and who the caller is.
 *
 * The rules live here; the Prisma calls live in `UserRepository`, the hashing in
 * `PasswordService` and the tokens in `TokenService`. See
 * apps/api/.claude/rules/auth-and-guards.md, which this implements.
 */
@Injectable()
export class AuthService implements OnModuleInit {
  /**
   * A throwaway Argon2id digest, used to give an unknown email the same cost as a known one.
   * See `login`. Memoised as the *promise* rather than the value so two simultaneous
   * unknown-email logins share one hash instead of computing one each.
   */
  private decoyDigest: Promise<string> | null = null;

  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UserRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly grants: PendingGrantBinder,
  ) {}

  /**
   * Warm the decoy at boot. Computed lazily it would make the *first* unknown-email login
   * pay for a hash plus a verify — measurably slower than every later one, which is exactly
   * the signal the decoy exists to remove.
   */
  async onModuleInit(): Promise<void> {
    await this.decoy();
  }

  /**
   * Create a password account and sign the new user straight in.
   *
   * There is no "is this email taken" query first: two concurrent registrations for one
   * address would both pass it and both insert. The unique index on `email` is the only
   * thing that actually decides, and `UserRepository` turns the violation it raises into
   * this 409. That the 409 exists at all does reveal that an address is registered — but
   * registration cannot avoid that and stay usable, whereas sign-in can, and does.
   */
  async register(input: RegisterInput): Promise<AuthenticatedSession> {
    // `registerInputSchema` already normalised this. Doing it again is idempotent, and it
    // means the invariant holds for any caller, not only one that came through the DTO.
    const email = normalizeEmail(input.email);

    const user = await this.users.createWithPassword({
      email,
      passwordHash: await this.passwords.hash(input.password),
      displayName: resolveDisplayName(input.displayName, email),
    });

    return this.startSession(user);
  }

  /**
   * Verify a password and start a session.
   *
   * An unknown address and a wrong password must be indistinguishable, or the endpoint
   * becomes an oracle for which addresses are registered (auth-and-guards.md rule 4). Same
   * error, same message, and comparable timing:
   *
   * Timing is the part that is easy to get wrong. Returning early when the lookup misses
   * would skip Argon2id entirely, and Argon2id is ~100ms here — an attacker with a
   * stopwatch could enumerate the whole user base without ever guessing a password. So the
   * verify runs unconditionally, against the real digest when there is one and against a
   * decoy digest of identical cost when there is not. The comparison result is folded into
   * one decision after the work has been done, and never branched on before it.
   */
  async login(input: LoginInput): Promise<AuthenticatedSession> {
    const email = normalizeEmail(input.email);
    const user = await this.users.findByEmail(email);

    // An unknown address has no digest to verify, and skipping the work would answer faster
    // than a real one — so it pays for a verify against a decoy instead.
    const digest = user?.passwordHash ?? (await this.decoy());
    const matches = await this.passwords.verify(digest, input.password);

    if (user === null || user.passwordHash === null || !matches) {
      throw new InvalidCredentialsError();
    }

    return this.startSession(user);
  }

  /** The caller behind an access token, for `GET /auth/me`. */
  async getSessionUser(userId: string): Promise<SessionUser> {
    const user = await this.users.findById(userId);

    // A signature that verifies but names nobody — a deleted account, or a token minted
    // against a database that has since been reset. The session is over; 404 would be a
    // claim about a resource, and this is a claim about the caller.
    if (user === null) throw new UnauthenticatedError();

    return this.toSessionUser(user);
  }

  /**
   * The user as a browser may see them.
   *
   * Parsed rather than constructed: `sessionUserSchema` is `.strict()`, so if this object
   * ever grows a `passwordHash` or a token, the parse throws here instead of the value being
   * quietly serialised into a response. `hasPassword` is the shape of that secret, never the
   * secret itself.
   */
  toSessionUser(user: UserRecord): SessionUser {
    return sessionUserSchema.parse({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      hasPassword: user.passwordHash !== null,
    });
  }

  private async startSession(user: UserRecord): Promise<AuthenticatedSession> {
    await this.bindPendingGrants(user);

    return { user: this.toSessionUser(user), session: await this.tokens.issue(user.id) };
  }

  /**
   * Attach any share invitations waiting on this address to the account that just proved it
   * holds it.
   *
   * Here rather than in `register`, because every route into a session funnels through
   * `startSession` — registration and sign-in alike — and an invitation
   * sent to somebody who already had an account must land on their *next* sign-in, not only
   * on a registration that will never happen again. Both sides of the comparison went through
   * `normalizeEmail`, which is what makes `Buyer@Acme.com` and `buyer@acme.com` one person.
   *
   * A failure here is swallowed on purpose. Binding is a convenience, not a step in
   * authenticating anybody: refusing the sign-in would lock a user out of their own account
   * over somebody else's invitation, and the next sign-in binds whatever this attempt missed.
   * Logged rather than ignored, because a grant that never binds looks from the recipient's
   * side like the owner forgot to invite them.
   */
  private async bindPendingGrants(user: UserRecord): Promise<void> {
    try {
      await this.grants.bindPendingGrants(user.id, user.email);
    } catch (error) {
      this.logger.error(`Could not bind pending share grants for ${user.id}`, error);
    }
  }

  private decoy(): Promise<string> {
    // Random, so the digest is never one an attacker could have a rainbow table for, and
    // hashed through the same service as a real password so the cost parameters can never
    // drift apart from the ones a genuine login pays.
    this.decoyDigest ??= this.passwords.hash(randomBytes(32).toString("base64url"));
    return this.decoyDigest;
  }
}

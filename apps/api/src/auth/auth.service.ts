import { Injectable, type OnModuleInit } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import {
  normalizeEmail,
  sessionUserSchema,
  type LoginInput,
  type RegisterInput,
  type SessionUser,
} from "@data-room/shared";
import {
  EmailAlreadyRegisteredError,
  GoogleEmailNotVerifiedError,
  InvalidCredentialsError,
  UnauthenticatedError,
} from "./auth.errors";
import { PasswordService } from "./password.service";
import { TokenService, type IssuedSession } from "./token.service";
import { UserRepository, type UserRecord } from "./user.repository";

/**
 * What Google's userinfo response reduces to once the OAuth module has verified it. The
 * service never speaks to Google itself — see nestjs-architecture.md rule 11 — so this is
 * the whole contract between the two.
 */
export type GoogleProfile = {
  /** Google's stable subject id. The email can change; this cannot. */
  googleId: string;
  email: string;
  /** Google's own attestation that the holder controls the address. */
  emailVerified: boolean;
  displayName?: string | undefined;
};

/** A signed-in caller and the tokens that prove it. The controller turns these into cookies. */
export type AuthenticatedSession = {
  user: SessionUser;
  session: IssuedSession;
};

/**
 * Matches the bound in `registerInputSchema`, applied here as well because a Google profile
 * never passes through that schema and Google does not bound the name it returns.
 */
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

  constructor(
    private readonly users: UserRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
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
   * Three different failures — no such address, wrong password, and a password login against
   * an account that only has Google — must be indistinguishable, or the endpoint becomes an
   * oracle for which addresses are registered and which of those have a password set
   * (auth-and-guards.md rule 4). Same error, same message, and comparable timing:
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

    // Covers both the unknown address and the Google-only account: neither has a digest, and
    // both must still pay for a verify.
    const digest = user?.passwordHash ?? (await this.decoy());
    const matches = await this.passwords.verify(digest, input.password);

    if (user === null || user.passwordHash === null || !matches) {
      throw new InvalidCredentialsError();
    }

    return this.startSession(user);
  }

  /**
   * Sign in with Google, attaching the identity to the existing account for that address.
   *
   * One human is one row. Somebody who registered with a password and later clicks "Continue
   * with Google" must land in the same Data Room, not in an empty second account — so the
   * match is on the normalised email and the outcome is a link, never a duplicate.
   */
  async linkOrCreateFromGoogle(profile: GoogleProfile): Promise<AuthenticatedSession> {
    // An unverified Google address is just a string its holder typed into a profile form.
    // Trusting it would let anyone claim any address and, through the linking below, walk
    // into the account that owns it. Google's attestation is the whole basis for the link.
    if (!profile.emailVerified) throw new GoogleEmailNotVerifiedError();

    const email = normalizeEmail(profile.email);
    return this.startSession(await this.resolveGoogleUser(profile, email));
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
   * ever grows a `passwordHash`, a `googleId` or a token, the parse throws here instead of
   * the value being quietly serialised into a response. `hasPassword` and `hasGoogle` are
   * the shapes of those secrets, never the secrets — enough for the interface to offer
   * "set a password" and nothing more.
   */
  toSessionUser(user: UserRecord): SessionUser {
    return sessionUserSchema.parse({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      hasPassword: user.passwordHash !== null,
      hasGoogle: user.googleId !== null,
    });
  }

  private async resolveGoogleUser(profile: GoogleProfile, email: string): Promise<UserRecord> {
    // Subject id first: it survives a Google-side address change, so an already-linked
    // account is found even when the email no longer matches the one we stored.
    const linked = await this.users.findByGoogleId(profile.googleId);
    if (linked !== null) return linked;

    const existing = await this.users.findByEmail(email);
    if (existing !== null) return this.linkGoogle(existing, profile.googleId);

    try {
      return await this.users.createWithGoogle({
        email,
        googleId: profile.googleId,
        displayName: resolveDisplayName(profile.displayName, email),
      });
    } catch (error) {
      if (!(error instanceof EmailAlreadyRegisteredError)) throw error;

      // Lost a race: between the lookup above and this insert, someone registered that
      // address. The unique index is what guarantees one account per address, and this is
      // how the loser of the race joins the winner's account rather than failing a sign-in
      // that had nothing wrong with it.
      const raced = await this.users.findByEmail(email);
      if (raced === null) throw error;
      return this.linkGoogle(raced, profile.googleId);
    }
  }

  private async linkGoogle(user: UserRecord, googleId: string): Promise<UserRecord> {
    if (user.googleId === googleId) return user;

    // The address already carries a *different* Google identity. Re-linking would move the
    // account to whoever signed in most recently, so refuse and leave the existing link
    // alone — a support problem is better than a silent account takeover.
    if (user.googleId !== null) {
      throw new EmailAlreadyRegisteredError(
        "That email address is already linked to a different Google account.",
      );
    }

    return this.users.linkGoogleAccount(user.id, googleId);
  }

  private async startSession(user: UserRecord): Promise<AuthenticatedSession> {
    return { user: this.toSessionUser(user), session: await this.tokens.issue(user.id) };
  }

  private decoy(): Promise<string> {
    // Random, so the digest is never one an attacker could have a rainbow table for, and
    // hashed through the same service as a real password so the cost parameters can never
    // drift apart from the ones a genuine login pays.
    this.decoyDigest ??= this.passwords.hash(randomBytes(32).toString("base64url"));
    return this.decoyDigest;
  }
}

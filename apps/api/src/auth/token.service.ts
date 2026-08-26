import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  InvalidRefreshTokenError,
  RefreshTokenAlreadyRotatedError,
  UnauthenticatedError,
} from "./auth.errors";

/**
 * Configuration for the token service.
 *
 * Injected as an options object rather than read from `ConfigService` directly, because the
 * env schema has no JWT variables yet and this service must not be the thing that decides
 * what they are called. The auth module binds this token from configuration.
 */
export type AuthTokenOptions = {
  /** HMAC key for the access token. Never leaves the server. */
  accessTokenSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  /**
   * How long a just-rotated token keeps being accepted. See `rotate` — this is the
   * difference between tolerating a client's own parallel retry and revoking its session.
   */
  rotationGraceSeconds: number;
  /**
   * The longest a single sign-in may live, however diligently it is rotated. The refresh TTL
   * is an idle timeout and slides forward on every use, so without this bound a session — or
   * a stolen token being refreshed by someone else — never ends.
   */
  absoluteSessionMaxSeconds: number;
};

export const AUTH_TOKEN_OPTIONS = Symbol("AUTH_TOKEN_OPTIONS");

/** One persisted refresh token, as the service needs to see it. */
export type RefreshTokenRecord = {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
  createdAt: Date;
  /** When the sign-in that began this family happened. Fixed for the family's whole life. */
  familyStartedAt: Date;
};

export type NewRefreshToken = {
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  familyStartedAt: Date;
};

/**
 * Persistence port for refresh tokens. An abstract class so it doubles as the injection
 * token; the auth module binds it to a Prisma-backed repository, and tests bind an
 * in-memory fake. The service holds no Prisma import of its own — see
 * apps/api/.claude/rules/nestjs-architecture.md.
 */
export abstract class RefreshTokenStore {
  abstract findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  abstract findById(id: string): Promise<RefreshTokenRecord | null>;
  abstract create(token: NewRefreshToken): Promise<RefreshTokenRecord>;

  /**
   * Insert the successor, then link and revoke the predecessor — in one transaction, so a
   * crash can never leave a spent token still usable or a successor with no ancestor.
   *
   * Must throw `RefreshTokenAlreadyRotatedError` if the predecessor already has a
   * `replacedById` (the unique index on that column is what detects the race).
   */
  abstract rotate(
    predecessorId: string,
    successor: NewRefreshToken,
    rotatedAt: Date,
  ): Promise<RefreshTokenRecord>;

  /**
   * Revoke every *live* token in the family. Rows that already carry a `revokedAt` keep it:
   * that timestamp is when they were rotated, and the grace window is measured from it.
   */
  abstract revokeFamily(familyId: string, revokedAt: Date): Promise<void>;
}

/**
 * Raised by the store when two requests rotate the same token at once. Not a `DomainError`:
 * it never reaches a client, because `rotate` catches it and falls through to the grace
 * window — losing that race is exactly the situation the window exists for.
 */
/** What a successful issue or rotation hands back to the caller that sets the cookies. */
export type IssuedSession = {
  userId: string;
  familyId: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
};

/**
 * A refresh token is rejected with exactly one error whatever the reason — unknown,
 * expired, revoked or replayed. Distinguishing them would tell an attacker whether a
 * stolen token was ever valid, and whether their replay tripped the alarm.
 */
const accessTokenHeaderSchema = z.object({
  alg: z.literal("HS256"),
  typ: z.literal("JWT"),
});

const accessTokenClaimsSchema = z.object({
  sub: z.string().min(1),
  iat: z.number().int(),
  exp: z.number().int(),
});

export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;

/** 256 bits of CSPRNG output. Guessing one is not a threat worth modelling. */
const REFRESH_TOKEN_BYTES = 32;

/** An HMAC key shorter than its digest weakens the construction for no benefit. */
const MIN_SECRET_LENGTH = 32;

/**
 * The stored form of a refresh token.
 *
 * SHA-256 rather than Argon2id on purpose: a password is low-entropy and needs a work
 * factor to survive an offline attack, whereas this value is 256 uniform random bits, so
 * there is nothing to brute-force and a slow hash would only add latency to every refresh.
 * What matters is that the plaintext is never written down — it exists in the cookie and
 * nowhere else, so a dumped database yields no usable session.
 */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  // Length is not a secret here — it is fixed by the algorithm — and timingSafeEqual
  // throws on a length mismatch, so compare it first.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function decodeSegment(segment: string): unknown {
  try {
    const json: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return json;
  } catch {
    return null;
  }
}

/**
 * Access tokens and refresh tokens.
 *
 * Access tokens are compact-serialisation JWTs signed HS256 with `node:crypto`; they are
 * short-lived and stateless. Refresh tokens are opaque random strings, stored hashed, and
 * rotate on every use with reuse detection — see `rotate`.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    @Inject(AUTH_TOKEN_OPTIONS) private readonly options: AuthTokenOptions,
    private readonly store: RefreshTokenStore,
  ) {
    if (options.accessTokenSecret.length < MIN_SECRET_LENGTH) {
      // Fail at boot rather than sign millions of forgeable tokens.
      throw new Error(
        `Access token secret must be at least ${MIN_SECRET_LENGTH} characters; ` +
          `got ${options.accessTokenSecret.length}.`,
      );
    }
  }

  /** Start a new session: a fresh family, its first refresh token, and an access token. */
  async issue(userId: string): Promise<IssuedSession> {
    // A new sign-in starts the family clock; every successor inherits this instant.
    return this.mint(userId, randomUUID(), this.now());
  }

  /**
   * Exchange a refresh token for its successor.
   *
   * The interesting cases are the failures:
   *
   * - Unknown or expired — reject, and touch nothing. An expired token is ordinary
   *   attrition, not evidence of theft, so it must not cost the user their other sessions.
   * - Already rotated, outside the grace window — someone is presenting a token that was
   *   spent. Either the client kept a copy or an attacker stole one, and there is no way to
   *   tell which from here, so the entire family dies and both parties sign in again.
   * - Already rotated, inside the grace window — a client firing several requests at once
   *   refreshes several times with the same token; without this window it would revoke its
   *   own session every time it made two calls in parallel. Inside the window we mint a
   *   sibling in the same family and leave the rotation record alone, so the successor the
   *   first request already returned stays valid. The window is seconds long, and it only
   *   applies while that successor is still live: once the family is revoked — by a logout
   *   or by a reuse we detected — the successor is revoked too and this path closes with it.
   */
  async rotate(presentedToken: string): Promise<IssuedSession> {
    const presented = await this.store.findByTokenHash(hashRefreshToken(presentedToken));
    if (presented === null) throw new InvalidRefreshTokenError();

    const now = this.now();
    if (presented.expiresAt.getTime() <= now.getTime()) throw new InvalidRefreshTokenError();

    if (presented.replacedById !== null) return this.rotateAlreadyRotated(presented, now);

    // Revoked but never rotated: the family was killed by a logout or by an earlier reuse.
    if (presented.revokedAt !== null) throw new InvalidRefreshTokenError();

    const successor = this.newRefreshToken(
      presented.userId,
      presented.familyId,
      now,
      presented.familyStartedAt,
    );
    try {
      const record = await this.store.rotate(presented.id, successor.input, now);
      return this.toSession(record, successor.plaintext);
    } catch (error) {
      if (!(error instanceof RefreshTokenAlreadyRotatedError)) throw error;

      // Two of the client's own requests rotated the same token at once and this one lost.
      // Re-read and let the grace window decide: a genuine race lands inside it, and a
      // replay dressed up as a race does not.
      const current = await this.store.findByTokenHash(presented.tokenHash);
      if (current === null) throw new InvalidRefreshTokenError();
      return this.rotateAlreadyRotated(current, now);
    }
  }

  /** Logout, and the blunt instrument reuse detection reaches for. Idempotent. */
  async revokeFamily(familyId: string): Promise<void> {
    await this.store.revokeFamily(familyId, this.now());
  }

  signAccessToken(userId: string): { token: string; expiresAt: Date } {
    const issuedAt = Math.floor(this.now().getTime() / 1000);
    const expiresAt = issuedAt + this.options.accessTokenTtlSeconds;

    const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const claims: AccessTokenClaims = { sub: userId, iat: issuedAt, exp: expiresAt };
    const payload = base64UrlEncode(JSON.stringify(claims));
    const signingInput = `${header}.${payload}`;

    return {
      token: `${signingInput}.${this.signature(signingInput)}`,
      expiresAt: new Date(expiresAt * 1000),
    };
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    const segments = token.split(".");
    const [header, payload, signature] = segments;
    if (segments.length !== 3) throw new UnauthenticatedError();
    if (header === undefined || payload === undefined || signature === undefined) {
      throw new UnauthenticatedError();
    }

    // The signature is recomputed with HS256 unconditionally — the header's `alg` is never
    // used to choose an algorithm. That is what makes `"alg": "none"` and the HS256/RS256
    // confusion attacks inert here: an unsigned or differently signed token simply fails
    // this comparison.
    if (!constantTimeEquals(signature, this.signature(`${header}.${payload}`))) {
      throw new UnauthenticatedError();
    }

    const headerFields = accessTokenHeaderSchema.safeParse(decodeSegment(header));
    if (!headerFields.success) throw new UnauthenticatedError();

    const claims = accessTokenClaimsSchema.safeParse(decodeSegment(payload));
    if (!claims.success) throw new UnauthenticatedError();

    if (claims.data.exp <= Math.floor(this.now().getTime() / 1000)) {
      throw new UnauthenticatedError();
    }

    return claims.data;
  }

  /**
   * A token that has already been spent. Inside the grace window this is the client's own
   * concurrent retry and gets a sibling; outside it, it is a replay and the family dies.
   */
  private async rotateAlreadyRotated(
    presented: RefreshTokenRecord,
    now: Date,
  ): Promise<IssuedSession> {
    const successor = await this.liveSuccessor(presented, now);
    if (successor !== null) {
      // The sibling inherits the successor's expiry rather than a fresh full lifetime, so a
      // replay inside the window cannot outlive the session it is standing in for.
      return this.mint(
        presented.userId,
        presented.familyId,
        presented.familyStartedAt,
        successor.expiresAt,
      );
    }

    // Deliberately logs the family and never the token or its hash: this line is the
    // audit trail for a suspected theft, not a place to write credential material.
    this.logger.warn(`Refresh token reuse detected. Revoking family ${presented.familyId}.`);
    await this.store.revokeFamily(presented.familyId, now);
    throw new InvalidRefreshTokenError();
  }

  /**
   * The token that replaced this one, if the grace window still applies — otherwise null.
   *
   * Returns the record rather than a boolean because the caller needs its expiry: a grace
   * sibling is capped at the successor's lifetime, not given a fresh one.
   */
  private async liveSuccessor(
    predecessor: RefreshTokenRecord,
    now: Date,
  ): Promise<RefreshTokenRecord | null> {
    const rotatedAt = predecessor.revokedAt;
    if (rotatedAt === null) return null;
    if (now.getTime() - rotatedAt.getTime() > this.options.rotationGraceSeconds * 1000) {
      return null;
    }
    if (predecessor.replacedById === null) return null;

    const successor = await this.store.findById(predecessor.replacedById);
    if (successor === null) return null;

    // Grace covers exactly one step back, and only while the token that replaced this one
    // is still usable. If the successor has been revoked the family is dead, and if it has
    // itself been rotated the client has moved on — either way a second presentation of
    // this token is a replay, not a retry.
    const stillUsable =
      successor.revokedAt === null && successor.expiresAt.getTime() > now.getTime();

    return stillUsable ? successor : null;
  }

  /**
   * Persist a brand-new token in `familyId` — a first sign-in, or a grace-window sibling.
   *
   * `expiresAtCeiling` bounds the sibling minted on the grace path. Without it a replay
   * inside the window is *rewarded*: the presenter receives a token with a full fresh
   * lifetime and its own rotation chain, never linked back to the token it replayed. Both
   * parties then rotate independently, reuse detection never fires again, and a stolen
   * credential becomes a permanent parallel session. A grace sibling must be no stronger
   * than the token it stands in for, so it inherits the successor's expiry.
   */
  private async mint(
    userId: string,
    familyId: string,
    familyStartedAt: Date,
    expiresAtCeiling?: Date,
  ): Promise<IssuedSession> {
    const minted = this.newRefreshToken(
      userId,
      familyId,
      this.now(),
      familyStartedAt,
      expiresAtCeiling,
    );
    const record = await this.store.create(minted.input);
    return this.toSession(record, minted.plaintext);
  }

  private newRefreshToken(
    userId: string,
    familyId: string,
    now: Date,
    familyStartedAt: Date,
    expiresAtCeiling?: Date,
  ): { plaintext: string; input: NewRefreshToken } {
    const plaintext = randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");

    // Three bounds, and the earliest wins:
    //   the idle timeout   — how long this token may sit unused
    //   the absolute cap   — how long the sign-in itself may live, however often it rotates
    //   the grace ceiling  — a replay sibling may not outlive the token it stands in for
    const candidates = [
      new Date(now.getTime() + this.options.refreshTokenTtlSeconds * 1000),
      new Date(familyStartedAt.getTime() + this.options.absoluteSessionMaxSeconds * 1000),
    ];
    if (expiresAtCeiling !== undefined) candidates.push(expiresAtCeiling);

    const expiresAt = candidates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));

    return {
      plaintext,
      input: {
        userId,
        familyId,
        tokenHash: hashRefreshToken(plaintext),
        expiresAt,
        familyStartedAt,
      },
    };
  }

  private toSession(record: RefreshTokenRecord, refreshToken: string): IssuedSession {
    const access = this.signAccessToken(record.userId);

    return {
      userId: record.userId,
      familyId: record.familyId,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken,
      refreshTokenExpiresAt: record.expiresAt,
    };
  }

  private signature(signingInput: string): string {
    return createHmac("sha256", this.options.accessTokenSecret)
      .update(signingInput, "utf8")
      .digest("base64url");
  }

  private now(): Date {
    return new Date();
  }
}

export { InvalidRefreshTokenError, RefreshTokenAlreadyRotatedError };

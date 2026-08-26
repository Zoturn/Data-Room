import { createHash, randomBytes } from "node:crypto";

/**
 * 256 bits, the same width as a refresh token. A share link is a bearer credential with no
 * second factor and no session behind it, so its only defence is that guessing one is not
 * worth attempting: at this width an attacker who could try a billion tokens a second would
 * still be at it long after the company being diligenced has been sold.
 */
export const SHARE_TOKEN_BYTES = 32;

/** 32 bytes of base64url. Fixed by the encoding, so it doubles as a cheap shape check. */
const SHARE_TOKEN_LENGTH = 43;

const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

/**
 * A fresh share token.
 *
 * `randomBytes` and not `Math.random`, `randomUUID` or anything derived from the node being
 * shared: a token that can be computed from something the recipient already knows is not a
 * secret. base64url because this value travels in a path segment — a `+` or a `/` from plain
 * base64 would have to survive being copied out of a chat message and pasted into a browser,
 * and one of them would not.
 *
 * The plaintext returned here is the only copy that will ever exist. It is handed to the
 * owner once, at creation, and the database keeps nothing but its hash.
 */
export function generateShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
}

/**
 * The stored form.
 *
 * SHA-256 rather than Argon2id, for the reason `hashRefreshToken` gives: this is 256 uniform
 * random bits, so there is no low-entropy guess to slow down, and a work factor would only
 * add latency to every anonymous page view of a shared folder. What matters is that a dumped
 * `shares` table yields no working links.
 *
 * Deterministic, so a presented token is resolved by a single indexed lookup on the hash
 * rather than by reading candidate rows and comparing them one by one.
 */
export function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Whether a string could be a token this generator produced.
 *
 * Not a security check — it decides nothing about access — but it lets the public surface
 * answer an obviously malformed token without a database round trip, and it keeps a probing
 * client from using response time to tell "no such token" apart from "not even a token".
 */
export function isShareTokenShaped(value: string): boolean {
  return value.length === SHARE_TOKEN_LENGTH && SHARE_TOKEN_PATTERN.test(value);
}

/**
 * The link an owner copies. Points at the web app rather than the API, because what the
 * recipient needs is a page, not JSON.
 *
 * `WEB_APP_URL` already has any trailing slash stripped by the env schema, so joining with a
 * single `/` here cannot produce `//shared/…` — a doubled slash would still route, but it is
 * the sort of thing that ends up in a screenshot in a data room.
 */
export function shareUrlFor(webAppUrl: string, token: string): string {
  return `${webAppUrl}/shared/${token}`;
}

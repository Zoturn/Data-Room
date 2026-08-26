import { DomainError } from "../common/errors/domain-error";

/**
 * The one 401 a caller ever sees. Every authentication failure collapses to this: no session,
 * an expired token, a forged token, a replayed refresh token. The uniformity is the point —
 * a caller learns that they are not signed in and nothing else, so a rejected request cannot
 * be used to probe which of those things went wrong.
 */
export class UnauthenticatedError extends DomainError {
  readonly code = "UNAUTHENTICATED" as const;
  readonly status = 401;

  constructor(message = "Sign in to continue.") {
    super(message);
  }
}

/**
 * A refresh token that is unknown, expired, revoked, or replayed. Distinct from
 * `UnauthenticatedError` only in wording: the refresh endpoint is reached by a client that
 * believed it had a session, so "expired" is the honest and more useful phrasing.
 */
export class InvalidRefreshTokenError extends UnauthenticatedError {
  constructor() {
    super("Your session has expired. Please sign in again.");
  }
}

/**
 * Internal signal, never surfaced: a token whose successor already exists has been presented
 * a second time. Outside the rotation grace window that is the classic stolen-token
 * indicator, and the caller is told only that they are not signed in.
 */
export class RefreshTokenAlreadyRotatedError extends Error {
  constructor() {
    super("This refresh token has already been rotated");
    this.name = "RefreshTokenAlreadyRotatedError";
  }
}

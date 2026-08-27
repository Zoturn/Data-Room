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

/**
 * Sign-in refused. The *only* error the login path raises, whatever went wrong: no account
 * with that address, or the wrong password. One message for both, because a distinct "no
 * account with that email" turns the endpoint into a directory of who is registered — see
 * apps/api/.claude/rules/auth-and-guards.md rule 4. `AuthService.login` keeps the *timing*
 * uniform as well; the wording alone is not enough.
 */
export class InvalidCredentialsError extends DomainError {
  readonly code = "INVALID_CREDENTIALS" as const;
  readonly status = 401;

  constructor() {
    super("That email address and password do not match an account.");
  }
}

/**
 * The address is already registered.
 *
 * This does disclose that an account exists, which the uniform 401 above is careful not to.
 * The disclosure is unavoidable: a registration form that accepted a taken address would
 * either create a duplicate or silently do nothing. Sign-in is where enumeration actually
 * pays off, and sign-in gives nothing away — registration is additionally rate limited so
 * the address space cannot be walked.
 */
export class EmailAlreadyRegisteredError extends DomainError {
  readonly code = "EMAIL_ALREADY_REGISTERED" as const;
  readonly status = 409;

  constructor(message = "An account with that email address already exists.") {
    super(message);
  }
}

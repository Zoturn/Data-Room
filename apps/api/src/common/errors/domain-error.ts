import type { ApiErrorCode, FieldError } from "@data-room/shared";

/**
 * Base for every failure a service can raise. Services throw these, never HttpException —
 * transport belongs to the filter. See apps/api/.claude/rules/errors-and-validation.md.
 */
export abstract class DomainError extends Error {
  abstract readonly code: ApiErrorCode;
  abstract readonly status: number;
  readonly details?: FieldError[];

  protected constructor(message: string, details?: FieldError[]) {
    super(message);
    this.name = new.target.name;
    if (details) this.details = details;
  }
}

/**
 * Used for anything the caller may not see, as well as anything that genuinely does not
 * exist. Never 403: a distinct forbidden response confirms that a resource is there.
 */
export class NotFoundError extends DomainError {
  readonly code = "NOT_FOUND" as const;
  readonly status = 404;

  constructor(message = "Not found") {
    super(message);
  }
}

export class ValidationFailedError extends DomainError {
  readonly code = "VALIDATION_FAILED" as const;
  readonly status = 400;

  constructor(message: string, details?: FieldError[]) {
    super(message, details);
  }
}

export class NameConflictError extends DomainError {
  readonly code = "NAME_CONFLICT" as const;
  readonly status = 409;

  constructor(name: string) {
    super(`An item named "${name}" already exists in this folder`);
  }
}

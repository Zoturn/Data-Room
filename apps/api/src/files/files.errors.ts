import { DomainError } from "../common/errors/domain-error";

/**
 * This module's own failures. They live beside the module that raises them rather than in
 * `common/errors`, which holds only what more than one module needs — see
 * errors-and-validation.md rule 3.
 */

/**
 * The stored object is not a PDF, whatever the client declared. Raised at commit, from the
 * bytes themselves, and never from a content type or an extension.
 *
 * 400 rather than 415: the request body is empty — the media under discussion is in storage,
 * not in this request — so the rejection is about what was uploaded, not about how the caller
 * framed the call.
 */
export class UnsupportedFileTypeError extends DomainError {
  readonly code = "UNSUPPORTED_FILE_TYPE" as const;
  readonly status = 400;

  constructor(message = "Only PDF files can be stored in a Data Room.") {
    super(message);
  }
}

/** The limit is stated in the message: "too large" without a number is not actionable. */
export class FileTooLargeError extends DomainError {
  readonly code = "FILE_TOO_LARGE" as const;
  readonly status = 413;

  constructor(limitBytes: number) {
    super(`Files must be ${Math.floor(limitBytes / (1024 * 1024))} MB or smaller.`);
  }
}

/**
 * The reservation is past its window, or the bytes never arrived. 410 rather than 404: the
 * distinction the client acts on is "this upload is over, start a new one", and a 404 would
 * be indistinguishable from a file id that was never real.
 */
export class UploadExpiredError extends DomainError {
  readonly code = "UPLOAD_EXPIRED" as const;
  readonly status = 410;

  constructor(message = "This upload has expired. Please try uploading the file again.") {
    super(message);
  }
}

/**
 * The destination cannot hold the node. Reserved for a target the caller *can* see and that
 * is genuinely the wrong kind of thing — a target in someone else's Data Room is 404, because
 * a distinct answer would confirm it exists.
 */
export class InvalidMoveTargetError extends DomainError {
  readonly code = "INVALID_MOVE_TARGET" as const;
  readonly status = 400;

  constructor(message: string) {
    super(message);
  }
}

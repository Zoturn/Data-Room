import { ApiError, NetworkError } from "@/lib/api/errors";

/**
 * Why a transfer to storage ended. The browser tells us almost nothing about a failed
 * cross-origin PUT — there is no body to read and no code to branch on — so the kind is
 * inferred from which XHR event fired and, when there is one, the status.
 */
export type UploadFailureKind =
  | "network"
  | "timeout"
  /** The signed URL is past its expiry, or storage refused the request outright. */
  | "expired"
  | "rejected"
  | "server";

/** A PUT to the signed URL that did not end in a 2xx. */
export class UploadTransportError extends Error {
  readonly kind: UploadFailureKind;
  /** `null` when the request never produced a response at all. */
  readonly status: number | null;

  constructor(kind: UploadFailureKind, status: number | null, message: string) {
    super(message);
    this.name = "UploadTransportError";
    this.kind = kind;
    this.status = status;
  }
}

/** The user cancelled, or the queue tore the transfer down. Never reported as a failure. */
export class UploadAbortedError extends Error {
  constructor() {
    super("Upload cancelled.");
    this.name = "UploadAbortedError";
  }
}

/**
 * Storage answers an expired signed URL with a plain 400 and answers a signature it will
 * not honour with a 403, and neither carries anything machine-readable. Both mean the same
 * thing to us: this reservation is spent, take a fresh one.
 */
export function kindForStatus(status: number): UploadFailureKind {
  if (status === 400 || status === 401 || status === 403) return "expired";
  if (status >= 500) return "server";
  return "rejected";
}

export type UploadFailure = {
  /** Written for the person watching the row, so it never contains a status or a code. */
  message: string;
  retryable: boolean;
  /** The queue takes one fresh reservation on its own before it reports an expiry. */
  expired: boolean;
};

/**
 * Turns anything a step of the pipeline can throw into the row's one line of text. The
 * queue depends on this rather than on error classes so that "what the user reads" stays
 * one decision in one place, and so the queue itself needs no knowledge of the API client.
 */
export function describeUploadFailure(error: unknown): UploadFailure {
  if (error instanceof UploadAbortedError) {
    return { message: "Upload cancelled.", retryable: true, expired: false };
  }

  if (error instanceof UploadTransportError) {
    switch (error.kind) {
      case "expired":
        return {
          message: "The upload link expired before the file finished. Retrying starts a fresh one.",
          retryable: true,
          expired: true,
        };
      case "network":
        return {
          message: "The connection dropped while sending this file.",
          retryable: true,
          expired: false,
        };
      case "timeout":
        return { message: "Sending this file timed out.", retryable: true, expired: false };
      case "server":
        return {
          message: "Storage could not accept this file just now.",
          retryable: true,
          expired: false,
        };
      case "rejected":
        return { message: "Storage refused this file.", retryable: false, expired: false };
    }
  }

  // The API's own refusals already carry a sentence written for a human — a name conflict,
  // a size limit, a file that is not really a PDF. Repeating it verbatim is the honest answer.
  if (error instanceof ApiError) {
    return {
      message: error.message,
      retryable: error.isRetryable || error.code === "UPLOAD_EXPIRED",
      expired: error.code === "UPLOAD_EXPIRED",
    };
  }

  if (error instanceof NetworkError) {
    return { message: error.message, retryable: true, expired: false };
  }

  return { message: "Something went wrong sending this file.", retryable: true, expired: false };
}

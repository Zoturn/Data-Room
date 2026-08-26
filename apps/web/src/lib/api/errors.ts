import { isApiErrorBody, type ApiErrorCode, type FieldError } from "@data-room/shared";

/**
 * A failure from the API, carrying the envelope's machine-readable code. Components branch
 * on `code` — never on `message`, which is written for humans and will change.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: FieldError[];
  readonly requestId: string;

  constructor(init: {
    code: ApiErrorCode;
    message: string;
    status: number;
    details?: FieldError[];
    requestId: string;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.code = init.code;
    this.status = init.status;
    this.details = init.details ?? [];
    this.requestId = init.requestId;
  }

  /** True when retrying the same request could plausibly succeed. */
  get isRetryable(): boolean {
    return this.status >= 500 || this.code === "RATE_LIMITED";
  }
}

/**
 * A failure that never reached the API — offline, DNS, CORS, a dead server. Distinguished
 * from an ApiError so the interface can say "could not reach the server" rather than
 * inventing a code.
 */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super("Could not reach the server. Check your connection and try again.");
    this.name = "NetworkError";
    this.cause = cause;
  }
}

/**
 * The API answered successfully with a body this client does not recognise. Distinct from
 * an ApiError because it is our bug, not the user's — the contract in packages/shared and
 * one of the two sides have drifted apart.
 */
export class ContractError extends Error {
  constructor(
    readonly path: string,
    cause?: unknown,
  ) {
    super(`The server's response for ${path} did not match what this app expects.`);
    this.name = "ContractError";
    this.cause = cause;
  }
}

/** Turns a non-2xx response into a typed error, falling back when the body is not an envelope. */
export async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  if (isApiErrorBody(body)) {
    const error: ConstructorParameters<typeof ApiError>[0] = {
      code: body.code,
      message: body.message,
      status: response.status,
      requestId: body.requestId,
    };
    if (body.details) error.details = body.details;
    return new ApiError(error);
  }

  // A response that is not an envelope means something in front of the API answered —
  // a proxy, a platform error page. Say so honestly rather than guessing a code.
  return new ApiError({
    code: "INTERNAL_ERROR",
    message: "The server returned an unexpected response.",
    status: response.status,
    requestId: response.headers.get("x-request-id") ?? "unknown",
  });
}

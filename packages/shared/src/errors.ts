import { z } from "zod";

/**
 * Every failure the API can return. The client switches on these, never on a message,
 * so a code must exist here before anything throws it.
 */
export const apiErrorCodeSchema = z.enum([
  // platform
  "VALIDATION_FAILED",
  "INTERNAL_ERROR",
  "RATE_LIMITED",
  "NOT_FOUND",

  // authentication
  "INVALID_CREDENTIALS",
  "UNAUTHENTICATED",
  "EMAIL_ALREADY_REGISTERED",

  // tree
  "NAME_CONFLICT",
  "MAX_DEPTH_EXCEEDED",
  "INVALID_MOVE_TARGET",

  // files
  "UNSUPPORTED_FILE_TYPE",
  "FILE_TOO_LARGE",
  "UPLOAD_EXPIRED",
]);

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

/** One invalid field, so a form can show the message on the input it belongs to. */
export const fieldErrorSchema = z.object({
  field: z.string().min(1),
  message: z.string().min(1),
});

export type FieldError = z.infer<typeof fieldErrorSchema>;

/**
 * The single shape of every non-2xx response. `requestId` correlates a user-visible
 * failure with the server log; it is the only internal detail a client ever receives.
 */
export const apiErrorSchema = z.object({
  code: apiErrorCodeSchema,
  message: z.string().min(1),
  details: z.array(fieldErrorSchema).optional(),
  requestId: z.string().min(1),
});

export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

/** Narrow an unknown response body to the error envelope. */
export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return apiErrorSchema.safeParse(value).success;
}

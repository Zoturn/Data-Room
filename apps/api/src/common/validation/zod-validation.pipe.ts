import { Injectable, PipeTransform } from "@nestjs/common";
import type { FieldError } from "@data-room/shared";
import { ZodError, type ZodSchema } from "zod";
import { ValidationFailedError } from "../errors/domain-error";

/**
 * Validates a body, query or param against a schema from packages/shared, so the API and
 * the web app enforce the same rules from one declaration.
 *
 * Field issues become `details` entries, which the client renders on the matching input —
 * a validation failure must never surface only as a toast.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ValidationFailedError("Some fields need attention", toFieldErrors(error));
      }
      throw error;
    }
  }
}

export function toFieldErrors(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "(root)",
    message: issue.message,
  }));
}

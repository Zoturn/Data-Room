import type { ZodSchema } from "zod";
import { ValidationFailedError } from "../errors/domain-error";

/**
 * Cursors are opaque to clients: they follow `nextCursor` and never build one. Encoding is
 * base64url over JSON so the payload can grow (the folder listing sorts on a tuple) without
 * changing the contract.
 */
export function encodeCursor(payload: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/**
 * Decodes and validates a cursor against the shape the caller expects.
 *
 * The schema is required rather than optional: a cursor arrives in a URL, so it is
 * attacker-controlled, and returning an unvalidated shape would push a cast onto every
 * call site. A malformed or tampered cursor is the client's mistake, so it becomes a 400
 * rather than a 500.
 */
export function decodeCursor<T>(cursor: string, schema: ZodSchema<T>): T {
  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw malformed();
  }

  const result = schema.safeParse(parsed);
  if (!result.success) throw malformed();

  return result.data;
}

function malformed(): ValidationFailedError {
  return new ValidationFailedError("That page link is not valid", [
    { field: "cursor", message: "Malformed cursor" },
  ]);
}

import { NODE_NAME_MAX_LENGTH } from "@data-room/shared";
import { ApiError, NetworkError } from "@/lib/api/errors";

/**
 * Where a rejected name has to be rendered. A name that is wrong belongs on the field the
 * user typed it into — a toast leaves them looking at a form that silently refused them.
 */
export type NameFailure = {
  readonly placement: "field" | "form";
  readonly message: string;
};

/**
 * Client-side validation, for speed of feedback only. The bound comes from the shared
 * schema so this sentence cannot drift from the rule the API enforces; the API validates
 * the same input again and whatever it rejects is rendered by `nameFailureFrom`.
 */
export function validateNodeName(name: string): string | null {
  if (name.length === 0) return "Enter a name.";
  if (name.length > NODE_NAME_MAX_LENGTH) {
    return `Use at most ${NODE_NAME_MAX_LENGTH} characters.`;
  }
  return null;
}

/**
 * Turns a rejected create or rename into one message in one place. Branching is on the
 * envelope's `code` — the message is written for humans and will be reworded, the code is
 * the contract.
 */
export function nameFailureFrom(error: unknown, attemptedName: string): NameFailure {
  if (error instanceof NetworkError) return { placement: "form", message: error.message };

  if (!(error instanceof ApiError)) {
    return { placement: "form", message: "Something went wrong. Please try again." };
  }

  switch (error.code) {
    case "NAME_CONFLICT":
      // Quoting the name is the whole point: the user is looking at a folder they cannot
      // see the conflict with, because the sibling may be on a later page.
      return {
        placement: "field",
        message: `“${attemptedName}” already exists here. Choose a different name.`,
      };

    case "VALIDATION_FAILED": {
      const onName = error.details.find((detail) => detail.field === "name");
      if (onName !== undefined) return { placement: "field", message: onName.message };
      return { placement: "form", message: error.message };
    }

    case "MAX_DEPTH_EXCEEDED":
      // The API's message names the limit, which is the only actionable part of it.
      return { placement: "form", message: error.message };

    case "NOT_FOUND":
      return {
        placement: "form",
        message: "This folder is no longer available. Refresh to see what changed.",
      };

    default:
      return { placement: "form", message: error.message };
  }
}

import { ZodError, type ZodIssue } from "zod";
import { ApiError, NetworkError } from "@/lib/api/errors";

/** One message per input, keyed by the field name the shared schema uses. */
export type FieldErrorMap = Readonly<Record<string, string>>;

/**
 * The outcome of a rejected submit, split the way it has to be rendered: `fields` land on
 * the inputs they belong to, and `formError` sits above the form. A validation failure that
 * only produced a `formError` still tells the user something; one that produced neither
 * would leave them staring at a form that silently refused them.
 */
export type SubmitFailure = {
  readonly fields: FieldErrorMap;
  readonly formError: string | null;
};

/** Where a signed-in visitor lands when no destination was preserved. */
export const DEFAULT_DESTINATION = "/";

const GENERIC_FAILURE = "Something went wrong. Please try again.";

/**
 * Copy for a missing value, per field. The schemas in `packages/shared` are the source of
 * truth for what is *valid*; this maps their machine-readable issues onto sentences a
 * person can act on, which is presentation, not a second set of rules.
 */
const REQUIRED_MESSAGES: Record<string, string> = {
  email: "Enter your email address.",
  password: "Enter your password.",
  displayName: "Enter a display name.",
};

function messageForIssue(field: string, issue: ZodIssue): string {
  if (issue.code === "too_small") {
    // The bound comes from the shared schema, so this sentence cannot drift from the rule.
    const minimum = Number(issue.minimum);
    if (minimum <= 1) return REQUIRED_MESSAGES[field] ?? issue.message;
    return `Use at least ${minimum} characters.`;
  }

  if (issue.code === "too_big") return `Use at most ${Number(issue.maximum)} characters.`;

  if (issue.code === "invalid_string" && issue.validation === "email") {
    return "Enter a valid email address.";
  }

  return issue.message;
}

/**
 * Turns a client-side parse failure into per-field messages. The first issue on a field
 * wins: "too short" and "must contain a letter" at once is noise, and the user fixes them
 * one at a time anyway.
 */
export function zodFieldErrors(error: ZodError): FieldErrorMap {
  const fields: Record<string, string> = {};

  for (const issue of error.issues) {
    const [head] = issue.path;
    if (typeof head !== "string" || head in fields) continue;
    fields[head] = messageForIssue(head, issue);
  }

  return fields;
}

function fromValidationEnvelope(error: ApiError, knownFields: readonly string[]): SubmitFailure {
  const fields: Record<string, string> = {};
  const unplaced: string[] = [];

  for (const detail of error.details) {
    if (!knownFields.includes(detail.field)) {
      // A field this form does not render still has to be said out loud, or the request
      // looks like it failed for no reason.
      unplaced.push(detail.message);
      continue;
    }
    if (detail.field in fields) continue;
    fields[detail.field] = detail.message;
  }

  if (unplaced.length > 0) return { fields, formError: unplaced.join(" ") };
  if (Object.keys(fields).length > 0) return { fields, formError: null };
  return { fields, formError: error.message };
}

/**
 * Maps whatever a submit threw onto the two places a form can show it. Branching is on the
 * envelope's `code`, never on its message — the message is written for humans and will be
 * reworded; the code is the contract.
 */
export function submitFailureFrom(error: unknown, knownFields: readonly string[]): SubmitFailure {
  if (error instanceof ZodError) return { fields: zodFieldErrors(error), formError: null };
  if (error instanceof NetworkError) return { fields: {}, formError: error.message };

  if (!(error instanceof ApiError)) return { fields: {}, formError: GENERIC_FAILURE };

  switch (error.code) {
    case "VALIDATION_FAILED":
      return fromValidationEnvelope(error, knownFields);

    case "EMAIL_ALREADY_REGISTERED":
      return { fields: { email: error.message }, formError: null };

    case "INVALID_CREDENTIALS":
      // The API answers identically for an unknown address, a wrong password and a
      // Google-only account, so that a stranger cannot use this form to discover who has
      // an account. The message must stay just as uninformative — and pointing at Google
      // is what rescues the one honest user this uniformity inconveniences.
      return {
        fields: {},
        formError: `${error.message} If you signed up with Google, continue with Google instead.`,
      };

    case "RATE_LIMITED":
      return { fields: {}, formError: "Too many attempts. Wait a moment and try again." };

    case "UNAUTHENTICATED":
      return { fields: {}, formError: "That session has ended. Please sign in again." };

    default:
      return { fields: {}, formError: error.message };
  }
}

/**
 * Guards the `?next=` destination. Without this the sign-in screen is an open redirect: a
 * link to `/sign-in?next=https://evil.example` would hand a freshly authenticated user to
 * an attacker's page, which is a credible phishing step because the sign-in itself was
 * genuine. Only a path on this origin is honoured — `//host` and `/\host` are
 * protocol-relative and resolve off-site, so they are refused too.
 */
export function safeRedirectPath(
  value: string | null | undefined,
  fallback: string = DEFAULT_DESTINATION,
): string {
  if (typeof value !== "string" || !value.startsWith("/")) return fallback;

  const second = value[1];
  if (second === "/" || second === "\\") return fallback;

  return value;
}

/** Carries the preserved destination across the link between the two auth screens. */
export function authScreenHref(path: string, destination: string): string {
  if (destination === DEFAULT_DESTINATION) return path;
  return `${path}?next=${encodeURIComponent(destination)}`;
}

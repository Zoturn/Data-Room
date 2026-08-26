/**
 * The share dialog's arithmetic: turning what someone typed into what the API accepts.
 *
 * Pure on purpose. Parsing a pasted list of addresses and deciding what "7 days" means are
 * both decisions worth testing against examples, and neither needs a rendered dialog to have
 * them.
 */

/** How long a link lasts, as the dialog offers it. `null` is "until revoked". */
export type ExpiryChoice = "1d" | "7d" | "30d" | "never";

const EXPIRY_DAYS: Record<Exclude<ExpiryChoice, "never">, number> = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
};

/**
 * The API takes an absolute instant rather than a duration, because a share outlives the
 * request that made it and "7 days" from a clock the server does not share is not a time.
 */
export function expiryInstant(choice: ExpiryChoice, now: Date): string | null {
  if (choice === "never") return null;

  const at = new Date(now.getTime() + EXPIRY_DAYS[choice] * 24 * 60 * 60 * 1000);

  return at.toISOString();
}

export type ParsedEmails = {
  /** Unique, lower-cased, in the order first seen. */
  valid: string[];
  /** Everything that did not look like an address, exactly as typed, for the error message. */
  invalid: string[];
};

/**
 * Addresses arrive pasted from a spreadsheet or an email client, so commas, semicolons,
 * newlines and stray spaces all separate them. Splitting on all of those is the difference
 * between inviting a deal room and retyping twelve addresses one at a time.
 *
 * Validation here is deliberately shallow — it catches the typo, and the API validates
 * properly. A frontend that tries to be the authority on what an address may contain rejects
 * real ones.
 */
export function parseEmails(input: string): ParsedEmails {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const raw of input.split(/[\s,;]+/)) {
    const candidate = raw.trim();
    if (candidate === "") continue;

    // Normalised the same way the API normalises, so the dialog's idea of "already added"
    // matches the one the unique index enforces.
    const normalised = candidate.toLowerCase();

    if (!/^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(normalised)) {
      invalid.push(candidate);
      continue;
    }

    if (seen.has(normalised)) continue;

    seen.add(normalised);
    valid.push(normalised);
  }

  return { valid, invalid };
}

/** Whether a share is still usable, from what the list response already carries. */
export function isShareActive(
  share: { revokedAt: string | null; expiresAt: string | null },
  now: Date,
): boolean {
  if (share.revokedAt !== null) return false;
  if (share.expiresAt === null) return true;

  return Date.parse(share.expiresAt) > now.getTime();
}

/**
 * What the row says about a share, in the order that matters: revoked is a decision someone
 * took and outranks an expiry that happened to pass on its own.
 */
export function describeShareState(
  share: { revokedAt: string | null; expiresAt: string | null },
  now: Date,
): string {
  if (share.revokedAt !== null) return "Revoked";
  if (share.expiresAt === null) return "Active until revoked";

  const expiresAt = Date.parse(share.expiresAt);

  if (expiresAt <= now.getTime()) return "Expired";

  const days = Math.ceil((expiresAt - now.getTime()) / (24 * 60 * 60 * 1000));

  return days === 1 ? "Expires in a day" : `Expires in ${days} days`;
}

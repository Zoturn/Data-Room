import { z } from "zod";

/**
 * The one definition of "the same address". Auth, account linking and — later — share
 * grants all compare emails through this, so `Owner@Acme.com ` and `owner@acme.com`
 * can never resolve to two different people or two different grants.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Longest address RFC 5321 permits, so a hostile client cannot push unbounded input into a unique index. */
const EMAIL_MAX_LENGTH = 254;

export const PASSWORD_MIN_LENGTH = 8;

/**
 * Argon2id cost is paid per character of input, so an unbounded password is a cheap way
 * to make the server do expensive work. The ceiling is far above any real passphrase.
 */
export const PASSWORD_MAX_LENGTH = 256;

/** Normalised first, validated second — the stored value is the value that was checked. */
const emailSchema = z
  .string()
  .transform(normalizeEmail)
  .pipe(z.string().min(1).max(EMAIL_MAX_LENGTH).email());

export const registerInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  displayName: z.string().trim().min(1).max(100).optional(),
});

export type RegisterInput = z.infer<typeof registerInputSchema>;

/**
 * Login deliberately does not check email *shape*. A malformed address must fail the same
 * way an unknown one does — 401 INVALID_CREDENTIALS — rather than a 400 that tells an
 * attacker their probe was rejected before any lookup happened.
 */
export const loginInputSchema = z.object({
  email: z.string().transform(normalizeEmail).pipe(z.string().min(1).max(EMAIL_MAX_LENGTH)),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginInputSchema>;

/**
 * The caller, as the browser is allowed to see them. `.strict()` is the security control:
 * credential material — a password digest, a token — cannot ride along on a response by
 * accident, because an extra key fails the parse instead of being quietly stripped.
 */
export const sessionUserSchema = z
  .object({
    id: z.string().min(1),
    email: z.string().min(1),
    displayName: z.string().min(1),
    /** That a credential exists, never the credential. Every account has one today. */
    hasPassword: z.boolean(),
  })
  .strict();

export type SessionUser = z.infer<typeof sessionUserSchema>;

import { z } from "zod";

/** An Origin header never carries a trailing slash, so neither should a configured origin. */
function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Every environment variable the API reads. Nothing outside this file may touch
 * `process.env` — that is what keeps .env.example complete and boot-time validation honest.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),

  /** Pooled connection used by the running service. */
  DATABASE_URL: z.string().url(),
  /** Direct connection; Prisma migrations need a session, which a pooler cannot give. */
  DIRECT_URL: z.string().url(),

  /** Where the browser app runs. OAuth redirects land back here. */
  WEB_APP_URL: z.string().url().transform(stripTrailingSlash),

  /**
   * Comma-separated origins allowed to send credentialed requests.
   *
   * Trailing slashes are stripped because a browser's `Origin` header never has one, so
   * `https://app.example.com/` silently matches nothing. The failure is opaque — the
   * preflight returns 204 with no `Access-Control-Allow-Origin`, and the app looks broken
   * rather than misconfigured — so it is worth normalising rather than documenting.
   */
  CORS_ORIGINS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(",")
        .map((origin) => stripTrailingSlash(origin.trim()))
        .filter(Boolean),
    ),

  /**
   * HMAC key for the access token. At least 32 characters — a short key is brute-forceable,
   * and a forgeable access token is a forgeable identity for every account.
   */
  JWT_ACCESS_SECRET: z.string().min(32),

  /**
   * Token lifetimes. Short for the access token, because nothing can revoke one before it
   * expires; long for the refresh token, which is revocable and rotates on every use.
   *
   * These live here rather than as constants so the cookie's `maxAge` and the token's `exp`
   * are derived from one value. Two constants in two files drift, and the symptom is a
   * cookie the browser has already discarded holding a token the server still considers
   * valid — or the reverse.
   */
  ACCESS_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(7 * 24 * 60 * 60),

  /**
   * How long a just-rotated refresh token keeps working. A client firing several requests at
   * once refreshes more than once; without this window the second attempt looks exactly like
   * a stolen-token replay and the session revokes itself.
   */
  REFRESH_ROTATION_GRACE_SECONDS: z.coerce.number().int().nonnegative().default(10),

  /**
   * The longest a single sign-in may live, however diligently it is rotated.
   *
   * REFRESH_TOKEN_TTL_SECONDS is an *idle* timeout — every rotation pushes it forward — so on
   * its own a session used weekly never ends, and neither does a stolen refresh token being
   * rotated weekly by someone else. This is the bound that eventually forces a real sign-in.
   */
  ABSOLUTE_SESSION_MAX_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(30 * 24 * 60 * 60),

  /**
   * Cookie policy is configuration, not code. Production is cross-site
   * (Vercel calling the API host) and needs SameSite=None, which browsers only
   * accept with Secure, which needs HTTPS. Locally the pair differs only by port —
   * not a different site — so Lax without Secure works over plain HTTP.
   */
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),

  /** The Supabase project the storage bucket lives in, e.g. https://abcdef.supabase.co. */
  SUPABASE_URL: z.string().url().transform(stripTrailingSlash),

  /**
   * The service-role key. It bypasses row-level security and can mint a signed URL for any
   * object in the project, so it is the one value in this file that must never reach a
   * browser — it is read here and nowhere else, and there is deliberately no NEXT_PUBLIC_
   * twin of it (env-and-secrets.md rule 4).
   */
  SUPABASE_SECRET_KEY: z.string().min(1),

  /** Private bucket holding every uploaded PDF. Objects are only ever reached by signed URL. */
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default("data-room-files"),

  /**
   * How long a signed upload URL lives. Long enough for a 50 MB file on a slow link, short
   * enough that a URL leaked from a log or a shared screen is worthless within minutes. The
   * client takes a fresh reservation automatically when one expires mid-transfer.
   */
  UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  /**
   * The same trade for downloads. The viewer re-requests one rather than holding it, which
   * is why this can be minutes rather than hours.
   */
  DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  /**
   * How long a `PENDING` node holds its name before the sweep reclaims it. Much longer than
   * the upload URL's life on purpose: it bounds an *abandoned* upload, and expiring it while
   * a legitimate retry is still using the name would hand that name to someone else.
   */
  UPLOAD_RESERVATION_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
});

/**
 * Cross-field checks the per-field schema cannot express.
 *
 * This is validation of configuration, not an `if (isProd)` branch — the values still come
 * from the environment, and this only refuses combinations that cannot be correct.
 */
export const validatedEnvSchema = envSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV !== "production") return;

  if (!env.COOKIE_SECURE) {
    // The defaults are the local ones, so a production deploy that simply omits this would
    // otherwise pass boot validation and issue session cookies without Secure. Hosts serve
    // plain HTTP and redirect to HTTPS; a non-Secure cookie is attached to that first
    // plaintext request, so the session token crosses the wire before the redirect fires.
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["COOKIE_SECURE"],
      message:
        "COOKIE_SECURE must be true in production; a session cookie without Secure can be sent over plain HTTP.",
    });
  }

  if (env.COOKIE_SAMESITE === "lax") {
    // Fails closed rather than open — the cross-site app simply stops working — but it is
    // still a misconfiguration, and a boot failure naming it beats debugging a login that
    // silently does not persist.
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["COOKIE_SAMESITE"],
      message:
        "COOKIE_SAMESITE must be 'none' in production; the frontend and API are different sites.",
    });
  }
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validate once, at boot. A malformed environment must stop the process before it
 * listens, so a broken deploy fails loudly instead of looking healthy until the
 * first request touches the missing value.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = validatedEnvSchema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Environment validation failed. The API will not start.\n${problems}\n\n` +
        `Copy apps/api/.env.example to apps/api/.env and fill in the values.`,
    );
  }

  return result.data;
}

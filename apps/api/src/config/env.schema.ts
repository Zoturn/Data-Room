import { z } from "zod";

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
  WEB_APP_URL: z.string().url(),

  /** Comma-separated origins allowed to send credentialed requests. */
  CORS_ORIGINS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

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
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validate once, at boot. A malformed environment must stop the process before it
 * listens, so a broken deploy fails loudly instead of looking healthy until the
 * first request touches the missing value.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);

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

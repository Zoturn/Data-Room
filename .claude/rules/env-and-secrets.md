---
paths:
  - "**/.env*"
  - "**/*.config.ts"
  - "apps/api/src/config/**/*.ts"
  - "apps/web/next.config.*"
---

# Environment and secrets

**Scope:** configuration values, how they are read, and what must never be committed or shipped to a browser.

## Rules

1. Every variable is declared in one zod schema per app and read only through the typed config service. `process.env.X` outside that schema is forbidden — it bypasses validation and hides the variable from `.env.example`.
2. The API validates its environment at boot and exits non-zero on a missing or malformed value. Failing at first request instead means a broken deploy looks healthy.
3. Adding a variable means adding it to the schema _and_ to `.env.example` with a non-secret placeholder, in the same commit.
4. `.env` files are never committed. Only `.env.example` is tracked.
5. Secrets never reach the browser. In `apps/web` only `NEXT_PUBLIC_`-prefixed values are readable client-side, and nothing prefixed that way may be a credential.
6. The Supabase **secret** key (`sb_secret_…`, formerly called the `service_role` key) is server-side only, in `apps/api`. It grants full bucket access and bypasses every access rule; treat it as a root credential. The **publishable** key is a different thing and is safe to expose — do not reach for it here by mistake.
7. Never log a secret, a token, a password, or a full signed URL. Log identifiers and outcomes.
8. Distinguish required from optional explicitly in the schema, and give optional values a default there rather than at each use site.
9. Rotate anything that reaches a log, a screenshot, an issue, or a chat message. Assume exposure is permanent.
10. Environment differences (cookie `Secure`, CORS origins, token TTLs) are values in the schema, not `if (isProd)` branches scattered through the code.

## Examples

```ts
// apps/api/src/config/env.schema.ts
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  SUPABASE_BUCKET: z.string().min(1),
  WEB_APP_URL: z.string().url(),
  CORS_ORIGINS: z.string().transform((s) => s.split(",")),
  COOKIE_SECURE: z.coerce.boolean().default(false),
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
});
```

```bash
# .env.example — placeholders only, never real values
DATABASE_URL=postgresql://user:password@host:5432/postgres
SUPABASE_SECRET_KEY=sb_secret_your-key-here
```

## Anti-patterns

- `process.env.SOMETHING ?? "fallback"` sprinkled through services.
- A secret in `NEXT_PUBLIC_*`.
- Committing `.env.local` "temporarily".
- Logging the whole request body on an auth endpoint.
- Reading configuration at module import time, before validation has run.

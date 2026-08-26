## Context

The platform foundation fixed the transport (httpOnly cookies, CORS allowlist, uniform error envelope) but has no notion of a person. Everything the product does is scoped to an owner: a Data Room is invisible until shared, permissioned shares name specific people by email, and revocation must be immediate. Two sign-in routes are in scope — email/password and Google — and the same human must end up as one account whichever they use.

The deployment shape matters here: the frontend is on Vercel and the API on a different host, so every session decision is a cross-site cookie decision.

## Goals / Non-Goals

**Goals:**
- One identity per email, reachable through either sign-in method.
- Sessions that survive a reload, refresh without the user noticing, and end immediately on sign-out.
- Endpoints protected by default, so a forgotten decorator fails closed.
- Credentials that are safe at rest and quiet under enumeration or brute-force probing.

**Non-Goals:**
- Email verification for password sign-up, password reset, and multi-factor. Real products need all three; none is graded here and each needs a mail provider.
- Organisations, teams, or roles beyond ownership — `add-sharing` handles access for other people.
- Sessions listing or device management.

## Decisions

### One `User`, two credential paths
`User` holds the normalised email; `passwordHash` and `googleId` are both nullable. Google sign-in matches on verified email and links to the existing row rather than creating a second account, because a user who signs up with a password and later clicks "Continue with Google" otherwise loses their entire Data Room.
*Alternative:* a separate `Account`/provider table (the NextAuth shape) — correct for many providers, unnecessary indirection for two, and the linking rule is the same either way.
*Risk accepted:* linking on email trusts Google's `email_verified`; unverified profiles are refused, which is what makes the trust safe.

### Argon2id over bcrypt
Memory-hard, resistant to GPU cracking, and the current OWASP recommendation. bcrypt's 72-byte input truncation is an additional footgun. Cost parameters are tuned to roughly 100ms on the deployment host.

### Access plus rotating refresh, both in cookies
A ~15-minute access token in a cookie readable by every API path, and a ~7-day refresh token in a cookie scoped to `/api/auth/refresh` so it is never sent with ordinary requests. Refresh tokens are stored hashed with a `familyId`; rotating one invalidates its predecessor, and presenting a rotated token revokes the family — the standard detection for a stolen token, worth the one extra table because this product's whole premise is confidential documents.
*Alternatives:* a single long-lived session cookie backed by a server session table (simple and revocable, but a database read on every request); a non-rotating refresh token (no theft detection at all).

`httpOnly` is unconditional. `Secure` and `SameSite`, however, cannot be: production is genuinely cross-site (Vercel calling the API host) and needs `SameSite=None`, which browsers accept only alongside `Secure`, which needs HTTPS — none of which exists on a developer's machine. Locally the frontend and API differ only by port, and port is not part of a *site*, so `SameSite=Lax` without `Secure` is both sufficient and correct. Both attributes therefore come from the env schema rather than an `isProd` branch, so the two environments differ in configuration and share one code path. If a browser ever refuses the local cookie anyway, the fallback is to proxy `/api/*` through the Next.js dev server and make the pair same-origin — never to relax the production policy.
*Alternatives:* running local HTTPS with a self-signed certificate (works, and costs every contributor a trust-store dance); dropping `httpOnly` locally (turns a debugging convenience into a habit that eventually ships).

### Access tokens are signed with `node:crypto`, not a JWT library

The access token is a compact-serialisation JWT signed HS256 directly with `node:crypto`, and
`@nestjs/jwt` is deliberately not a dependency.

This inverts the usual advice, so the reasoning matters. "Do not hand-roll JWT" exists because
two specific things go wrong: verifiers that read `alg` out of the header and use it to choose
an algorithm — which makes `"alg":"none"` and HS256/RS256 confusion trivial — and signature
comparison that leaks timing. Both are addressed explicitly here: the signature is recomputed
with HS256 unconditionally and the header's `alg` is never consulted to select anything, the
comparison is `timingSafeEqual`, and header and claims are validated through zod before use.

`jsonwebtoken`, which `@nestjs/jwt` wraps, is itself vulnerable to algorithm confusion unless
the caller remembers to pass `algorithms: ['HS256']`. A library does not remove the decision;
it only moves it somewhere easier to forget.

What we gain is one fewer dependency in the request path and a verifier whose security
properties are visible in the file. What we give up is a library's accumulated handling of
claim types we do not issue — `nbf`, audience, issuer, key rotation. If this ever needs
asymmetric keys, multiple audiences, or JWKS, that trade reverses and the library is the right
answer.

*Alternative considered and rejected:* rewriting onto `@nestjs/jwt` after the fact. The
implementation was already covered by tests asserting the confusion and expiry cases; swapping
verified crypto for a rewrite is churn carrying regression risk, with no security gain.

### Fail-closed guard, opt-out public routes
A globally registered JWT guard, with `@Public()` marking the exceptions (health, register, login, refresh, Google routes, and later the public-share endpoints). A new endpoint is protected because nobody did anything, which is the correct default for a document vault.
*Alternative:* per-controller guards — one omission silently exposes a route, and the sharing change adds many routes at once.

### The Google callback redirects, it does not return JSON
The callback sets the session cookies and issues a 302 to `WEB_APP_URL`, carrying the post-login destination through the OAuth `state` parameter alongside the CSRF nonce. The browser is mid-navigation, so a JSON body would leave the user staring at raw text.

### Uniform authentication failure
Unknown email, wrong password, and password login against a Google-only account all produce the identical 401 `INVALID_CREDENTIALS`. Registration is the one endpoint that necessarily reveals that an address is taken; rate limiting is what keeps that from becoming an enumeration oracle.

### Frontend session as one query plus a single-flight refresh
`GET /auth/me` is a TanStack Query entry and the only source of session truth. The API client intercepts a 401 once, calls refresh, and replays the original request; concurrent 401s share one in-flight refresh so a page issuing five parallel requests does not rotate the token five times and trigger reuse detection against itself. A second 401 clears the session and redirects.
*Alternative:* refreshing on a timer — races with a tab that has been asleep, and still needs the 401 path anyway.

## Risks / Trade-offs

- **`SameSite=None` requires HTTPS everywhere and is disliked by tracker-blocking browsers.** A reviewer in Safari or a locked-down profile may find sessions dropped, and a developer who copies the production cookie flags locally will find login silently failing. → Both origins on HTTPS in production, cookies partitioned where supported, cookie attributes driven by configuration, `localhost` used consistently on both sides in development, and a Cypress e2e covering sign-in → reload → still signed in, run against both the local and the deployed pair.
- **Self-inflicted reuse detection.** A parallel burst of refreshes would revoke the family and log the user out. → Single-flight refresh on the client, and a short grace window server-side where the immediately-previous token is accepted without triggering revocation.
- **Google OAuth needs exact redirect URIs.** Preview deployments on changing URLs will fail the callback. → Register the production and localhost callbacks only; the README says preview URLs support password sign-in.
- **No password reset.** A reviewer who forgets a demo password is stuck. → Google sign-in is the escape hatch, and the README names the limitation as a conscious cut.
- **Rate limiting is per-instance in memory.** With more than one API instance the effective limit multiplies. → Acceptable at one instance; the rule notes a shared store as the production fix.

## Migration Plan

Additive migration creating `User` and `RefreshToken`; no existing rows to backfill. Deploy the API before the frontend, since the frontend's session hook depends on `/auth/me`. Rollback is a revert of the migration and both deployments — no user data is at risk before launch.

Bring-up order: Prisma models → password auth and token service → guards → Google strategy → frontend session layer → rate limiting → tests.

## Open Questions

- Should a display name be collected at registration, or derived from the email local part until Google supplies one? Leaning derived, to keep sign-up to two fields.
- Access token TTL: 15 minutes is the default, but a longer TTL would reduce refresh traffic during a demo. Revisit if refresh proves noisy under Cypress runs.

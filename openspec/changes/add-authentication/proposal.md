## Why

The brief requires authentication: a Data Room belongs to its owner and is invisible to everyone else unless shared. Ownership, permissioned sharing and revocation all need a stable user identity, so nothing else in the product can be built correctly until identity exists.

## What Changes

- Add a `User` model with a unique, case-insensitively normalised email, an optional password hash and an optional Google account link, so one person keeps one account whichever way they sign in.
- Add email/password registration and login with Argon2id hashing and a deliberately uniform failure response that does not reveal whether an email is registered.
- Add Google OAuth as a second sign-in route, linking to an existing account when the verified email matches rather than creating a duplicate.
- Issue a short-lived access token and a long-lived rotating refresh token, both carried in httpOnly cookies; refresh rotation detects and revokes a reused token family.
- Add `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `GET /auth/google` and `GET /auth/google/callback`.
- Add a global authentication guard so endpoints are protected by default and access is opt-out through an explicit public decorator.
- Add the frontend session layer: sign-in and sign-up screens built from shadcn form primitives, a session hook, route protection with redirect-back, transparent refresh on a 401, and sign-out.
- Rate-limit the credential endpoints.

## Capabilities

### New Capabilities
- `authentication`: identity, credential and OAuth sign-in, session lifetime and transport, and the default-deny protection of every other endpoint.

### Modified Capabilities
None.

## Impact

- New `User` and `RefreshToken` tables; the first Prisma migration with real data in it.
- New dependencies: `@nestjs/passport`, `passport-google-oauth20`, `@nestjs/jwt`, `argon2`, `@nestjs/throttler`.
- New environment variables: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, token TTLs, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `WEB_APP_URL`.
- Every endpoint added by later changes is protected unless explicitly marked public — the sharing change depends on that default.

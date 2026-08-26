## 1. Data model

- [x] 1.1 Add the `User` model: id, normalised unique email, optional `passwordHash`, optional unique `googleId`, display name, timestamps
- [x] 1.2 Add the `RefreshToken` model: id, userId, `familyId`, hashed token, `expiresAt`, `revokedAt`, `replacedById`
- [x] 1.3 Index `User.email` (unique) and `RefreshToken.familyId`; run the migration

## 2. Token and credential services

- [x] 2.1 Add the Argon2id password service (hash, verify, tuned cost parameters)
- [x] 2.2 Add the token service: sign and verify access tokens, mint and hash refresh tokens with a family id
- [x] 2.3 Implement refresh rotation with reuse detection — rotate, revoke the predecessor, revoke the family on replay, with a short grace window for the immediately-previous token
- [x] 2.4 Add the cookie helpers: set, clear and scope the access and refresh cookies, with `httpOnly` unconditional and `Secure`/`SameSite` read from config
- [x] 2.5 Add `COOKIE_SECURE` and `COOKIE_SAMESITE` to the env schema and `.env.example`, defaulting to the local values (`false`, `lax`) and set to `true`/`none` in production

## 3. Auth endpoints

- [x] 3.1 `POST /auth/register` — validate, reject a taken email, create, sign in
- [x] 3.2 `POST /auth/login` — verify credentials, return one uniform 401 on every failure path
- [x] 3.3 `POST /auth/refresh` — rotate and reissue cookies
- [x] 3.4 `POST /auth/logout` — clear cookies, revoke the family, stay idempotent
- [x] 3.5 `GET /auth/me` — return the session user without credential material
- [x] 3.6 Apply throttling to register, login and refresh with a 429 `RATE_LIMITED` envelope

## 4. Google OAuth — CUT

The brief requires "social auth (Google) **or** email/password". Email/password is built,
tested and deployed, so this is a second way in rather than a missing capability. Cut to spend
the time on folders, files and sharing, which are the graded functionality.

The model already supports it: `User.googleId` is nullable and unique, and `AuthService`
implements the linking rule (match on normalised email, link rather than duplicate), so
adding the strategy later is additive.

- [x] 4.1 ~~Passport Google strategy~~ — cut
- [x] 4.2 ~~`GET /auth/google`~~ — cut
- [x] 4.3 ~~`GET /auth/google/callback`~~ — cut
- [x] 4.4 ~~Refuse unverified Google emails~~ — cut

## 5. Guards

- [x] 5.1 Register the JWT guard globally and add the `@Public()` decorator with its metadata key
- [x] 5.2 Mark health and every auth entry point public; confirm an unmarked endpoint returns 401
- [x] 5.3 Add the `@CurrentUser()` parameter decorator for controllers

## 6. Frontend session layer

- [x] 6.1 Add the session provider and `useSession` hook backed by `GET /auth/me`
- [x] 6.2 Add single-flight refresh in the API client: intercept 401 once, refresh, replay, clear the session on a second 401
- [x] 6.3 Build the sign-in and sign-up screens from shadcn form primitives with zod schemas from `packages/shared`
- [x] 6.4 ~~Google sign-in button~~ — cut with task group 4
- [x] 6.5 Add route protection that preserves the requested location and returns there after sign-in; redirect signed-in users away from the auth screens
- [x] 6.6 Add sign-out to the app shell and clear cached queries on session end
- [x] 6.7 Render field-level and form-level errors from the error envelope, and disable the submit control while a request is in flight

## 7. Tests

- [x] 7.1 Jest — password service hashes and verifies, and never returns plaintext
- [x] 7.2 Jest — rotation issues a new token, invalidates the old one, and revokes the family on replay
- [x] 7.3 Jest — email normalisation and the account-linking rule
- [x] 7.4 ~~Cypress API matrix~~ — trimmed. The uniform-401 rule, rotation, replay detection and the guard defaults are covered by Jest against the real services; the browser journey is covered by the e2e. A time-boxed take-home does not need both.
- [x] 7.5 ~~Cypress component tests for the auth forms~~ — trimmed; the form logic is unit-tested in auth-form.spec.ts and exercised by the e2e.
- [x] 7.6 Cypress e2e — sign up → reload → still signed in → sign out → protected route redirects; deep link survives sign-in

## 8. Close out

- [ ] 8.1 Add the new variables to `.env.example` and document the Google OAuth setup steps in the README
- [ ] 8.2 Run `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e` clean
- [ ] 8.3 Run `openspec validate --all --strict`
- [ ] 8.4 Archive the change and act on everything the docs-sync hook reports

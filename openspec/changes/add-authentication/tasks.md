## 1. Data model

- [ ] 1.1 Add the `User` model: id, normalised unique email, optional `passwordHash`, optional unique `googleId`, display name, timestamps
- [ ] 1.2 Add the `RefreshToken` model: id, userId, `familyId`, hashed token, `expiresAt`, `revokedAt`, `replacedById`
- [ ] 1.3 Index `User.email` (unique) and `RefreshToken.familyId`; run the migration

## 2. Token and credential services

- [ ] 2.1 Add the Argon2id password service (hash, verify, tuned cost parameters)
- [ ] 2.2 Add the token service: sign and verify access tokens, mint and hash refresh tokens with a family id
- [ ] 2.3 Implement refresh rotation with reuse detection — rotate, revoke the predecessor, revoke the family on replay, with a short grace window for the immediately-previous token
- [ ] 2.4 Add the cookie helpers: set, clear and scope the access and refresh cookies, with `httpOnly` unconditional and `Secure`/`SameSite` read from config
- [ ] 2.5 Add `COOKIE_SECURE` and `COOKIE_SAMESITE` to the env schema and `.env.example`, defaulting to the local values (`false`, `lax`) and set to `true`/`none` in production

## 3. Auth endpoints

- [ ] 3.1 `POST /auth/register` — validate, reject a taken email, create, sign in
- [ ] 3.2 `POST /auth/login` — verify credentials, return one uniform 401 on every failure path
- [ ] 3.3 `POST /auth/refresh` — rotate and reissue cookies
- [ ] 3.4 `POST /auth/logout` — clear cookies, revoke the family, stay idempotent
- [ ] 3.5 `GET /auth/me` — return the session user without credential material
- [ ] 3.6 Apply throttling to register, login and refresh with a 429 `RATE_LIMITED` envelope

## 4. Google OAuth

- [ ] 4.1 Add the Passport Google strategy with the client id, secret and callback URL from env
- [ ] 4.2 `GET /auth/google` — start the flow, putting a CSRF nonce and the return destination in `state`
- [ ] 4.3 `GET /auth/google/callback` — validate `state`, require a verified email, link or create the user, set cookies, redirect to `WEB_APP_URL`
- [ ] 4.4 Refuse unverified Google emails and surface a readable error on the frontend

## 5. Guards

- [ ] 5.1 Register the JWT guard globally and add the `@Public()` decorator with its metadata key
- [ ] 5.2 Mark health and every auth entry point public; confirm an unmarked endpoint returns 401
- [ ] 5.3 Add the `@CurrentUser()` parameter decorator for controllers

## 6. Frontend session layer

- [ ] 6.1 Add the session provider and `useSession` hook backed by `GET /auth/me`
- [ ] 6.2 Add single-flight refresh in the API client: intercept 401 once, refresh, replay, clear the session on a second 401
- [ ] 6.3 Build the sign-in and sign-up screens from shadcn form primitives with zod schemas from `packages/shared`
- [ ] 6.4 Add the Google sign-in button and handle the callback return, including its error state
- [ ] 6.5 Add route protection that preserves the requested location and returns there after sign-in; redirect signed-in users away from the auth screens
- [ ] 6.6 Add sign-out to the app shell and clear cached queries on session end
- [ ] 6.7 Render field-level and form-level errors from the error envelope, and disable the submit control while a request is in flight

## 7. Tests

- [ ] 7.1 Jest — password service hashes and verifies, and never returns plaintext
- [ ] 7.2 Jest — rotation issues a new token, invalidates the old one, and revokes the family on replay
- [ ] 7.3 Jest — email normalisation and the account-linking rule
- [ ] 7.4 Cypress API — register, login, me, refresh, logout; uniform 401 for unknown email and wrong password; 429 past the rate limit; 401 on an unmarked protected endpoint
- [ ] 7.5 Cypress component — sign-in form validation, error rendering, pending state
- [ ] 7.6 Cypress e2e — sign up → reload → still signed in → sign out → protected route redirects; deep link survives sign-in

## 8. Close out

- [ ] 8.1 Add the new variables to `.env.example` and document the Google OAuth setup steps in the README
- [ ] 8.2 Run `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e` clean
- [ ] 8.3 Run `openspec validate --all --strict`
- [ ] 8.4 Archive the change and act on everything the docs-sync hook reports

# authentication Specification

## Purpose
TBD - created by archiving change add-authentication. Update Purpose after archive.
## Requirements
### Requirement: User identity
The system SHALL identify each person by a unique email address, normalised to lower case and trimmed before storage and comparison. A user MAY hold a password credential, a linked Google account, or both, and MUST retain the same identity across both sign-in methods.

#### Scenario: Email uniqueness ignores case
- **WHEN** an account exists for `Owner@Acme.com` and someone registers `owner@acme.com`
- **THEN** registration is refused because the address is already in use

#### Scenario: Google sign-in links to the existing account
- **WHEN** a user registered with email and password later signs in with Google using the same verified email address
- **THEN** the Google account is linked to the existing user
- **AND** no second account is created

### Requirement: Registration with email and password
The system SHALL let a visitor register with an email address and a password of at least 8 characters. Passwords MUST be hashed with Argon2id and MUST NOT be logged or returned in any response. Registration SHALL sign the new user in.

#### Scenario: Successful registration
- **WHEN** a visitor submits an unused email address and a valid password
- **THEN** the account is created, session cookies are set, and the response contains the user's id, email and display name

#### Scenario: Weak password is refused
- **WHEN** a visitor submits a password shorter than 8 characters
- **THEN** the response is 400 with `code: "VALIDATION_FAILED"` and no account is created

#### Scenario: Stored password is unreadable
- **WHEN** an account is created
- **THEN** the stored value is an Argon2id hash and the plaintext password appears in no log, response or database column

### Requirement: Login with email and password
The system SHALL authenticate a registered user by email and password and SHALL return one indistinguishable failure for an unknown email and for a wrong password.

#### Scenario: Successful login
- **WHEN** a registered user submits their correct credentials
- **THEN** session cookies are set and the response describes the authenticated user

#### Scenario: Failures do not enumerate accounts
- **WHEN** login is attempted with an unregistered email
- **AND** login is attempted with a registered email and a wrong password
- **THEN** both responses are 401 with `code: "INVALID_CREDENTIALS"` and the same message

#### Scenario: Google-only account attempts password login
- **WHEN** a user who registered through Google attempts a password login
- **THEN** the response is the same 401 `INVALID_CREDENTIALS` and the client offers Google sign-in

### Requirement: Google OAuth sign-in
The system SHALL support Google OAuth 2.0 sign-in, accepting only verified email addresses, and SHALL return the user to the frontend after the callback. The OAuth state parameter MUST be validated to prevent cross-site request forgery.

#### Scenario: First Google sign-in creates an account
- **WHEN** a person signs in with a Google account whose verified email is unknown to the system
- **THEN** an account is created with that email and Google's display name, and the session is established

#### Scenario: Unverified Google email is refused
- **WHEN** the Google profile reports an unverified email address
- **THEN** sign-in is refused and no account is created

#### Scenario: Tampered state is refused
- **WHEN** the callback arrives with a missing or mismatched state parameter
- **THEN** the request is rejected and no session is established

### Requirement: Session tokens in cookies
The system SHALL issue a short-lived access token and a longer-lived refresh token, both carried in cookies marked `httpOnly` in every environment, with the refresh cookie scoped to the refresh endpoint path. The `Secure` and `SameSite` attributes SHALL come from configuration: `Secure` with `SameSite=None` in production, where the frontend and API are cross-site, and non-`Secure` with `SameSite=Lax` for local development over plain HTTP. Tokens MUST NOT be exposed to client-side JavaScript or placed in `localStorage`.

#### Scenario: Cookies are not script-readable
- **WHEN** a session is established
- **THEN** `document.cookie` in the frontend exposes neither token

#### Scenario: Sessions work locally over plain HTTP
- **WHEN** the frontend on `http://localhost:3000` signs in against the API on `http://localhost:3001`
- **THEN** the session cookies are accepted by the browser and sent with subsequent credentialed requests
- **AND** no HTTPS certificate is required to develop

#### Scenario: Production cookies are cross-site capable
- **WHEN** the deployed frontend signs in against the deployed API on a different site
- **THEN** the cookies are issued with `Secure` and `SameSite=None` and are sent on later requests

#### Scenario: Expired access token is refreshed transparently
- **WHEN** an authenticated request is made with an expired access token and a valid refresh token
- **THEN** the client refreshes and retries once, and the user notices no interruption

### Requirement: Refresh token rotation and reuse detection
Every use of a refresh token SHALL issue a new refresh token and invalidate the previous one. Presenting an already-used refresh token MUST revoke the whole token family and force re-authentication.

#### Scenario: Rotation on refresh
- **WHEN** a client refreshes its session
- **THEN** a new refresh token is set and the previous token no longer authenticates

#### Scenario: Replayed token revokes the family
- **WHEN** a refresh token that has already been rotated is presented again
- **THEN** the response is 401, every refresh token in that family is revoked, and the next request requires signing in again

### Requirement: Sign-out
Signing out SHALL clear both session cookies and revoke the current refresh token family, and MUST succeed even when the session has already expired.

#### Scenario: Sign-out ends the session
- **WHEN** an authenticated user signs out
- **THEN** the cookies are cleared, the refresh token is revoked, and `GET /auth/me` responds 401

#### Scenario: Sign-out is idempotent
- **WHEN** sign-out is called without a valid session
- **THEN** the response is still successful and no error is surfaced to the user

### Requirement: Endpoints are protected by default
Every API endpoint SHALL require an authenticated session unless explicitly marked public. An unauthenticated request to a protected endpoint MUST fail with 401 and MUST NOT disclose whether the requested resource exists.

#### Scenario: New endpoint inherits protection
- **WHEN** an endpoint is added without an explicit public marker
- **THEN** an unauthenticated request to it responds 401

#### Scenario: Existence is not disclosed
- **WHEN** an unauthenticated request names a resource id that does exist
- **THEN** the response is 401 and reveals nothing about that resource

### Requirement: Current user endpoint
`GET /auth/me` SHALL return the authenticated user's id, email, display name and linked sign-in methods, and MUST NOT return credential material.

#### Scenario: Session restored on reload
- **WHEN** the frontend loads with valid session cookies
- **THEN** `GET /auth/me` returns the user and the app renders as signed in without a flash of the signed-out state

### Requirement: Credential endpoints are rate limited
Registration, login and refresh SHALL be rate limited per client, and exceeding the limit MUST respond 429 with `code: "RATE_LIMITED"`.

#### Scenario: Brute force is throttled
- **WHEN** login is attempted repeatedly beyond the configured limit
- **THEN** further attempts respond 429 until the window resets

### Requirement: Frontend route protection
The frontend SHALL redirect an unauthenticated visitor away from application routes to sign-in, preserving the requested location, and SHALL return the user there after a successful sign-in.

#### Scenario: Deep link survives sign-in
- **WHEN** a signed-out visitor opens a link to a folder inside a Data Room
- **THEN** they are sent to sign-in, and after signing in they land on that folder

#### Scenario: Signed-in user skips the auth screens
- **WHEN** a signed-in user opens the sign-in route
- **THEN** they are redirected into the application


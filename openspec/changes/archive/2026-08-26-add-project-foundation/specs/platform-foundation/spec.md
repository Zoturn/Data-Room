## ADDED Requirements

### Requirement: Monorepo workspace layout
The repository SHALL be a single pnpm workspace containing `apps/web` (Next.js frontend), `apps/api` (NestJS backend) and `packages/shared` (API contract types and zod schemas). Frontend and backend MUST NOT import from each other's source; all shared types MUST travel through `packages/shared`.

#### Scenario: Shared contract type is used by both sides
- **WHEN** a request or response type is declared in `packages/shared`
- **THEN** `apps/api` and `apps/web` both compile against that single declaration
- **AND** changing the type produces a type error in both workspaces until both are updated

#### Scenario: Cross-app import is rejected
- **WHEN** a file in `apps/web` imports from `apps/api`
- **THEN** the lint step fails with an explicit boundary violation

### Requirement: Validated environment configuration
The API SHALL validate all environment variables against a schema at startup and SHALL refuse to boot when a required variable is missing or malformed. Secrets MUST NOT be committed; an `.env.example` listing every variable with a non-secret placeholder MUST be maintained.

#### Scenario: Missing variable stops boot
- **WHEN** the API starts without `DATABASE_URL`
- **THEN** it exits non-zero before listening
- **AND** the log names the missing variable

#### Scenario: Example file stays complete
- **WHEN** a new environment variable is introduced
- **THEN** `.env.example` contains that variable with a placeholder value

### Requirement: Health endpoint
The API SHALL expose `GET /health` returning HTTP 200 with service status and database reachability, and HTTP 503 when the database is unreachable. The endpoint MUST NOT require authentication.

#### Scenario: Healthy service
- **WHEN** an unauthenticated client requests `GET /health` and the database responds
- **THEN** the response is 200 with `{ "status": "ok", "database": "up" }`

#### Scenario: Database unavailable
- **WHEN** the database connection fails
- **THEN** `GET /health` responds 503 with `"database": "down"`

### Requirement: Uniform error envelope
Every non-2xx API response SHALL use one JSON envelope containing a stable machine-readable `code`, a human-readable `message`, an optional `details` array for field-level validation errors, and a `requestId`. Internal errors MUST NOT leak stack traces or driver messages to the client.

#### Scenario: Validation failure
- **WHEN** a request body fails DTO validation
- **THEN** the response is 400 with `code: "VALIDATION_FAILED"` and one `details` entry per invalid field

#### Scenario: Unexpected error is sanitised
- **WHEN** an unhandled exception is thrown while serving a request
- **THEN** the response is 500 with `code: "INTERNAL_ERROR"` and no stack trace
- **AND** the full error with its `requestId` is written to the server log

### Requirement: Cursor pagination envelope
Every list endpoint SHALL return `{ items, nextCursor }` and accept `limit` and `cursor` query parameters, with a default and a hard maximum for `limit`. Offset pagination MUST NOT be used for Data Room contents.

#### Scenario: Page is capped
- **WHEN** a client requests a list with `limit=10000`
- **THEN** the response contains at most the configured maximum number of items

#### Scenario: Last page
- **WHEN** the final page of results is returned
- **THEN** `nextCursor` is `null`

### Requirement: Cross-origin session transport
The API SHALL accept credentialed cross-origin requests only from the configured frontend origins, and session cookies MUST be `httpOnly`, `Secure` and `SameSite=None` in production.

#### Scenario: Unlisted origin is refused
- **WHEN** a browser on an origin outside the allowlist calls the API with credentials
- **THEN** the request is rejected by CORS

#### Scenario: Deployed frontend keeps its session
- **WHEN** the deployed frontend calls the deployed API with `credentials: "include"`
- **THEN** the session cookie is sent and the request is authenticated

### Requirement: Test harness is Jest and Cypress only
The repository SHALL provide Jest for unit and integration tests and Cypress for API e2e, React component and UI e2e tests. No other test runner or assertion framework — including Vitest, Playwright, Mocha, supertest and Testing Library — MAY be added.

#### Scenario: Unit suites run from the root
- **WHEN** `pnpm test` runs at the repository root
- **THEN** the Jest suites of every workspace execute

#### Scenario: Forbidden runner is caught
- **WHEN** a dependency on another test runner is added to any workspace
- **THEN** CI fails on the dependency policy check

### Requirement: Continuous integration gate
CI SHALL run typecheck, lint, Jest suites, production builds and a Cypress smoke run on every pull request, and a red pipeline MUST block merge.

#### Scenario: Failing test blocks merge
- **WHEN** a pull request contains a failing Jest test
- **THEN** the pipeline reports failure and the pull request cannot be merged

### Requirement: Documentation carries general information only
Each `CLAUDE.md` (root, `apps/web`, `apps/api`) SHALL contain only orientation — purpose, stack, directory map, commands — plus an index of rule files referenced by path. Conventions and implementation detail MUST live in `.claude/rules/*.md`, and every path listed in a rule index MUST resolve to an existing file.

#### Scenario: Detail belongs in a rule
- **WHEN** a new convention is agreed
- **THEN** it is written into the relevant `.claude/rules/*.md` file
- **AND** `CLAUDE.md` changes only if the rule index needs a new entry

#### Scenario: Broken rule link is detected
- **WHEN** a rule file is renamed without updating the index
- **THEN** the documentation check reports the unresolved path

### Requirement: Repeated actions run as hooks
Pre- and post-action automation SHALL be implemented as Claude Code hooks committed in `.claude/settings.json` with scripts under `.claude/hooks/`, and MUST NOT be written as procedural instructions inside rule files. Hooks MUST exit successfully when their toolchain is absent.

#### Scenario: Formatting after a write
- **WHEN** a file is created or edited
- **THEN** the format hook runs the nearest workspace Prettier over that file

#### Scenario: Tests are revisited after a source edit
- **WHEN** a source file under `apps/*/src` is created or edited
- **THEN** the hook reports whether its companion spec is missing or older than the source

#### Scenario: Tests run after a commit
- **WHEN** a `git commit` command succeeds
- **THEN** the hook runs the Jest suites of the affected workspaces and reports failures

#### Scenario: Documentation is verified after an archive
- **WHEN** `openspec archive` completes
- **THEN** the hook validates the specs and reports stale documentation or unresolved rule paths

#### Scenario: Generated specs are protected
- **WHEN** a direct edit to `openspec/specs/**` is attempted
- **THEN** the hook denies the edit and points to the change delta instead

#### Scenario: Hook is harmless without dependencies
- **WHEN** a hook runs in a clone with no `node_modules`
- **THEN** it exits zero without error output

### Requirement: Public deployment
Frontend and backend SHALL both be deployed and publicly reachable, with the frontend configured to call the deployed backend and the repository README listing both URLs.

#### Scenario: Reviewer opens the deployed app
- **WHEN** a reviewer opens the deployed frontend URL and signs in
- **THEN** the application works end to end against the deployed backend and database

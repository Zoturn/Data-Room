## Why

The Data Room MVP needs a real backend, a real database and a deployed frontend before any feature work can land. Without a shared skeleton — one repository, one API contract, one environment story, one test strategy — each subsequent change would invent its own conventions and the reviewer would see five different styles in one submission. This change establishes that skeleton and nothing else.

## What Changes

- Create a pnpm workspace monorepo with `apps/web` (Next.js 15 App Router, React, TypeScript, Tailwind, shadcn/ui), `apps/api` (NestJS 11, Prisma, PostgreSQL) and `packages/shared` (API contract types and zod schemas consumed by both sides).
- Add strict TypeScript, ESLint and Prettier configuration shared across workspaces.
- Add typed, validated environment configuration; the API refuses to boot on missing or malformed variables instead of failing at first request.
- Add a `GET /health` endpoint reporting service and database reachability, used by deploy platforms and by Cypress as a readiness gate.
- Define a single JSON error envelope and a global NestJS exception filter that produces it, plus the cursor pagination envelope every list endpoint will use.
- Configure CORS and cookie policy for a cross-origin frontend (Vercel) and backend (Railway/Render).
- Add the Jest and Cypress harnesses for both workspaces, wired so `pnpm test` runs unit tests and `pnpm e2e` runs Cypress.
- Add the documentation system: root, web and api `CLAUDE.md` files that carry general information only, `.claude/rules/*.md` holding the detail, and Claude Code hooks in `.claude/settings.json` that format on write, prompt for test updates, run tests after a commit, verify docs after an archive, and protect generated specs.
- Add CI (typecheck → lint → Jest → build → Cypress smoke) and provision the Supabase project, Vercel project and API host.

## Capabilities

### New Capabilities
- `platform-foundation`: repository layout, environment configuration, health checking, the shared HTTP response and error contract, and the automation that keeps documentation and tests honest.

### Modified Capabilities
None — this is the first change.

## Impact

- New repository skeleton: `apps/web`, `apps/api`, `packages/shared`, `.claude/`, `openspec/`.
- New external dependencies: Supabase (Postgres + Storage), Vercel, an API host (Railway or Render), GitHub Actions.
- Every later change inherits the error envelope, pagination envelope, env loading and test harness defined here; changing them later is a breaking change for all of them.

## Context

Greenfield repository for a take-home Data Room MVP, time-boxed to roughly 6–8 hours of implementation. The reviewer grades, in order: UX and functionality, design polish, then code quality. The stack is fixed by the brief: React/TypeScript/Tailwind/shadcn on the frontend, Node with a relational database on the backend, blob storage for files, and both halves deployed publicly. Two operational constraints shape everything below: the frontend and backend live on different hosts (so sessions cross origins), and the whole thing must be reproducible by a reviewer who clones the repo and reads one README.

## Goals / Non-Goals

**Goals:**
- One repository a reviewer can clone, configure from `.env.example`, and run with two commands.
- A contract — errors, pagination, auth transport — fixed once so the five later changes only add features, never re-litigate conventions.
- Documentation that stays true after every merge, enforced mechanically rather than by memory.
- A test setup restricted to Jest and Cypress that still covers unit logic, HTTP behaviour and real user flows.

**Non-Goals:**
- Multi-tenancy, organisations, billing, audit logs, or background job infrastructure.
- Microservices. One API process is correct at this size.
- A component library of our own — shadcn/ui is copied in and owned.
- Kubernetes, Terraform, or any infrastructure-as-code; platform dashboards are enough here.

## Decisions

### Monorepo over two repositories
One pnpm workspace holding `apps/web`, `apps/api` and `packages/shared`. The API contract is declared once and both sides break at compile time when it drifts — the single highest-value guarantee available for a full-stack submission of this size. It also gives the reviewer one clone, one install, one README.
*Alternatives:* two repositories (honest service separation, but the contract has to be duplicated or published as a package — cost with no benefit at this scale); a single Next.js app with route handlers as the backend (fewest moving parts, but the brief explicitly asks for a real Node backend, and NestJS is what the team uses).

### Next.js 15 App Router as a client shell
The frontend renders and holds UI state; every read and write goes to the NestJS API. Next.js route handlers are used only where the browser genuinely cannot call the API directly. This keeps one authorisation implementation rather than two.
*Alternatives:* Vite SPA (fine, but Vercel deployment and file-based routing are free with Next.js); Next.js server actions talking straight to Prisma (would split business logic across two runtimes and duplicate permission checks — the exact defect the sharing change cannot afford).

### Supabase for Postgres and Storage
One provider, one dashboard, one set of credentials for both the relational data and the blob storage, with signed upload and download URLs available out of the box. Prisma connects through the pooled connection string.
*Alternatives:* Neon + S3 (most production-realistic, but IAM policies, bucket CORS and presigner wiring cost hours the brief would rather see spent on UX); Vercel Blob (simplest API but Vercel-centric, awkward when the backend, not the frontend, owns uploads).

### Contract-first shared package
`packages/shared` holds zod schemas; DTO validation on the API and form validation on the web both derive from them, and TypeScript types are inferred rather than hand-written twice.
*Alternative:* generating a client from an OpenAPI document — more machinery, and a generation step to keep in sync, for a benefit zod already provides in a TypeScript-only repository.

### Cookie sessions rather than bearer tokens in storage
Access and refresh tokens live in `httpOnly`, `Secure`, `SameSite=None` cookies. Tokens in `localStorage` are readable by any injected script; a public-link viewer feature makes XSS exposure a real concern rather than a theoretical one. The cost is `SameSite=None` plus a strict CORS allowlist, and both hosts serving HTTPS.
*Alternative:* bearer token in memory with a silent refresh — no cookie complexity, but the token is lost on every reload and the refresh token still has to live somewhere.

### One error envelope and cursor pagination from day one
`{ code, message, details?, requestId }` for every failure, `{ items, nextCursor }` for every list. Cursor pagination is chosen now, before there is data to justify it, because retrofitting it after the folder listing UI exists means rewriting that UI — and the README has to answer what happens at 100,000 files.
*Alternative:* offset pagination (simpler, and wrong past a few thousand rows: deep offsets scan, and rows shift under the reader during concurrent uploads).

### Jest and Cypress, no other runners
Jest covers services, permission resolution, path arithmetic and pure frontend logic. Cypress covers everything that crosses a process boundary: API e2e through `cy.request` against a running Nest instance, React components through Cypress Component Testing, and the graded UI flows end to end. supertest is deliberately excluded — Cypress `cy.request` tests the real listening server rather than an in-process handler, which is closer to what the reviewer will exercise.
*Alternative:* Jest + supertest + Playwright — the conventional split, but three tools where two suffice, and outside the permitted set.

### Automation as hooks, conventions as rules
A rule that says "run Prettier after editing" is a request that something remembers to do it. A `PostToolUse` hook simply does it. So `.claude/settings.json` carries formatting, test companionship, post-commit test runs, post-archive documentation verification and a guard on generated specs; `.claude/rules/*.md` carries only how code should be written. `CLAUDE.md` files stay at orientation level and index the rules by path, which keeps them small enough to stay accurate.
*Alternative:* one large `CLAUDE.md` per app (everything in one place, but it rots quickly and loads irrelevant detail into every session).

## Risks / Trade-offs

- **Cross-site cookies are fragile.** Safari's ITP and any misconfigured `SameSite` value will break sessions in exactly the browser a reviewer might use. → Deploy both halves over HTTPS, pin the CORS allowlist, and cover login-then-reload as a Cypress e2e test against the deployed pair, not only against localhost.
- **Supabase free tier pauses idle projects.** A reviewer opening the link after a quiet week could meet a cold or paused database. → `/health` reports database reachability, the frontend shows a real error state rather than a spinner, and the README names the symptom.
- **Cursor pagination complicates "jump to page".** → The Data Room UI is infinite-scroll by design, so the affordance is never offered.
- **A monorepo can blur boundaries.** Nothing physically stops `apps/web` importing backend code. → Lint boundary rule, enforced in CI.
- **Hooks assume a POSIX shell.** On Windows the scripts run under Git Bash, which Claude Code provides. → Every script is `set -u`, path-normalises backslashes, and exits zero when its toolchain is missing.

## Migration Plan

Greenfield, so no migration. Bring-up order: workspace and tooling → shared package → Nest app with env validation, error filter and `/health` → Next.js app with Tailwind and shadcn → Jest and Cypress harnesses → CI → provision Supabase, Vercel and the API host → deploy both and confirm `/health` and a browser session across origins.

Rollback is per-deployment: both hosts keep the previous build, and no data exists yet to migrate back.

## Open Questions

- Railway or Render for the API? Decided at deploy time on cold-start behaviour of the free tier; nothing in the code depends on the answer.
- Does the reviewer need seeded demo data, or is a fresh empty Data Room the better first impression? Revisit when the sharing flow exists, since demonstrating a permissioned share needs a second account.

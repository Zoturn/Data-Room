# Data Room

A secure repository where an owner stores folders and PDF documents and shares them read-only — by public link or with named people — for due diligence. Built for the GS1 full-stack take-home task.

**Stack:** Next.js 15 + React + TypeScript + Tailwind + shadcn/ui · NestJS 11 + Prisma + PostgreSQL · Supabase Storage · Jest and Cypress.

## Layout

```
apps/web/          Next.js frontend — see apps/web/CLAUDE.md
apps/api/          NestJS backend  — see apps/api/CLAUDE.md
packages/shared/   zod schemas and types shared by both
openspec/          change proposals and the specs they produce
.claude/rules/     conventions that apply to both sides
.claude/hooks/     automation (see below)
```

Frontend and backend never import each other. Everything they share travels through `packages/shared`.

## Commands

```bash
pnpm install
pnpm dev            # both apps
pnpm typecheck      # every workspace
pnpm lint
pnpm test           # Jest, every workspace
pnpm e2e            # Cypress
```

Configuration comes from `.env`, created from `.env.example`. The API refuses to start if a variable is missing.

## Working here

Changes start as an OpenSpec proposal, not as code. Read [.claude/rules/openspec-workflow.md](.claude/rules/openspec-workflow.md) before starting anything.

```bash
openspec list                    # active changes and progress
openspec show <change>           # read one
openspec validate --all --strict
```

Changes are built in this order, each archived before the next begins:

| Order | Change                      | Delivers                                          |
| ----- | --------------------------- | ------------------------------------------------- |
| 1     | `add-project-foundation`    | monorepo, contract, env, health, CI, deployment   |
| 2     | `add-authentication`        | email/password sign-in, sessions, route guards    |
| 3     | `add-data-room-tree`        | Data Room, folders, breadcrumbs, recursive delete |
| 4     | `add-file-management`       | upload, view, rename, move, delete                |
| 5     | `add-sharing`               | public links, permissioned shares, revocation     |
| 6     | `add-search-and-versioning` | extra credit, plus the final README               |

## Rules

Every convention lives in a rule file and loads automatically for the paths it covers. These files are the detail; this document is only the map.

**Both sides — [.claude/rules/](.claude/rules/)**

| Rule                                                       | Covers                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| [openspec-workflow.md](.claude/rules/openspec-workflow.md) | proposing, specifying, applying and archiving a change           |
| [api-contract.md](.claude/rules/api-contract.md)           | endpoint shapes, the error envelope, cursor pagination           |
| [typescript.md](.claude/rules/typescript.md)               | strictness, no `any`, shared inferred types                      |
| [env-and-secrets.md](.claude/rules/env-and-secrets.md)     | configuration, `.env.example`, what must never ship to a browser |
| [git-workflow.md](.claude/rules/git-workflow.md)           | branches, commits, pull requests, migrations                     |

**Backend — [apps/api/.claude/rules/](apps/api/.claude/rules/)** · indexed in [apps/api/CLAUDE.md](apps/api/CLAUDE.md)

**Frontend — [apps/web/.claude/rules/](apps/web/.claude/rules/)** · indexed in [apps/web/CLAUDE.md](apps/web/CLAUDE.md)

## Automation

Repeated actions are hooks in [.claude/settings.json](.claude/settings.json), never instructions in a rule. They run whether or not anyone remembers them, and no-op in a clone with no dependencies installed.

| Hook                                                       | Fires                    | Does                                                                            |
| ---------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------- |
| [spec-guard.sh](.claude/hooks/spec-guard.sh)               | before a write           | refuses hand edits to `openspec/specs/**`, which `openspec archive` generates   |
| [format.sh](.claude/hooks/format.sh)                       | after a write            | Prettier, using the nearest workspace's own config                              |
| [test-companion.sh](.claude/hooks/test-companion.sh)       | after a source write     | reports a missing or stale companion spec so tests follow the change            |
| [post-commit-tests.sh](.claude/hooks/post-commit-tests.sh) | after `git commit`       | runs Jest for the workspaces the commit touched                                 |
| [docs-sync.sh](.claude/hooks/docs-sync.sh)                 | after `openspec archive` | revalidates specs, checks every rule path resolves, flags stale README sections |

## Testing

Jest and Cypress only. Jest for logic and services, Cypress for HTTP, components and user flows. Vitest, Playwright, Mocha, supertest and Testing Library are not permitted; CI enforces it. The detail is in each app's `testing.md`.

## Documentation

A `CLAUDE.md` carries orientation and a rule index. Conventions, examples and detail go in a rule. If something here starts explaining _how_ to do something, it belongs in a rule instead.

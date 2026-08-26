# Data Room

A virtual Data Room: an owner keeps folders and PDF documents in a private repository and shares them read-only — by public link, or with specific people — for due diligence.

Built for the GS1 full-stack take-home task.

> **Status:** specification complete, implementation not started. Every section below marked _(pending)_ is written by the change that delivers it — see [Roadmap](#roadmap).

## Hosted URLs

|              | URL                                                           |
| ------------ | ------------------------------------------------------------- |
| Frontend     | <https://data-room-web-sigma.vercel.app>                      |
| Backend      | <https://data-room-production-1752.up.railway.app>            |
| Health check | <https://data-room-production-1752.up.railway.app/api/health> |

The frontend is deployed and rendering; sign-in and the Data Room itself arrive with
`add-authentication` and the changes after it. A short tour of what to try first is added
with the final change.

## What it does

- **Folders** — create, nest, rename, and delete with a warning that states exactly how many folders and files will be removed. Breadcrumb navigation at any depth.
- **Files** — upload several PDFs at once by drag-and-drop with per-file progress, view them in the app, rename, move between folders, delete. Name conflicts resolve predictably.
- **Sharing** — share the Data Room, a folder, or a single file, read-only, either as a public link or to named people who must sign in. Access covers everything nested inside. The owner can revoke at any time, immediately.
- **Accounts** — email and password, or Google. A Data Room is invisible to everyone but its owner until it is shared.
- **Extra credit** — filename search across the Data Room, and optional file versioning on a name conflict.

## Stack

|          |                                                                                        |
| -------- | -------------------------------------------------------------------------------------- |
| Frontend | Next.js 15 (App Router), React, TypeScript, Tailwind, shadcn/ui, TanStack Query        |
| Backend  | NestJS 11, Prisma, PostgreSQL                                                          |
| Storage  | Supabase — Postgres and Storage                                                        |
| Auth     | Argon2id passwords and Google OAuth, JWT access + rotating refresh in httpOnly cookies |
| Testing  | Jest (units, services) and Cypress (API, components, end-to-end)                       |
| Hosting  | Vercel (web), Railway or Render (api), Supabase (data and blobs)                       |

## Design decisions

_(pending — assembled in `add-search-and-versioning` from the six change design documents in `openspec/changes/*/design.md`, which record every decision and the alternatives weighed against it.)_

The short version, ahead of that write-up:

- **One `Node` table for folders and files**, discriminated by type, so naming, listing, moving, deleting and sharing are each implemented once rather than twice.
- **Materialised path of ids** on every node, so breadcrumbs, subtree aggregates, recursive delete, scoped search and permission inheritance are all one indexed prefix query — and a rename touches a single row.
- **Uploads bypass the API.** The browser sends bytes straight to blob storage through a short-lived signed URL; the API reserves the name first and validates the stored object afterwards.
- **One access resolver** that every read passes through. Sharing is read-only by construction: no code path lets a share authorise a write.

## Data model

_(pending — ERD added in `add-data-room-tree` and completed in `add-sharing` and `add-search-and-versioning`.)_

Entities: `User`, `RefreshToken`, `DataRoom`, `Node` (folder or file), `Share`, `ShareGrant`, `FileVersion`.

## How it scales

_(pending — each answer is written by the change that implements it; the reasoning already exists in the linked design document.)_

**How do you compute the total size and item count of a folder including its whole subtree?**
_(pending — `add-data-room-tree`;_ see `openspec/changes/add-data-room-tree/design.md`_)_

**What changes when one Data Room holds 100,000 files — listing, pagination, indexes?**
_(pending — `add-file-management`;_ see `openspec/changes/add-file-management/design.md`_)_

**How does sharing extend to per-user roles (viewer/editor) without remodelling?**
_(pending — `add-sharing`;_ see `openspec/changes/add-sharing/design.md`_)_

## Setup

Prerequisites: Node 22 (see `.nvmrc`) and pnpm 11 (`corepack enable pnpm`).

```bash
pnpm install
cp apps/api/.env.example apps/api/.env      # fill in the Supabase connection strings
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @data-room/shared build
pnpm --filter @data-room/api prisma:generate
pnpm --filter @data-room/api prisma:deploy
pnpm dev                                     # web on :3000, api on :3001
```

The API validates its environment at boot and exits with the name of anything missing, so a
half-configured start fails immediately rather than at the first request.

For provisioning Supabase, Vercel and the API host, follow **[docs/deployment.md](docs/deployment.md)** — a step-by-step runbook with a verification after each stage.

## Environment

_(pending — every variable is listed in `.env.example` with a placeholder. The API validates them at boot and refuses to start if one is missing.)_

## Testing

Jest and Cypress only.

```bash
pnpm test    # Jest — services, permission resolution, pure logic
pnpm e2e     # Cypress — API end-to-end, component tests, user flows
```

## How this was built

This repository is specified with [OpenSpec](https://github.com/Fission-AI/OpenSpec) before it is coded. Each capability is a change proposal holding a proposal, capability specs written as testable scenarios, a design document recording the decisions and their alternatives, and a task list.

```bash
openspec list                    # changes and progress
openspec show add-sharing        # read one
openspec validate --all --strict
```

Conventions live in `.claude/rules/*.md` and load automatically for the files they govern; `CLAUDE.md` files carry orientation only. Formatting, test companionship, post-commit test runs and post-archive documentation checks are hooks, so they happen without anyone remembering them.

### Roadmap

| Order | Change                      | Status                   |
| ----- | --------------------------- | ------------------------ |
| 1     | `add-project-foundation`    | specified                |
| 2     | `add-authentication`        | specified                |
| 3     | `add-data-room-tree`        | specified                |
| 4     | `add-file-management`       | specified                |
| 5     | `add-sharing`               | specified                |
| 6     | `add-search-and-versioning` | specified (extra credit) |

## Use of AI

_(pending — the required note on where and how AI was used, written with the final change.)_

## Deliberate cuts

_(pending — the list of things consciously left out, with reasons: no password reset or email verification, no email delivery of share invitations, no version retention policy, PDF only, no access logs.)_

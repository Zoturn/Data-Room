# Data Room API

The NestJS backend. It owns the data model, all business rules and every authorisation decision. The frontend is a client of this service and re-implements none of it.

**Stack:** NestJS 11 · Prisma · PostgreSQL (Supabase) · Supabase Storage · Jest and Cypress.

## Layout

```
src/
  config/      env schema and typed access
  prisma/      PrismaService
  auth/        registration, login, tokens, guards
  data-room/   the owned root container
  folders/     the node tree
  files/       file nodes and the upload pipeline
  storage/     blob storage behind one interface
  sharing/     shares, grants and access resolution
  common/      error envelope, filters, pipes, pagination
prisma/        schema and migrations
cypress/       API end-to-end specs
```

## Commands

```bash
pnpm --filter @data-room/api dev
pnpm --filter @data-room/api test          # Jest
pnpm --filter @data-room/api e2e           # Cypress API specs
pnpm --filter @data-room/api prisma migrate dev --name <name>
pnpm --filter @data-room/api prisma studio
```

Requires `DATABASE_URL` and the Supabase and JWT variables from `.env`. `GET /api/health` reports service and database status.

## Shape of the service

Requests arrive at a controller, which validates and delegates to a service, which uses a repository for persistence. Guards decide whether a caller may proceed; the access resolver decides what they may see. Everything a client can receive — success or failure — has one agreed shape, defined in `packages/shared`.

## Rules

| Rule                                                               | Covers                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| [nestjs-architecture.md](.claude/rules/nestjs-architecture.md)     | modules, the controller → service → repository layering, DI              |
| [prisma-data-model.md](.claude/rules/prisma-data-model.md)         | schema conventions, the node tree, indexes, migrations                   |
| [auth-and-guards.md](.claude/rules/auth-and-guards.md)             | sessions, cookie policy including local development, default-deny guards |
| [sharing-authorization.md](.claude/rules/sharing-authorization.md) | access resolution — the security boundary of the product                 |
| [file-upload-storage.md](.claude/rules/file-upload-storage.md)     | signed URLs, the upload pipeline, blob lifecycle                         |
| [errors-and-validation.md](.claude/rules/errors-and-validation.md) | DTOs, domain errors, the exception filter                                |
| [testing.md](.claude/rules/testing.md)                             | Jest for units, Cypress for HTTP; nothing else                           |

Repository-wide rules — API contract, TypeScript, environment, git — are indexed in the root [CLAUDE.md](../../CLAUDE.md).

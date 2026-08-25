# Data Room web

The Next.js frontend. It renders the Data Room and talks to the API; it holds no business rules and makes no authorisation decisions of its own.

**Stack:** Next.js 15 (App Router) · React · TypeScript · Tailwind · shadcn/ui · TanStack Query · react-hook-form + zod · Jest and Cypress.

## Layout

```
src/
  app/
    (auth)/      sign-in and sign-up
    (app)/       the owner's Data Room
    (shared)/    public and permissioned share views
  features/      folders, files, uploads, sharing, search — components, hooks, api calls
  components/
    ui/          shadcn primitives, owned by this repo
  lib/api/       the API client, error parsing, query keys
cypress/         component and end-to-end specs
```

## Commands

```bash
pnpm --filter @data-room/web dev
pnpm --filter @data-room/web build
pnpm --filter @data-room/web test          # Jest
pnpm --filter @data-room/web e2e           # Cypress
pnpm --filter @data-room/web cypress open  # component and e2e, interactive
```

Needs `NEXT_PUBLIC_API_URL` pointing at the API. Nothing secret may be `NEXT_PUBLIC_`.

## Shape of the app

Session state comes from one `/auth/me` query. Server data comes from TanStack Query through a single API client that sends cookies and parses the error envelope. Where the user is — the open folder, the search, filters — lives in the URL, so every view is linkable and survives a reload. Components are small and composed; the same row renders for an owner and for a read-only viewer, with capabilities passed in as props.

The brief grades user experience first, so loading, empty, error and destructive states are treated as features rather than afterthoughts.

## Rules

| Rule                                                             | Covers                                                            |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| [nextjs-app-router.md](.claude/rules/nextjs-app-router.md)       | routing, route groups, server vs client components, URL state     |
| [components.md](.claude/rules/components.md)                     | granularity, composition, feature layout, capabilities as props   |
| [tailwind-shadcn.md](.claude/rules/tailwind-shadcn.md)           | tokens, utilities, owning the shadcn primitives                   |
| [data-fetching.md](.claude/rules/data-fetching.md)               | the API client, query keys, single-flight refresh, mutations      |
| [forms-and-validation.md](.claude/rules/forms-and-validation.md) | react-hook-form with shared zod schemas, error rendering          |
| [ux-states.md](.claude/rules/ux-states.md)                       | loading, empty, error, destructive confirmations, upload progress |
| [accessibility.md](.claude/rules/accessibility.md)               | keyboard, focus, labelling, announcements                         |
| [testing.md](.claude/rules/testing.md)                           | Jest for logic, Cypress for components and flows; nothing else    |

Repository-wide rules — API contract, TypeScript, environment, git — are indexed in the root [CLAUDE.md](../../CLAUDE.md).

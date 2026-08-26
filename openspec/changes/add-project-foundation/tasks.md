## 1. Workspace and tooling

- [x] 1.1 Initialise the pnpm workspace: root `package.json`, `pnpm-workspace.yaml` covering `apps/*` and `packages/*`, `.gitignore`, `.nvmrc`
- [x] 1.2 Add the shared base `tsconfig.json` with `strict: true`, `noUncheckedIndexedAccess` and path aliases; extend it in each workspace
- [x] 1.3 Add ESLint (flat config) and Prettier at the root, plus the import-boundary rule that forbids `apps/web` ↔ `apps/api` imports
- [x] 1.4 Add root scripts: `dev`, `build`, `typecheck`, `lint`, `test`, `e2e`
- [x] 1.5 Add a `check:test-runners` script that fails when a dependency outside Jest/Cypress appears in any workspace, and wire it into `lint`

## 2. Shared contract package

- [x] 2.1 Create `packages/shared` with zod schemas for the error envelope (`code`, `message`, `details?`, `requestId`) and the cursor page envelope (`items`, `nextCursor`)
- [x] 2.2 Export inferred TypeScript types and the API error `code` union
- [x] 2.3 Add Jest unit tests for the schemas (accepts valid, rejects malformed)

## 3. Backend skeleton

- [x] 3.1 Scaffold the NestJS app in `apps/api` with `main.ts`, `AppModule` and a global `/api` prefix
- [x] 3.2 Add the env config module: zod schema, fail-fast validation at boot, typed accessor service; write `.env.example`
- [x] 3.3 Add Prisma with the Supabase connection string, an empty initial schema and a `PrismaService` with graceful shutdown
- [x] 3.4 Implement `GET /health` returning service status and database reachability (503 when the database is down)
- [x] 3.5 Add the global exception filter and validation pipe producing the shared error envelope, with a `requestId` middleware
- [x] 3.6 Configure CORS allowlist, cookie parser and cookie defaults (`httpOnly`, `Secure`, `SameSite=None` in production)
- [x] 3.7 Add the pagination helper (`limit` default and hard maximum, cursor encode/decode)

## 4. Frontend skeleton

- [x] 4.1 Scaffold the Next.js 15 App Router app in `apps/web` with TypeScript and the App Router directory structure
- [x] 4.2 Add Tailwind and initialise shadcn/ui with the base theme tokens; add the first primitives (button, dialog, dropdown, toast)
- [x] 4.3 Add the API client: base URL from env, `credentials: "include"`, error-envelope parsing into a typed `ApiError`
- [x] 4.4 Add TanStack Query provider, the root layout, and the global error and not-found boundaries
- [x] 4.5 Add the app shell — header, content region, toast host — with loading and error states

## 5. Test harnesses

- [x] 5.1 Configure Jest in `apps/api` (ts-jest, `@nestjs/testing`, coverage thresholds)
- [x] 5.2 Configure Jest in `apps/web` for hooks, utilities and pure logic
- [x] 5.3 Configure Cypress in `apps/api` for API e2e via `cy.request`, with a `/health` readiness gate and database reset between specs
- [x] 5.4 Configure Cypress in `apps/web` for component testing and UI e2e
- [x] 5.5 Write the smoke specs: Jest — env validation rejects a missing variable and the error filter shapes an envelope; Cypress — `/health` responds and the app shell renders

## 6. Documentation and automation

- [x] 6.1 Write the root `CLAUDE.md`: purpose, stack, directory map, commands, rule index, hook table, change order
- [x] 6.2 Write `apps/api/CLAUDE.md` and `apps/web/CLAUDE.md` — orientation and rule index only
- [x] 6.3 Write the shared rules: `openspec-workflow`, `git-workflow`, `typescript`, `env-and-secrets`, `api-contract`
- [x] 6.4 Write the backend rules: `nestjs-architecture`, `prisma-data-model`, `errors-and-validation`, `testing`
- [x] 6.5 Write the frontend rules: `nextjs-app-router`, `components`, `tailwind-shadcn`, `data-fetching`, `forms-and-validation`, `ux-states`, `accessibility`, `testing`
- [x] 6.6 Write the hook scripts under `.claude/hooks/`: `format.sh`, `test-companion.sh`, `post-commit-tests.sh`, `docs-sync.sh`, `spec-guard.sh`
- [x] 6.7 Wire the hooks in `.claude/settings.json` and verify each script by piping a sample payload, including the no-`node_modules` case
- [x] 6.8 Write the README skeleton: overview, setup, environment, scripts, and placeholders for ERD, How it scales, hosted URLs and the AI-usage note

## 7. CI and deployment

- [x] 7.1 Add the GitHub Actions workflow: install → typecheck → lint → Jest → build → Cypress smoke
- [ ] 7.2 Create the Supabase project, capture the pooled connection string, run the first Prisma migration
- [ ] 7.3 Deploy `apps/web` to Vercel with the API base URL configured
- [ ] 7.4 Deploy `apps/api` to Railway or Render with env vars and the CORS allowlist set to the Vercel origin
- [ ] 7.5 Verify the deployed pair: `/health` returns ok, and a credentialed cross-origin request from the deployed frontend succeeds
- [ ] 7.6 Record both hosted URLs in the README

## 8. Close out

- [ ] 8.1 Run `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e` clean
- [ ] 8.2 Run `openspec validate --all --strict`
- [ ] 8.3 Archive the change and act on everything the docs-sync hook reports

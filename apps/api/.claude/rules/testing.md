---
paths:
  - "apps/api/**/*.spec.ts"
  - "apps/api/**/*.cy.ts"
  - "apps/api/cypress/**"
  - "apps/api/jest.config.*"
  - "apps/api/cypress.config.*"
---

# Backend testing

**Scope:** what is tested with Jest, what is tested with Cypress, and what may not be used at all in `apps/api`.

## Rules

1. **Jest and Cypress only.** No Vitest, no Mocha, no Playwright, and no supertest. Adding another runner fails the dependency check in CI.
2. **Jest** covers units and integration: services, the access resolver, name normalisation and conflict resolution, path and depth arithmetic, token rotation, and repositories against a disposable Postgres. Build modules with `@nestjs/testing`.
3. **Cypress** covers HTTP. API end-to-end tests drive the real listening server with `cy.request` — deliberately not an in-process handler, because the reviewer will exercise a real server, including its guards, filters, pipes and cookies.
4. Specs live beside their subject (`*.spec.ts`); Cypress API specs live in `apps/api/cypress/e2e`.
5. Test behaviour through the public surface. A test that reaches into a private method is testing the implementation and will break on a refactor that changed nothing a user can see.
6. Substitute the fake `StorageService` in Jest. No test may touch Supabase or the network.
7. Reset the database between Cypress specs through a task that truncates, not by deleting rows in a hand-rolled order. Specs must pass in any order and in isolation.
8. Every scenario in an OpenSpec capability spec has a corresponding test, and its name should make that obvious. A requirement without a test is not implemented.
9. Test the failure paths as hard as the happy ones: conflicts, expiry, revocation, rejected file types, exceeded limits, unauthorised callers.
10. For anything permission-related, assert on what is **absent** — that a stranger receives 404, that a search result set omits an item — not only on what is present.
11. Concurrency matters here: cover simultaneous same-name creates and simultaneous uploads with real parallel requests, since the unique index is the thing being tested.
12. No sleeps. Wait on a condition — `/health`, a response, a database state.

## Examples

```ts
// Jest — service against a fake storage, no network
const moduleRef = await Test.createTestingModule({
  providers: [FilesService, { provide: StorageService, useClass: InMemoryStorage }],
}).compile();
```

```ts
// Cypress — the real server, cookies included
it("refuses a foreign folder with 404, not 403", () => {
  cy.apiLogin(otherUser);
  cy.request({ url: `/api/folders/${ownersFolderId}`, failOnStatusCode: false })
    .its("status")
    .should("eq", 404);
});
```

```ts
// concurrency is the point of the test — issue the requests in parallel
cy.wrap(Promise.allSettled([createFolder("Reports"), createFolder("reports")]))
  .then((results) => {
    expect(results.filter(fulfilled)).to.have.length(1);
  });
```

## Anti-patterns

- `supertest` — outside the permitted set; use `cy.request`.
- Mocking Prisma to test a repository; the query is the thing under test.
- One long spec that signs in, uploads, shares and deletes, so a failure says nothing about where.
- Asserting only that a permitted user succeeded, never that a forbidden one failed.
- `cy.wait(2000)` in place of waiting for a condition.

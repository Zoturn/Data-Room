---
paths:
  - "apps/web/**/*.spec.ts"
  - "apps/web/**/*.spec.tsx"
  - "apps/web/**/*.cy.ts"
  - "apps/web/**/*.cy.tsx"
  - "apps/web/cypress/**"
  - "apps/web/jest.config.*"
  - "apps/web/cypress.config.*"
---

# Frontend testing

**Scope:** what is tested with Jest, what is tested with Cypress, and what may not be used at all in `apps/web`.

## Rules

1. **Jest and Cypress only.** No Vitest, no Playwright, and no Testing Library. Adding another runner or assertion library fails the dependency check in CI.
2. **Jest** covers logic without a DOM: hooks in isolation, query-key builders, cursor handling, name and extension splitting, byte formatting, the upload queue's state machine, error-envelope parsing.
3. **Cypress Component Testing** covers components. Mount the component, drive it the way a user would, assert on what is rendered. This is the substitute for a component-rendering library, and it exercises real styles and real events.
4. **Cypress E2E** covers the flows the brief grades: multi-file drag-and-drop upload with per-file progress, folder create/rename/delete with the warning, move, file view, public share opened signed-out, permissioned share, revocation, and search.
5. Select by role or by accessible name — `cy.findByRole("button", { name: /delete folder/i })` — not by CSS class. A test that breaks on a class rename was testing the wrong thing; a test that breaks on an accessible-name change caught a real regression.
6. Never add a `data-testid` where a role and a name already identify the element. Selectors are a last resort for genuinely unnamed containers.
7. Stub the API at the network boundary with `cy.intercept` in component tests. E2E runs against the real API and a reset database.
8. Assert on the four states, not only on content: skeletons appear, the empty state offers its actions, the error state offers retry.
9. Test what the user cannot do as carefully as what they can: in a shared view, assert that the upload, rename, move, delete and share controls are **absent**.
10. Cover the awkward paths — a cancelled upload, one failed file among five, a suffixed name reported back, a folder deleted while open.
11. No fixed waits. Wait for a request alias, an element, or a state.
12. Keep specs independent: each sets up its own account and data through API calls, never through the UI of another feature.

## Examples

```tsx
// Cypress component test
it("shows each file's own progress", () => {
  cy.mount(<UploadPanel items={twoUploadsInFlight} />);
  cy.findAllByRole("progressbar").should("have.length", 2);
  cy.findByRole("button", { name: /cancel report\.pdf/i }).click();
  cy.findByText(/cancelled/i).should("be.visible");
});
```

```tsx
// E2E — assert on absence in a shared view
cy.visit(`/s/${token}`);
cy.findByRole("button", { name: /upload/i }).should("not.exist");
cy.findByRole("button", { name: /delete/i }).should("not.exist");
```

```ts
// Jest — pure logic, no DOM
expect(splitName("2024-Q4-report.pdf")).toEqual({ stem: "2024-Q4-report", extension: ".pdf" });
```

## Anti-patterns

- `@testing-library/react` — outside the permitted set; use Cypress Component Testing.
- `cy.get(".folder-row > div:nth-child(2)")`.
- `cy.wait(1000)` instead of waiting for an alias.
- A spec that depends on data another spec created.
- Testing only that a permitted control works, never that a forbidden one is missing.

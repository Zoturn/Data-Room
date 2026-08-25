---
paths:
  - "apps/web/src/components/**"
  - "apps/web/src/features/**"
  - "apps/web/src/**/*.tsx"
---

# React components

**Scope:** component granularity, composition and file layout in `apps/web`.

## Rules

1. Components are granular and single-purpose. A folder row, its name cell, its actions menu and the delete confirmation are four components, not one — that is what makes them testable in Cypress component tests and reusable in the shared view.
2. Separate presentational components from the ones that fetch. A component that both queries and renders a complex tree cannot be tested without a server.
3. One component per file, named for what it renders, in `PascalCase`, with the file matching the component name.
4. Feature code lives in `src/features/<feature>/` (components, hooks, api calls). Only genuinely cross-feature pieces belong in `src/components/`. `src/components/ui/` is shadcn's territory.
5. Props are explicit and typed; no prop-spreading through several layers, no `any`, no optional props standing in for a state machine.
6. Lift state only as far as it must go. A dialog's open state belongs to the row that opens it, not to the page.
7. Derive rather than duplicate. Do not mirror server data into local state — that is what causes a listing to disagree with itself after a rename.
8. Keep hooks at the top level and dependency arrays honest. Do not silence the exhaustive-deps lint; if it complains, the effect is doing too much.
9. A list row must not know it is inside a shared view. Pass capabilities in as props (`canRename`, `canDelete`) so the same row serves both surfaces.
10. Write-controls the caller may not use are **absent**, never disabled. A disabled delete button still tells a viewer that deleting exists here.
11. Long lists virtualise. A folder with thousands of children must not render thousands of rows.
12. Keys come from stable ids, never from an array index.

## Examples

```
src/features/folders/
  components/
    FolderContentsList.tsx
    FolderRow.tsx
    FolderRowActions.tsx
    CreateFolderDialog.tsx
    DeleteFolderDialog.tsx
  hooks/useFolderChildren.ts
  api/folders.ts
```

```tsx
// capabilities as props — one row, two surfaces
type NodeRowProps = {
  node: NodeSummary;
  canRename: boolean;
  canDelete: boolean;
  onOpen: (node: NodeSummary) => void;
};
```

## Anti-patterns

- A 400-line page component that fetches, filters, renders and owns every dialog.
- `<Row {...props} />` forwarding an unknown bag of props.
- `useState` initialised from a query result and then drifting from it.
- `isShared` checks scattered through leaf components.
- A disabled action where the capability is absent.

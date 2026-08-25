---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/tsconfig*.json"
---

# TypeScript conventions

**Scope:** every workspace. Language-level choices only — framework rules live in the app rules.

## Rules

1. `strict` is on and stays on, together with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `noImplicitOverride`. Relaxing a compiler flag to make code compile is a change to the codebase's guarantees, not a local fix.
2. Never write `any`. Use `unknown` at boundaries and narrow it. If a third-party type is wrong, fix it in one declaration file rather than scattering casts.
3. Never write `as` to silence an error. A cast is acceptable only where a runtime check has already proved the type, immediately above it.
4. Never write `!` non-null assertions. Narrow with a guard, or make the type honest.
5. Types that cross the frontend/backend boundary live in `packages/shared` and are inferred from zod schemas (`z.infer`), never hand-written twice.
6. Prefer `type` for object shapes and unions; use `interface` only when declaration merging is actually needed.
7. Model states as discriminated unions rather than several optional booleans, so impossible states cannot be represented.
8. Name things for what they are: no `data`, `info`, `handleStuff`, `tmp`, or numeric suffixes.
9. Export what is used elsewhere and nothing more. An exported symbol is an API someone will depend on.
10. Comment _why_, never _what_. Code that needs a "what" comment needs a better name instead.
11. Async functions return typed results and throw typed errors; a rejected promise must never carry a bare string.

## Examples

Narrowing rather than casting:

```ts
// no
const share = raw as Share;

// yes
const parsed = shareSchema.safeParse(raw);
if (!parsed.success) throw new InvalidShareError(parsed.error);
const share = parsed.data;
```

Impossible states made unrepresentable:

```ts
// no — isLoading && error && data are independently settable
type UploadState = { isLoading: boolean; error?: string; url?: string };

// yes
type UploadState =
  | { status: "idle" }
  | { status: "uploading"; progress: number }
  | { status: "failed"; error: UploadError }
  | { status: "done"; url: string };
```

## Anti-patterns

- `// @ts-expect-error` without a comment explaining the upstream reason and when it goes away.
- `any` in a catch clause instead of `unknown` plus narrowing.
- Duplicating a request or response shape on both sides of the wire.
- Optional properties standing in for a state machine.
- Enums where a union of string literals is clearer and erasable.

---
paths:
  - "packages/shared/**/*.ts"
  - "apps/api/src/**/*.controller.ts"
  - "apps/api/src/**/dto/**/*.ts"
  - "apps/web/src/lib/api/**/*.ts"
---

# API contract

**Scope:** the shape of every request and response crossing between `apps/web` and `apps/api`, and the `packages/shared` schemas that define it.

## Rules

1. Every request and response shape is a zod schema in `packages/shared`. The API derives its DTO validation from it and the web app derives its form validation and types from it. Neither side declares its own copy.
2. Base path is `/api`. Resources are plural nouns; actions that are not CRUD are a sub-path verb (`POST /files/:id/move`), never a verb in the resource name.
3. Success responses return the resource or `{ items, nextCursor }`. Do not wrap successes in a `{ success: true, data }` envelope — the status code already says it worked.
4. Every failure returns exactly this envelope: `{ code, message, details?, requestId }`. `code` is a stable `SCREAMING_SNAKE_CASE` member of the shared union; `message` is for a human; `details` carries one entry per invalid field.
5. Add a new error `code` to the shared union first. A code the client cannot exhaustively handle is a code that will be rendered as "something went wrong".
6. Status codes carry meaning: 400 validation, 401 unauthenticated, 404 not found _or not permitted_, 409 conflict, 413 too large, 429 rate limited, 500 unexpected. Never 403 — it confirms that a resource exists.
7. Lists are cursor-paginated, always. `limit` has a default and a hard maximum; `nextCursor` is an opaque string and is `null` on the last page. Clients must not construct or parse a cursor.
8. Timestamps are ISO 8601 UTC strings. Sizes are bytes as numbers. Ids are strings and opaque — never parse meaning out of one.
9. Do not put anything sensitive in a URL: no emails, no tokens in query strings that end up in logs. Share tokens travel in the path only for public links, which is their purpose.
10. Any operation that silently changed what the user asked for — a suffixed upload name, for example — returns the resolved value so the interface can say what actually happened.
11. Breaking the contract means updating the shared schema, both sides and the tests in one change. There is no deprecation window inside a monorepo.

## Examples

```ts
// packages/shared/src/errors.ts
export const apiErrorCode = z.enum([
  "VALIDATION_FAILED",
  "INVALID_CREDENTIALS",
  "NOT_FOUND",
  "NAME_CONFLICT",
  "MAX_DEPTH_EXCEEDED",
  "INVALID_MOVE_TARGET",
  "UNSUPPORTED_FILE_TYPE",
  "FILE_TOO_LARGE",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
]);

export const apiErrorSchema = z.object({
  code: apiErrorCode,
  message: z.string(),
  details: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
  requestId: z.string(),
});
```

```ts
export const pageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });
```

## Anti-patterns

- `{ success: false, error: "..." }` alongside the standard envelope — one shape, everywhere.
- 403 for an item the caller may not see.
- `?page=3&perPage=20` on Data Room contents.
- Returning 200 with an error body.
- Hand-written response interfaces in `apps/web` that mirror a Nest DTO.

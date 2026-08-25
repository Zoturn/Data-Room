---
paths:
  - "apps/api/src/**/dto/**/*.ts"
  - "apps/api/src/**/*.filter.ts"
  - "apps/api/src/**/*.pipe.ts"
  - "apps/api/src/common/errors/**/*.ts"
---

# Errors and validation

**Scope:** how input is validated and how failures become responses in `apps/api`.

## Rules

1. Every request body, query and param is validated by a DTO derived from the `packages/shared` zod schema. A handler never receives unvalidated input.
2. The validation pipe is global with `whitelist` and `forbidNonWhitelisted` on, so unknown fields are rejected rather than silently ignored.
3. Domain failures are typed exceptions defined next to their module — `NameConflictError`, `MaxDepthExceededError`, `InvalidMoveTargetError`. Services throw those, never `HttpException` and never a bare `Error`.
4. One global exception filter maps domain exceptions to the shared envelope. Mapping lives there alone, so a status code and an error `code` are decided in one place.
5. Every error `code` exists in the shared union before it is thrown. See `api-contract.md`.
6. Internal failures return 500 `INTERNAL_ERROR` with no driver text, no stack trace and no SQL. The full error goes to the log with its `requestId`; the client gets the id and nothing else.
7. Never return 403. Anything the caller may not see is 404 — 403 confirms it exists.
8. Prisma error codes are translated at the repository boundary: `P2002` becomes the domain's conflict error, `P2025` becomes not-found. A raw Prisma error must never reach the filter.
9. Validation messages name the field and what was wrong, in language a user can read. They are rendered in a form, not in a log.
10. Never swallow an error to keep a request alive. The one deliberate exception is best-effort blob deletion, which logs and records the key for the sweep — and says so in a comment.

## Examples

```ts
// domain error, thrown by the service
export class NameConflictError extends DomainError {
  readonly code = "NAME_CONFLICT";
  constructor(readonly name: string) {
    super(`An item named "${name}" already exists in this folder`);
  }
}
```

```ts
// repository boundary — Prisma codes never escape
try {
  return await this.prisma.node.create({ data });
} catch (e) {
  if (isPrismaError(e, "P2002")) throw new NameConflictError(data.name);
  throw e;
}
```

```ts
// the one place that knows about HTTP
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const { status, body } = this.toEnvelope(error, requestIdOf(host));
    host.switchToHttp().getResponse().status(status).json(body);
  }
}
```

## Anti-patterns

- `throw new BadRequestException("...")` inside a service — transport concerns leaking downward.
- `catch (e) { return null; }`, turning a failure into an empty result.
- Returning `{ error: "..." }` with status 200.
- A `message` written for a developer where a user will read it.
- Mapping an error to a status code at the call site instead of in the filter.

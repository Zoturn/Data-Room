---
paths:
  - "apps/web/src/lib/api/**"
  - "apps/web/src/**/hooks/**"
  - "apps/web/src/**/api/**"
  - "apps/web/src/**/*query*.ts"
---

# Data fetching and the API client

**Scope:** the HTTP client, TanStack Query usage, caching and mutations in `apps/web`.

## Rules

1. One API client module wraps `fetch`. Every request sets `credentials: "include"` — a request without it arrives anonymous and the failure looks like a session bug.
2. Failures are parsed into a typed `ApiError` carrying the envelope's `code`, `message`, `details` and `requestId`. Components branch on `code`, never on a message string.
3. A 401 triggers one refresh and one retry, shared single-flight across concurrent requests. A second 401 clears the session and redirects. Never let five parallel 401s trigger five refreshes — the rotation would revoke the family and log the user out.
4. Query keys are hierarchical and declared in one place per feature: `["folders", folderId, "children", params]`. Never inline an ad-hoc key at a call site.
5. Lists use `useInfiniteQuery` with the `nextCursor` from the response. Never fabricate a cursor and never fall back to page numbers.
6. Mutations invalidate the narrowest key that could have changed — the affected folder's children and the ancestor aggregates, not the whole cache.
7. Optimistic updates are for renames and moves, where the outcome is predictable. Always implement the rollback, and reconcile with the server's response: an upload or rename may come back with a *different* name than requested, and the UI must show what actually happened.
8. Never optimistically apply a delete of a folder subtree. Wait for confirmation — the operation is destructive and irreversible.
9. Uploads do not use this client. Progress requires `XMLHttpRequest`; that transport lives in the upload module and is the single documented exception.
10. Set `staleTime` deliberately per query. Folder contents are short-lived; the session is longer; a signed content URL must never be cached past its expiry.
11. Never cache an authorisation decision. Cache data, and treat a 404 as a signal to drop it.
12. Do not build URLs by string concatenation of user input. Encode path segments.

## Examples

```ts
export const folderKeys = {
  all: ["folders"] as const,
  detail: (id: string) => [...folderKeys.all, id] as const,
  children: (id: string, params: ListParams) => [...folderKeys.detail(id), "children", params] as const,
};
```

```ts
// single-flight refresh — concurrent 401s share one rotation
let refreshInFlight: Promise<void> | null = null;
function refreshOnce() {
  refreshInFlight ??= doRefresh().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}
```

```ts
// reconcile with what the server actually did
onSuccess: (result) => {
  if (result.name !== requestedName) {
    toast.info(`Saved as "${result.name}" because that name was taken`);
  }
  queryClient.invalidateQueries({ queryKey: folderKeys.children(parentId) });
}
```

## Anti-patterns

- A `fetch` call in a component, bypassing the client and its error parsing.
- Matching on `error.message === "Not found"`.
- `queryClient.invalidateQueries()` with no key after every mutation.
- Optimistically removing a subtree before the server confirms.
- Caching a signed download URL in a long-lived query.

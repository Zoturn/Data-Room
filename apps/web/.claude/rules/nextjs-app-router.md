---
paths:
  - "apps/web/src/app/**"
  - "apps/web/next.config.*"
  - "apps/web/middleware.ts"
---

# Next.js App Router

**Scope:** routing, the server/client component split, and navigation in `apps/web`.

## Rules

1. The web app is a client shell over the NestJS API. All business logic and authorisation live in the API. Never query the database from Next.js, and never re-implement a permission check here.
2. Route handlers and server actions are used only where the browser genuinely cannot call the API directly. Reach for one deliberately, and say why in the pull request.
3. Everything that reads Data Room content is a client component using TanStack Query — the data is per-user, cookie-authorised and mutated constantly, so server rendering it buys nothing and complicates the session story.
4. Keep `"use client"` at the leaf, not at the layout. A client boundary on a layout makes the whole tree client-side.
5. Navigation state lives in the URL: the open folder, the search query, filters and sort are route params or search params, so every view is linkable, shareable and survives a reload. Never hold them only in React state.
6. Route groups separate the three surfaces: `(auth)` for sign-in and sign-up, `(app)` for the owner's Data Room, `(shared)` for public and restricted share views. Shared routes must not import owner-only components.
7. Every route segment that fetches has a `loading.tsx` and an `error.tsx`. A blank screen during a fetch is a bug.
8. Deep links are honoured: an unauthenticated visitor is sent to sign-in with the destination preserved and returned there afterwards.
9. Public share pages set `robots: { index: false }` in their metadata.
10. Environment values reaching the browser are `NEXT_PUBLIC_` and never secret — the API base URL qualifies, nothing else does.

## Examples

```
src/app/
  (auth)/sign-in/page.tsx
  (app)/rooms/[roomId]/folders/[folderId]/page.tsx
  (app)/rooms/[roomId]/files/[fileId]/page.tsx
  (shared)/s/[token]/page.tsx
```

```tsx
// state in the URL, not in useState
const params = useSearchParams();
const query = params.get("q") ?? "";
```

## Anti-patterns

- `"use client"` at the root layout.
- A server component fetching Data Room content with the user's cookie forwarded by hand.
- Folder navigation held in component state, so the back button and refresh both break.
- Owner components imported into a shared route "just to reuse the list".
- A route that fetches without `loading.tsx`.

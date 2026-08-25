---
paths:
  - "apps/web/src/**/*.tsx"
  - "apps/web/src/app/**/loading.tsx"
  - "apps/web/src/app/**/error.tsx"
---

# UX states

**Scope:** loading, empty, error, destructive and progress states. The brief grades user experience first, and these are where an application usually fails it.

## Rules

1. Every view that fetches has four designed states: loading, empty, error, and content. None of them may be a bare spinner on an empty page or an unexplained blank area.
2. Loading uses skeletons shaped like the content that is coming, so the layout does not jump when it arrives.
3. Empty states say what this place is and offer the next action — an empty folder offers "Create folder" and "Upload files", not just the word "Empty".
4. Errors say what failed, whether it is retryable, and offer the retry. Never render a raw error message or a `requestId` alone.
5. Destructive confirmations state the real consequence with real numbers, taken from the server's preview: "12 folders and 143 files (2.3 GB) will be permanently deleted." Never "Are you sure?"
6. The destructive control is not the default focus, is labelled with the verb ("Delete folder", not "OK"), and the dialog is escapable.
7. Uploads show per-file progress, the resolved name, and per-file cancel and retry. One file's failure must never present as the batch failing.
8. Warn before an action that silently discards work — navigating away with uploads in flight.
9. An item that disappeared under the user (deleted, moved out of a share, share revoked) gets a specific explanation and a route back to somewhere valid. Never a 404 shell or a broken view.
10. Success feedback is proportionate: a toast for a background result (an upload finished, a link copied), nothing at all for an action whose result is visible on screen.
11. Optimistic UI must be reconciled. When the server saved a different name than requested, say so.
12. Nothing important is conveyed by colour alone, and no interactive element is smaller than a comfortable touch target.

## Examples

```tsx
if (query.isPending) return <FolderContentsSkeleton />;
if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;
if (isEmpty) return <EmptyFolderState onCreateFolder={openCreate} onUpload={openPicker} />;
return <FolderContentsList items={items} />;
```

```tsx
<AlertDialogDescription>
  Deleting <strong>{folder.name}</strong> permanently removes {preview.folders} folders and{" "}
  {preview.files} files ({formatBytes(preview.bytes)}). This cannot be undone.
</AlertDialogDescription>
```

## Anti-patterns

- A full-page spinner for a list that could show skeleton rows.
- "Something went wrong" with no retry.
- A confirmation that does not say how much is about to be lost.
- A single progress bar for a batch of uploads.
- A viewer left staring at a broken frame after the owner deleted the file.

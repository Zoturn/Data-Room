---
paths:
  - "apps/web/src/**/*.tsx"
---

# Accessibility

**Scope:** keyboard, screen-reader and focus behaviour in `apps/web`.

## Rules

1. Every action is reachable and operable by keyboard alone: navigating folders, opening the row menu, renaming, uploading through the picker, confirming a delete, copying a share link.
2. Use the semantic element. A row that navigates is a link or a button, never a `div` with an `onClick`. Native elements bring focus, keyboard and screen-reader behaviour for free.
3. Focus is visible everywhere. Never remove an outline without replacing it with a `focus-visible` ring.
4. Dialogs trap focus, return it to the trigger on close, close on Escape, and are labelled by their title. shadcn's primitives do this — do not reimplement one by hand.
5. Icon-only controls carry an accessible name (`aria-label`), and decorative icons are `aria-hidden`.
6. Breadcrumbs are a `<nav aria-label="Breadcrumb">` with an ordered list, and the current folder is marked `aria-current="page"`.
7. Asynchronous outcomes are announced: upload progress and completion, a copied link, a failed action. Use a polite live region; toasts must be announced, not merely drawn.
8. Drag-and-drop always has a keyboard equivalent. A file picker button beside the drop zone is the minimum, since drag-and-drop is unusable without a pointer.
9. Form fields are labelled and their errors associated with `aria-describedby` and `aria-invalid`, so a screen reader hears the error on the field it belongs to.
10. Headings descend in order; the page has exactly one `h1`. Do not choose a heading level for its size.
11. Respect `prefers-reduced-motion` for progress animations and transitions.
12. Text meets WCAG AA contrast against its background, in both themes. Muted foreground on muted background is the usual failure.

## Examples

```tsx
<nav aria-label="Breadcrumb">
  <ol className="flex items-center gap-1">
    {crumbs.map((c, i) => (
      <li key={c.id}>
        <Link href={hrefFor(c)} aria-current={i === crumbs.length - 1 ? "page" : undefined}>
          {c.name}
        </Link>
      </li>
    ))}
  </ol>
</nav>
```

```tsx
<Button variant="ghost" size="icon" aria-label={`Actions for ${node.name}`}>
  <MoreVertical aria-hidden className="size-4" />
</Button>
```

```tsx
<p role="status" aria-live="polite" className="sr-only">
  {completed} of {total} files uploaded
</p>
```

## Anti-patterns

- `<div onClick={...}>` as a table row or a menu item.
- `outline: none` with nothing in its place.
- An icon button with no accessible name.
- Upload progress visible only as a moving bar, announced to nobody.
- Drag-and-drop as the only way to add a file.

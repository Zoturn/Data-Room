---
paths:
  - "apps/web/src/components/ui/**"
  - "apps/web/tailwind.config.*"
  - "apps/web/src/app/globals.css"
  - "apps/web/components.json"
---

# Tailwind and shadcn/ui

**Scope:** styling, design tokens and the shadcn component library in `apps/web`.

## Rules

1. Tailwind utilities in the markup are the default. No CSS modules, no styled-components, no `.css` files beyond `globals.css` and Tailwind's layers.
2. Colour, spacing, radius and typography come from theme tokens — `bg-background`, `text-muted-foreground`, `border-border`. Never a raw hex, `rgb()`, or an arbitrary value like `text-[#3b82f6]` in a component.
3. shadcn components are copied into `src/components/ui/` and owned by this repository. Edit them directly when they need to change; do not wrap one in another component solely to restyle it.
4. Do not modify a shadcn primitive to suit one call site. If a variant is needed, add a variant.
5. Compose class names with the `cn()` helper so conditional classes merge rather than fight.
6. Mobile-first responsive utilities. The Data Room listing, breadcrumb and dialogs must be usable on a narrow viewport — the breadcrumb collapses, the row actions stay reachable.
7. Dark mode uses the token set, so a component that only uses tokens supports it for free. Never hard-code a light-mode colour.
8. Prefer flex and grid utilities to absolute positioning. Absolute positioning is for overlays, drop-zone highlights and progress bars.
9. Spacing comes from the scale. Do not invent `mt-[13px]`.
10. Keep the class list readable: layout, then spacing, then colour, then state variants. When a list grows unmanageable, the component is doing too much.
11. Icons come from one library (`lucide-react`), sized with utilities, and always paired with an accessible name when they are the only content of a control.

## Examples

```tsx
<div className={cn(
  "flex items-center gap-3 rounded-md px-3 py-2",
  "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
  isDropTarget && "bg-accent ring-2 ring-primary",
)}>
```

```ts
// tailwind.config — tokens defined once
theme: {
  extend: {
    colors: {
      background: "hsl(var(--background))",
      foreground: "hsl(var(--foreground))",
      muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
    },
  },
}
```

## Anti-patterns

- `style={{ marginTop: 12 }}` alongside Tailwind classes.
- `bg-[#ffffff]` where `bg-background` exists.
- A `StyledButton` wrapper around shadcn's `Button` to change a colour.
- Copying a shadcn primitive to a second location and editing that copy.
- A desktop-only layout that overflows below 400px.

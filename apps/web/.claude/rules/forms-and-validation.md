---
paths:
  - "apps/web/src/**/*form*.tsx"
  - "apps/web/src/**/*dialog*.tsx"
  - "apps/web/src/**/schemas/**"
---

# Forms and validation

**Scope:** every input the user types — sign-in, folder names, file renames, share recipients.

## Rules

1. Forms use react-hook-form with a zod resolver, and the schema comes from `packages/shared`. The client and the API must agree on what is valid; two schemas will diverge.
2. Client validation is for speed of feedback, never for trust. The API validates the same input again, and the client renders whatever the API rejects.
3. Field errors from the envelope's `details` map onto the matching form fields; anything else becomes a form-level error. A validation failure must never surface as a toast alone — the user cannot see which field is wrong.
4. Disable the submit control while a mutation is in flight and show a pending state on it. Double-submitting a folder creation is a name conflict the user caused by accident.
5. Dialogs that edit something pre-fill with the current value and select it, so renaming is one keystroke away.
6. A rename dialog for a file edits the **stem only** and shows the extension as fixed text. The extension must not be user-editable.
7. Trim on submit, and mirror the API's normalisation in the client's schema so a name that will collide is reported the same way on both sides.
8. `NAME_CONFLICT` is rendered inline on the name field with the conflicting name quoted, not as a generic failure.
9. Never clear a form on error — the user's input is theirs. Clear only after success.
10. Destructive confirmations are not forms: they state exactly what will be lost, keep the destructive control off the default focus, and are dismissible by Escape.
11. Email inputs use `type="email"`, `autoComplete="email"`, and inputmode-appropriate keyboards; password inputs use the right `autoComplete` token so password managers work.
12. Every input has a real `<label>`. A placeholder is not a label.

## Examples

```tsx
const form = useForm<CreateFolderInput>({
  resolver: zodResolver(createFolderSchema), // from packages/shared
  defaultValues: { name: "" },
});

const onSubmit = form.handleSubmit(async (values) => {
  try {
    await createFolder.mutateAsync(values);
    form.reset();
  } catch (error) {
    if (error instanceof ApiError && error.code === "NAME_CONFLICT") {
      form.setError("name", { message: error.message });
      return;
    }
    form.setError("root", { message: "Could not create the folder. Please try again." });
  }
});
```

```tsx
// extension is fixed, stem is editable
<div className="flex items-center gap-1">
  <Input {...form.register("stem")} aria-label="File name" />
  <span className="text-muted-foreground">{extension}</span>
</div>
```

## Anti-patterns

- A second copy of a validation schema in `apps/web`.
- Showing a server validation error only as a toast.
- A submit button that stays enabled during the request.
- Wiping the form on a failed submit.
- Placeholder text standing in for a label.

"use client";

import { useId, type RefObject } from "react";
import { NODE_NAME_MAX_LENGTH } from "@data-room/shared";

export type NameFieldProps = {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  hint?: string | undefined;
  error?: string | undefined;
  disabled?: boolean;
  /** So the dialog that owns this field can focus and select it when it opens. */
  inputRef?: RefObject<HTMLInputElement | null> | undefined;
};

/**
 * The one text field this feature edits — a folder's name, or the Data Room's.
 *
 * A real `<label htmlFor>` rather than a placeholder, `aria-invalid` on the control itself
 * and `aria-describedby` pointing at the error, so a screen reader hears "already exists
 * here" on the field it belongs to instead of somewhere else on the page.
 */
export function NameField({
  label,
  value,
  onValueChange,
  hint,
  error,
  disabled = false,
  inputRef,
}: NameFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId]
    .filter((candidate): candidate is string => candidate !== null)
    .join(" ");

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>

      <input
        id={id}
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
        }}
        disabled={disabled}
        autoComplete="off"
        // A hard stop reads better than an error for a bound nobody reaches by accident.
        maxLength={NODE_NAME_MAX_LENGTH}
        aria-invalid={error !== undefined}
        {...(describedBy === "" ? {} : { "aria-describedby": describedBy })}
        className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive"
      />

      {hint === undefined ? null : (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}

      {error === undefined ? null : (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

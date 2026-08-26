"use client";

import { useId } from "react";

export type AuthTextFieldProps = {
  label: string;
  name: string;
  type: "email" | "password" | "text";
  value: string;
  onValueChange: (value: string) => void;
  /** The right token matters: it is what lets a password manager save and fill the account. */
  autoComplete: string;
  hint?: string | undefined;
  error?: string | undefined;
  disabled?: boolean;
};

/**
 * One labelled input, wired for assistive technology: a real `<label htmlFor>` rather than a
 * placeholder, `aria-invalid` on the control itself, and `aria-describedby` pointing at the
 * hint and the error so a screen reader hears the problem on the field it belongs to instead
 * of somewhere else on the page.
 */
export function AuthTextField({
  label,
  name,
  type,
  value,
  onValueChange,
  autoComplete,
  hint,
  error,
  disabled = false,
}: AuthTextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter((candidate): candidate is string => candidate !== null)
    .join(" ");

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>

      <input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        autoComplete={autoComplete}
        disabled={disabled}
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

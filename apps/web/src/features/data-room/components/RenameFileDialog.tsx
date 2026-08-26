"use client";

import { useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NameField } from "@/features/data-room/components/NameField";
import { joinFileName, splitFileName, validateFileStem } from "@/features/data-room/file-details";
import { nameFailureFrom } from "@/features/data-room/folder-names";

export type RenameFileDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
  isPending: boolean;
  /** Receives the whole name, extension re-attached. Rejects with the API's error. */
  onRename: (name: string) => Promise<void>;
};

/**
 * Renaming a file edits its stem and nothing else.
 *
 * The extension is shown but not editable: turning `report.pdf` into `report` breaks the
 * viewer's association with it for no benefit anyone asked for, and a user who wants a
 * different type has a different file. The dialog re-attaches whatever the name arrived
 * with, so a name with no extension stays that way rather than acquiring one.
 */
export function RenameFileDialog({
  open,
  onOpenChange,
  currentName,
  isPending,
  onRename,
}: RenameFileDialogProps) {
  const { stem: currentStem, extension } = splitFileName(currentName);

  const [stem, setStem] = useState(currentStem);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const preview = joinFileName(stem.trim(), extension);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = stem.trim();
    const invalid = validateFileStem(trimmed, extension);
    if (invalid !== null) {
      setFieldError(invalid);
      return;
    }

    const name = joinFileName(trimmed, extension);

    // Nothing to save, and no reason to spend a request telling the server so.
    if (name === currentName) {
      onOpenChange(false);
      return;
    }

    setFieldError(undefined);
    setFormError(undefined);

    try {
      await onRename(name);
      onOpenChange(false);
    } catch (error) {
      const failure = nameFailureFrom(error, name);
      if (failure.placement === "field") setFieldError(failure.message);
      else setFormError(failure.message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Pre-filled with the stem and pre-selected, so the extension is never in the way of
        // the first keystroke.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const input = inputRef.current;
          if (input === null) return;
          input.focus();
          input.select();
        }}
      >
        <DialogHeader>
          <DialogTitle>Rename file</DialogTitle>
          <DialogDescription>
            {extension === ""
              ? "Only the name changes; the file itself is untouched."
              : `Only the name changes. The “${extension}” ending is kept.`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="grid gap-4">
          {formError === undefined ? null : (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
          )}

          <NameField
            label="File name"
            value={stem}
            onValueChange={setStem}
            // The extension is shown as the name being saved rather than as a decoration
            // beside the field, so what is about to happen is never in doubt.
            hint={`Saves as “${preview}”.`}
            error={fieldError}
            disabled={isPending}
            inputRef={inputRef}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} aria-busy={isPending}>
              {isPending ? (
                <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
              ) : null}
              {isPending ? "Saving…" : "Save name"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

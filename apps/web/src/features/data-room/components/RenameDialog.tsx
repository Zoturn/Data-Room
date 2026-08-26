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
import { nameFailureFrom, validateNodeName } from "@/features/data-room/folder-names";

/**
 * The root folder carries the Data Room's name, so renaming it is renaming the room. Same
 * dialog, same field, different sentence and a different endpoint behind `onRename`.
 */
export type RenameTargetKind = "folder" | "room";

export type RenameDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: RenameTargetKind;
  currentName: string;
  isPending: boolean;
  /** Rejects with the API's error; this dialog decides where the message is rendered. */
  onRename: (name: string) => Promise<void>;
};

export function RenameDialog({
  open,
  onOpenChange,
  kind,
  currentName,
  isPending,
  onRename,
}: RenameDialogProps) {
  const [name, setName] = useState(currentName);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const noun = kind === "room" ? "Data Room" : "folder";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = name.trim();
    const invalid = validateNodeName(trimmed);
    if (invalid !== null) {
      setFieldError(invalid);
      return;
    }

    // Nothing to save, and no reason to spend a request telling the server so.
    if (trimmed === currentName) {
      onOpenChange(false);
      return;
    }

    setFieldError(undefined);
    setFormError(undefined);

    try {
      await onRename(trimmed);
      onOpenChange(false);
    } catch (error) {
      // The optimistic update has already rolled back by the time this runs, so the list
      // behind the dialog shows the old name again and this says why.
      const failure = nameFailureFrom(error, trimmed);
      if (failure.placement === "field") setFieldError(failure.message);
      else setFormError(failure.message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Pre-filled and pre-selected, so renaming is one keystroke away rather than a
        // select-all first.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const input = inputRef.current;
          if (input === null) return;
          input.focus();
          input.select();
        }}
      >
        <DialogHeader>
          <DialogTitle>Rename {noun}</DialogTitle>
          <DialogDescription>
            {kind === "room"
              ? "The Data Room's name is what the root folder is called."
              : "Everything inside keeps its place; only the name changes."}
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
            label={kind === "room" ? "Data Room name" : "Folder name"}
            value={name}
            onValueChange={setName}
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

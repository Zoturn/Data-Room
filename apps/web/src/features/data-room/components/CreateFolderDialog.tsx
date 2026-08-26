"use client";

import { useState, type FormEvent } from "react";
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

export type CreateFolderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Named in the description, so it is obvious where the folder is about to appear. */
  parentName: string;
  isPending: boolean;
  /** Rejects with the API's error; this dialog decides where the message is rendered. */
  onCreate: (name: string) => Promise<void>;
};

export function CreateFolderDialog({
  open,
  onOpenChange,
  parentName,
  isPending,
  onCreate,
}: CreateFolderDialogProps) {
  const [name, setName] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | undefined>(undefined);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Trimmed here as well as on the server, so a name that will collide is reported the
    // same way on both sides.
    const trimmed = name.trim();
    const invalid = validateNodeName(trimmed);
    if (invalid !== null) {
      setFieldError(invalid);
      return;
    }

    setFieldError(undefined);
    setFormError(undefined);

    try {
      await onCreate(trimmed);
      onOpenChange(false);
    } catch (error) {
      // The typed name stays exactly as it was: it is the user's, and it is one edit away
      // from being accepted.
      const failure = nameFailureFrom(error, trimmed);
      if (failure.placement === "field") setFieldError(failure.message);
      else setFormError(failure.message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>
            The folder is created inside <strong className="font-medium">{parentName}</strong>.
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
            label="Folder name"
            value={name}
            onValueChange={setName}
            error={fieldError}
            disabled={isPending}
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
            {/* Disabled while in flight: a double submit is a name conflict the user caused
                by accident. */}
            <Button type="submit" disabled={isPending} aria-busy={isPending}>
              {isPending ? (
                <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
              ) : null}
              {isPending ? "Creating…" : "Create folder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { NodeSummary } from "@data-room/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { actionFailureMessage } from "@/features/data-room/file-details";
import { formatBytes } from "@/features/data-room/format";

export type DeleteFileDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: NodeSummary;
  isDeleting: boolean;
  /** Rejects with the API's error; the dialog stays open and says what happened. */
  onConfirm: () => Promise<void>;
};

/**
 * The confirmation names the file and its size, and says the deletion is permanent.
 *
 * No preview request, unlike a folder: a file's consequence is the file, and it is already
 * in the row the user clicked. What the folder dialog spends a request on, this one already
 * knows.
 */
export function DeleteFileDialog({
  open,
  onOpenChange,
  file,
  isDeleting,
  onConfirm,
}: DeleteFileDialogProps) {
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  async function handleConfirm() {
    setFormError(undefined);

    try {
      await onConfirm();
    } catch (error) {
      setFormError(actionFailureMessage(error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // The destructive control is never the default focus: an accidental Enter on an
        // opening dialog must not delete a document.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Delete this file?</DialogTitle>
          <DialogDescription>
            Deleting <strong className="font-medium">{file.name}</strong> (
            {formatBytes(file.sizeBytes)}) permanently removes it and the document it holds. This
            cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {formError === undefined ? null : (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {formError}
          </p>
        )}

        <DialogFooter>
          <Button
            ref={cancelRef}
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              void handleConfirm();
            }}
            disabled={isDeleting}
            aria-busy={isDeleting}
          >
            {isDeleting ? (
              <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
            ) : null}
            {isDeleting ? "Deleting…" : "Delete file"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

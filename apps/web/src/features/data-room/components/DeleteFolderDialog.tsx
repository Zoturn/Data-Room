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
import { ApiError, NetworkError } from "@/lib/api/errors";
import { describeSubtree } from "@/features/data-room/format";
import { useDeletionPreview } from "@/features/data-room/hooks/useFolderContents";

export type DeleteFolderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder: NodeSummary;
  isDeleting: boolean;
  /** Rejects with the API's error; the dialog stays open and says what happened. */
  onConfirm: () => Promise<void>;
};

/**
 * The confirmation states the real consequence, in the server's own numbers.
 *
 * The preview is fetched when the dialog opens and the destructive control stays disabled
 * until it arrives, so nobody can confirm a deletion whose size they were never shown. "Are
 * you sure?" tells the owner nothing they did not already know.
 */
export function DeleteFolderDialog({
  open,
  onOpenChange,
  folder,
  isDeleting,
  onConfirm,
}: DeleteFolderDialogProps) {
  const preview = useDeletionPreview(folder.id, open);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  const contents = preview.data === undefined ? null : describeSubtree(preview.data);

  async function handleConfirm() {
    setFormError(undefined);

    try {
      await onConfirm();
    } catch (error) {
      setFormError(failureMessage(error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // The destructive control is never the default focus: an accidental Enter on an
        // opening dialog must not delete a subtree.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Delete this folder?</DialogTitle>

          <DialogDescription aria-live="polite">
            {preview.isPending ? (
              <>
                Checking what is inside <strong className="font-medium">{folder.name}</strong>…
              </>
            ) : null}

            {preview.isError ? (
              <>Could not check what is inside this folder, so nothing has been deleted.</>
            ) : null}

            {contents === null && preview.data !== undefined ? (
              <>
                Deleting <strong className="font-medium">{folder.name}</strong> removes an empty
                folder. This cannot be undone.
              </>
            ) : null}

            {contents !== null ? (
              <>
                Deleting <strong className="font-medium">{folder.name}</strong> permanently removes{" "}
                {contents}. This cannot be undone.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {preview.isPending ? (
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        ) : null}

        {preview.isError ? (
          <Button
            variant="outline"
            className="justify-self-start"
            onClick={() => {
              void preview.refetch();
            }}
          >
            Try again
          </Button>
        ) : null}

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
            disabled={isDeleting || preview.data === undefined}
            aria-busy={isDeleting}
          >
            {isDeleting ? (
              <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
            ) : null}
            {isDeleting ? "Deleting…" : "Delete folder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** API messages are written for the person reading them; anything else is our bug. */
function failureMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof NetworkError) return error.message;
  return "Something went wrong. Please try again.";
}

"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { Breadcrumb, NodeSummary } from "@data-room/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FolderPicker, type PickerSelection } from "@/features/data-room/components/FolderPicker";
import { moveFailureMessage } from "@/features/data-room/file-details";

export type MoveFileDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: NodeSummary;
  /** The chain above the file, root first — the picker's starting point and its open path. */
  breadcrumbs: readonly Breadcrumb[];
  currentParentId: string;
  isPending: boolean;
  /** Rejects with the API's error; the dialog stays open and says what happened. */
  onMove: (destination: PickerSelection) => Promise<void>;
};

/**
 * Choosing where a file goes.
 *
 * Only folders are offered, so "a file cannot contain a file" is a fact of the picker rather
 * than an error message — the API still refuses a non-folder target, because a dialog is not
 * where a rule is enforced. The folder the file is already in is visible but unselectable:
 * hiding it would leave the user hunting for the place they are looking at.
 */
export function MoveFileDialog({
  open,
  onOpenChange,
  file,
  breadcrumbs,
  currentParentId,
  isPending,
  onMove,
}: MoveFileDialogProps) {
  const [selection, setSelection] = useState<PickerSelection | null>(null);
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const root = breadcrumbs[0];

  async function handleMove() {
    if (selection === null) return;

    setFormError(undefined);

    try {
      await onMove(selection);
      onOpenChange(false);
    } catch (error) {
      setFormError(moveFailureMessage(error, selection.name));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move file</DialogTitle>
          <DialogDescription>
            Choose a folder for <strong className="font-medium">{file.name}</strong>. If that folder
            already holds a file with this name, it will be given a numbered one.
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

        {root === undefined ? (
          // No chain means the API answered with a file that has no place in the tree; there
          // is nothing honest to draw a picker from.
          <p className="text-sm text-muted-foreground">
            We could not work out where this file sits. Refresh and try again.
          </p>
        ) : (
          <FolderPicker
            root={root}
            openPath={breadcrumbs.map((crumb) => crumb.id)}
            currentParentId={currentParentId}
            selection={selection}
            onSelect={setSelection}
            disabled={isPending}
          />
        )}

        <p className="text-sm text-muted-foreground" aria-live="polite">
          {selection === null ? "No folder chosen yet." : `Moving into “${selection.name}”.`}
        </p>

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
          <Button
            type="button"
            onClick={() => {
              void handleMove();
            }}
            disabled={isPending || selection === null}
            aria-busy={isPending}
          >
            {isPending ? (
              <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
            ) : null}
            {isPending ? "Moving…" : "Move here"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

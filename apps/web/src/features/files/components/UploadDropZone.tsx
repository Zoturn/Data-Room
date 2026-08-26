"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { FileUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useUploadCommits, useUploadQueue } from "@/features/files/hooks/useUploads";
import {
  destinationFromRow,
  isFileDrag,
  FOLDER_DROP_ID_ATTRIBUTE,
  FOLDER_DROP_NAME_ATTRIBUTE,
  FOLDER_DROP_SELECTOR,
  type UploadDestination,
} from "@/features/files/upload/destination";
import { UPLOAD_LIMITS } from "@/features/files/upload/limits";
import { screenFiles, toUploadFile } from "@/features/files/upload/select";

export type UploadDropZoneProps = {
  roomId: string;
  folderId: string;
  folderName: string;
  children: ReactNode;
};

/**
 * The listing, wrapped in a target that accepts PDFs.
 *
 * Drag-and-drop is the gesture people reach for and the only one some of them try, so the
 * whole listing is the target rather than a small dashed rectangle beneath it — including the
 * empty state, which is exactly where a first upload happens. The picker beside it is not a
 * lesser path: it is the one a keyboard uses, and it is the one that works when the browser
 * refuses a drag from a network share.
 *
 * Dropping onto a folder row uploads into that folder. The row publishes its identity as
 * markup (see `destination.ts`) because this component wraps the listing and never sees a
 * row's props.
 */
export function UploadDropZone({ roomId, folderId, folderName, children }: UploadDropZoneProps) {
  const queue = useUploadQueue();
  useUploadCommits(roomId);

  const inputRef = useRef<HTMLInputElement | null>(null);
  /**
   * `dragenter` and `dragleave` fire for every element the pointer crosses inside the zone,
   * so a counter — not a boolean — is what tells a move between two rows from a real exit.
   */
  const depth = useRef(0);
  const [destination, setDestination] = useState<UploadDestination | null>(null);

  const here: UploadDestination = { folderId, folderName };

  function accept(files: readonly File[], into: UploadDestination): void {
    const { accepted, rejected } = screenFiles(files, UPLOAD_LIMITS);

    // Each rejection names the file and the rule it broke: "three files were skipped" leaves
    // the user to work out which three and why.
    for (const rejection of rejected) toast.error(rejection.message);
    if (accepted.length === 0) return;

    queue.enqueue(
      accepted.map((file) => ({
        folderId: into.folderId,
        folderName: into.folderName,
        file: toUploadFile(file, UPLOAD_LIMITS),
      })),
    );
  }

  function destinationUnder(target: EventTarget | null): UploadDestination {
    if (!(target instanceof Element)) return here;

    const row = target.closest(FOLDER_DROP_SELECTOR);
    if (row === null) return here;

    return destinationFromRow(
      row.getAttribute(FOLDER_DROP_ID_ATTRIBUTE),
      row.getAttribute(FOLDER_DROP_NAME_ATTRIBUTE),
      here,
    );
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>): void {
    if (!isFileDrag(event.dataTransfer.types)) return;
    depth.current += 1;
    setDestination(destinationUnder(event.target));
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    if (!isFileDrag(event.dataTransfer.types)) return;
    // Without this the browser treats the drop as navigation and opens the PDF in the tab.
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDestination(destinationUnder(event.target));
  }

  function handleDragLeave(): void {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDestination(null);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    if (!isFileDrag(event.dataTransfer.types)) return;
    event.preventDefault();

    const into = destinationUnder(event.target);
    depth.current = 0;
    setDestination(null);

    accept([...event.dataTransfer.files], into);
  }

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-border px-3 py-2">
        <p className="text-sm text-muted-foreground">
          Drop PDFs anywhere in this list, or onto a folder to put them inside it. Up to{" "}
          {formatLimit()} each.
        </p>

        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          <FileUp aria-hidden />
          Choose files
        </Button>

        {/* Hidden rather than absent: the button above is the visible control, and a file
          input cannot be opened without one the user actually clicked. */}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="application/pdf,.pdf"
          className="sr-only"
          aria-label={`Choose PDFs to upload to ${folderName}`}
          onChange={(event) => {
            const chosen = event.target.files;
            if (chosen !== null) accept([...chosen], here);
            // Cleared so choosing the same file twice in a row still fires a change event.
            event.target.value = "";
          }}
        />
      </div>

      {children}

      {destination === null ? null : (
        <div
          // Purely decorative: the sentence below is announced through the live region, and
          // a drag has no keyboard equivalent to trap focus in.
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-background/85"
        >
          <p className="max-w-sm px-4 text-center text-sm font-medium">
            Upload to “{destination.folderName}”
          </p>
        </div>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {destination === null ? "" : `Drop to upload into ${destination.folderName}`}
      </p>
    </div>
  );
}

function formatLimit(): string {
  return `${String(Math.round(UPLOAD_LIMITS.maxBytes / (1024 * 1024)))} MB`;
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Download,
  ExternalLink,
  FileX,
  FolderInput,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState } from "@/components/states";
import { Breadcrumbs } from "@/features/data-room/components/Breadcrumbs";
import { DeleteFileDialog } from "@/features/data-room/components/DeleteFileDialog";
import { MoveFileDialog } from "@/features/data-room/components/MoveFileDialog";
import { RenameFileDialog } from "@/features/data-room/components/RenameFileDialog";
import type { PickerSelection } from "@/features/data-room/components/FolderPicker";
import {
  actionFailureMessage,
  fileCrumbs,
  fileLocation,
  isMissing,
} from "@/features/data-room/file-details";
import { formatBytes, formatExactTime, formatUpdatedAt } from "@/features/data-room/format";
import {
  useDeleteFile,
  useFileContentUrl,
  useFileDetail,
  useMoveFile,
  useRenameFile,
} from "@/features/data-room/hooks/useFile";
import { fileHref, folderHref, roomHref } from "@/features/data-room/routes";

/** Which dialog is open. A union, so "renaming, but nothing to rename" cannot be a state. */
type ActiveDialog = { kind: "none" } | { kind: "rename" } | { kind: "move" } | { kind: "delete" };

export type FileViewerProps = {
  roomId: string;
  fileId: string;
};

/**
 * One file, open: what it is, where it sits, the document itself, and what the owner can do
 * to it.
 *
 * The bytes are never proxied through this app — the frame is pointed at a signed URL the
 * API issues for a few minutes at a time, and the actions below operate on metadata alone.
 */
export function FileViewer({ roomId, fileId }: FileViewerProps) {
  const router = useRouter();

  const detail = useFileDetail(fileId);
  const content = useFileContentUrl(fileId, detail.isSuccess);

  const renameFile = useRenameFile();
  const moveFile = useMoveFile(roomId);
  const deleteFile = useDeleteFile(roomId);

  const [dialog, setDialog] = useState<ActiveDialog>({ kind: "none" });

  /**
   * The URL the frame is showing, which is deliberately not the freshest one.
   *
   * Renewal exists so the actions and a reload always have a live URL, but re-pointing the
   * frame reloads the plugin and throws the reader back to page one. A document already on
   * screen has its bytes; the renewed URL is there for when it does not.
   */
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [frameNonce, setFrameNonce] = useState(0);
  const latestUrl = content.data?.url ?? null;

  useEffect(() => {
    if (latestUrl !== null) setFrameUrl((current) => current ?? latestUrl);
  }, [latestUrl]);

  const file = detail.data?.file ?? null;
  const location = detail.data === undefined ? null : fileLocation(detail.data);

  function closeDialog() {
    setDialog({ kind: "none" });
  }

  /** Points the frame at the newest URL and forces the plugin to start over. */
  function reloadPreview() {
    setFrameUrl(latestUrl);
    setFrameNonce((previous) => previous + 1);
    if (latestUrl === null) void content.refetch();
  }

  async function handleRename(name: string): Promise<void> {
    if (file === null || location === null) return;
    await renameFile.mutateAsync({ file, name, at: location });
  }

  async function handleMove(destination: PickerSelection): Promise<void> {
    if (file === null || location === null) return;

    await moveFile.mutateAsync({
      file,
      from: location,
      to: { parentId: destination.id, ancestry: destination.ancestry },
    });
    toast.success(`Moved to “${destination.name}”.`);
  }

  async function handleDelete(): Promise<void> {
    if (file === null || location === null) return;

    await deleteFile.mutateAsync({ file, at: location });
    closeDialog();
    toast.success(`Deleted “${file.name}”.`);
    // Nothing left on this page to look at; the folder it was in is where the user now is.
    router.replace(folderHref(roomId, location.parentId));
  }

  if (detail.isPending) return <ViewerSkeleton />;

  /**
   * A file that is gone answers 404, and so does one that was never the caller's — the API
   * refuses to distinguish them on purpose. Either way the answer is the same: this is not
   * here any more, and here is the way back.
   */
  if (detail.isError && isMissing(detail.error)) {
    return (
      <EmptyState
        icon={<FileX className="size-8" aria-hidden />}
        title="This file is no longer available"
        description="It was deleted, or it was never yours to open. Everything else in your Data Room is untouched."
        action={
          <Button asChild>
            <Link href={roomHref(roomId)}>Back to your Data Room</Link>
          </Button>
        }
      />
    );
  }

  if (detail.data === undefined) {
    return (
      <ErrorState
        title="Could not open this file"
        description={actionFailureMessage(detail.error)}
        onRetry={() => {
          void detail.refetch();
        }}
      />
    );
  }

  const opened = detail.data;
  const parentId = location?.parentId ?? null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Breadcrumbs
          crumbs={fileCrumbs(opened)}
          hrefFor={(id) => (id === opened.file.id ? fileHref(roomId, id) : folderHref(roomId, id))}
        />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold">{opened.file.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatBytes(opened.file.sizeBytes)} ·{" "}
              <span title={formatExactTime(opened.file.updatedAt)}>
                Modified {formatUpdatedAt(opened.file.updatedAt)}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <DownloadAction url={latestUrl} name={opened.file.name} />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={`Actions for ${opened.file.name}`}
                >
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    setDialog({ kind: "rename" });
                  }}
                >
                  <Pencil aria-hidden />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setDialog({ kind: "move" });
                  }}
                >
                  <FolderInput aria-hidden />
                  Move to…
                </DropdownMenuItem>
                <DropdownMenuItem
                  destructive
                  onSelect={() => {
                    setDialog({ kind: "delete" });
                  }}
                >
                  <Trash2 aria-hidden />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <FilePreview
        name={opened.file.name}
        url={frameUrl}
        nonce={frameNonce}
        isFailed={content.isError}
        failureMessage={actionFailureMessage(content.error)}
        onReload={reloadPreview}
      />

      {dialog.kind === "rename" ? (
        <RenameFileDialog
          open
          onOpenChange={(next) => {
            if (!next) closeDialog();
          }}
          currentName={opened.file.name}
          isPending={renameFile.isPending}
          onRename={handleRename}
        />
      ) : null}

      {dialog.kind === "move" && parentId !== null ? (
        <MoveFileDialog
          open
          onOpenChange={(next) => {
            if (!next) closeDialog();
          }}
          file={opened.file}
          breadcrumbs={opened.breadcrumbs}
          currentParentId={parentId}
          isPending={moveFile.isPending}
          onMove={handleMove}
        />
      ) : null}

      {dialog.kind === "delete" ? (
        <DeleteFileDialog
          open
          onOpenChange={(next) => {
            if (!next) closeDialog();
          }}
          file={opened.file}
          isDeleting={deleteFile.isPending}
          onConfirm={handleDelete}
        />
      ) : null}
    </div>
  );
}

/**
 * The document itself.
 *
 * `<object>` rather than `<iframe>` for exactly one reason: its children are the browser's
 * own fallback, rendered when it will not display a PDF inline — which is still the case on
 * most mobile browsers and wherever the built-in viewer is turned off. So the offer to
 * download is markup the browser chooses, not a guess this app makes about the user agent.
 */
function FilePreview({
  name,
  url,
  nonce,
  isFailed,
  failureMessage,
  onReload,
}: {
  name: string;
  url: string | null;
  nonce: number;
  isFailed: boolean;
  failureMessage: string;
  onReload: () => void;
}) {
  if (isFailed) {
    return (
      <ErrorState
        title="Could not load this document"
        description={failureMessage}
        onRetry={onReload}
      />
    );
  }

  if (url === null) {
    return (
      <div
        className="h-[70vh] w-full animate-pulse rounded-lg border border-border bg-muted motion-reduce:animate-none"
        role="status"
        aria-label={`Loading ${name}`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <object
        // Remounting is the only way to make the plugin start over, so the reload control
        // changes the key rather than hoping a re-render is enough.
        key={`${nonce}`}
        data={url}
        type="application/pdf"
        aria-label={`${name}, document preview`}
        className="h-[70vh] w-full rounded-lg border border-border bg-muted"
      >
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            This browser will not show a PDF here. Download it or open it in a new tab to read it.
          </p>
          <div className="flex gap-2">
            <Button asChild>
              <a href={url} download={name}>
                <Download aria-hidden />
                Download
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden />
                Open in a new tab
              </a>
            </Button>
          </div>
        </div>
      </object>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onReload}>
          <RefreshCw aria-hidden />
          Reload preview
        </Button>
      </div>
    </div>
  );
}

/**
 * The download.
 *
 * `download` is honoured for a same-origin URL and ignored for a cross-origin one, and the
 * bytes deliberately live on another origin — so this reliably hands the file to the
 * browser, which either saves it or opens its own viewer with its own save control. Either
 * outcome gives the user the file; neither routes 50 MB through this app.
 */
function DownloadAction({ url, name }: { url: string | null; name: string }) {
  if (url === null) {
    return (
      <Button disabled aria-busy>
        <Download aria-hidden />
        Download
      </Button>
    );
  }

  return (
    <Button asChild>
      <a href={url} download={name}>
        <Download aria-hidden />
        Download
      </a>
    </Button>
  );
}

/** Shaped like the viewer that is coming, so nothing jumps when the file arrives. */
function ViewerSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="flex flex-col gap-3">
        <div className="h-4 w-48 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <div className="h-8 w-72 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <div className="h-4 w-40 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      </div>
      <div className="h-[70vh] w-full animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
      <p className="sr-only" aria-live="polite">
        Opening this file
      </p>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderPlus, FolderX, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { NodeSummary, SubtreeAggregate } from "@data-room/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { ApiError, NetworkError } from "@/lib/api/errors";
import { UploadDropZone } from "@/features/files/components/UploadDropZone";
import { UploadPanel } from "@/features/files/components/UploadPanel";
import { Breadcrumbs } from "@/features/data-room/components/Breadcrumbs";
import { CreateFolderDialog } from "@/features/data-room/components/CreateFolderDialog";
import { DeleteFileDialog } from "@/features/data-room/components/DeleteFileDialog";
import { DeleteFolderDialog } from "@/features/data-room/components/DeleteFolderDialog";
import type { PickerSelection } from "@/features/data-room/components/FolderPicker";
import { MoveFileDialog } from "@/features/data-room/components/MoveFileDialog";
import { NodeList } from "@/features/data-room/components/NodeList";
import { NodeRow } from "@/features/data-room/components/NodeRow";
import { ShareDialog } from "@/features/sharing/components/ShareDialog";
import { RenameDialog } from "@/features/data-room/components/RenameDialog";
import { RenameFileDialog } from "@/features/data-room/components/RenameFileDialog";
import { isMissing } from "@/features/data-room/file-details";
import { summariseAggregate } from "@/features/data-room/format";
import { useRenameDataRoom, useRoomSummary } from "@/features/data-room/hooks/useDataRoom";
import { useDeleteFile, useMoveFile, useRenameFile } from "@/features/data-room/hooks/useFile";
import {
  childrenOf,
  openedFolder,
  useCreateFolder,
  useDeleteNode,
  useFolderAggregate,
  useFolderContents,
  useRenameNode,
  type TreeLocation,
} from "@/features/data-room/hooks/useFolderContents";
import { fileHref, folderHref, roomHref } from "@/features/data-room/routes";

/**
 * Which dialog is open, and what it is about. A union rather than five booleans and five
 * nullable targets: "renaming, but no node chosen" is then not a state that can exist.
 *
 * A rename and a delete each serve both kinds of node, dispatching on `node.type` at the
 * point of use — folders and files answer to different endpoints and different dialogs, but
 * the row that opened them is the same row.
 *
 * `at: null` on a rename means the open folder is the Data Room root, whose name belongs to
 * the room itself — so that rename goes to the room endpoint.
 */
type ActiveDialog =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "rename"; node: NodeSummary; at: TreeLocation | null }
  | { kind: "move"; node: NodeSummary; at: TreeLocation }
  | { kind: "delete"; node: NodeSummary; at: TreeLocation; leavesOpenFolder: boolean }
  | { kind: "share"; node: NodeSummary };

export type FolderContentsProps = {
  roomId: string;
  folderId: string;
};

/**
 * One folder: where it sits, what is in it, and everything the owner can do to it.
 *
 * This is the component that fetches; the breadcrumb, the rows and the dialogs are
 * presentational and take their capabilities as props, so the same pieces serve a shared
 * view later without knowing they are in one.
 */
export function FolderContents({ roomId, folderId }: FolderContentsProps) {
  const router = useRouter();

  const contents = useFolderContents(folderId);
  const opened = openedFolder(contents.data);
  const items = childrenOf(contents.data);

  const isRoot = opened !== null && opened.breadcrumbs.length === 1;
  const roomSummary = useRoomSummary(roomId);
  // At the root the folder's subtree *is* the room, so asking twice would print the same
  // numbers twice.
  const folderTotals = useFolderAggregate(folderId, opened !== null && !isRoot);

  const createFolder = useCreateFolder(roomId);
  const renameNode = useRenameNode();
  const renameRoom = useRenameDataRoom(roomId);
  const deleteNode = useDeleteNode(roomId);

  const renameFile = useRenameFile();
  const moveFile = useMoveFile(roomId);
  const deleteFile = useDeleteFile(roomId);

  const [dialog, setDialog] = useState<ActiveDialog>({ kind: "none" });
  const loadMoreRef = useRef<HTMLButtonElement | null>(null);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = contents;

  // Infinite scroll, with the "Load more" button as its own sentinel — so a pointer never
  // has to press it and a keyboard never has to scroll.
  useEffect(() => {
    const element = loadMoreRef.current;
    if (element === null || !hasNextPage || isFetchingNextPage) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage();
      },
      { rootMargin: "240px" },
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const ancestry = opened === null ? [] : opened.breadcrumbs.map((crumb) => crumb.id);
  const here: TreeLocation | null =
    opened === null ? null : { parentId: opened.folder.id, ancestry };
  const parentCrumb = opened === null ? undefined : opened.breadcrumbs.at(-2);
  const above: TreeLocation | null =
    parentCrumb === undefined
      ? null
      : { parentId: parentCrumb.id, ancestry: ancestry.slice(0, -1) };

  function closeDialog() {
    setDialog({ kind: "none" });
  }

  async function handleCreate(name: string): Promise<void> {
    if (here === null) return;
    await createFolder.mutateAsync({ name, at: here });
  }

  async function handleRename(name: string): Promise<void> {
    if (dialog.kind !== "rename") return;
    if (dialog.at === null) {
      await renameRoom.mutateAsync(name);
      return;
    }

    if (dialog.node.type === "FILE") {
      await renameFile.mutateAsync({ file: dialog.node, name, at: dialog.at });
      return;
    }

    await renameNode.mutateAsync({ node: dialog.node, name, at: dialog.at });
  }

  async function handleMove(destination: PickerSelection): Promise<void> {
    if (dialog.kind !== "move") return;

    await moveFile.mutateAsync({
      file: dialog.node,
      from: dialog.at,
      to: { parentId: destination.id, ancestry: destination.ancestry },
    });
    toast.success(`Moved to “${destination.name}”.`);
  }

  async function handleDelete(): Promise<void> {
    if (dialog.kind !== "delete") return;
    const { node, at, leavesOpenFolder } = dialog;

    if (node.type === "FILE") {
      await deleteFile.mutateAsync({ file: node, at });
      closeDialog();
      toast.success(`Deleted “${node.name}”.`);
      return;
    }

    await deleteNode.mutateAsync({ node, at });
    closeDialog();

    if (leavesOpenFolder) {
      // The folder they were standing in no longer exists; the parent is where they are now.
      router.replace(folderHref(roomId, at.parentId));
      toast.success(`Deleted “${node.name}”.`);
    }
  }

  const statLine = buildStatLine({
    isRoot,
    folderTotals: folderTotals.data,
    roomTotals: roomSummary.data,
  });

  /**
   * A folder that has gone takes its own heading and its actions with it — offering
   * "New folder" inside something that no longer exists is the broken view this state is
   * here to replace. Any other failure keeps whatever was already on screen, because stale
   * rows still tell the truth about what was there a moment ago.
   */
  const isGone = contents.isError && isMissing(contents.error);
  const hasFailed = contents.isError && !isGone && opened === null;

  return (
    <div className="flex flex-col gap-6">
      {isGone ? null : (
        <header className="flex flex-col gap-3">
          {opened === null ? (
            <HeaderSkeleton />
          ) : (
            <>
              <Breadcrumbs crumbs={opened.breadcrumbs} hrefFor={(id) => folderHref(roomId, id)} />

              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="truncate text-2xl font-semibold">{opened.folder.name}</h1>
                  {statLine === null ? (
                    <span
                      className="mt-2 block h-4 w-56 animate-pulse rounded bg-muted motion-reduce:animate-none"
                      aria-hidden
                    />
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">{statLine}</p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => {
                      setDialog({ kind: "create" });
                    }}
                  >
                    <FolderPlus aria-hidden />
                    New folder
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={`Actions for ${opened.folder.name}`}
                      >
                        <MoreHorizontal aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => {
                          setDialog({ kind: "rename", node: opened.folder, at: above });
                        }}
                      >
                        <Pencil aria-hidden />
                        {isRoot ? "Rename Data Room" : "Rename folder"}
                      </DropdownMenuItem>

                      {/* The root cannot be deleted — a Data Room with no folder to open is a
                        state this interface has nothing to show for. */}
                      {above === null ? null : (
                        <DropdownMenuItem
                          destructive
                          onSelect={() => {
                            setDialog({
                              kind: "delete",
                              node: opened.folder,
                              at: above,
                              leavesOpenFolder: true,
                            });
                          }}
                        >
                          <Trash2 aria-hidden />
                          Delete folder
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </>
          )}
        </header>
      )}

      {contents.isPending ? <ListSkeleton /> : null}

      {isGone ? (
        <EmptyState
          icon={<FolderX className="size-8" aria-hidden />}
          title="This folder is no longer available"
          description="It was deleted, or it was never yours to open. Everything else in your Data Room is untouched."
          action={
            <Button asChild>
              <Link href={roomHref(roomId)}>Back to your Data Room</Link>
            </Button>
          }
        />
      ) : null}

      {hasFailed ? (
        <ErrorState
          title="Could not open this folder"
          description={describeFailure(contents.error)}
          onRetry={() => {
            void contents.refetch();
          }}
        />
      ) : null}

      {/* The drop zone covers the listing and the empty state alike: an empty folder is
        exactly where someone reaches for drag-and-drop, and a target that only appears once
        a folder has something in it is a target nobody finds. */}
      {opened === null ? null : (
        <UploadDropZone roomId={roomId} folderId={folderId} folderName={opened.folder.name}>
          {items.length === 0 ? (
            <EmptyState
              icon={<FolderPlus className="size-8" aria-hidden />}
              title={isRoot ? "Your Data Room is empty" : "This folder is empty"}
              description="Drop PDFs here to add them, or create a folder to organise what goes in. Nothing is visible to anyone else until you share it."
              action={
                <Button
                  onClick={() => {
                    setDialog({ kind: "create" });
                  }}
                >
                  <FolderPlus aria-hidden />
                  New folder
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-3">
              <NodeList
                items={items}
                renderRow={(node) => (
                  <NodeRow
                    key={node.id}
                    node={node}
                    href={
                      node.type === "FOLDER"
                        ? folderHref(roomId, node.id)
                        : fileHref(roomId, node.id)
                    }
                    canRename
                    canShare
                    // Only files move in this change; a folder move rewrites a whole subtree
                    // and has no endpoint yet, so it is absent rather than disabled.
                    canMove={node.type === "FILE"}
                    canDelete
                    onRename={(target) => {
                      setDialog({ kind: "rename", node: target, at: here });
                    }}
                    onMove={(target) => {
                      if (here === null) return;
                      setDialog({ kind: "move", node: target, at: here });
                    }}
                    onShare={(target) => {
                      setDialog({ kind: "share", node: target });
                    }}
                    onDelete={(target) => {
                      if (here === null) return;
                      setDialog({
                        kind: "delete",
                        node: target,
                        at: here,
                        leavesOpenFolder: false,
                      });
                    }}
                  />
                )}
              />

              {hasNextPage ? (
                <div className="flex justify-center">
                  <Button
                    ref={loadMoreRef}
                    variant="outline"
                    onClick={() => {
                      void fetchNextPage();
                    }}
                    disabled={isFetchingNextPage}
                    aria-busy={isFetchingNextPage}
                  >
                    {isFetchingNextPage ? "Loading…" : "Load more"}
                  </Button>
                </div>
              ) : null}

              <p role="status" aria-live="polite" className="sr-only">
                {isFetchingNextPage ? "Loading more items" : ""}
              </p>
            </div>
          )}
        </UploadDropZone>
      )}

      {/* Uploads outlive the folder they started in, so the panel is rendered beside the
        listing rather than inside the drop zone it came from. */}
      <UploadPanel />

      {opened !== null && dialog.kind === "create" ? (
        <CreateFolderDialog
          open
          onOpenChange={(next) => {
            if (!next) closeDialog();
          }}
          parentName={opened.folder.name}
          isPending={createFolder.isPending}
          onCreate={handleCreate}
        />
      ) : null}

      {dialog.kind === "share" ? (
        <ShareDialog
          open
          onOpenChange={(next) => {
            if (!next) closeDialog();
          }}
          node={dialog.node}
        />
      ) : null}

      {dialog.kind === "rename" && dialog.node.type === "FILE" ? (
        <RenameFileDialog
          open
          onOpenChange={(next) => {
            if (!next) closeDialog();
          }}
          currentName={dialog.node.name}
          isPending={renameFile.isPending}
          onRename={handleRename}
        />
      ) : null}

      {dialog.kind === "rename" && dialog.node.type === "FOLDER" ? (
        <RenameDialog
          open
          onOpenChange={(next) => {
            if (!next) closeDialog();
          }}
          kind={dialog.at === null ? "room" : "folder"}
          currentName={dialog.node.name}
          isPending={dialog.at === null ? renameRoom.isPending : renameNode.isPending}
          onRename={handleRename}
        />
      ) : null}

      {dialog.kind === "move" && opened !== null ? (
        <MoveFileDialog
          open
          onOpenChange={(next) => {
            if (!next) closeDialog();
          }}
          file={dialog.node}
          // The open folder's own chain: the picker starts at the room root with the path
          // down to here already expanded, which is where the file being moved lives.
          breadcrumbs={opened.breadcrumbs}
          currentParentId={dialog.at.parentId}
          isPending={moveFile.isPending}
          onMove={handleMove}
        />
      ) : null}

      {dialog.kind === "delete" && dialog.node.type === "FILE" ? (
        <DeleteFileDialog
          open
          onOpenChange={(next) => {
            if (!next) closeDialog();
          }}
          file={dialog.node}
          isDeleting={deleteFile.isPending}
          onConfirm={handleDelete}
        />
      ) : null}

      {dialog.kind === "delete" && dialog.node.type === "FOLDER" ? (
        <DeleteFolderDialog
          open
          onOpenChange={(next) => {
            if (!next) closeDialog();
          }}
          folder={dialog.node}
          isDeleting={deleteNode.isPending}
          onConfirm={handleDelete}
        />
      ) : null}
    </div>
  );
}

/** Shaped like the header that is coming, so nothing jumps when the folder arrives. */
function HeaderSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <div className="h-4 w-48 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      <div className="h-8 w-64 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      <div className="h-4 w-56 animate-pulse rounded bg-muted motion-reduce:animate-none" />
    </div>
  );
}

/**
 * The Data Room's totals are always stated; the open folder's are stated as well once they
 * differ from them. `null` while the numbers are still in flight, so the caller can hold
 * the space instead of letting the heading jump.
 */
function buildStatLine(input: {
  isRoot: boolean;
  folderTotals: SubtreeAggregate | undefined;
  roomTotals: SubtreeAggregate | undefined;
}): string | null {
  const parts: string[] = [];

  if (!input.isRoot && input.folderTotals !== undefined) {
    parts.push(`${summariseAggregate(input.folderTotals)} in this folder`);
  }

  if (input.roomTotals !== undefined) {
    parts.push(
      input.isRoot
        ? `${summariseAggregate(input.roomTotals)} in this Data Room`
        : `Data Room total ${summariseAggregate(input.roomTotals)}`,
    );
  }

  return parts.length === 0 ? null : parts.join(" · ");
}

function describeFailure(error: Error): string {
  if (error instanceof ApiError || error instanceof NetworkError) return error.message;
  return "We could not load what is in this folder. Trying again often works.";
}

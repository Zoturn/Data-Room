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
import { Breadcrumbs } from "@/features/data-room/components/Breadcrumbs";
import { CreateFolderDialog } from "@/features/data-room/components/CreateFolderDialog";
import { DeleteFolderDialog } from "@/features/data-room/components/DeleteFolderDialog";
import { NodeRow } from "@/features/data-room/components/NodeRow";
import { RenameDialog } from "@/features/data-room/components/RenameDialog";
import { summariseAggregate } from "@/features/data-room/format";
import { useRenameDataRoom, useRoomSummary } from "@/features/data-room/hooks/useDataRoom";
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
import { folderHref, roomHref } from "@/features/data-room/routes";

/**
 * Which dialog is open, and what it is about. A union rather than four booleans and four
 * nullable targets: "renaming, but no folder chosen" is then not a state that can exist.
 *
 * `at: null` on a rename means the open folder is the Data Room root, whose name belongs to
 * the room itself — so that rename goes to the room endpoint.
 */
type ActiveDialog =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "rename"; node: NodeSummary; at: TreeLocation | null }
  | { kind: "delete"; node: NodeSummary; at: TreeLocation; leavesOpenFolder: boolean };

export type FolderContentsProps = {
  roomId: string;
  folderId: string;
};

/**
 * One folder: where it sits, what is in it, and everything the owner can do to it.
 *
 * This is the component that fetches; the breadcrumb, the rows and the three dialogs are
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
    await renameNode.mutateAsync({ node: dialog.node, name, at: dialog.at });
  }

  async function handleDelete(): Promise<void> {
    if (dialog.kind !== "delete") return;
    const { node, at, leavesOpenFolder } = dialog;

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

      {contents.isSuccess && items.length === 0 ? (
        <EmptyState
          icon={<FolderPlus className="size-8" aria-hidden />}
          title={isRoot ? "Your Data Room is empty" : "This folder is empty"}
          description="Create a folder to organise what goes in here. Nothing is visible to anyone else until you share it."
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
      ) : null}

      {!isGone && items.length > 0 ? (
        <div className="flex flex-col gap-3">
          <ul className="rounded-lg border border-border">
            <li
              className="flex items-center gap-2 border-b border-border px-2 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
              aria-hidden
            >
              <span className="flex-1 pl-8">Name</span>
              <span className="hidden w-24 text-right sm:block">Size</span>
              <span className="hidden w-40 text-right md:block">Modified</span>
              <span className="w-9" />
            </li>

            {items.map((node) => (
              <NodeRow
                key={node.id}
                node={node}
                href={node.type === "FOLDER" ? folderHref(roomId, node.id) : null}
                // Files arrive with add-file-management; until then a file row has no
                // actions rather than disabled ones.
                canRename={node.type === "FOLDER"}
                canDelete={node.type === "FOLDER"}
                onRename={(target) => {
                  setDialog({ kind: "rename", node: target, at: here });
                }}
                onDelete={(target) => {
                  if (here === null) return;
                  setDialog({ kind: "delete", node: target, at: here, leavesOpenFolder: false });
                }}
              />
            ))}
          </ul>

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
      ) : null}

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

      {dialog.kind === "rename" ? (
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

      {dialog.kind === "delete" ? (
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

/**
 * A folder that is gone answers 404, and so does one that was never the caller's — the API
 * refuses to distinguish them on purpose. Either way the answer to the person looking at it
 * is the same: this is not here any more, and here is the way back.
 */
function isMissing(error: Error): boolean {
  return error instanceof ApiError && error.status === 404;
}

function describeFailure(error: Error): string {
  if (error instanceof ApiError || error instanceof NetworkError) return error.message;
  return "We could not load what is in this folder. Trying again often works.";
}

"use client";

import Link from "next/link";
import { FileText, Folder, FolderInput, MoreVertical, Pencil, Trash2 } from "lucide-react";
import type { NodeSummary } from "@data-room/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatBytes, formatExactTime, formatUpdatedAt } from "@/features/data-room/format";

export type NodeRowProps = {
  node: NodeSummary;
  /** A folder opens its listing, a file opens its viewer; `null` leaves the row inert. */
  href: string | null;
  /**
   * Capabilities arrive as props so this row serves the owner's view and, later, a shared
   * one. An action the caller may not take is absent — a disabled Delete still tells a
   * viewer that deleting exists here.
   */
  canRename: boolean;
  canMove: boolean;
  canDelete: boolean;
  onRename: (node: NodeSummary) => void;
  onMove: (node: NodeSummary) => void;
  onDelete: (node: NodeSummary) => void;
};

export function NodeRow({
  node,
  href,
  canRename,
  canMove,
  canDelete,
  onRename,
  onMove,
  onDelete,
}: NodeRowProps) {
  const isFolder = node.type === "FOLDER";
  const Icon = isFolder ? Folder : FileText;

  const label = (
    <>
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate font-medium">{node.name}</span>
    </>
  );

  return (
    <li
      // The listing measures one of these to size its window; every row is the same height,
      // so the first is enough.
      data-node-row
      // Dropping files onto a folder row uploads into that folder. The drop zone wraps the
      // whole listing and cannot reach into a row's props, so the destination is published
      // as markup it can find under the pointer with `closest()`.
      data-folder-drop-id={isFolder ? node.id : undefined}
      data-folder-drop-name={isFolder ? node.name : undefined}
      className="flex items-center gap-2 border-b border-border px-2 last:border-b-0 hover:bg-accent/40"
    >
      {href === null ? (
        <span className="flex min-w-0 flex-1 items-center gap-3 py-3">{label}</span>
      ) : (
        <Link
          href={href}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
        </Link>
      )}

      <span className="hidden w-24 shrink-0 text-right text-sm text-muted-foreground sm:block">
        {isFolder ? <span aria-hidden>—</span> : formatBytes(node.sizeBytes)}
      </span>

      <span
        className="hidden w-40 shrink-0 text-right text-sm text-muted-foreground md:block"
        title={formatExactTime(node.updatedAt)}
      >
        <span className="sr-only">Modified </span>
        {formatUpdatedAt(node.updatedAt)}
      </span>

      {canRename || canMove || canDelete ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${node.name}`}>
              <MoreVertical aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canRename ? (
              <DropdownMenuItem
                onSelect={() => {
                  onRename(node);
                }}
              >
                <Pencil aria-hidden />
                Rename
              </DropdownMenuItem>
            ) : null}
            {canMove ? (
              <DropdownMenuItem
                onSelect={() => {
                  onMove(node);
                }}
              >
                <FolderInput aria-hidden />
                Move to…
              </DropdownMenuItem>
            ) : null}
            {canDelete ? (
              <DropdownMenuItem
                destructive
                onSelect={() => {
                  onDelete(node);
                }}
              >
                <Trash2 aria-hidden />
                Delete
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}

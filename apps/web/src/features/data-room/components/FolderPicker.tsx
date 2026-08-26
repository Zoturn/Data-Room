"use client";

import { useState } from "react";
import { ChevronRight, Folder, Loader2 } from "lucide-react";
import type { Breadcrumb } from "@data-room/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { childrenOf, useFolderContents } from "@/features/data-room/hooks/useFolderContents";

/**
 * A folder chosen as a destination, carrying the path it was found down.
 *
 * The ancestry is not decoration: a move changes the totals of every folder above the
 * destination, and those are the queries that have to be invalidated. The picker is the only
 * thing that knows the chain, because it is what walked it.
 */
export type PickerSelection = {
  readonly id: string;
  readonly name: string;
  /** Root first, the chosen folder last. */
  readonly ancestry: readonly string[];
};

export type FolderPickerProps = {
  /** The Data Room's root, which is always where the tree starts. */
  root: Breadcrumb;
  /** Expanded when the picker opens, so the user starts where the file already is. */
  openPath: readonly string[];
  /** The folder the file is already in — a destination that would change nothing. */
  currentParentId: string;
  selection: PickerSelection | null;
  onSelect: (selection: PickerSelection) => void;
  disabled: boolean;
};

/**
 * Every folder in the Data Room, one level at a time.
 *
 * Branches are fetched only once they are opened, through the same query the folder listing
 * uses — so expanding a folder the user just came from costs nothing, and a Data Room of a
 * hundred thousand nodes never has to be enumerated to offer a destination. Files are
 * filtered out here rather than asked for separately: the API has one listing endpoint, and
 * a second one for folders alone would be a new contract for a dialog.
 */
export function FolderPicker({
  root,
  openPath,
  currentParentId,
  selection,
  onSelect,
  disabled,
}: FolderPickerProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(openPath));

  function toggle(folderId: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (!next.delete(folderId)) next.add(folderId);
      return next;
    });
  }

  return (
    <div className="max-h-72 overflow-y-auto rounded-md border border-border p-1">
      <ul className="grid gap-0.5">
        <Branch
          folder={root}
          ancestry={[root.id]}
          depth={0}
          expanded={expanded}
          onToggle={toggle}
          selection={selection}
          currentParentId={currentParentId}
          onSelect={onSelect}
          disabled={disabled}
        />
      </ul>
    </div>
  );
}

type BranchProps = {
  folder: Breadcrumb;
  /** Root first, this folder last. */
  ancestry: readonly string[];
  depth: number;
  expanded: ReadonlySet<string>;
  onToggle: (folderId: string) => void;
  selection: PickerSelection | null;
  currentParentId: string;
  onSelect: (selection: PickerSelection) => void;
  disabled: boolean;
};

function Branch(props: BranchProps) {
  const { folder, ancestry, depth, expanded, onToggle, selection, currentParentId } = props;

  const isExpanded = expanded.has(folder.id);
  const isCurrent = folder.id === currentParentId;
  const isSelected = selection?.id === folder.id;

  return (
    <li>
      <div
        className="flex items-center gap-1"
        // Indentation is the only thing that says which folder contains which, so it is
        // computed rather than picked from a handful of utility classes.
        style={{ paddingLeft: `${depth * 1.25}rem` }}
      >
        <button
          type="button"
          onClick={() => {
            onToggle(folder.id);
          }}
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${folder.name}`}
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight
            className={cn("size-4 transition-transform", isExpanded && "rotate-90")}
            aria-hidden
          />
        </button>

        <button
          type="button"
          onClick={() => {
            props.onSelect({ id: folder.id, name: folder.name, ancestry });
          }}
          disabled={props.disabled || isCurrent}
          // `aria-pressed` rather than a checked radio: this is a toggle over a tree that
          // only ever has one thing pressed, and a radio group would need every branch
          // mounted to be navigable.
          aria-pressed={isSelected}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isSelected ? "bg-accent font-medium" : "hover:bg-accent/50",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{folder.name}</span>
          {isCurrent ? (
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">Already here</span>
          ) : null}
        </button>
      </div>

      {/* Mounted only while open, which is what makes the fetch lazy — there is no `enabled`
        flag to keep in step with the expansion state. */}
      {isExpanded ? <SubFolders {...props} /> : null}
    </li>
  );
}

function SubFolders(props: BranchProps) {
  const { folder, ancestry, depth } = props;

  const contents = useFolderContents(folder.id);
  const folders = childrenOf(contents.data).filter((node) => node.type === "FOLDER");
  const indent = { paddingLeft: `${(depth + 1) * 1.25 + 1.75}rem` };

  if (contents.isPending) {
    return (
      <p className="flex items-center gap-2 py-1 text-sm text-muted-foreground" style={indent}>
        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        Loading…
      </p>
    );
  }

  if (contents.isError) {
    return (
      <p role="alert" className="py-1 text-sm text-destructive" style={indent}>
        Could not list this folder.
      </p>
    );
  }

  if (folders.length === 0) {
    return (
      <p className="py-1 text-sm text-muted-foreground" style={indent}>
        No folders inside.
      </p>
    );
  }

  return (
    <ul className="grid gap-0.5">
      {folders.map((child) => (
        <Branch
          {...props}
          key={child.id}
          folder={{ id: child.id, name: child.name }}
          ancestry={[...ancestry, child.id]}
          depth={depth + 1}
        />
      ))}

      {/* A folder with more children than one page: the rest are one press away rather than
        silently missing from the destinations on offer. */}
      {contents.hasNextPage ? (
        <li style={indent}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void contents.fetchNextPage();
            }}
            disabled={contents.isFetchingNextPage}
            aria-busy={contents.isFetchingNextPage}
          >
            {contents.isFetchingNextPage ? "Loading…" : "Show more folders"}
          </Button>
        </li>
      ) : null}
    </ul>
  );
}

"use client";

import { useCallback } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  Breadcrumb,
  DeletionPreview,
  NodeSummary,
  Page,
  SubtreeAggregate,
} from "@data-room/shared";
import {
  createFolder,
  dataRoomKeys,
  deleteFolder,
  fetchDeletionPreview,
  fetchFolderAggregate,
  fetchFolderChildren,
  fetchFolderContents,
  folderKeys,
  renameFolder,
} from "@/features/data-room/api/folders";

/**
 * Opening a folder answers with the folder, its breadcrumbs and the first page of children;
 * following the cursor answers with children alone. Two shapes, one paginated query — a
 * union rather than optional fields, so "a later page has no breadcrumbs" is a fact of the
 * type instead of a hole every reader has to remember.
 */
export type ContentsPage =
  | {
      kind: "opening";
      folder: NodeSummary;
      breadcrumbs: Breadcrumb[];
      children: Page<NodeSummary>;
    }
  | { kind: "continuation"; children: Page<NodeSummary> };

/**
 * The page param is left at its default `unknown`: it is an opaque cursor this app follows
 * and never reads, and pinning it here only makes the query's own inferred type disagree
 * with the one the cache is read back through.
 */
type ContentsData = InfiniteData<ContentsPage>;

/** Where a write lands: the folder it happens in, and every ancestor whose totals it moves. */
export type TreeLocation = {
  readonly parentId: string;
  /** Root first, `parentId` last. */
  readonly ancestry: readonly string[];
};

const CHILDREN_PER_PAGE = 50;

/** `null` asks for the folder itself; anything else is an opaque cursor being followed. */
const FIRST_PAGE: string | null = null;

export function useFolderContents(folderId: string) {
  return useInfiniteQuery({
    queryKey: folderKeys.contents(folderId),
    initialPageParam: FIRST_PAGE,
    queryFn: async ({ pageParam, signal }): Promise<ContentsPage> => {
      if (pageParam === null) {
        const contents = await fetchFolderContents(folderId, { limit: CHILDREN_PER_PAGE }, signal);
        return { kind: "opening", ...contents };
      }

      const children = await fetchFolderChildren(
        folderId,
        { limit: CHILDREN_PER_PAGE, cursor: pageParam },
        signal,
      );
      return { kind: "continuation", children };
    },
    getNextPageParam: (lastPage: ContentsPage) => lastPage.children.nextCursor,
    // Folder contents are short-lived: another tab, or the owner's own last write, can have
    // moved them.
    staleTime: 15_000,
  });
}

/** The folder that was opened, or `null` while the first page is still in flight. */
export function openedFolder(
  data: ContentsData | undefined,
): { folder: NodeSummary; breadcrumbs: Breadcrumb[] } | null {
  const first = data?.pages[0];
  if (first === undefined || first.kind !== "opening") return null;

  return { folder: first.folder, breadcrumbs: first.breadcrumbs };
}

export function childrenOf(data: ContentsData | undefined): NodeSummary[] {
  return data?.pages.flatMap((page) => page.children.items) ?? [];
}

export function useFolderAggregate(
  folderId: string,
  enabled: boolean,
): UseQueryResult<SubtreeAggregate, Error> {
  return useQuery({
    queryKey: folderKeys.aggregate(folderId),
    queryFn: ({ signal }) => fetchFolderAggregate(folderId, signal),
    enabled,
    staleTime: 15_000,
  });
}

/**
 * The numbers the confirmation dialog states. Never cached: the dialog exists to tell the
 * truth about what is about to be destroyed, and a number from two minutes ago is a guess.
 */
export function useDeletionPreview(
  folderId: string,
  enabled: boolean,
): UseQueryResult<DeletionPreview, Error> {
  return useQuery({
    queryKey: folderKeys.deletionPreview(folderId),
    queryFn: ({ signal }) => fetchDeletionPreview(folderId, signal),
    enabled,
    staleTime: 0,
    gcTime: 0,
  });
}

/**
 * Invalidates exactly what a write moved: the listing it happened in, the totals of every
 * ancestor above it, and the room's own summary. Never the whole cache.
 */
function useTreeInvalidation(roomId: string): (at: TreeLocation) => void {
  const queryClient = useQueryClient();

  return useCallback(
    (at: TreeLocation) => {
      void queryClient.invalidateQueries({ queryKey: folderKeys.contents(at.parentId) });
      void queryClient.invalidateQueries({ queryKey: dataRoomKeys.summary(roomId) });

      for (const ancestorId of at.ancestry) {
        void queryClient.invalidateQueries({ queryKey: folderKeys.aggregate(ancestorId) });
      }
    },
    [queryClient, roomId],
  );
}

export type CreateFolderVariables = { name: string; at: TreeLocation };

export function useCreateFolder(
  roomId: string,
): UseMutationResult<NodeSummary, Error, CreateFolderVariables> {
  const invalidate = useTreeInvalidation(roomId);

  return useMutation({
    mutationFn: ({ name, at }: CreateFolderVariables) =>
      createFolder({ parentId: at.parentId, name }),
    // No optimistic insert: where the row lands depends on the server's ordering, and a
    // colliding name is decided by the database rather than by anything this client knows.
    onSuccess: (_folder, { at }) => {
      invalidate(at);
    },
  });
}

export type RenameVariables = { node: NodeSummary; name: string; at: TreeLocation };

type RenameContext = {
  previousParent: ContentsData | undefined;
  previousSelf: ContentsData | undefined;
};

function mapPageChildren(
  page: ContentsPage,
  map: (items: NodeSummary[]) => NodeSummary[],
): ContentsPage {
  const children: Page<NodeSummary> = { ...page.children, items: map(page.children.items) };

  return page.kind === "opening"
    ? { kind: "opening", folder: page.folder, breadcrumbs: page.breadcrumbs, children }
    : { kind: "continuation", children };
}

function withRenamedChild(
  data: ContentsData | undefined,
  nodeId: string,
  name: string,
): ContentsData | undefined {
  if (data === undefined) return undefined;

  return {
    ...data,
    pages: data.pages.map((page) =>
      mapPageChildren(page, (items) =>
        items.map((item) => (item.id === nodeId ? { ...item, name } : item)),
      ),
    ),
  };
}

/** A folder renamed while it is open must retitle itself and its own last breadcrumb too. */
function withRenamedSelf(data: ContentsData | undefined, name: string): ContentsData | undefined {
  if (data === undefined) return undefined;

  const [first, ...rest] = data.pages;
  if (first === undefined || first.kind !== "opening") return data;

  const last = first.breadcrumbs.length - 1;
  const breadcrumbs = first.breadcrumbs.map((crumb, index) =>
    index === last ? { ...crumb, name } : crumb,
  );

  return {
    ...data,
    pages: [{ ...first, folder: { ...first.folder, name }, breadcrumbs }, ...rest],
  };
}

/**
 * Optimistic, because a rename's outcome is predictable and the row is what the user is
 * looking at. The rollback is not optional: a sibling already holding that name makes the
 * server say no, and the list must not keep showing a name that was refused.
 */
export function useRenameNode(): UseMutationResult<
  NodeSummary,
  Error,
  RenameVariables,
  RenameContext
> {
  const queryClient = useQueryClient();

  return useMutation<NodeSummary, Error, RenameVariables, RenameContext>({
    mutationFn: ({ node, name }) => renameFolder(node.id, name),

    onMutate: async ({ node, name, at }) => {
      const parentKey = folderKeys.contents(at.parentId);
      const selfKey = folderKeys.contents(node.id);

      // An in-flight fetch would land after the patch and quietly undo it.
      await Promise.all([
        queryClient.cancelQueries({ queryKey: parentKey }),
        queryClient.cancelQueries({ queryKey: selfKey }),
      ]);

      const previousParent = queryClient.getQueryData<ContentsData>(parentKey);
      const previousSelf = queryClient.getQueryData<ContentsData>(selfKey);

      queryClient.setQueryData(parentKey, withRenamedChild(previousParent, node.id, name));
      queryClient.setQueryData(selfKey, withRenamedSelf(previousSelf, name));

      return { previousParent, previousSelf };
    },

    onError: (_error, { node, at }, context) => {
      if (context === undefined) return;
      queryClient.setQueryData(folderKeys.contents(at.parentId), context.previousParent);
      queryClient.setQueryData(folderKeys.contents(node.id), context.previousSelf);
    },

    onSuccess: (saved, { name }) => {
      // The server normalises what it stores. When it saved something other than what was
      // typed, say so rather than letting the two quietly disagree.
      if (saved.name !== name) toast.info(`Saved as “${saved.name}”.`);
    },

    // A rename moves no counts, so the totals are deliberately left alone: only the listing
    // that holds the row, and the folder's own view, can be showing the old name.
    onSettled: (_saved, _error, { node, at }) => {
      void queryClient.invalidateQueries({ queryKey: folderKeys.contents(at.parentId) });
      void queryClient.invalidateQueries({ queryKey: folderKeys.contents(node.id) });
    },
  });
}

export type DeleteVariables = { node: NodeSummary; at: TreeLocation };

/**
 * Never optimistic. Taking a subtree off the screen before the server has agreed shows an
 * outcome that cannot be undone if it turns out not to have happened.
 */
export function useDeleteNode(roomId: string): UseMutationResult<void, Error, DeleteVariables> {
  const queryClient = useQueryClient();
  const invalidate = useTreeInvalidation(roomId);

  return useMutation({
    mutationFn: ({ node }: DeleteVariables) => deleteFolder(node.id),
    onSuccess: (_result, { node, at }) => {
      // Everything cached under the deleted folder describes rows that no longer exist.
      queryClient.removeQueries({ queryKey: folderKeys.detail(node.id) });
      invalidate(at);
    },
  });
}

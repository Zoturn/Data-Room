"use client";

import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { ContentUrl, FileDetail, NodeSummary } from "@data-room/shared";
import {
  deleteFile,
  fetchContentUrl,
  fetchFile,
  fileKeys,
  moveFile,
  renameFile,
} from "@/features/data-room/api/files";
import { folderKeys } from "@/features/data-room/api/folders";
import { renewalDelayMs } from "@/features/data-room/file-details";
import {
  useTreeInvalidation,
  type TreeLocation,
} from "@/features/data-room/hooks/useFolderContents";

/** One file's metadata and its place in the tree — everything the viewer's header needs. */
export function useFileDetail(fileId: string): UseQueryResult<FileDetail, Error> {
  return useQuery({
    queryKey: fileKeys.detail(fileId),
    queryFn: ({ signal }) => fetchFile(fileId, signal),
    // Short, like a folder listing: another tab can rename or move this file out from under
    // the one that is open.
    staleTime: 15_000,
  });
}

/**
 * `setTimeout` stores its delay in a signed 32-bit integer, and anything larger wraps to a
 * negative — which fires immediately and spins. A URL good for longer than 24 days is not a
 * case this product has, but a renewal loop is a bad way to find that out.
 */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * The signed URL for the bytes, kept alive for as long as the file is open.
 *
 * Renewal is on a timer rather than on failure: the browser reports an expired URL as a
 * blank frame with no event this code can see, so waiting for the error means waiting for
 * the reader to lose their place. Nothing here is cached — a signed URL is a credential
 * with an expiry, and a stale one in the cache is just a broken viewer.
 */
export function useFileContentUrl(
  fileId: string,
  enabled: boolean,
): UseQueryResult<ContentUrl, Error> {
  const query = useQuery({
    queryKey: fileKeys.contentUrl(fileId),
    queryFn: ({ signal }) => fetchContentUrl(fileId, signal),
    enabled,
    staleTime: 0,
    gcTime: 0,
  });

  const { data, refetch } = query;

  useEffect(() => {
    if (data === undefined) return undefined;

    const timer = setTimeout(
      () => {
        void refetch();
      },
      Math.min(renewalDelayMs(data.expiresAt), MAX_TIMER_MS),
    );

    return () => {
      clearTimeout(timer);
    };
  }, [data, refetch]);

  return query;
}

export type RenameFileVariables = { file: NodeSummary; name: string; at: TreeLocation };

/**
 * Not optimistic, unlike a folder rename: a colliding name is suffixed rather than refused,
 * so the name the server saves is regularly not the one that was typed. Showing the typed
 * one first would mean correcting it a moment later.
 */
export function useRenameFile(): UseMutationResult<NodeSummary, Error, RenameFileVariables> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ file, name }: RenameFileVariables) => renameFile(file.id, name),

    onSuccess: (saved, { name, at }) => {
      // Suffixed, trimmed or normalised — whatever the server settled on, say it rather than
      // letting the header and the user's memory of what they typed disagree.
      if (saved.name !== name) toast.info(`Saved as “${saved.name}”.`);

      queryClient.setQueryData<FileDetail>(fileKeys.detail(saved.id), (previous) =>
        previous === undefined ? undefined : { ...previous, file: saved },
      );
      void queryClient.invalidateQueries({ queryKey: folderKeys.contents(at.parentId) });
    },
  });
}

export type MoveFileVariables = {
  file: NodeSummary;
  /** Where it is now — the listing that loses the row. */
  from: TreeLocation;
  /** Where it is going — the listing that gains it, and the ancestors whose totals move. */
  to: TreeLocation;
};

/**
 * A move touches two listings and two chains of totals, so both ends are invalidated. The
 * file's own detail is refetched rather than patched: its breadcrumbs are now wrong, and
 * they are the viewer's only way back out.
 */
export function useMoveFile(
  roomId: string,
): UseMutationResult<NodeSummary, Error, MoveFileVariables> {
  const queryClient = useQueryClient();
  const invalidate = useTreeInvalidation(roomId);

  return useMutation({
    mutationFn: ({ file, to }: MoveFileVariables) => moveFile(file.id, to.parentId),

    onSuccess: (saved, { file, from, to }) => {
      if (saved.name !== file.name) {
        toast.info(`Moved as “${saved.name}” — that folder already had a “${file.name}”.`);
      }

      invalidate(from);
      invalidate(to);
      void queryClient.invalidateQueries({ queryKey: fileKeys.detail(file.id) });
    },
  });
}

export type DeleteFileVariables = { file: NodeSummary; at: TreeLocation };

/**
 * Never optimistic. Taking the file off the screen before the server has agreed shows an
 * outcome that cannot be undone if it turns out not to have happened.
 */
export function useDeleteFile(roomId: string): UseMutationResult<void, Error, DeleteFileVariables> {
  const queryClient = useQueryClient();
  const invalidate = useTreeInvalidation(roomId);

  return useMutation({
    mutationFn: ({ file }: DeleteFileVariables) => deleteFile(file.id),

    onSuccess: (_result, { file, at }) => {
      // Both the metadata and the signed URL describe something that no longer exists, and
      // the URL in particular must not be handed to a viewer that reopens this id.
      queryClient.removeQueries({ queryKey: fileKeys.detail(file.id) });
      queryClient.removeQueries({ queryKey: fileKeys.contentUrl(file.id) });
      invalidate(at);
    },
  });
}

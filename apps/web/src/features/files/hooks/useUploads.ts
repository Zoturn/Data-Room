"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { dataRoomKeys, folderKeys } from "@/features/data-room/api/folders";
import { installUnloadWarning } from "@/features/files/upload/unload-guard";
import type { UploadItem, UploadQueue } from "@/features/files/upload/queue";
import { uploadQueue } from "@/features/files/upload/store";

/** Stable across renders and across the server snapshot, so the store never looks changed. */
const NO_ITEMS: readonly UploadItem[] = [];

export function useUploadQueue(): UploadQueue {
  return uploadQueue();
}

/**
 * The queue's rows, re-rendered on every change.
 *
 * The server snapshot is empty rather than the queue's own: the singleton would otherwise be
 * shared between requests during rendering, and there is no upload in flight on a server.
 */
export function useUploadItems(): readonly UploadItem[] {
  const queue = uploadQueue();
  return useSyncExternalStore(queue.subscribe, queue.getItems, () => NO_ITEMS);
}

/**
 * Folds each committed file into the cache as it lands.
 *
 * Per file rather than per batch: thirty files finishing one by one should appear one by one,
 * which is also what keeps a slow upload from making the listing look broken. Invalidation
 * rather than an optimistic insert — the server decides both the resolved name and where the
 * row sorts.
 *
 * The ancestor totals are matched by predicate because a file dropped onto a folder row goes
 * somewhere whose chain of parents this view never loaded. Only mounted queries refetch, so
 * the broad match costs nothing the user is not already looking at.
 */
export function useUploadCommits(roomId: string): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    return uploadQueue().onCommitted((event) => {
      void queryClient.invalidateQueries({ queryKey: folderKeys.contents(event.folderId) });
      void queryClient.invalidateQueries({ queryKey: dataRoomKeys.summary(roomId) });
      void queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === folderKeys.all[0] && query.queryKey.at(-1) === "aggregate",
      });
    });
  }, [queryClient, roomId]);
}

/** Asks the browser to confirm a tab close while any transfer is still running. */
export function useUnloadWarning(): void {
  useEffect(() => {
    const queue = uploadQueue();
    return installUnloadWarning(window, () => queue.activeCount() > 0);
  }, []);
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { DataRoom, SubtreeAggregate } from "@data-room/shared";
import {
  dataRoomKeys,
  fetchDataRoom,
  fetchRoomSummary,
  folderKeys,
  renameDataRoom,
} from "@/features/data-room/api/folders";
import { folderHref } from "@/features/data-room/routes";

/**
 * The caller's Data Room. The first read provisions it, so this is also what makes a brand
 * new account land somewhere usable instead of on a setup step.
 */
export function useDataRoom(): UseQueryResult<DataRoom, Error> {
  return useQuery({
    queryKey: dataRoomKeys.me(),
    queryFn: ({ signal }) => fetchDataRoom(signal),
    // The room's identity changes only when this app renames it, and that path writes the
    // cache directly.
    staleTime: 5 * 60_000,
  });
}

/** Totals for everything in the room, at every depth. */
export function useRoomSummary(roomId: string): UseQueryResult<SubtreeAggregate, Error> {
  return useQuery({
    queryKey: dataRoomKeys.summary(roomId),
    queryFn: ({ signal }) => fetchRoomSummary(roomId, signal),
    staleTime: 15_000,
  });
}

export function useRenameDataRoom(roomId: string): UseMutationResult<DataRoom, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => renameDataRoom(roomId, name),
    onSuccess: (room) => {
      queryClient.setQueryData(dataRoomKeys.me(), room);
      // The root folder carries the room's name, so its heading and its breadcrumb root
      // are both stale the moment the room is renamed.
      void queryClient.invalidateQueries({ queryKey: folderKeys.detail(room.rootFolderId) });
    },
  });
}

/**
 * What `/rooms` and `/rooms/:id` do: resolve the caller's room and send them to its root
 * folder, so the address bar always names the folder actually on screen.
 */
export type RoomLandingState =
  { status: "resolving" } | { status: "failed"; error: Error; retry: () => void };

export function useRoomLanding(): RoomLandingState {
  const router = useRouter();
  const room = useDataRoom();
  const { data, error, refetch } = room;

  // Always the resolved room's own id, never the one in the URL: a link carrying somebody
  // else's room id must land the caller in their own room rather than in a 404.
  const destination = data === undefined ? null : folderHref(data.id, data.rootFolderId);

  useEffect(() => {
    if (destination !== null) router.replace(destination);
  }, [destination, router]);

  if (error !== null) {
    return {
      status: "failed",
      error,
      retry: () => {
        void refetch();
      },
    };
  }

  return { status: "resolving" };
}

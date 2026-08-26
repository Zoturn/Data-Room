"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { CreateShareInput, Page, Share } from "@data-room/shared";
import {
  addShareGrants,
  createShare,
  fetchSharesForNode,
  removeShareGrant,
  revokeShare,
  shareKeys,
} from "@/features/sharing/api/shares";

/**
 * The shares on one node, for its owner.
 *
 * `enabled` rather than a conditional hook: the dialog mounts before it is opened, and a list
 * request for a node nobody is looking at is a request the owner did not ask for.
 */
export function useSharesForNode(
  nodeId: string,
  enabled: boolean,
): UseQueryResult<Page<Share>, Error> {
  return useQuery({
    queryKey: shareKeys.forNode(nodeId),
    queryFn: ({ signal }) => fetchSharesForNode(nodeId, signal),
    enabled,
    // Revocation must be visible immediately, and a stale list is the one thing that could
    // make a revoked link look live. Cheap query, so it simply is not cached.
    staleTime: 0,
  });
}

export function useCreateShare(nodeId: string): UseMutationResult<Share, Error, CreateShareInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createShare,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shareKeys.forNode(nodeId) });
    },
  });
}

export function useRevokeShare(nodeId: string): UseMutationResult<Share, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: revokeShare,
    // Not optimistic. Revoking is the one action whose success must be the server's word:
    // showing a link as dead before it is would be a lie in the safe-looking direction.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shareKeys.forNode(nodeId) });
    },
  });
}

export function useAddGrants(
  nodeId: string,
): UseMutationResult<Share, Error, { shareId: string; emails: readonly string[] }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ shareId, emails }) => addShareGrants(shareId, emails),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shareKeys.forNode(nodeId) });
    },
  });
}

export function useRemoveGrant(
  nodeId: string,
): UseMutationResult<void, Error, { shareId: string; grantId: string }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ shareId, grantId }) => removeShareGrant(shareId, grantId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shareKeys.forNode(nodeId) });
    },
  });
}

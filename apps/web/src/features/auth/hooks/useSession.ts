"use client";

import { useCallback } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { LoginInput, RegisterInput, SessionUser } from "@data-room/shared";
import { fetchSessionUser, registerAccount, signInWithPassword, signOut } from "@/lib/api/auth";

/** Hierarchical and declared once, so a mutation can invalidate exactly this and nothing else. */
export const authKeys = {
  all: ["auth"] as const,
  session: () => [...authKeys.all, "session"] as const,
};

/**
 * Three outcomes, not two. "We could not reach the API" is not "you are signed out": treating
 * it as one would throw a signed-in user back to the sign-in screen every time their wifi
 * dropped, and — worse — would make a server outage look like their session was revoked.
 */
export type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: SessionUser }
  | { status: "unavailable"; error: Error; retry: () => void };

/**
 * The query's three observable values collapsed into one state. Pure, so the mapping is
 * testable without a DOM or a QueryClient.
 *
 * `undefined` means the answer has not arrived; `null` means the API said 401, which is a
 * definitive "signed out". A cached user survives a later refetch failure — the session is
 * still good until the API says otherwise.
 */
export function toSessionState(input: {
  user: SessionUser | null | undefined;
  error: Error | null;
  retry: () => void;
}): SessionState {
  if (input.user) return { status: "signed-in", user: input.user };
  if (input.user === null) return { status: "signed-out" };
  if (input.error !== null)
    return { status: "unavailable", error: input.error, retry: input.retry };
  return { status: "loading" };
}

/**
 * The single source of session truth. Every component asks this; nothing else reads
 * `/auth/me`, and nothing keeps its own copy of the user.
 */
export function useSession(): SessionState {
  const query = useQuery({
    queryKey: authKeys.session(),
    queryFn: ({ signal }) => fetchSessionUser(signal),
    // The session only changes when this app changes it, and every one of those paths writes
    // the cache directly. A shorter window would spend a request on every tab switch.
    staleTime: 5 * 60_000,
  });

  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  return toSessionState({ user: query.data, error: query.error, retry });
}

/**
 * Seeds the session cache from a sign-in or sign-up response, so the app renders as signed
 * in immediately instead of flashing the signed-out state while `/auth/me` is in flight.
 */
function useSessionEstablishingMutation<TInput>(
  mutationFn: (input: TInput) => Promise<SessionUser>,
): UseMutationResult<SessionUser, Error, TInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (user) => {
      queryClient.setQueryData(authKeys.session(), user);
    },
  });
}

export function useSignIn(): UseMutationResult<SessionUser, Error, LoginInput> {
  return useSessionEstablishingMutation(signInWithPassword);
}

export function useSignUp(): UseMutationResult<SessionUser, Error, RegisterInput> {
  return useSessionEstablishingMutation(registerAccount);
}

/**
 * Ends the session and empties the cache. Everything cached was fetched under the departing
 * user's cookies, and on a shared machine the next person must not see one frame of it —
 * removal rather than invalidation, so nothing refetches either.
 *
 * The session entry itself is set rather than removed: removing it would leave its observers
 * pending and immediately refetch `/auth/me` just to be told what we already know.
 */
export function useSignOut(): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== authKeys.all[0],
      });
      queryClient.setQueryData(authKeys.session(), null);
    },
  });
}

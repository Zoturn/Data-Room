"use client";

import { AppShell } from "@/components/app-shell";
import { ErrorState, ListSkeleton } from "@/components/states";
import { useRoomLanding } from "@/features/data-room/hooks/useDataRoom";

/**
 * A Data Room has no page of its own — opening one means opening its root folder, which is
 * where this sends you.
 *
 * The room id in the URL is deliberately not trusted as the destination: the landing hook
 * resolves the caller's own room, so a link carrying someone else's id lands them in theirs
 * rather than on a 404. Same reasoning as the API's — no id ever confirms a room exists.
 */
export default function RoomPage() {
  const landing = useRoomLanding();

  if (landing.status === "failed") {
    return (
      <AppShell>
        <ErrorState
          title="Could not open your Data Room"
          description="We could not reach your Data Room just now. This is usually temporary."
          onRetry={landing.retry}
        />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <p role="status" className="sr-only">
        Opening your Data Room
      </p>
      <ListSkeleton />
    </AppShell>
  );
}

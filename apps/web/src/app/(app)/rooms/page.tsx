"use client";

import { AppShell } from "@/components/app-shell";
import { ErrorState, ListSkeleton } from "@/components/states";
import { useRoomLanding } from "@/features/data-room/hooks/useDataRoom";

/**
 * Where the application starts. A user has exactly one Data Room, provisioned by the API on
 * this first read, so this page's whole job is to resolve it and hand over to its root
 * folder — after which the address bar always names the folder on screen.
 *
 * `replace`, not `push`: this stop is not somewhere Back should ever return to.
 */
export default function RoomsPage() {
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

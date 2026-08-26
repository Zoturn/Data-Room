"use client";

import { useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { ErrorState } from "@/components/states";

/**
 * The last line of defence for a render that threw. It must always offer a way forward —
 * a dead end with no retry is the failure mode this file exists to prevent.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <AppShell>
      <ErrorState
        title="Something went wrong"
        description="We could not display this page. Trying again often works; if it keeps happening, reload the app."
        onRetry={reset}
      />
    </AppShell>
  );
}

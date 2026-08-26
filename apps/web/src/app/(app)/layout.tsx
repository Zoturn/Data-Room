import { Suspense, type ReactNode } from "react";
import { RequireSession } from "@/features/auth/components/RequireSession";

/**
 * Everything under this route group requires a session.
 *
 * The gate lives in the layout rather than in each page so a new page is protected because
 * nobody did anything — the same fail-closed default the API's global guard gives the
 * backend. A page that needs to be public goes outside this group.
 *
 * Suspense because RequireSession reads search params, which Next requires be suspended.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <RequireSession>{children}</RequireSession>
    </Suspense>
  );
}

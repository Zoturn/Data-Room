"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/features/auth/hooks/useSession";
import { ListSkeleton, ErrorState } from "@/components/states";
import { AppShell } from "@/components/app-shell";
import { destinationFrom } from "@/features/auth/auth-form";

/**
 * Gate for everything under the app routes.
 *
 * The redirect carries the requested location in `next`, so a deep link to a folder survives
 * sign-in and lands where the user was going rather than dumping them at the root. It is a
 * relative path only — never an absolute URL — because a `next` that could point off-site
 * turns the sign-in page into an open redirect.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    if (session.status !== "signed-out") return;

    const next = destinationFrom(pathname, search.toString());
    router.replace(`/sign-in?next=${encodeURIComponent(next)}`);
  }, [session.status, pathname, search, router]);

  if (session.status === "signed-in") return <>{children}</>;

  if (session.status === "unavailable") {
    return (
      <AppShell>
        <ErrorState
          title="Could not reach the server"
          description="We could not confirm your session. This is usually temporary."
          onRetry={session.retry}
        />
      </AppShell>
    );
  }

  // Loading, or redirecting after a signed-out result. A skeleton rather than a spinner, and
  // never a flash of the signed-out state before the redirect lands.
  return (
    <AppShell>
      <ListSkeleton />
    </AppShell>
  );
}

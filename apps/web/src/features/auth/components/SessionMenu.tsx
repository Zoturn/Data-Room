"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession, useSignOut } from "@/features/auth/hooks/useSession";

/**
 * Who is signed in, and the way out. Rendered in the app shell's header.
 *
 * Sign-out navigates to the sign-in screen rather than leaving the user on a page they can no
 * longer load: the session hook would flip to signed-out, the route guard would redirect, and
 * the intervening frame would be a skeleton for a folder they cannot see.
 */
export function SessionMenu() {
  const session = useSession();
  const signOut = useSignOut();
  const router = useRouter();

  if (session.status !== "signed-in") return null;

  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-sm text-muted-foreground sm:inline" title={session.user.email}>
        {session.user.email}
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={signOut.isPending}
        onClick={() => {
          signOut.mutate(undefined, {
            // Replace, not push: the signed-in page must not be one Back away.
            onSettled: () => router.replace("/sign-in"),
          });
        }}
      >
        <LogOut aria-hidden />
        {signOut.isPending ? "Signing out…" : "Sign out"}
      </Button>
    </div>
  );
}

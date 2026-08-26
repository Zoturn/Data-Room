import type { ReactNode } from "react";
import { FolderLock } from "lucide-react";
import { SessionMenu } from "@/features/auth/components/SessionMenu";

/**
 * The frame every signed-in page renders inside: a header that names the product, and a
 * content region. Page-level chrome (breadcrumbs, actions) is supplied by the page itself.
 */
export function AppShell({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4">
          <span className="flex items-center gap-2 font-semibold">
            <FolderLock className="size-5" aria-hidden />
            Data Room
          </span>
          <div className="flex items-center gap-2">
            {actions}
            <SessionMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}

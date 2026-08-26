"use client";

import { Toaster as SonnerToaster } from "sonner";

/**
 * Toasts carry background outcomes — an upload finished, a link was copied. They must be
 * announced, not merely drawn, so screen-reader users learn the same thing sighted users do.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast: "bg-popover text-popover-foreground border border-border shadow-md",
          description: "text-muted-foreground",
        },
      }}
    />
  );
}

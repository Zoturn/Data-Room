import type { Metadata } from "next";
import { Suspense } from "react";
import { FolderLock } from "lucide-react";
import { SignInForm } from "@/features/auth/components/SignInForm";

export const metadata: Metadata = {
  title: "Sign in · Data Room",
  description: "Sign in to your Data Room.",
  // An auth screen has nothing worth indexing and every reason not to be.
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-4 py-12">
      <div className="grid gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <FolderLock className="size-5" aria-hidden />
          Data Room
        </span>
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Use your email and password.
        </p>
      </div>

      {/*
        The form reads the preserved `?next=` destination, so it must sit under a Suspense
        boundary — reading search params opts a subtree into client rendering, and without a
        boundary Next would bail out of prerendering this whole page.
      */}
      <Suspense fallback={<AuthFormFallback label="Loading the sign-in form" />}>
        <SignInForm />
      </Suspense>
    </main>
  );
}

/** Shaped like the form that is coming, so nothing jumps when it arrives. */
function AuthFormFallback({ label }: { label: string }) {
  return (
    <div className="grid gap-4">
      <p className="sr-only" role="status">
        {label}
      </p>
      <div
        className="h-14 animate-pulse rounded-md bg-muted motion-reduce:animate-none"
        aria-hidden
      />
      <div
        className="h-14 animate-pulse rounded-md bg-muted motion-reduce:animate-none"
        aria-hidden
      />
      <div
        className="h-9 animate-pulse rounded-md bg-muted motion-reduce:animate-none"
        aria-hidden
      />
    </div>
  );
}

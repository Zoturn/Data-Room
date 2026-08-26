"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { loginInputSchema } from "@data-room/shared";
import { Button } from "@/components/ui/button";
import { googleSignInUrl } from "@/lib/api/auth";
import {
  authScreenHref,
  safeRedirectPath,
  submitFailureFrom,
  zodFieldErrors,
  type FieldErrorMap,
} from "@/features/auth/auth-form";
import { AuthTextField } from "@/features/auth/components/AuthTextField";
import { useSession, useSignIn } from "@/features/auth/hooks/useSession";

/** The inputs this form renders, so a server `details` entry for anything else is not swallowed. */
const FIELDS = ["email", "password"] as const;

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const session = useSession();
  const signIn = useSignIn();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrorMap>({});
  const [formError, setFormError] = useState<string | null>(null);

  const destination = safeRedirectPath(searchParams.get("next"));

  /**
   * One rule serves two requirements: a visitor who is already signed in never sees this
   * screen, and a successful submit navigates as soon as the session cache holds the user.
   * `replace` rather than `push` keeps sign-in out of the history, so Back after signing in
   * does not land on a form that immediately bounces.
   */
  useEffect(() => {
    if (session.status === "signed-in") router.replace(destination);
  }, [session.status, destination, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);

    // Client validation is for speed of feedback only — the API validates this again, and
    // whatever it rejects is rendered the same way below.
    const parsed = loginInputSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldErrors(zodFieldErrors(parsed.error));
      return;
    }

    try {
      await signIn.mutateAsync(parsed.data);
    } catch (error) {
      // The input stays exactly as typed. It is the user's, and retyping a password after a
      // server hiccup is the fastest way to make someone give up.
      const failure = submitFailureFrom(error, FIELDS);
      setFieldErrors(failure.fields);
      setFormError(failure.formError);
    }
  }

  const isSubmitting = signIn.isPending;

  return (
    <div className="grid gap-6">
      {formError === null ? null : (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {formError}
        </p>
      )}

      <form onSubmit={handleSubmit} noValidate className="grid gap-4">
        <AuthTextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onValueChange={setEmail}
          disabled={isSubmitting}
          error={fieldErrors["email"]}
        />

        <AuthTextField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onValueChange={setPassword}
          disabled={isSubmitting}
          error={fieldErrors["password"]}
        />

        <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
          {isSubmitting ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
          ) : null}
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" aria-hidden />
        or
        <span className="h-px flex-1 bg-border" aria-hidden />
      </div>

      {/* A real link, not a button: this leaves the origin for Google's consent screen. */}
      <Button variant="outline" asChild>
        <a href={googleSignInUrl(destination)}>Continue with Google</a>
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link
          href={authScreenHref("/sign-up", destination)}
          className="font-medium text-foreground underline underline-offset-4"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}

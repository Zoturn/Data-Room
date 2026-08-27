"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { PASSWORD_MIN_LENGTH, registerInputSchema } from "@data-room/shared";
import { Button } from "@/components/ui/button";
import {
  authScreenHref,
  safeRedirectPath,
  submitFailureFrom,
  zodFieldErrors,
  type FieldErrorMap,
} from "@/features/auth/auth-form";
import { AuthTextField } from "@/features/auth/components/AuthTextField";
import { useSession, useSignUp } from "@/features/auth/hooks/useSession";

/** The inputs this form renders, so a server `details` entry for anything else is not swallowed. */
const FIELDS = ["email", "password"] as const;

export function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const session = useSession();
  const signUp = useSignUp();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrorMap>({});
  const [formError, setFormError] = useState<string | null>(null);

  const destination = safeRedirectPath(searchParams.get("next"));

  // Registration signs the new account in, so the same rule that keeps a signed-in visitor
  // off this screen is also what navigates them onward afterwards.
  useEffect(() => {
    if (session.status === "signed-in") router.replace(destination);
  }, [session.status, destination, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);

    // The shared schema normalises the address as part of parsing, so the value sent is the
    // value the API will compare against — the same address cannot become two accounts.
    const parsed = registerInputSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldErrors(zodFieldErrors(parsed.error));
      return;
    }

    try {
      await signUp.mutateAsync(parsed.data);
    } catch (error) {
      const failure = submitFailureFrom(error, FIELDS);
      setFieldErrors(failure.fields);
      setFormError(failure.formError);
    }
  }

  const isSubmitting = signUp.isPending;

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
          // "new-password" is what tells a password manager to offer a generated one.
          autoComplete="new-password"
          value={password}
          onValueChange={setPassword}
          disabled={isSubmitting}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          error={fieldErrors["password"]}
        />

        <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
          {isSubmitting ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
          ) : null}
          {isSubmitting ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href={authScreenHref("/sign-in", destination)}
          className="font-medium text-foreground underline underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { Check, Copy, Link2, Loader2, Mail, Trash2 } from "lucide-react";
import type { NodeSummary, ShareMode } from "@data-room/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ListSkeleton, ErrorState } from "@/components/states";
import { describeShareState, expiryInstant, parseEmails, type ExpiryChoice } from "../share-form";
import { useCreateShare, useRevokeShare, useSharesForNode } from "../hooks/useShares";

export type ShareDialogProps = {
  node: NodeSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const EXPIRY_OPTIONS: ReadonlyArray<{ value: ExpiryChoice; label: string }> = [
  { value: "never", label: "Until revoked" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

/**
 * Sharing one folder or file, read-only.
 *
 * The two modes are one form because they differ in exactly one input — who may open it —
 * and splitting them into tabs would make the owner choose a mechanism before they have
 * decided on an audience.
 *
 * A public link is shown once, at creation. The API stores only a hash of the token, so
 * nothing here can retrieve it again, and the dialog says so rather than letting an owner
 * assume they can come back for it.
 */
export function ShareDialog({ node, open, onOpenChange }: ShareDialogProps) {
  const shares = useSharesForNode(node.id, open);
  const create = useCreateShare(node.id);
  const revoke = useRevokeShare(node.id);

  const [mode, setMode] = useState<ShareMode>("PUBLIC_LINK");
  const [expiry, setExpiry] = useState<ExpiryChoice>("never");
  const [emailText, setEmailText] = useState("");
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const now = new Date();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    setFreshUrl(null);

    const parsed = parseEmails(emailText);

    if (mode === "RESTRICTED") {
      if (parsed.invalid.length > 0) {
        setFormError(`These do not look like email addresses: ${parsed.invalid.join(", ")}`);
        return;
      }
      if (parsed.valid.length === 0) {
        setFormError("Add at least one person to share with.");
        return;
      }
    }

    try {
      const share = await create.mutateAsync({
        nodeId: node.id,
        mode,
        expiresAt: expiryInstant(expiry, now),
        emails: mode === "RESTRICTED" ? parsed.valid : [],
      });

      setEmailText("");
      // Held in state rather than read back from the list, because the list will never
      // carry it: this is the only moment the token exists outside the database.
      setFreshUrl(share.url);
      setCopied(false);
    } catch {
      setFormError("That share could not be created. Please try again.");
    }
  }

  const existing = shares.data?.items ?? [];
  const isPending = create.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share “{node.name}”</DialogTitle>
          <DialogDescription>
            Anyone you share with can view and download, and nothing else. Everything inside a
            shared folder is shared with it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="grid gap-4">
          {formError === undefined ? null : (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
          )}

          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Who can open it</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <ModeChoice
                checked={mode === "PUBLIC_LINK"}
                onSelect={() => {
                  setMode("PUBLIC_LINK");
                }}
                icon={<Link2 aria-hidden className="size-4" />}
                title="Anyone with the link"
                detail="No sign-in needed"
                disabled={isPending}
              />
              <ModeChoice
                checked={mode === "RESTRICTED"}
                onSelect={() => {
                  setMode("RESTRICTED");
                }}
                icon={<Mail aria-hidden className="size-4" />}
                title="Only these people"
                detail="They sign in to open it"
                disabled={isPending}
              />
            </div>
          </fieldset>

          {mode === "RESTRICTED" ? (
            <div className="grid gap-1.5">
              <label htmlFor="share-emails" className="text-sm font-medium">
                Email addresses
              </label>
              <textarea
                id="share-emails"
                value={emailText}
                onChange={(event) => {
                  setEmailText(event.target.value);
                }}
                disabled={isPending}
                rows={3}
                placeholder="buyer@acme.com, counsel@acme.com"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <p className="text-xs text-muted-foreground">
                Separate with commas, spaces or new lines. They can be invited before they have an
                account.
              </p>
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <label htmlFor="share-expiry" className="text-sm font-medium">
              Access lasts
            </label>
            <select
              id="share-expiry"
              value={expiry}
              onChange={(event) => {
                // The option list is the only source of these values, so a cast is not needed:
                // an unrecognised one falls back rather than being asserted into the type.
                const chosen = EXPIRY_OPTIONS.find((option) => option.value === event.target.value);
                setExpiry(chosen?.value ?? "never");
              }}
              disabled={isPending}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {EXPIRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {freshUrl === null ? null : (
            <div className="grid gap-1.5 rounded-md border border-border bg-muted/40 p-3">
              <p className="text-sm font-medium">Link created</p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={freshUrl}
                  aria-label="Share link"
                  onFocus={(event) => {
                    event.target.select();
                  }}
                  className="h-9 flex-1 rounded-md border border-border bg-background px-3 font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(freshUrl).then(() => {
                      setCopied(true);
                    });
                  }}
                >
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              {/* Said plainly, because an owner who assumes otherwise loses the link. */}
              <p className="text-xs text-muted-foreground">
                Copy it now — this link is not shown again.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
              disabled={isPending}
            >
              Close
            </Button>
            <Button type="submit" disabled={isPending} aria-busy={isPending}>
              {isPending ? (
                <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
              ) : null}
              {isPending ? "Creating…" : "Create share"}
            </Button>
          </DialogFooter>
        </form>

        <section className="grid gap-2 border-t border-border pt-4">
          <h3 className="text-sm font-medium">Existing shares</h3>

          {shares.isPending ? <ListSkeleton rows={2} /> : null}

          {shares.isError ? (
            <ErrorState
              title="Could not load shares"
              description="This is usually temporary."
              onRetry={() => {
                void shares.refetch();
              }}
            />
          ) : null}

          {!shares.isPending && !shares.isError && existing.length === 0 ? (
            <p className="text-sm text-muted-foreground">This item has not been shared yet.</p>
          ) : null}

          <ul className="grid gap-2">
            {existing.map((share) => (
              <li
                key={share.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {share.mode === "PUBLIC_LINK"
                      ? "Anyone with the link"
                      : share.grants.map((grant) => grant.email).join(", ") || "No recipients yet"}
                  </p>
                  <p className="text-xs text-muted-foreground">{describeShareState(share, now)}</p>
                </div>

                {share.revokedAt === null ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() => {
                      revoke.mutate(share.id);
                    }}
                  >
                    <Trash2 aria-hidden />
                    Revoke
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      </DialogContent>
    </Dialog>
  );
}

/** A radio in everything but markup, so the whole card is the target rather than a 16px dot. */
function ModeChoice({
  checked,
  onSelect,
  icon,
  title,
  detail,
  disabled,
}: {
  checked: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  detail: string;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      disabled={disabled}
      className={`grid gap-0.5 rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </span>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </button>
  );
}

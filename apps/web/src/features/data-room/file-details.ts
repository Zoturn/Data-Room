import { NODE_NAME_MAX_LENGTH, type Breadcrumb, type FileDetail } from "@data-room/shared";
import { ApiError, NetworkError } from "@/lib/api/errors";
import type { TreeLocation } from "@/features/data-room/hooks/useFolderContents";

/**
 * What the file views compute from a `FileDetail` and from a refused action: the two halves
 * of a name, where the file sits in the tree, and what to say when the server says no.
 *
 * The file-side counterpart of `folder-names.ts`, kept out of the components so the rules
 * are testable with Jest rather than only through a rendered dialog.
 */
export type FileName = {
  /** Everything before the final dot — the only part a rename may edit. */
  readonly stem: string;
  /** The final dot and what follows it, or `""` when the name carries no extension. */
  readonly extension: string;
};

/**
 * A leading dot is part of the name, not an extension: `.env` has no extension, and letting
 * a rename edit an empty stem would leave the user nothing to type into.
 */
export function splitFileName(name: string): FileName {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return { stem: name, extension: "" };

  return { stem: name.slice(0, dot), extension: name.slice(dot) };
}

export function joinFileName(stem: string, extension: string): string {
  return `${stem}${extension}`;
}

/**
 * The bound is on the whole name, but the user is only editing the stem — so the message
 * states the budget they actually have rather than one they cannot spend.
 */
export function validateFileStem(stem: string, extension: string): string | null {
  if (stem.length === 0) return "Enter a name.";

  const budget = NODE_NAME_MAX_LENGTH - extension.length;
  if (stem.length > budget) {
    return extension === ""
      ? `Use at most ${NODE_NAME_MAX_LENGTH} characters.`
      : `Use at most ${budget} characters — “${extension}” is kept.`;
  }

  return null;
}

/**
 * The folder holding the file. Tolerates both breadcrumb conventions — a chain that ends at
 * the parent folder, and one that ends with the file itself — because the viewer must not
 * break on which of the two the API settled on.
 */
export function fileParentCrumb(detail: FileDetail): Breadcrumb | null {
  const last = detail.breadcrumbs.at(-1);
  if (last === undefined) return null;

  return last.id === detail.file.id ? (detail.breadcrumbs.at(-2) ?? null) : last;
}

/**
 * The bar the viewer draws: the folder chain, with the file itself as the last crumb.
 *
 * The name comes from the file rather than from the chain even when the API put it there,
 * because a rename updates one of those two and not the other.
 */
export function fileCrumbs(detail: FileDetail): Breadcrumb[] {
  const last = detail.breadcrumbs.at(-1);
  const folders =
    last !== undefined && last.id === detail.file.id
      ? detail.breadcrumbs.slice(0, -1)
      : detail.breadcrumbs;

  return [...folders, { id: detail.file.id, name: detail.file.name }];
}

/** Where a write to this file lands: its folder, and every ancestor whose totals it moves. */
export function fileLocation(detail: FileDetail): TreeLocation | null {
  const parent = fileParentCrumb(detail);
  if (parent === null) return null;

  const ancestry: string[] = [];
  for (const crumb of detail.breadcrumbs) {
    if (crumb.id === detail.file.id) break;
    ancestry.push(crumb.id);
    if (crumb.id === parent.id) break;
  }

  return { parentId: parent.id, ancestry };
}

/**
 * How long the viewer may hold a signed URL before asking for another one.
 *
 * Renewing early rather than on failure is what keeps a document open on screen from
 * blanking mid-read: the browser only reports an expired URL as a broken frame, and by then
 * the reader has already lost their place. `0` means "already stale, ask now".
 */
export function renewalDelayMs(expiresAt: string, now: Date = new Date()): number {
  const expiry = new Date(expiresAt).getTime();
  if (Number.isNaN(expiry)) return 0;

  const RENEW_EARLY_MS = 30_000;
  return Math.max(expiry - now.getTime() - RENEW_EARLY_MS, 0);
}

/**
 * A file that is gone answers 404, and so does one that was never the caller's — the API
 * refuses to distinguish them on purpose.
 */
export function isMissing(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** API messages are written for the person reading them; anything else is our bug. */
export function actionFailureMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof NetworkError) return error.message;
  return "Something went wrong. Please try again.";
}

/**
 * A refused move, said in terms of the folder the user picked. Branching is on the
 * envelope's `code`; a destination in someone else's Data Room answers 404 and is described
 * as unavailable rather than as forbidden, which is all the API is willing to admit.
 */
export function moveFailureMessage(error: unknown, destinationName: string): string {
  if (!(error instanceof ApiError)) return actionFailureMessage(error);

  switch (error.code) {
    case "INVALID_MOVE_TARGET":
      return "Files can only be moved into a folder. Choose a folder and try again.";

    case "NOT_FOUND":
      return `“${destinationName}” is no longer available. Choose another folder.`;

    default:
      return error.message;
  }
}

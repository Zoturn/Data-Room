import {
  contentUrlSchema,
  pageSchema,
  shareSchema,
  sharedViewSchema,
  type ContentUrl,
  type CreateShareInput,
  type Page,
  type Share,
  type SharedView,
} from "@data-room/shared";
import { apiFetch, apiSend } from "@/lib/api/client";

/**
 * Every response is parsed against the schema both sides share, so a contract drift becomes
 * one clear error at the boundary rather than an `undefined` three components deep.
 */
const sharesPageSchema = pageSchema(shareSchema);

/**
 * Query keys for the owner's view of sharing. The recipient side has none: it is read once
 * per navigation from a token in the URL, and caching an authorisation decision is exactly
 * what revocation must not have to invalidate.
 */
export const shareKeys = {
  all: ["shares"] as const,
  /** The shares on one node. Invalidating this is how a create or a revoke lands. */
  forNode: (nodeId: string) => [...shareKeys.all, "node", nodeId] as const,
};

/** Ids and tokens are encoded rather than interpolated, so nothing they carry reshapes a path. */
function segment(value: string): string {
  return encodeURIComponent(value);
}

function signalOption(signal?: AbortSignal): { signal?: AbortSignal } {
  return signal ? { signal } : {};
}

export function fetchSharesForNode(nodeId: string, signal?: AbortSignal): Promise<Page<Share>> {
  return apiFetch(`/shares?nodeId=${segment(nodeId)}`, sharesPageSchema, signalOption(signal));
}

/**
 * The response carries the public URL exactly once, at creation. It is never returned again —
 * the API stores only a hash — so the dialog must show it now or lose it.
 */
export function createShare(input: CreateShareInput): Promise<Share> {
  return apiFetch("/shares", shareSchema, { method: "POST", body: input });
}

export function revokeShare(shareId: string): Promise<Share> {
  return apiFetch(`/shares/${segment(shareId)}/revoke`, shareSchema, { method: "POST" });
}

export function addShareGrants(shareId: string, emails: readonly string[]): Promise<Share> {
  return apiFetch(`/shares/${segment(shareId)}/grants`, shareSchema, {
    method: "POST",
    body: { emails },
  });
}

export function removeShareGrant(shareId: string, grantId: string): Promise<void> {
  return apiSend(`/shares/${segment(shareId)}/grants/${segment(grantId)}`, { method: "DELETE" });
}

/**
 * The recipient's view. The token is a credential in a path segment, which is why these
 * requests are made from the page that already has it rather than threaded through a store.
 */
export function fetchSharedView(token: string, signal?: AbortSignal): Promise<SharedView> {
  return apiFetch(`/public/shares/${segment(token)}`, sharedViewSchema, signalOption(signal));
}

/**
 * A recipient's download URL. Fetched per action rather than held: it expires in minutes, and
 * one kept in component state becomes a blank frame the first time a tab is left open.
 */
export function fetchSharedContentUrl(
  token: string,
  nodeId: string,
  signal?: AbortSignal,
): Promise<ContentUrl> {
  return apiFetch(
    `/public/shares/${segment(token)}/files/${segment(nodeId)}/content-url`,
    contentUrlSchema,
    signalOption(signal),
  );
}

export function fetchSharedNode(
  token: string,
  nodeId: string,
  signal?: AbortSignal,
): Promise<SharedView> {
  return apiFetch(
    `/public/shares/${segment(token)}/nodes/${segment(nodeId)}`,
    sharedViewSchema,
    signalOption(signal),
  );
}

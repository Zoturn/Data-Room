import {
  contentUrlSchema,
  fileDetailSchema,
  nodeSummarySchema,
  type ContentUrl,
  type FileDetail,
  type NodeSummary,
} from "@data-room/shared";
import { apiFetch, apiSend } from "@/lib/api/client";

/**
 * Reads and writes for one file. Uploads are not here: the bytes never travel through this
 * client — see `features/files/upload` — and this module only ever speaks JSON to the API.
 */
export const fileKeys = {
  all: ["files"] as const,
  detail: (fileId: string) => [...fileKeys.all, fileId] as const,
  /**
   * Kept separate from the detail: the signed URL expires on its own schedule, so renewing
   * it must not also refetch the metadata the viewer is already showing.
   */
  contentUrl: (fileId: string) => [...fileKeys.all, fileId, "content-url"] as const,
};

/** Ids are encoded rather than interpolated, so nothing a name carries can reshape a path. */
function segment(id: string): string {
  return encodeURIComponent(id);
}

function signalOption(signal?: AbortSignal): { signal?: AbortSignal } {
  return signal ? { signal } : {};
}

/** The file and the chain of folders above it, in one response — the viewer's whole header. */
export function fetchFile(fileId: string, signal?: AbortSignal): Promise<FileDetail> {
  return apiFetch(`/files/${segment(fileId)}`, fileDetailSchema, signalOption(signal));
}

/**
 * A short-lived signed URL for the bytes. Requested on demand and never persisted: it is a
 * credential with an expiry, and a stale one in a cache is just a broken viewer.
 */
export function fetchContentUrl(fileId: string, signal?: AbortSignal): Promise<ContentUrl> {
  return apiFetch(`/files/${segment(fileId)}/content-url`, contentUrlSchema, signalOption(signal));
}

/**
 * The name sent here is the whole name, extension included — the dialog re-attaches the
 * extension so a rename cannot strip it, and the API resolves any collision by suffixing.
 */
export function renameFile(fileId: string, name: string): Promise<NodeSummary> {
  return apiFetch(`/files/${segment(fileId)}`, nodeSummarySchema, {
    method: "PATCH",
    body: { name },
  });
}

/** Answers with the file as it now stands, which is where the resolved name comes from. */
export function moveFile(fileId: string, parentId: string): Promise<NodeSummary> {
  return apiFetch(`/files/${segment(fileId)}/move`, nodeSummarySchema, {
    method: "POST",
    body: { parentId },
  });
}

/** 204, no body: the row and, best-effort, its stored bytes are gone. */
export function deleteFile(fileId: string): Promise<void> {
  return apiSend(`/files/${segment(fileId)}`, { method: "DELETE" });
}

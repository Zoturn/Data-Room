import {
  nodeSummarySchema,
  uploadIntentSchema,
  type NodeSummary,
  type UploadIntent,
  type UploadIntentInput,
} from "@data-room/shared";
import { apiFetch } from "@/lib/api/client";

/**
 * The two API calls that bracket an upload. The bytes themselves are not here and never
 * pass through this client — they go straight to the signed URL, which is the whole point
 * of reserving first (see `upload/transport.ts`).
 */

/** Ids are encoded rather than interpolated, so nothing a name carries can reshape a path. */
function segment(id: string): string {
  return encodeURIComponent(id);
}

function signalOption(signal?: AbortSignal): { signal?: AbortSignal } {
  return signal ? { signal } : {};
}

/**
 * Reserves the name and returns somewhere to put the bytes. The node exists as `PENDING`
 * from this moment, which is what stops two simultaneous `report.pdf` uploads colliding.
 */
export function createUploadIntent(
  input: UploadIntentInput,
  signal?: AbortSignal,
): Promise<UploadIntent> {
  return apiFetch("/files/upload-intent", uploadIntentSchema, {
    method: "POST",
    body: input,
    ...signalOption(signal),
  });
}

/**
 * Turns the reservation into a real file: the API confirms the object is there, sniffs its
 * magic bytes and records the true size. Until this answers, nothing is listed.
 */
export function commitUpload(nodeId: string, signal?: AbortSignal): Promise<NodeSummary> {
  return apiFetch(`/files/${segment(nodeId)}/commit`, nodeSummarySchema, {
    method: "POST",
    ...signalOption(signal),
  });
}

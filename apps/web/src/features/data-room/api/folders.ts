import {
  dataRoomSchema,
  deletionPreviewSchema,
  folderContentsSchema,
  nodeSummarySchema,
  pageSchema,
  subtreeAggregateSchema,
  type CreateFolderInput,
  type DataRoom,
  type DeletionPreview,
  type FolderContents,
  type NodeSummary,
  type Page,
  type SubtreeAggregate,
} from "@data-room/shared";
import { apiFetch, apiSend } from "@/lib/api/client";

/**
 * Every response is parsed against the schema both sides share, so a contract drift becomes
 * one clear error at the boundary instead of an `undefined` three components deep.
 */
const childrenPageSchema = pageSchema(nodeSummarySchema);

/**
 * Query keys, hierarchical and declared once. They live beside the calls they key rather
 * than in a hook file, because both the folder hooks and the Data Room hooks invalidate
 * across the two — and a key defined in one of them would make the other import it back.
 */
export const dataRoomKeys = {
  all: ["data-room"] as const,
  me: () => [...dataRoomKeys.all, "me"] as const,
  summary: (roomId: string) => [...dataRoomKeys.all, roomId, "summary"] as const,
};

export const folderKeys = {
  all: ["folders"] as const,
  /** Everything about one folder — invalidating this drops its listing and its totals. */
  detail: (folderId: string) => [...folderKeys.all, folderId] as const,
  contents: (folderId: string) => [...folderKeys.detail(folderId), "contents"] as const,
  aggregate: (folderId: string) => [...folderKeys.detail(folderId), "aggregate"] as const,
  deletionPreview: (folderId: string) =>
    [...folderKeys.detail(folderId), "deletion-preview"] as const,
};

type ListParams = {
  limit?: number;
  /** Opaque and followed, never constructed — see .claude/rules/api-contract.md. */
  cursor?: string | null;
};

function listQuery(params: ListParams): string {
  const search = new URLSearchParams();
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.cursor !== undefined && params.cursor !== null) search.set("cursor", params.cursor);

  const query = search.toString();
  return query === "" ? "" : `?${query}`;
}

/** Ids are encoded rather than interpolated, so nothing a name carries can reshape a path. */
function segment(id: string): string {
  return encodeURIComponent(id);
}

function signalOption(signal?: AbortSignal): { signal?: AbortSignal } {
  return signal ? { signal } : {};
}

/**
 * The caller's Data Room, provisioned by the API on first read. There is no id to pass:
 * a user has exactly one room and it is addressed as `me`.
 */
export function fetchDataRoom(signal?: AbortSignal): Promise<DataRoom> {
  return apiFetch("/data-rooms/me", dataRoomSchema, signalOption(signal));
}

export function fetchRoomSummary(roomId: string, signal?: AbortSignal): Promise<SubtreeAggregate> {
  return apiFetch(
    `/data-rooms/${segment(roomId)}/summary`,
    subtreeAggregateSchema,
    signalOption(signal),
  );
}

/**
 * The root folder carries the Data Room's name, so the room is what gets renamed and the
 * root follows in the same transaction.
 */
export function renameDataRoom(roomId: string, name: string): Promise<DataRoom> {
  return apiFetch(`/data-rooms/${segment(roomId)}`, dataRoomSchema, {
    method: "PATCH",
    body: { name },
  });
}

/**
 * Opening a folder: its metadata, the whole breadcrumb chain and the first page of children
 * in one response, so the bar and the list do not arrive at different times.
 */
export function fetchFolderContents(
  folderId: string,
  params: ListParams,
  signal?: AbortSignal,
): Promise<FolderContents> {
  return apiFetch(
    `/folders/${segment(folderId)}${listQuery(params)}`,
    folderContentsSchema,
    signalOption(signal),
  );
}

/** Later pages of the same listing, reached by following `nextCursor`. */
export function fetchFolderChildren(
  folderId: string,
  params: ListParams,
  signal?: AbortSignal,
): Promise<Page<NodeSummary>> {
  return apiFetch(
    `/folders/${segment(folderId)}/children${listQuery(params)}`,
    childrenPageSchema,
    signalOption(signal),
  );
}

export function fetchFolderAggregate(
  folderId: string,
  signal?: AbortSignal,
): Promise<SubtreeAggregate> {
  return apiFetch(
    `/folders/${segment(folderId)}/aggregate`,
    subtreeAggregateSchema,
    signalOption(signal),
  );
}

/**
 * What the confirmation dialog states before anything is destroyed. Fetched at confirm
 * time, never cached, so the number the owner reads is the number about to disappear.
 */
export function fetchDeletionPreview(
  folderId: string,
  signal?: AbortSignal,
): Promise<DeletionPreview> {
  return apiFetch(
    `/folders/${segment(folderId)}/deletion-preview`,
    deletionPreviewSchema,
    signalOption(signal),
  );
}

export function createFolder(input: CreateFolderInput): Promise<NodeSummary> {
  return apiFetch("/folders", nodeSummarySchema, { method: "POST", body: input });
}

export function renameFolder(folderId: string, name: string): Promise<NodeSummary> {
  return apiFetch(`/folders/${segment(folderId)}`, nodeSummarySchema, {
    method: "PATCH",
    body: { name },
  });
}

/** 204, no body: the folder and its subtree are gone. */
export function deleteFolder(folderId: string): Promise<void> {
  return apiSend(`/folders/${segment(folderId)}`, { method: "DELETE" });
}

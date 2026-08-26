import { z } from "zod";

import { pageSchema } from "./pagination.js";

/**
 * Folders and files are one table discriminated by this, so listing, renaming, moving,
 * sharing and deleting each have one implementation instead of two near-identical ones.
 */
export const nodeTypeSchema = z.enum(["FOLDER", "FILE"]);

export type NodeType = z.infer<typeof nodeTypeSchema>;

/** Long enough for any real name, short enough to keep a unique index and a breadcrumb sane. */
export const NODE_NAME_MAX_LENGTH = 255;

/**
 * THE normaliser. `normalizedName` is written from this on every insert and every rename,
 * and the unique index on `(parentId, normalizedName)` is what actually decides a collision.
 * A second implementation anywhere is a latent duplicate the database would happily accept.
 *
 * NFC first: `é` typed as one code point and as `e` plus a combining accent are the same name
 * to a person, and must be the same string before anything compares them.
 */
export function normalizeNodeName(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
}

/**
 * Ids are UUIDs and the tree depends on it: a subtree is `path LIKE '<idChain>%'`, so an id
 * carrying `%` or `_` would match past its own subtree. Validating the shape at the edge
 * keeps that alphabet closed instead of trusting every call site to escape.
 */
const nodeIdSchema = z.string().uuid();

/**
 * Trimmed before length is checked, so `"  Reports  "` is stored — and collides — as
 * `Reports` rather than sneaking past as a near-duplicate.
 */
const nodeNameSchema = z.string().trim().min(1).max(NODE_NAME_MAX_LENGTH);

/** One row of a folder listing: everything the contents table renders, and nothing more. */
export const nodeSummarySchema = z.object({
  id: nodeIdSchema,
  type: nodeTypeSchema,
  name: z.string().min(1),
  updatedAt: z.string().datetime(),
  /**
   * Bytes. Always 0 for a folder — a folder row holds no content of its own, and the size of
   * what is underneath it is a subtree aggregate that listing deliberately does not pay for.
   */
  sizeBytes: z.number().int().nonnegative(),
});

export type NodeSummary = z.infer<typeof nodeSummarySchema>;

/** One hop in the ancestor chain. Ids come out of the node's path, names from one lookup. */
export const breadcrumbSchema = z.object({
  id: nodeIdSchema,
  name: z.string().min(1),
});

export type Breadcrumb = z.infer<typeof breadcrumbSchema>;

/** What opening a folder returns: where you are, how you got there, and what is inside. */
export const folderContentsSchema = z.object({
  folder: nodeSummarySchema,
  /** Ordered root first, the folder itself last, so the bar renders straight from this array. */
  breadcrumbs: z.array(breadcrumbSchema).min(1),
  children: pageSchema(nodeSummarySchema),
});

export type FolderContents = z.infer<typeof folderContentsSchema>;

export const createFolderInputSchema = z.object({
  parentId: nodeIdSchema,
  name: nodeNameSchema,
});

export type CreateFolderInput = z.infer<typeof createFolderInputSchema>;

/** Renaming a folder, a file or the Data Room itself — one name, one rule. */
export const renameInputSchema = z.object({
  name: nodeNameSchema,
});

export type RenameInput = z.infer<typeof renameInputSchema>;

/**
 * Everything under a node, counted at every depth. One prefix scan over the path index
 * answers the Data Room summary and a single folder's totals alike.
 */
export const subtreeAggregateSchema = z.object({
  folders: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
});

export type SubtreeAggregate = z.infer<typeof subtreeAggregateSchema>;

/**
 * What the confirmation dialog states before anything is destroyed. It is the aggregate
 * shape because it is the same query over the same subtree, run at confirm time — so the
 * number the owner reads is the number that is about to disappear.
 */
export const deletionPreviewSchema = subtreeAggregateSchema;

export type DeletionPreview = SubtreeAggregate;

/**
 * A Data Room as the owner sees it. `rootFolderId` is where the interface starts: the root
 * is a real node, so "share the whole Data Room" is the same operation as sharing a folder.
 */
export const dataRoomSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  rootFolderId: nodeIdSchema,
});

export type DataRoom = z.infer<typeof dataRoomSchema>;

import { z } from "zod";

import { breadcrumbSchema, nodeIdSchema, nodeSummarySchema, NODE_NAME_MAX_LENGTH } from "./nodes.js";

/**
 * The only type this product stores. Widening it is meant to be a matter of turning these
 * two constants into a list — nothing below hard-codes "PDF" beyond them.
 */
export const PDF_CONTENT_TYPE = "application/pdf";

/** 50 MB. Enforced at intent from the declared size and again at commit from the real one. */
export const FILE_SIZE_MAX_BYTES = 50 * 1024 * 1024;

/**
 * What the browser asks for before it has sent a byte. `sizeBytes` and `contentType` are
 * client claims — they buy an early, friendly rejection, and the commit step re-checks both
 * against the stored object, which is the only account of the file that cannot lie.
 */
export const uploadIntentInputSchema = z.object({
  parentId: nodeIdSchema,
  name: z.string().min(1).max(NODE_NAME_MAX_LENGTH),
  contentType: z.literal(PDF_CONTENT_TYPE),
  sizeBytes: z.number().int().positive().max(FILE_SIZE_MAX_BYTES),
});

export type UploadIntentInput = z.infer<typeof uploadIntentInputSchema>;

/**
 * The reservation. The node exists as `PENDING` before the bytes do, which is what holds the
 * name against a second upload of the same one.
 */
export const uploadIntentSchema = z.object({
  nodeId: nodeIdSchema,
  uploadUrl: z.string().url(),
  /**
   * What the file will actually be called. A collision suffixes rather than rejects, so
   * `report.pdf` can come back as `report (2).pdf` — the upload row shows this, otherwise the
   * user watches a file upload under a name it does not end up having.
   */
  resolvedName: z.string().min(1),
  /** After this the signed URL is dead and the reservation is a sweep candidate. */
  expiresAt: z.string().datetime(),
});

export type UploadIntent = z.infer<typeof uploadIntentSchema>;

/** Opening one file: the same summary a listing row carries, plus how to navigate back out. */
export const fileDetailSchema = z.object({
  file: nodeSummarySchema,
  breadcrumbs: z.array(breadcrumbSchema),
});

export type FileDetail = z.infer<typeof fileDetailSchema>;

/**
 * A short-lived signed download URL. `expiresAt` is returned rather than left implicit so the
 * viewer can re-request one before a long reading session breaks, instead of discovering the
 * expiry as a broken PDF frame.
 */
export const contentUrlSchema = z.object({
  url: z.string().url(),
  expiresAt: z.string().datetime(),
});

export type ContentUrl = z.infer<typeof contentUrlSchema>;

/** Only the destination: a move never renames on purpose, though it may resolve a conflict. */
export const moveInputSchema = z.object({ parentId: nodeIdSchema });

export type MoveInput = z.infer<typeof moveInputSchema>;

import { z } from "zod";

import { breadcrumbSchema, nodeIdSchema, nodeSummarySchema } from "./nodes.js";
import { pageSchema } from "./pagination.js";

/**
 * How a share decides who may read it: anyone holding the link, or the specific people the
 * owner named. The mode is fixed when the share is created — switching a restricted share to
 * a public one after the fact would widen access to a link nobody was told existed.
 */
export const shareModeSchema = z.enum(["PUBLIC_LINK", "RESTRICTED"]);

export type ShareMode = z.infer<typeof shareModeSchema>;

/**
 * A one-member enum on purpose. Sharing is read-only, and the role exists so that adding
 * `EDITOR` later is a value added here plus a capability row — not a schema migration and a
 * hunt for every place that assumed read. It is deliberately future work: a write path that
 * consults a share does not exist, and that absence is the security property.
 */
export const shareRoleSchema = z.enum(["VIEWER"]);

export type ShareRole = z.infer<typeof shareRoleSchema>;

export const createShareInputSchema = z.object({
  nodeId: nodeIdSchema,
  mode: shareModeSchema,
  expiresAt: z.string().datetime().nullable().default(null),
  /** RESTRICTED only. Normalised and de-duplicated server-side. */
  emails: z.array(z.string().email()).max(50).default([]),
});

export type CreateShareInput = z.infer<typeof createShareInputSchema>;

/**
 * One named recipient. `acceptedAt` records the first time the grant was actually used by a
 * signed-in account, which is what lets the dialog distinguish an invitation that is waiting
 * from one that has landed.
 */
export const shareGrantSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: shareRoleSchema,
  acceptedAt: z.string().datetime().nullable(),
});

export type ShareGrant = z.infer<typeof shareGrantSchema>;

/**
 * A share as its owner sees it. The token itself is never in here: `url` is assembled once,
 * server-side, for the mode that can use it, so a token cannot reach a log, a list response
 * or a support query by accident.
 */
export const shareSchema = z.object({
  id: z.string().uuid(),
  nodeId: nodeIdSchema,
  nodeName: z.string(),
  mode: shareModeSchema,
  role: shareRoleSchema,
  /** PUBLIC_LINK only; null for RESTRICTED so a token never reaches a UI that cannot use it. */
  url: z.string().url().nullable(),
  expiresAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  grants: z.array(shareGrantSchema),
});

export type Share = z.infer<typeof shareSchema>;

/**
 * What a recipient sees. Breadcrumbs are re-rooted at the share target.
 *
 * `canDownload` is a literal rather than a boolean because there is nothing to negotiate: a
 * recipient who can see the view can fetch the bytes. It is present so the recipient
 * interface renders from the response instead of inferring a capability from the mode.
 */
export const sharedViewSchema = z.object({
  node: nodeSummarySchema,
  breadcrumbs: z.array(breadcrumbSchema),
  /** Null when the target is a file — a shared file discloses nothing about its folder. */
  children: pageSchema(nodeSummarySchema).nullable(),
  canDownload: z.literal(true),
});

export type SharedView = z.infer<typeof sharedViewSchema>;

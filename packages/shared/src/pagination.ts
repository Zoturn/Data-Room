import { z } from "zod";

export const PAGE_LIMIT_DEFAULT = 50;
export const PAGE_LIMIT_MAX = 200;

/**
 * Query parameters every list endpoint accepts. `limit` is capped rather than rejected:
 * a client asking for too much gets the maximum, not an error.
 */
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
  cursor: z.string().min(1).optional(),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

/**
 * The shape of every list response. `nextCursor` is opaque — clients follow it and
 * never construct or parse one. `null` means this was the last page.
 */
export const pageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

import type { Page } from "@data-room/shared";

/**
 * Turns an over-fetched row set into a page. Callers query `limit + 1` rows; the extra row
 * is what proves another page exists, so no COUNT(*) is needed to know whether to keep going.
 */
export function toPage<TRow, TItem>(
  rows: TRow[],
  limit: number,
  toItem: (row: TRow) => TItem,
  toCursor: (row: TRow) => string,
): Page<TItem> {
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  const last = visible.at(-1);

  return {
    items: visible.map(toItem),
    nextCursor: hasMore && last ? toCursor(last) : null,
  };
}

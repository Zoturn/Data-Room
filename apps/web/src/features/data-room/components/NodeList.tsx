"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { NodeSummary } from "@data-room/shared";
import { rowWindow, shouldVirtualise } from "@/features/data-room/virtual-rows";

/**
 * Until a row has been measured. Deliberately close to the real row so the first paint is
 * not visibly corrected a frame later.
 */
const ESTIMATED_ROW_HEIGHT = 53;

/** Rows kept mounted beyond the viewport, so a flick of the wheel never exposes blank space. */
const OVERSCAN = 8;

export type NodeListProps = {
  items: readonly NodeSummary[];
  /** The caller owns the row, including its key — this component owns only which rows exist. */
  renderRow: (node: NodeSummary) => ReactNode;
};

/**
 * The contents of one folder, rendering a window rather than a list.
 *
 * A Data Room folder can hold a hundred thousand files, and a hundred thousand `<li>`s is a
 * frontend failure independent of the database. Above a few screenfuls this mounts what the
 * viewport can show plus a margin and holds the rest open with two spacer rows, so the
 * scrollbar stays honest and the DOM stays small. The arithmetic is in `virtual-rows.ts`,
 * under test; what is here is the measurement and nothing else.
 *
 * The page scrolls, not a nested box: an inner scroller would trap the wheel, break the
 * browser's own find-in-page position and give the "load more" sentinel a second viewport to
 * be measured against.
 */
export function NodeList({ items, renderRow }: NodeListProps) {
  const listRef = useRef<HTMLUListElement | null>(null);

  const [rowHeight, setRowHeight] = useState(ESTIMATED_ROW_HEIGHT);

  /**
   * The viewport starts over-estimated rather than at zero: rendering a few rows too many
   * for one frame costs nothing, and rendering too few is a blank list until the first
   * measurement lands.
   */
  const [metrics, setMetrics] = useState(() => ({ scrollTop: 0, viewportHeight: 1_200 }));

  const count = items.length;
  const isVirtual = shouldVirtualise(count);

  useEffect(() => {
    const element = listRef.current;
    if (!isVirtual || element === null) return undefined;

    function measure() {
      if (element === null) return;

      const row = element.querySelector("[data-node-row]");
      if (row instanceof HTMLElement && row.offsetHeight > 0) setRowHeight(row.offsetHeight);

      const step = Math.max(rowHeight, 1);
      // Quantised to whole rows: the window only changes when a row boundary crosses the
      // fold, so a scroll gesture re-renders once per row instead of once per frame.
      const top = Math.floor(-element.getBoundingClientRect().top / step) * step;
      const height = window.innerHeight;

      setMetrics((previous) =>
        previous.scrollTop === top && previous.viewportHeight === height
          ? previous
          : { scrollTop: top, viewportHeight: height },
      );
    }

    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);

    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [isVirtual, rowHeight]);

  const view = isVirtual
    ? rowWindow({
        count,
        rowHeight,
        scrollTop: metrics.scrollTop,
        viewportHeight: metrics.viewportHeight,
        overscan: OVERSCAN,
      })
    : { startIndex: 0, endIndex: count, paddingTop: 0, paddingBottom: 0 };

  return (
    <ul
      ref={listRef}
      // The count is announced because a windowed list can only report the rows it has
      // mounted, and "17 items" in a folder of 100,000 would be a lie told by the markup.
      aria-label={`${count.toLocaleString()} ${count === 1 ? "item" : "items"}`}
      className="rounded-lg border border-border"
    >
      <li
        className="flex items-center gap-2 border-b border-border px-2 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
        aria-hidden
      >
        <span className="flex-1 pl-8">Name</span>
        <span className="hidden w-24 text-right sm:block">Size</span>
        <span className="hidden w-40 text-right md:block">Modified</span>
        <span className="w-9" />
      </li>

      {view.paddingTop > 0 ? <li aria-hidden style={{ height: view.paddingTop }} /> : null}

      {items.slice(view.startIndex, view.endIndex).map(renderRow)}

      {view.paddingBottom > 0 ? <li aria-hidden style={{ height: view.paddingBottom }} /> : null}
    </ul>
  );
}

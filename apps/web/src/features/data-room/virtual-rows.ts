/**
 * The window of rows a long listing actually renders.
 *
 * A folder of 100,000 files is a frontend failure independent of the database — see the
 * change's design note — so the list renders what the viewport can show plus a margin, and
 * holds the rest open with padding. The arithmetic lives here, away from the DOM, because
 * an off-by-one in it is a blank list and that deserves a test rather than a scroll.
 */
export type RowWindow = {
  /** Index of the first rendered row. */
  readonly startIndex: number;
  /** One past the last rendered row, so `slice(startIndex, endIndex)` is the window. */
  readonly endIndex: number;
  /** Height of the rows above the window, which keeps the scrollbar honest. */
  readonly paddingTop: number;
  /** Height of the rows below it. */
  readonly paddingBottom: number;
};

export type RowWindowInput = {
  count: number;
  rowHeight: number;
  /**
   * How far the top of the list has scrolled past the top of the viewport. Negative while
   * the list still starts below the fold, which is the common case for a short header.
   */
  scrollTop: number;
  viewportHeight: number;
  /** Rows rendered beyond the viewport, so a fast scroll does not expose blank space. */
  overscan: number;
};

/**
 * Below this many rows the whole list is rendered. Windowing costs a measured container and
 * two spacer rows; under a few screenfuls it buys nothing and only adds ways to be wrong.
 */
export const VIRTUALISE_ABOVE = 80;

export function shouldVirtualise(count: number): boolean {
  return count > VIRTUALISE_ABOVE;
}

export function rowWindow(input: RowWindowInput): RowWindow {
  const { count, rowHeight, scrollTop, viewportHeight, overscan } = input;

  // A row height of zero would divide the list into infinitely many rows; a measurement
  // that has not happened yet must degrade to rendering everything, never to nothing.
  if (count <= 0 || rowHeight <= 0) {
    return { startIndex: 0, endIndex: Math.max(count, 0), paddingTop: 0, paddingBottom: 0 };
  }

  const firstVisible = Math.floor(scrollTop / rowHeight);
  const lastVisible = Math.ceil((scrollTop + viewportHeight) / rowHeight);

  const startIndex = clamp(firstVisible - overscan, 0, count);
  const endIndex = clamp(lastVisible + overscan, startIndex, count);

  return {
    startIndex,
    endIndex,
    paddingTop: startIndex * rowHeight,
    paddingBottom: (count - endIndex) * rowHeight,
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

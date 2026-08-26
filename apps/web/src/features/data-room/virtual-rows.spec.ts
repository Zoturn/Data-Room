import { describe, expect, it } from "@jest/globals";
import { rowWindow, shouldVirtualise, VIRTUALISE_ABOVE } from "./virtual-rows";

const base = { rowHeight: 48, viewportHeight: 800, overscan: 6 };

describe("shouldVirtualise", () => {
  it("leaves a listing shorter than the threshold alone", () => {
    expect(shouldVirtualise(VIRTUALISE_ABOVE)).toBe(false);
    expect(shouldVirtualise(VIRTUALISE_ABOVE + 1)).toBe(true);
  });
});

describe("rowWindow", () => {
  it("renders from the top with overscan while the list sits below the fold", () => {
    // scrollTop is negative before the list reaches the top of the viewport; clamping is
    // what stops that from producing a negative start index and an empty render.
    const window = rowWindow({ ...base, count: 5_000, scrollTop: -300 });

    expect(window.startIndex).toBe(0);
    expect(window.paddingTop).toBe(0);
    expect(window.endIndex).toBeGreaterThan(10);
  });

  it("keeps the total height constant so the scrollbar does not lie", () => {
    const count = 100_000;
    const window = rowWindow({ ...base, count, scrollTop: 240_000 });
    const rendered = (window.endIndex - window.startIndex) * base.rowHeight;

    expect(window.paddingTop + rendered + window.paddingBottom).toBe(count * base.rowHeight);
  });

  it("renders a small window of a six-figure folder, not the folder", () => {
    const window = rowWindow({ ...base, count: 100_000, scrollTop: 240_000 });

    // A viewport of 800px over 48px rows is 17 rows, plus overscan at both ends.
    expect(window.endIndex - window.startIndex).toBeLessThan(40);
    expect(window.startIndex).toBe(5_000 - base.overscan);
  });

  it("stops at the last row when the list is scrolled to the end", () => {
    const window = rowWindow({ ...base, count: 200, scrollTop: 200 * 48 });

    expect(window.endIndex).toBe(200);
    expect(window.paddingBottom).toBe(0);
  });

  it("renders everything when there is nothing measured to window against", () => {
    // A container measured at zero height must degrade to the whole list; showing no rows
    // at all would look exactly like an empty folder.
    expect(rowWindow({ ...base, rowHeight: 0, count: 12, scrollTop: 0 })).toEqual({
      startIndex: 0,
      endIndex: 12,
      paddingTop: 0,
      paddingBottom: 0,
    });
  });

  it("has an empty window for an empty list", () => {
    expect(rowWindow({ ...base, count: 0, scrollTop: 0 })).toEqual({
      startIndex: 0,
      endIndex: 0,
      paddingTop: 0,
      paddingBottom: 0,
    });
  });
});

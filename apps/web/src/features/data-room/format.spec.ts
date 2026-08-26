import { describe, expect, it } from "@jest/globals";
import { describeSubtree, formatBytes, formatUpdatedAt, summariseAggregate } from "./format";

describe("formatBytes", () => {
  it("keeps whole bytes whole", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
  });

  it("climbs a unit at each 1024 and keeps one decimal", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2_469_606_195)).toBe("2.3 GB");
  });

  it("does not invent a size for a negative or unknown one", () => {
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});

describe("describeSubtree", () => {
  it("is the sentence the confirmation dialog states", () => {
    expect(describeSubtree({ folders: 12, files: 143, bytes: 2_469_606_195 })).toBe(
      "12 folders and 143 files (2.3 GB)",
    );
  });

  it("names only what is actually there, in the singular when there is one", () => {
    expect(describeSubtree({ folders: 3, files: 0, bytes: 0 })).toBe("3 folders");
    expect(describeSubtree({ folders: 0, files: 1, bytes: 2048 })).toBe("1 file (2 KB)");
  });

  // An empty folder must not be described with an alarming count of nothing.
  it("has nothing to say about an empty subtree", () => {
    expect(describeSubtree({ folders: 0, files: 0, bytes: 0 })).toBeNull();
  });
});

describe("summariseAggregate", () => {
  it("states zeroes plainly, because an empty room is a fact rather than a failure", () => {
    expect(summariseAggregate({ folders: 0, files: 0, bytes: 0 })).toBe(
      "0 folders · 0 files · 0 B",
    );
  });
});

describe("formatUpdatedAt", () => {
  const now = new Date("2026-08-26T12:00:00.000Z");

  it("does not count seconds", () => {
    expect(formatUpdatedAt("2026-08-26T11:59:50.000Z", now)).toBe("just now");
  });

  it("renders nothing rather than 'Invalid Date' for an unparseable timestamp", () => {
    expect(formatUpdatedAt("not a date", now)).toBe("");
  });
});

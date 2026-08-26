import { describe, expect, it } from "@jest/globals";
import { destinationFromRow, isFileDrag, type UploadDestination } from "./destination";

const OPEN_FOLDER: UploadDestination = { folderId: "folder-open", folderName: "Diligence" };

describe("destinationFromRow", () => {
  it("uploads into the folder row under the pointer", () => {
    expect(destinationFromRow("folder-legal", "Legal", OPEN_FOLDER)).toEqual({
      folderId: "folder-legal",
      folderName: "Legal",
    });
  });

  it("falls back to the open folder away from any row", () => {
    expect(destinationFromRow(null, null, OPEN_FOLDER)).toEqual(OPEN_FOLDER);
  });

  // Half a destination would light up a highlight naming the wrong folder, which is worse
  // than not offering the row as a target at all.
  it("falls back when a row publishes an id but no name", () => {
    expect(destinationFromRow("folder-legal", null, OPEN_FOLDER)).toEqual(OPEN_FOLDER);
    expect(destinationFromRow("folder-legal", "", OPEN_FOLDER)).toEqual(OPEN_FOLDER);
  });

  it("falls back when a row publishes a name but no id", () => {
    expect(destinationFromRow(null, "Legal", OPEN_FOLDER)).toEqual(OPEN_FOLDER);
    expect(destinationFromRow("", "Legal", OPEN_FOLDER)).toEqual(OPEN_FOLDER);
  });
});

describe("isFileDrag", () => {
  it("accepts a drag carrying files", () => {
    expect(isFileDrag(["Files"])).toBe(true);
  });

  it("ignores dragged text and links", () => {
    expect(isFileDrag(["text/plain", "text/uri-list"])).toBe(false);
    expect(isFileDrag([])).toBe(false);
    expect(isFileDrag(undefined)).toBe(false);
  });
});

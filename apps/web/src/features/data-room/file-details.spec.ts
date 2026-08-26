import { describe, expect, it } from "@jest/globals";
import type { FileDetail } from "@data-room/shared";
import { ApiError, NetworkError } from "@/lib/api/errors";
import {
  actionFailureMessage,
  fileLocation,
  fileParentCrumb,
  isMissing,
  joinFileName,
  moveFailureMessage,
  splitFileName,
  validateFileStem,
} from "./file-details";

function apiError(
  code: "INVALID_MOVE_TARGET" | "NOT_FOUND" | "NAME_CONFLICT",
  status: number,
): ApiError {
  return new ApiError({ code, message: "The API's own wording.", status, requestId: "req-1" });
}

function detail(breadcrumbs: { id: string; name: string }[]): FileDetail {
  return {
    file: {
      id: "file-1",
      type: "FILE",
      name: "report.pdf",
      updatedAt: "2026-08-26T10:00:00.000Z",
      sizeBytes: 1024,
    },
    breadcrumbs,
  };
}

describe("splitFileName", () => {
  it("keeps the extension out of the editable half", () => {
    expect(splitFileName("report.pdf")).toEqual({ stem: "report", extension: ".pdf" });
  });

  it("splits on the last dot, so a dotted stem survives a rename intact", () => {
    expect(splitFileName("q4.final.report.pdf")).toEqual({
      stem: "q4.final.report",
      extension: ".pdf",
    });
  });

  it("treats a leading dot as part of the name rather than as an extension", () => {
    // Otherwise the rename dialog opens with an empty field and nothing to type over.
    expect(splitFileName(".gitignore")).toEqual({ stem: ".gitignore", extension: "" });
  });

  it("leaves a name with no extension, and one that only ends in a dot, whole", () => {
    expect(splitFileName("report")).toEqual({ stem: "report", extension: "" });
    expect(splitFileName("report.")).toEqual({ stem: "report.", extension: "" });
  });

  it("round-trips through joinFileName", () => {
    const { stem, extension } = splitFileName("Отчёт 2026.pdf");
    expect(joinFileName(stem, extension)).toBe("Отчёт 2026.pdf");
  });
});

describe("validateFileStem", () => {
  it("refuses an empty stem", () => {
    expect(validateFileStem("", ".pdf")).toBe("Enter a name.");
  });

  it("states the budget left after the extension, not the raw bound", () => {
    const message = validateFileStem("x".repeat(252), ".pdf");

    expect(message).toBe("Use at most 251 characters — “.pdf” is kept.");
  });

  it("accepts a stem that fits once the extension is counted", () => {
    expect(validateFileStem("x".repeat(251), ".pdf")).toBeNull();
  });

  it("falls back to the whole bound when there is no extension to keep", () => {
    expect(validateFileStem("x".repeat(256), "")).toBe("Use at most 255 characters.");
  });
});

describe("fileParentCrumb", () => {
  it("takes the last crumb when the chain ends at the folder", () => {
    const crumb = fileParentCrumb(
      detail([
        { id: "root", name: "Acme" },
        { id: "folder-1", name: "Financials" },
      ]),
    );

    expect(crumb?.id).toBe("folder-1");
  });

  it("steps back past the file when the chain includes it", () => {
    // The two conventions are indistinguishable from the type, and the viewer must not
    // send someone "back" to the file they are already looking at.
    const crumb = fileParentCrumb(
      detail([
        { id: "root", name: "Acme" },
        { id: "folder-1", name: "Financials" },
        { id: "file-1", name: "report.pdf" },
      ]),
    );

    expect(crumb?.id).toBe("folder-1");
  });

  it("has no parent to offer when the chain is empty", () => {
    expect(fileParentCrumb(detail([]))).toBeNull();
  });
});

describe("fileLocation", () => {
  it("reports the folder and every ancestor whose totals a write moves", () => {
    expect(
      fileLocation(
        detail([
          { id: "root", name: "Acme" },
          { id: "folder-1", name: "Financials" },
        ]),
      ),
    ).toEqual({ parentId: "folder-1", ancestry: ["root", "folder-1"] });
  });

  it("never counts the file itself as an ancestor", () => {
    expect(
      fileLocation(
        detail([
          { id: "root", name: "Acme" },
          { id: "folder-1", name: "Financials" },
          { id: "file-1", name: "report.pdf" },
        ]),
      ),
    ).toEqual({ parentId: "folder-1", ancestry: ["root", "folder-1"] });
  });
});

describe("isMissing", () => {
  it("recognises the 404 that covers both deleted and never-yours", () => {
    expect(isMissing(apiError("NOT_FOUND", 404))).toBe(true);
    expect(isMissing(apiError("NAME_CONFLICT", 409))).toBe(false);
    expect(isMissing(new NetworkError())).toBe(false);
  });
});

describe("moveFailureMessage", () => {
  it("explains a non-folder target in terms of what to do instead", () => {
    expect(moveFailureMessage(apiError("INVALID_MOVE_TARGET", 400), "report.pdf")).toContain(
      "only be moved into a folder",
    );
  });

  it("describes a destination in another Data Room as unavailable, never as forbidden", () => {
    // 404 is all the API admits to; saying "not allowed" would leak that it exists.
    expect(moveFailureMessage(apiError("NOT_FOUND", 404), "Legal")).toBe(
      "“Legal” is no longer available. Choose another folder.",
    );
  });

  it("passes anything else through in the API's own words", () => {
    expect(moveFailureMessage(apiError("NAME_CONFLICT", 409), "Legal")).toBe(
      "The API's own wording.",
    );
  });
});

describe("actionFailureMessage", () => {
  it("prefers the API's wording and falls back for anything it did not write", () => {
    expect(actionFailureMessage(new NetworkError())).toContain("Could not reach the server");
    expect(actionFailureMessage(new Error("boom"))).toBe("Something went wrong. Please try again.");
  });
});

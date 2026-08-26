import { describe, expect, it } from "@jest/globals";
import type { UploadItem, UploadStatus } from "./queue";
import { describeUploadRow, resolvedNameNote, summariseQueue } from "./summary";

function anItem(status: UploadStatus, changes: Partial<UploadItem> = {}): UploadItem {
  return {
    id: `upload-${status}`,
    folderId: "folder-1",
    folderName: "Diligence",
    name: "report.pdf",
    resolvedName: null,
    sizeBytes: 2 * 1024 * 1024,
    status,
    progress: 0,
    error: null,
    retryable: false,
    nodeId: null,
    ...changes,
  };
}

describe("describeUploadRow", () => {
  it("states the size while a file waits its turn", () => {
    expect(describeUploadRow(anItem("queued"))).toBe("Waiting · 2 MB");
  });

  it("states the percentage and the size while sending", () => {
    expect(describeUploadRow(anItem("sending", { progress: 0.427 }))).toBe("43% of 2 MB");
  });

  // The two API calls that bracket the transfer have no meaningful percentage, so they say
  // what they are doing rather than sitting at 0% and then at 100%.
  it("names the two bracketing steps instead of showing progress", () => {
    expect(describeUploadRow(anItem("reserving"))).toBe("Preparing…");
    expect(describeUploadRow(anItem("committing"))).toBe("Finishing…");
  });

  it("repeats the failure's own sentence rather than writing a second one", () => {
    const failed = anItem("failed", { error: "The connection dropped while sending this file." });
    expect(describeUploadRow(failed)).toBe("The connection dropped while sending this file.");
  });

  it("still says something for a failure that arrived without a message", () => {
    expect(describeUploadRow(anItem("failed"))).toBe("Upload failed.");
  });
});

describe("resolvedNameNote", () => {
  it("says nothing while the name is unresolved or unchanged", () => {
    expect(resolvedNameNote(anItem("sending"))).toBeNull();
    expect(resolvedNameNote(anItem("done", { resolvedName: "report.pdf" }))).toBeNull();
  });

  it("reports a name the server suffixed, which is where the file will be found", () => {
    expect(resolvedNameNote(anItem("done", { resolvedName: "report (2).pdf" }))).toBe(
      "Saved as “report (2).pdf”",
    );
  });
});

describe("summariseQueue", () => {
  it("counts what is still in flight while anything is", () => {
    const items = [anItem("sending"), anItem("queued"), anItem("done")];
    expect(summariseQueue(items)).toBe("Uploading 2 of 3 files");
  });

  it("leads with the failures once nothing is in flight", () => {
    expect(summariseQueue([anItem("failed"), anItem("done")])).toBe("1 upload failed");
  });

  it("reports a clean batch", () => {
    expect(summariseQueue([anItem("done"), anItem("done")])).toBe("2 files uploaded");
  });

  it("keeps a cancellation visible beside what did succeed", () => {
    expect(summariseQueue([anItem("done"), anItem("cancelled")])).toBe(
      "1 file uploaded · 1 cancelled",
    );
  });

  it("reports a batch the user stopped entirely", () => {
    expect(summariseQueue([anItem("cancelled"), anItem("cancelled")])).toBe("2 uploads cancelled");
  });
});

import { describe, expect, it } from "@jest/globals";

import {
  FILE_SIZE_MAX_BYTES,
  PDF_CONTENT_TYPE,
  contentUrlSchema,
  moveInputSchema,
  uploadIntentInputSchema,
  uploadIntentSchema,
} from "./files.js";

const PARENT_ID = "6f1b9d3e-2c4a-4b0e-9a7d-6d5f0c1b2a34";
const NODE_ID = "0d2c8a51-9f3b-4d6e-8c1a-7b4e5f6a9d20";

/**
 * These schemas are the contract both sides validate against, so what they *refuse* is the
 * part worth pinning: every rejection below is a check the server would otherwise have to
 * repeat by hand.
 */
describe("uploadIntentInputSchema", () => {
  const valid = {
    parentId: PARENT_ID,
    name: "report.pdf",
    contentType: PDF_CONTENT_TYPE,
    sizeBytes: 1024,
  };

  it("accepts a declared PDF within the size limit", () => {
    expect(uploadIntentInputSchema.parse(valid)).toEqual(valid);
  });

  it("refuses a content type other than PDF", () => {
    expect(uploadIntentInputSchema.safeParse({ ...valid, contentType: "image/png" }).success).toBe(
      false,
    );
  });

  it("refuses a size over the limit, so an oversized file is stopped before any bytes move", () => {
    expect(
      uploadIntentInputSchema.safeParse({ ...valid, sizeBytes: FILE_SIZE_MAX_BYTES + 1 }).success,
    ).toBe(false);
  });

  it("refuses an empty file — a zero-byte upload has nothing to commit", () => {
    expect(uploadIntentInputSchema.safeParse({ ...valid, sizeBytes: 0 }).success).toBe(false);
  });

  it("refuses a parent that is not a uuid", () => {
    expect(uploadIntentInputSchema.safeParse({ ...valid, parentId: "root" }).success).toBe(false);
  });
});

describe("uploadIntentSchema", () => {
  it("carries the resolved name, which may differ from the one that was asked for", () => {
    const intent = uploadIntentSchema.parse({
      nodeId: NODE_ID,
      uploadUrl: "https://storage.example.com/upload?token=abc",
      resolvedName: "report (2).pdf",
      expiresAt: "2026-08-26T12:00:00.000Z",
    });

    expect(intent.resolvedName).toBe("report (2).pdf");
  });

  it("refuses an expiry that is not an ISO timestamp", () => {
    const result = uploadIntentSchema.safeParse({
      nodeId: NODE_ID,
      uploadUrl: "https://storage.example.com/upload?token=abc",
      resolvedName: "report.pdf",
      expiresAt: "in five minutes",
    });

    expect(result.success).toBe(false);
  });
});

describe("contentUrlSchema", () => {
  it("refuses a relative URL, which the viewer could not load", () => {
    expect(
      contentUrlSchema.safeParse({ url: "/object/report.pdf", expiresAt: "2026-08-26T12:00:00.000Z" })
        .success,
    ).toBe(false);
  });
});

describe("moveInputSchema", () => {
  it("carries the destination and nothing else", () => {
    expect(moveInputSchema.parse({ parentId: PARENT_ID, name: "ignored" })).toEqual({
      parentId: PARENT_ID,
    });
  });
});

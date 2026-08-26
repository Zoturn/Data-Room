import { describe, expect, it } from "@jest/globals";

import {
  createShareInputSchema,
  shareSchema,
  sharedViewSchema,
  shareModeSchema,
  shareRoleSchema,
} from "./sharing.js";

const NODE_ID = "3f0a7c22-8b1d-4e5f-9a06-1c2d3e4f5a6b";
const SHARE_ID = "9c8b7a65-4d3e-4f21-8a09-0b1c2d3e4f50";
const GRANT_ID = "1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9";

/**
 * These schemas are the contract three other layers validate against, so the parts pinned
 * here are the ones a caller could otherwise get away with breaking: the defaults that make a
 * minimal body legal, and the refusals that keep a token or a write capability out of the shape.
 */
describe("createShareInputSchema", () => {
  it("defaults a share to no expiry and no recipients, so a public link needs only a node", () => {
    expect(createShareInputSchema.parse({ nodeId: NODE_ID, mode: "PUBLIC_LINK" })).toEqual({
      nodeId: NODE_ID,
      mode: "PUBLIC_LINK",
      expiresAt: null,
      emails: [],
    });
  });

  it("accepts recipients for a restricted share", () => {
    const parsed = createShareInputSchema.parse({
      nodeId: NODE_ID,
      mode: "RESTRICTED",
      emails: ["Buyer@Acme.com", "counsel@acme.com"],
    });

    // Case is left alone here on purpose: normalisation is the server's job, and doing it in
    // two places is how `Buyer@Acme.com` ends up with two grants.
    expect(parsed.emails).toEqual(["Buyer@Acme.com", "counsel@acme.com"]);
  });

  it("refuses a recipient list long enough to be a mailing list", () => {
    const emails = Array.from({ length: 51 }, (_, index) => `person${index}@acme.com`);

    expect(
      createShareInputSchema.safeParse({ nodeId: NODE_ID, mode: "RESTRICTED", emails }).success,
    ).toBe(false);
  });

  it("refuses an address that is not an email, before it becomes a grant nobody can match", () => {
    expect(
      createShareInputSchema.safeParse({ nodeId: NODE_ID, mode: "RESTRICTED", emails: ["buyer"] })
        .success,
    ).toBe(false);
  });

  it("refuses a node id that is not a uuid, keeping the path alphabet closed", () => {
    expect(createShareInputSchema.safeParse({ nodeId: "root", mode: "PUBLIC_LINK" }).success).toBe(
      false,
    );
  });

  it("refuses an expiry that is not an instant", () => {
    expect(
      createShareInputSchema.safeParse({ nodeId: NODE_ID, mode: "PUBLIC_LINK", expiresAt: "soon" })
        .success,
    ).toBe(false);
  });

  it("refuses a mode outside the two that exist", () => {
    expect(createShareInputSchema.safeParse({ nodeId: NODE_ID, mode: "ANYONE" }).success).toBe(
      false,
    );
  });
});

describe("shareRoleSchema", () => {
  it("admits VIEWER and nothing else, so a write capability cannot be requested", () => {
    expect(shareRoleSchema.parse("VIEWER")).toBe("VIEWER");
    expect(shareRoleSchema.safeParse("EDITOR").success).toBe(false);
  });
});

describe("shareModeSchema", () => {
  it("names both modes", () => {
    expect(shareModeSchema.options).toEqual(["PUBLIC_LINK", "RESTRICTED"]);
  });
});

describe("shareSchema", () => {
  const share = {
    id: SHARE_ID,
    nodeId: NODE_ID,
    nodeName: "Diligence",
    mode: "PUBLIC_LINK",
    role: "VIEWER",
    url: "https://app.example.com/shared/abc",
    expiresAt: null,
    revokedAt: null,
    createdAt: "2026-08-27T09:00:00.000Z",
    grants: [],
  };

  it("carries the link for a public share", () => {
    expect(shareSchema.parse(share).url).toBe("https://app.example.com/shared/abc");
  });

  it("allows a null url, which is what a restricted share reports instead of a token", () => {
    const restricted = {
      ...share,
      mode: "RESTRICTED",
      url: null,
      grants: [{ id: GRANT_ID, email: "buyer@acme.com", role: "VIEWER", acceptedAt: null }],
    };

    expect(shareSchema.parse(restricted).grants[0]?.email).toBe("buyer@acme.com");
  });

  it("has no field a raw token could travel in", () => {
    const parsed = shareSchema.parse({ ...share, token: "s3cr3t" });

    expect(Object.keys(parsed)).not.toContain("token");
  });

  it("refuses a url that is not a url", () => {
    expect(shareSchema.safeParse({ ...share, url: "/shared/abc" }).success).toBe(false);
  });
});

describe("sharedViewSchema", () => {
  const node = {
    id: NODE_ID,
    type: "FOLDER",
    name: "Diligence",
    updatedAt: "2026-08-27T09:00:00.000Z",
    sizeBytes: 0,
  };

  it("accepts a shared folder with its re-rooted breadcrumb and its children", () => {
    const view = sharedViewSchema.parse({
      node,
      breadcrumbs: [{ id: NODE_ID, name: "Diligence" }],
      children: { items: [], nextCursor: null },
      canDownload: true,
    });

    // The share target is the first crumb: anything above it is outside the share.
    expect(view.breadcrumbs[0]?.id).toBe(NODE_ID);
  });

  it("accepts null children, which is how a shared file says its folder is not listable", () => {
    const view = sharedViewSchema.parse({
      node: { ...node, type: "FILE", sizeBytes: 2048 },
      breadcrumbs: [{ id: NODE_ID, name: "report.pdf" }],
      children: null,
      canDownload: true,
    });

    expect(view.children).toBeNull();
  });

  it("refuses canDownload false — a view a recipient can open is one they can read", () => {
    expect(
      sharedViewSchema.safeParse({
        node,
        breadcrumbs: [],
        children: null,
        canDownload: false,
      }).success,
    ).toBe(false);
  });
});

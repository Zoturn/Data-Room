import { describe, expect, it } from "@jest/globals";
import { describeShareState, expiryInstant, isShareActive, parseEmails } from "./share-form";

/**
 * The cases a deal room actually produces: a list pasted out of a spreadsheet, the same
 * person entered twice in different case, and a link whose expiry passed while the page was
 * open.
 */
const NOW = new Date("2026-03-01T12:00:00.000Z");

describe("parseEmails", () => {
  it("splits on the separators a paste actually contains", () => {
    const parsed = parseEmails("a@acme.com, b@acme.com; c@acme.com\nd@acme.com  e@acme.com");

    expect(parsed.valid).toEqual([
      "a@acme.com",
      "b@acme.com",
      "c@acme.com",
      "d@acme.com",
      "e@acme.com",
    ]);
    expect(parsed.invalid).toEqual([]);
  });

  it("treats one person entered twice in different case as one person", () => {
    // The API normalises the same way, so the dialog's idea of a duplicate matches the
    // unique index that enforces it.
    const parsed = parseEmails("Buyer@Acme.com, buyer@acme.com");

    expect(parsed.valid).toEqual(["buyer@acme.com"]);
  });

  it("keeps what did not parse, as typed, so the message can name it", () => {
    const parsed = parseEmails("good@acme.com, not-an-address, also bad@");

    expect(parsed.valid).toEqual(["good@acme.com"]);
    expect(parsed.invalid).toEqual(["not-an-address", "also", "bad@"]);
  });

  it("ignores trailing separators rather than inventing an empty recipient", () => {
    expect(parseEmails("a@acme.com,  ,\n")).toEqual({ valid: ["a@acme.com"], invalid: [] });
  });

  it("returns nothing for nothing", () => {
    expect(parseEmails("   ")).toEqual({ valid: [], invalid: [] });
  });
});

describe("expiryInstant", () => {
  it("resolves a duration against the caller's clock into an absolute instant", () => {
    expect(expiryInstant("7d", NOW)).toBe("2026-03-08T12:00:00.000Z");
    expect(expiryInstant("1d", NOW)).toBe("2026-03-02T12:00:00.000Z");
    expect(expiryInstant("30d", NOW)).toBe("2026-03-31T12:00:00.000Z");
  });

  it("has no instant for a link that lasts until it is revoked", () => {
    expect(expiryInstant("never", NOW)).toBeNull();
  });
});

describe("isShareActive", () => {
  it("counts a share with no expiry as active", () => {
    expect(isShareActive({ revokedAt: null, expiresAt: null }, NOW)).toBe(true);
  });

  it("counts a revoked share as inactive even when its expiry is still ahead", () => {
    expect(isShareActive({ revokedAt: "2026-02-01T00:00:00.000Z", expiresAt: null }, NOW)).toBe(
      false,
    );
  });

  it("counts a passed expiry as inactive", () => {
    expect(isShareActive({ revokedAt: null, expiresAt: "2026-02-28T12:00:00.000Z" }, NOW)).toBe(
      false,
    );
  });
});

describe("describeShareState", () => {
  it("says revoked first, because that was a decision somebody took", () => {
    expect(
      describeShareState(
        { revokedAt: "2026-02-01T00:00:00.000Z", expiresAt: "2026-04-01T00:00:00.000Z" },
        NOW,
      ),
    ).toBe("Revoked");
  });

  it("counts the days left, in the singular when there is one", () => {
    expect(
      describeShareState({ revokedAt: null, expiresAt: "2026-03-08T12:00:00.000Z" }, NOW),
    ).toBe("Expires in 7 days");
    expect(
      describeShareState({ revokedAt: null, expiresAt: "2026-03-02T12:00:00.000Z" }, NOW),
    ).toBe("Expires in a day");
  });

  it("says expired once the instant has passed", () => {
    expect(
      describeShareState({ revokedAt: null, expiresAt: "2026-02-28T12:00:00.000Z" }, NOW),
    ).toBe("Expired");
  });

  it("says what an unlimited link is, rather than leaving it blank", () => {
    expect(describeShareState({ revokedAt: null, expiresAt: null }, NOW)).toBe(
      "Active until revoked",
    );
  });
});

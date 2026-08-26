import { createHash } from "node:crypto";
import {
  SHARE_TOKEN_BYTES,
  generateShareToken,
  hashShareToken,
  isShareTokenShaped,
  shareUrlFor,
} from "./share-token";

describe("share tokens", () => {
  describe("Requirement: A share token is 256 bits from a CSPRNG", () => {
    it("carries 32 bytes of entropy", () => {
      expect(SHARE_TOKEN_BYTES).toBe(32);
      expect(Buffer.from(generateShareToken(), "base64url")).toHaveLength(32);
    });

    it("never repeats a token", () => {
      // Not a proof of randomness — nothing this cheap is — but it does catch the failure
      // that actually happens: a generator wired to a constant, a counter, or a value
      // derived from the node being shared.
      const tokens = new Set(Array.from({ length: 500 }, generateShareToken));

      expect(tokens.size).toBe(500);
    });

    it("produces only characters that survive a URL path", () => {
      // `+` and `/` from plain base64 would have to survive being pasted out of an email and
      // into a browser, and one of them would not.
      for (let attempt = 0; attempt < 100; attempt += 1) {
        expect(generateShareToken()).toMatch(/^[A-Za-z0-9_-]+$/u);
      }
    });
  });

  describe("Requirement: The stored form is a hash, not the token", () => {
    it("stores something the token cannot be read back out of", () => {
      const token = generateShareToken();

      expect(hashShareToken(token)).not.toContain(token);
      expect(hashShareToken(token)).toBe(createHash("sha256").update(token, "utf8").digest("hex"));
    });

    it("hashes deterministically, so a presented token is one indexed lookup", () => {
      const token = generateShareToken();

      expect(hashShareToken(token)).toBe(hashShareToken(token));
    });

    it("separates two tokens that differ by a single character", () => {
      expect(hashShareToken("a".repeat(43))).not.toBe(hashShareToken(`${"a".repeat(42)}b`));
    });
  });

  describe("Requirement: A malformed token is answered without a database round trip", () => {
    it("accepts what the generator produces", () => {
      expect(isShareTokenShaped(generateShareToken())).toBe(true);
    });

    it.each([
      ["empty", ""],
      ["too short", "a".repeat(42)],
      ["too long", "a".repeat(44)],
      ["a plain-base64 slash", `${"a".repeat(42)}/`],
      ["a plain-base64 plus", `${"a".repeat(42)}+`],
      ["base64 padding", `${"a".repeat(42)}=`],
      ["a node id", "0f5d6c6e-2c1f-4a5b-9d3e-1f2a3b4c5d6e"],
    ])("refuses %s", (_case, value) => {
      expect(isShareTokenShaped(value)).toBe(false);
    });
  });

  describe("Requirement: The copied link points at the web app", () => {
    it("addresses the recipient's page, not the API", () => {
      expect(shareUrlFor("https://app.test", "token-value")).toBe(
        "https://app.test/shared/token-value",
      );
    });

    it("joins with exactly one slash", () => {
      // `WEB_APP_URL` is stripped of a trailing slash by the env schema; asserting it here
      // means a change to that transform breaks this test rather than a screenshot in a
      // data room.
      expect(shareUrlFor("https://app.test", "t")).not.toContain("//shared");
    });
  });
});

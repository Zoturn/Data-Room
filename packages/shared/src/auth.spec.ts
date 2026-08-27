import { describe, expect, it } from "@jest/globals";
import {
  loginInputSchema,
  normalizeEmail,
  registerInputSchema,
  sessionUserSchema,
} from "./auth.js";

describe("normalizeEmail", () => {
  it.each([
    ["Owner@Acme.com", "owner@acme.com"],
    ["  owner@acme.com  ", "owner@acme.com"],
    ["\tOWNER@ACME.COM\n", "owner@acme.com"],
  ])("collapses %p to %p", (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it("is idempotent, so re-normalising a stored address never changes it", () => {
    const once = normalizeEmail(" Owner@Acme.com ");
    expect(normalizeEmail(once)).toBe(once);
  });

  it("treats case and padding variants as one address", () => {
    const variants = ["owner@acme.com", "Owner@Acme.com", " OWNER@acme.com "];
    const normalized = new Set(variants.map(normalizeEmail));
    expect(normalized.size).toBe(1);
  });
});

describe("registerInputSchema", () => {
  it("normalises the email it accepts, so the value stored is the value compared", () => {
    const result = registerInputSchema.safeParse({
      email: "  Owner@Acme.com ",
      password: "correct horse",
    });

    if (!result.success) throw new Error("expected a valid registration");
    expect(result.data.email).toBe("owner@acme.com");
  });

  it("accepts an optional display name", () => {
    const result = registerInputSchema.safeParse({
      email: "owner@acme.com",
      password: "correct horse",
      displayName: "  Ada Lovelace  ",
    });

    if (!result.success) throw new Error("expected a valid registration");
    expect(result.data.displayName).toBe("Ada Lovelace");
  });

  it("enforces the password minimum", () => {
    const result = registerInputSchema.safeParse({
      email: "owner@acme.com",
      password: "1234567",
    });

    expect(result.success).toBe(false);
  });

  it("accepts a password exactly at the minimum", () => {
    const result = registerInputSchema.safeParse({
      email: "owner@acme.com",
      password: "12345678",
    });

    expect(result.success).toBe(true);
  });

  it("bounds the password, so Argon2id cannot be turned into a denial of service", () => {
    const result = registerInputSchema.safeParse({
      email: "owner@acme.com",
      password: "a".repeat(257),
    });

    expect(result.success).toBe(false);
  });

  it.each(["not-an-email", "owner@", "@acme.com", "owner acme.com", ""])(
    "rejects the malformed email %p",
    (email) => {
      expect(registerInputSchema.safeParse({ email, password: "correct horse" }).success).toBe(
        false,
      );
    },
  );

  it("rejects a malformed email even after trimming, so padding cannot smuggle one through", () => {
    const result = registerInputSchema.safeParse({
      email: "   not-an-email   ",
      password: "correct horse",
    });

    expect(result.success).toBe(false);
  });
});

describe("loginInputSchema", () => {
  it("normalises the email the same way registration does", () => {
    const result = loginInputSchema.safeParse({ email: " Owner@Acme.com ", password: "x" });

    if (!result.success) throw new Error("expected a valid login");
    expect(result.data.email).toBe("owner@acme.com");
  });

  it("requires a password, but only that one is present", () => {
    expect(loginInputSchema.safeParse({ email: "owner@acme.com", password: "" }).success).toBe(
      false,
    );
    expect(loginInputSchema.safeParse({ email: "owner@acme.com", password: "x" }).success).toBe(
      true,
    );
  });

  it("does not reject a malformed email, so a bad address fails as INVALID_CREDENTIALS not as validation", () => {
    expect(loginInputSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(true);
  });
});

describe("sessionUserSchema", () => {
  const sessionUser = {
    id: "8f2b1e3a-0000-4000-8000-000000000001",
    email: "owner@acme.com",
    displayName: "Ada Lovelace",
    hasPassword: true,
  };

  it("accepts a user with both sign-in methods described", () => {
    expect(sessionUserSchema.safeParse(sessionUser).success).toBe(true);
  });

  it("rejects an object carrying a passwordHash, so credential material cannot ride along", () => {
    const result = sessionUserSchema.safeParse({
      ...sessionUser,
      passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$hash",
    });

    expect(result.success).toBe(false);
  });

  it.each(["passwordHash", "refreshToken", "accessToken"])(
    "rejects the unexpected %s field rather than silently stripping it",
    (field) => {
      const result = sessionUserSchema.safeParse({ ...sessionUser, [field]: "secret" });
      expect(result.success).toBe(false);
    },
  );

  it("requires the linked-method flag, so the interface never guesses", () => {
    const { hasPassword: _omitted, ...withoutFlag } = sessionUser;
    expect(sessionUserSchema.safeParse(withoutFlag).success).toBe(false);
  });
});

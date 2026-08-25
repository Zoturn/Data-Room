import { describe, expect, it } from "@jest/globals";
import { apiErrorSchema, isApiErrorBody } from "./errors.js";

describe("apiErrorSchema", () => {
  it("accepts a minimal envelope", () => {
    const result = apiErrorSchema.safeParse({
      code: "NOT_FOUND",
      message: "That folder does not exist",
      requestId: "req_01H",
    });

    expect(result.success).toBe(true);
  });

  it("accepts field-level details", () => {
    const result = apiErrorSchema.safeParse({
      code: "VALIDATION_FAILED",
      message: "Some fields need attention",
      details: [{ field: "name", message: "Name is required" }],
      requestId: "req_01H",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a code outside the union, so no endpoint can invent one", () => {
    const result = apiErrorSchema.safeParse({
      code: "SOMETHING_BROKE",
      message: "…",
      requestId: "req_01H",
    });

    expect(result.success).toBe(false);
  });

  it("requires a requestId, so every failure is traceable to a log line", () => {
    const result = apiErrorSchema.safeParse({
      code: "INTERNAL_ERROR",
      message: "Something went wrong",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an empty message", () => {
    const result = apiErrorSchema.safeParse({
      code: "INTERNAL_ERROR",
      message: "",
      requestId: "req_01H",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a detail entry missing its field name", () => {
    const result = apiErrorSchema.safeParse({
      code: "VALIDATION_FAILED",
      message: "Some fields need attention",
      details: [{ message: "Name is required" }],
      requestId: "req_01H",
    });

    expect(result.success).toBe(false);
  });
});

describe("isApiErrorBody", () => {
  it("narrows a valid envelope", () => {
    const body: unknown = { code: "NAME_CONFLICT", message: "Taken", requestId: "req_1" };

    if (!isApiErrorBody(body)) throw new Error("expected a valid envelope");
    expect(body.code).toBe("NAME_CONFLICT");
  });

  it.each([null, undefined, "not json", 42, {}, { code: "NOT_FOUND" }])("rejects %p", (value) => {
    expect(isApiErrorBody(value)).toBe(false);
  });
});

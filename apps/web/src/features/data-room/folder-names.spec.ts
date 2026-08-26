import { describe, expect, it } from "@jest/globals";
import { ApiError, NetworkError } from "@/lib/api/errors";
import { nameFailureFrom, validateNodeName } from "./folder-names";

function apiError(
  code: "NAME_CONFLICT" | "VALIDATION_FAILED" | "MAX_DEPTH_EXCEEDED" | "NOT_FOUND",
  details?: { field: string; message: string }[],
): ApiError {
  return new ApiError({
    code,
    message: "The API's own wording.",
    status: 400,
    requestId: "req-1",
    ...(details ? { details } : {}),
  });
}

describe("validateNodeName", () => {
  it("accepts a name and refuses an empty one", () => {
    expect(validateNodeName("Financials")).toBeNull();
    expect(validateNodeName("")).toBe("Enter a name.");
  });

  it("names the bound it enforces", () => {
    expect(validateNodeName("x".repeat(256))).toBe("Use at most 255 characters.");
  });
});

describe("nameFailureFrom", () => {
  // The one that matters: a conflict belongs on the field, quoting the name, never in a
  // toast the user cannot associate with an input.
  it("puts a name conflict on the field and quotes the name", () => {
    const failure = nameFailureFrom(apiError("NAME_CONFLICT"), "Reports");

    expect(failure.placement).toBe("field");
    expect(failure.message).toContain("Reports");
  });

  it("uses the server's own field message when it names the field", () => {
    const failure = nameFailureFrom(
      apiError("VALIDATION_FAILED", [{ field: "name", message: "Names cannot start with a dot." }]),
      ".hidden",
    );

    expect(failure).toEqual({ placement: "field", message: "Names cannot start with a dot." });
  });

  it("falls back to the form when the rejection is not about the name", () => {
    const failure = nameFailureFrom(
      apiError("VALIDATION_FAILED", [{ field: "parentId", message: "Unknown parent." }]),
      "Reports",
    );

    expect(failure.placement).toBe("form");
  });

  it("says the depth limit and the reachability problem in the API's words", () => {
    expect(nameFailureFrom(apiError("MAX_DEPTH_EXCEEDED"), "Deep")).toEqual({
      placement: "form",
      message: "The API's own wording.",
    });
    expect(nameFailureFrom(apiError("NOT_FOUND"), "Gone").message).toContain("no longer available");
  });

  it("distinguishes a request that never arrived from one that was refused", () => {
    expect(nameFailureFrom(new NetworkError(), "Reports").placement).toBe("form");
    expect(nameFailureFrom(new Error("boom"), "Reports").message).toBe(
      "Something went wrong. Please try again.",
    );
  });
});

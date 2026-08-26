import { describe, expect, it } from "@jest/globals";
import { ApiError, toApiError } from "./errors";

function responseOf(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("toApiError", () => {
  it("parses a well-formed envelope", async () => {
    const error = await toApiError(
      responseOf(409, {
        code: "NAME_CONFLICT",
        message: 'An item named "report.pdf" already exists in this folder',
        requestId: "req_1",
      }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("NAME_CONFLICT");
    expect(error.status).toBe(409);
    expect(error.requestId).toBe("req_1");
    expect(error.details).toEqual([]);
  });

  it("keeps field details so a form can show them on the right input", async () => {
    const error = await toApiError(
      responseOf(400, {
        code: "VALIDATION_FAILED",
        message: "Some fields need attention",
        details: [{ field: "name", message: "Name is required" }],
        requestId: "req_2",
      }),
    );

    expect(error.details).toEqual([{ field: "name", message: "Name is required" }]);
  });

  it("falls back honestly when the body is not an envelope", async () => {
    // A proxy or platform error page answered instead of the API. Say so rather than
    // inventing a code the client would then branch on incorrectly.
    const error = await toApiError(new Response("<html>502 Bad Gateway</html>", { status: 502 }));

    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.status).toBe(502);
    expect(error.requestId).toBe("unknown");
  });

  it("recovers the request id from the header when the body is unusable", async () => {
    const error = await toApiError(
      new Response("not json", { status: 500, headers: { "x-request-id": "req_hdr" } }),
    );

    expect(error.requestId).toBe("req_hdr");
  });
});

describe("ApiError.isRetryable", () => {
  function buildError(code: ConstructorParameters<typeof ApiError>[0]["code"], status: number) {
    return new ApiError({ code, message: "x", status, requestId: "r" });
  }

  it("treats server failures and throttling as worth retrying", () => {
    expect(buildError("INTERNAL_ERROR", 500).isRetryable).toBe(true);
    expect(buildError("RATE_LIMITED", 429).isRetryable).toBe(true);
  });

  it.each([
    { code: "NOT_FOUND" as const, status: 404 },
    { code: "NAME_CONFLICT" as const, status: 409 },
    { code: "VALIDATION_FAILED" as const, status: 400 },
    { code: "INVALID_CREDENTIALS" as const, status: 401 },
  ])("does not retry $code — it would only delay the real error", ({ code, status }) => {
    expect(buildError(code, status).isRetryable).toBe(false);
  });
});

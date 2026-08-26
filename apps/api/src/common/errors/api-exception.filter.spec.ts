import { HttpException, HttpStatus } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import { apiErrorSchema } from "@data-room/shared";
import { ApiExceptionFilter } from "./api-exception.filter";
import { NameConflictError, NotFoundError, ValidationFailedError } from "./domain-error";

type Captured = { status: number; body: unknown };

function hostFor(captured: Captured): ArgumentsHost {
  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  };

  const request = { requestId: "req_test", method: "GET", originalUrl: "/api/folders/1" };

  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;
}

describe("ApiExceptionFilter", () => {
  const filter = new ApiExceptionFilter();

  beforeAll(() => {
    // The 5xx path logs deliberately; silence it so a passing run stays readable.
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("shapes a domain error into the shared envelope", () => {
    const captured: Captured = { status: 0, body: undefined };
    filter.catch(new NameConflictError("report.pdf"), hostFor(captured));

    expect(captured.status).toBe(409);
    expect(apiErrorSchema.safeParse(captured.body).success).toBe(true);
    expect(captured.body).toMatchObject({ code: "NAME_CONFLICT", requestId: "req_test" });
  });

  it("carries field details through for a validation failure", () => {
    const captured: Captured = { status: 0, body: undefined };
    filter.catch(
      new ValidationFailedError("Some fields need attention", [
        { field: "name", message: "Name is required" },
      ]),
      hostFor(captured),
    );

    expect(captured.status).toBe(400);
    expect(captured.body).toMatchObject({
      code: "VALIDATION_FAILED",
      details: [{ field: "name", message: "Name is required" }],
    });
  });

  it("answers 404 for something the caller may not see", () => {
    const captured: Captured = { status: 0, body: undefined };
    filter.catch(new NotFoundError(), hostFor(captured));

    expect(captured.status).toBe(404);
    expect(captured.body).toMatchObject({ code: "NOT_FOUND" });
  });

  it("sanitises an unexpected error, leaking no stack trace or driver text", () => {
    const captured: Captured = { status: 0, body: undefined };
    const leaky = new Error("connect ECONNREFUSED 10.0.0.5:5432 — relation users does not exist");

    filter.catch(leaky, hostFor(captured));

    expect(captured.status).toBe(500);
    expect(apiErrorSchema.safeParse(captured.body).success).toBe(true);

    const serialised = JSON.stringify(captured.body);
    expect(serialised).not.toContain("ECONNREFUSED");
    expect(serialised).not.toContain("relation users");
    expect(serialised).not.toContain("at ");
    expect(captured.body).toMatchObject({ code: "INTERNAL_ERROR", requestId: "req_test" });
  });

  it("maps a framework HttpException onto a contract code", () => {
    const captured: Captured = { status: 0, body: undefined };
    filter.catch(new HttpException("Nope", HttpStatus.UNAUTHORIZED), hostFor(captured));

    expect(captured.status).toBe(401);
    expect(captured.body).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("never emits a body outside the shared schema", () => {
    const cases: unknown[] = [
      new NotFoundError(),
      new NameConflictError("x"),
      new HttpException("teapot", 418),
      "a thrown string",
      undefined,
    ];

    for (const thrown of cases) {
      const captured: Captured = { status: 0, body: undefined };
      filter.catch(thrown, hostFor(captured));
      expect(apiErrorSchema.safeParse(captured.body).success).toBe(true);
    }
  });
});

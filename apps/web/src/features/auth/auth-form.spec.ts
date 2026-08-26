import { describe, expect, it } from "@jest/globals";
import {
  loginInputSchema,
  registerInputSchema,
  type ApiErrorCode,
  type FieldError,
} from "@data-room/shared";
import { ApiError, NetworkError } from "@/lib/api/errors";
import {
  authScreenHref,
  destinationFrom,
  safeRedirectPath,
  submitFailureFrom,
  zodFieldErrors,
} from "./auth-form";

const FIELDS = ["email", "password"] as const;

/**
 * Built branch by branch rather than by spreading a partial: `exactOptionalPropertyTypes`
 * refuses an explicit `undefined` where the constructor declares an optional property.
 */
function apiError(init: {
  code: ApiErrorCode;
  message?: string;
  status?: number;
  details?: FieldError[];
}): ApiError {
  const base = {
    code: init.code,
    message: init.message ?? "Something the server said",
    status: init.status ?? 400,
    requestId: "req_test",
  };

  return init.details === undefined
    ? new ApiError(base)
    : new ApiError({ ...base, details: init.details });
}

describe("zodFieldErrors", () => {
  it("puts each shared-schema issue on the field it belongs to", () => {
    const parsed = registerInputSchema.safeParse({ email: "not-an-email", password: "short" });
    if (parsed.success) throw new Error("expected the shared schema to reject this input");

    expect(zodFieldErrors(parsed.error)).toEqual({
      email: "Enter a valid email address.",
      password: "Use at least 8 characters.",
    });
  });

  it("says a value is missing rather than quoting a length rule", () => {
    const parsed = loginInputSchema.safeParse({ email: "", password: "" });
    if (parsed.success) throw new Error("expected the shared schema to reject empty credentials");

    expect(zodFieldErrors(parsed.error)).toEqual({
      email: "Enter your email address.",
      password: "Enter your password.",
    });
  });

  it("keeps only the first message per field, so one input never stacks complaints", () => {
    const parsed = registerInputSchema.safeParse({ email: "a".repeat(300), password: "x" });
    if (parsed.success) throw new Error("expected the shared schema to reject this input");

    const fields = zodFieldErrors(parsed.error);
    expect(Object.keys(fields).sort()).toEqual(["email", "password"]);
  });
});

describe("submitFailureFrom", () => {
  it("renders envelope details on the matching inputs and not as a lone form error", () => {
    const failure = submitFailureFrom(
      apiError({
        code: "VALIDATION_FAILED",
        details: [{ field: "password", message: "Password is too weak" }],
      }),
      FIELDS,
    );

    expect(failure).toEqual({ fields: { password: "Password is too weak" }, formError: null });
  });

  it("surfaces a detail for a field this form does not render, rather than dropping it", () => {
    const failure = submitFailureFrom(
      apiError({
        code: "VALIDATION_FAILED",
        details: [{ field: "captcha", message: "Captcha is required" }],
      }),
      FIELDS,
    );

    expect(failure.fields).toEqual({});
    expect(failure.formError).toBe("Captcha is required");
  });

  it("falls back to the envelope message when validation named no field at all", () => {
    const failure = submitFailureFrom(apiError({ code: "VALIDATION_FAILED" }), FIELDS);

    expect(failure.formError).toBe("Something the server said");
  });

  it("points a rejected sign-in at Google without revealing which half was wrong", () => {
    const failure = submitFailureFrom(
      apiError({
        code: "INVALID_CREDENTIALS",
        message: "Email or password is incorrect.",
        status: 401,
      }),
      FIELDS,
    );

    expect(failure.fields).toEqual({});
    expect(failure.formError).toBe(
      "Email or password is incorrect. If you signed up with Google, continue with Google instead.",
    );
  });

  it("shows a taken address on the email input, where the user can change it", () => {
    const failure = submitFailureFrom(
      apiError({
        code: "EMAIL_ALREADY_REGISTERED",
        message: "That email is already registered.",
        status: 409,
      }),
      FIELDS,
    );

    expect(failure.fields).toEqual({ email: "That email is already registered." });
    expect(failure.formError).toBeNull();
  });

  it("explains throttling instead of repeating the server's wording", () => {
    const failure = submitFailureFrom(apiError({ code: "RATE_LIMITED", status: 429 }), FIELDS);

    expect(failure.formError).toBe("Too many attempts. Wait a moment and try again.");
  });

  it("says the server was unreachable when the request never arrived", () => {
    const failure = submitFailureFrom(new NetworkError(), FIELDS);

    expect(failure.fields).toEqual({});
    expect(failure.formError).toMatch(/could not reach the server/i);
  });

  it("never leaks an unrecognised throw to the user", () => {
    const failure = submitFailureFrom(new Error("TypeError: undefined is not a function"), FIELDS);

    expect(failure.formError).toBe("Something went wrong. Please try again.");
  });
});

describe("safeRedirectPath", () => {
  it("honours a path on this origin", () => {
    expect(safeRedirectPath("/rooms/abc/folders/def")).toBe("/rooms/abc/folders/def");
  });

  it.each([
    ["https://evil.example/steal", "an absolute URL"],
    ["//evil.example/steal", "a protocol-relative URL"],
    ["/\\evil.example/steal", "a backslash-escaped host"],
    ["javascript:alert(1)", "a script URL"],
    ["rooms/abc", "a relative path with no leading slash"],
    [null, "a missing parameter"],
  ])("refuses %s (%s) and falls back", (value, _description) => {
    expect(safeRedirectPath(value)).toBe("/");
  });

  it("uses the caller's fallback when one is given", () => {
    expect(safeRedirectPath("https://evil.example", "/rooms")).toBe("/rooms");
  });
});

describe("authScreenHref", () => {
  it("carries the destination between the two auth screens", () => {
    expect(authScreenHref("/sign-up", "/rooms/abc")).toBe("/sign-up?next=%2Frooms%2Fabc");
  });

  it("leaves the link clean when there is nothing to preserve", () => {
    expect(authScreenHref("/sign-up", "/")).toBe("/sign-up");
  });
});

describe("destinationFrom", () => {
  it("omits the question mark when there is no query", () => {
    expect(destinationFrom("/rooms/r1", "")).toBe("/rooms/r1");
  });

  it("preserves a query so a filtered view survives sign-in", () => {
    expect(safeRedirectPath(destinationFrom("/rooms/r1", "view=list"))).toBe("/rooms/r1?view=list");
  });
});

describe("safeRedirectPath loop guard", () => {
  it.each(["/sign-in", "/sign-up", "/sign-in?next=%2F"])(
    "refuses %s, which would send the user straight back",
    (value) => {
      expect(safeRedirectPath(value)).toBe("/");
    },
  );
});

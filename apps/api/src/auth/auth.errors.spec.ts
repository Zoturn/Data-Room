import { DomainError } from "../common/errors/domain-error";
import {
  InvalidRefreshTokenError,
  RefreshTokenAlreadyRotatedError,
  UnauthenticatedError,
} from "./auth.errors";

describe("auth errors", () => {
  it.each([new UnauthenticatedError(), new InvalidRefreshTokenError()])(
    "%s maps to 401 UNAUTHENTICATED",
    (error) => {
      // The exception filter reads `code` and `status` off DomainError. An auth failure that
      // carried anything else would reach the client as a 500, which both leaks that
      // something unexpected happened and loses the signal the client branches on.
      expect(error).toBeInstanceOf(DomainError);
      expect(error.status).toBe(401);
      expect(error.code).toBe("UNAUTHENTICATED");
    },
  );

  it("treats an invalid refresh token as a kind of unauthenticated, not a separate outcome", () => {
    // Catching UnauthenticatedError must catch both, or a caller handling "not signed in"
    // would miss the refresh path.
    expect(new InvalidRefreshTokenError()).toBeInstanceOf(UnauthenticatedError);
  });

  it("words the refresh failure for someone who believed they had a session", () => {
    expect(new UnauthenticatedError().message).toMatch(/sign in/i);
    expect(new InvalidRefreshTokenError().message).toMatch(/expired/i);
  });

  it("keeps the rotation signal internal, off the DomainError channel", () => {
    // This one must never reach a client: it distinguishes a replayed token from an absent
    // one, which is exactly the distinction an attacker would like to probe for.
    const internal = new RefreshTokenAlreadyRotatedError();

    expect(internal).toBeInstanceOf(Error);
    expect(internal).not.toBeInstanceOf(DomainError);
  });
});

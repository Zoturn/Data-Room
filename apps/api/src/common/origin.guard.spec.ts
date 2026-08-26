import type { ExecutionContext } from "@nestjs/common";
import { ConfigService } from "../config/config.service";
import { CrossSiteRequestError, OriginGuard } from "./origin.guard";

const ALLOWED = "https://app.test";

function guard(): OriginGuard {
  return new OriginGuard(
    new ConfigService({
      DATABASE_URL: "postgresql://user:pass@localhost:6543/db",
      DIRECT_URL: "postgresql://user:pass@localhost:5432/db",
      WEB_APP_URL: ALLOWED,
      CORS_ORIGINS: ALLOWED,
      JWT_ACCESS_SECRET: "a-test-secret-of-at-least-thirty-two-chars",
    }),
  );
}

function contextFor(method: string, origin?: string): ExecutionContext {
  const headers: Record<string, string> = {};
  if (origin !== undefined) headers["origin"] = origin;

  return {
    switchToHttp: () => ({ getRequest: () => ({ method, headers }) }),
  } as unknown as ExecutionContext;
}

describe("OriginGuard", () => {
  it("allows a state-changing request from the configured origin", () => {
    expect(guard().canActivate(contextFor("POST", ALLOWED))).toBe(true);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("rejects %s from a foreign origin", (method) => {
    // The attack this exists for: a form post from any page is a CORS-simple request, so
    // no preflight happens and CORS never refuses it — the handler runs and Set-Cookie
    // takes effect. On login that signs the victim into the attacker's account.
    expect(() => guard().canActivate(contextFor(method, "https://evil.test"))).toThrow(
      CrossSiteRequestError,
    );
  });

  it("answers 401 rather than 403, disclosing nothing about the route", () => {
    try {
      guard().canActivate(contextFor("POST", "https://evil.test"));
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(CrossSiteRequestError);
      if (error instanceof CrossSiteRequestError) {
        expect(error.status).toBe(401);
      }
    }
  });

  it("leaves reads alone, since a GET changes nothing worth forging", () => {
    expect(guard().canActivate(contextFor("GET", "https://evil.test"))).toBe(true);
  });

  it("allows a request with no Origin at all", () => {
    // curl, the Cypress API specs and platform health probes send none — and a non-browser
    // caller has no ambient cookies to abuse, which is the whole basis of this attack.
    expect(guard().canActivate(contextFor("POST"))).toBe(true);
  });

  it("matches the origin exactly, not by prefix", () => {
    // https://app.test.evil.test starts with the allowed value; a prefix check would pass it.
    expect(() => guard().canActivate(contextFor("POST", `${ALLOWED}.evil.test`))).toThrow(
      CrossSiteRequestError,
    );
  });
});

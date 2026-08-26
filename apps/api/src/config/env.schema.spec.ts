import { parseEnv } from "./env.schema";

const valid = {
  DATABASE_URL: "postgresql://user:pass@localhost:6543/db",
  DIRECT_URL: "postgresql://user:pass@localhost:5432/db",
  WEB_APP_URL: "http://localhost:3000",
  CORS_ORIGINS: "http://localhost:3000",
};

describe("parseEnv", () => {
  it("accepts a complete environment and applies defaults", () => {
    const env = parseEnv(valid);

    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(3001);
    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
  });

  it.each(["DATABASE_URL", "DIRECT_URL", "WEB_APP_URL", "CORS_ORIGINS"])(
    "refuses to start without %s, and names it",
    (missing) => {
      const incomplete = { ...valid };
      delete incomplete[missing as keyof typeof incomplete];

      // Failing at boot is the point: a deploy missing a variable must not look healthy
      // until the first request touches it.
      expect(() => parseEnv(incomplete)).toThrow(new RegExp(missing));
    },
  );

  it("refuses a malformed URL rather than failing later at connection time", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "not-a-url" })).toThrow(/DATABASE_URL/);
  });

  it("splits and trims the CORS allowlist", () => {
    const env = parseEnv({ ...valid, CORS_ORIGINS: "http://a.test , http://b.test" });

    expect(env.CORS_ORIGINS).toEqual(["http://a.test", "http://b.test"]);
  });

  it("strips trailing slashes from allowed origins", () => {
    // A browser's Origin header never carries a trailing slash, so a configured
    // "https://app.test/" would match nothing and the preflight would fail silently.
    const env = parseEnv({
      ...valid,
      CORS_ORIGINS: "https://app.test/, https://other.test//",
    });

    expect(env.CORS_ORIGINS).toEqual(["https://app.test", "https://other.test"]);
  });

  it("strips a trailing slash from the web app URL", () => {
    expect(parseEnv({ ...valid, WEB_APP_URL: "https://app.test/" }).WEB_APP_URL).toBe(
      "https://app.test",
    );
  });

  it("coerces PORT from its string form", () => {
    expect(parseEnv({ ...valid, PORT: "8080" }).PORT).toBe(8080);
  });

  describe("cookie policy", () => {
    it("defaults to the local pair: not Secure, SameSite=Lax", () => {
      // localhost:3000 and localhost:3001 differ only by port, which is not part of a
      // site — so Lax cookies are sent, and no HTTPS certificate is needed to develop.
      const env = parseEnv(valid);

      expect(env.COOKIE_SECURE).toBe(false);
      expect(env.COOKIE_SAMESITE).toBe("lax");
    });

    it("accepts the cross-site production pair", () => {
      const env = parseEnv({ ...valid, COOKIE_SECURE: "true", COOKIE_SAMESITE: "none" });

      expect(env.COOKIE_SECURE).toBe(true);
      expect(env.COOKIE_SAMESITE).toBe("none");
    });

    it("refuses a SameSite value browsers do not accept", () => {
      expect(() => parseEnv({ ...valid, COOKIE_SAMESITE: "sometimes" })).toThrow(/COOKIE_SAMESITE/);
    });
  });
});

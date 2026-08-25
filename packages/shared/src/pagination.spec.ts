import { describe, expect, it } from "@jest/globals";
import { z } from "zod";
import { PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX, pageQuerySchema, pageSchema } from "./pagination.js";

describe("pageQuerySchema", () => {
  it("defaults the limit when none is given", () => {
    const result = pageQuerySchema.parse({});
    expect(result.limit).toBe(PAGE_LIMIT_DEFAULT);
    expect(result.cursor).toBeUndefined();
  });

  it("coerces a query-string limit, since query params arrive as text", () => {
    expect(pageQuerySchema.parse({ limit: "25" }).limit).toBe(25);
  });

  it("refuses a limit beyond the maximum", () => {
    // The spec caps the page; asking for 10000 must not return 10000 rows.
    expect(pageQuerySchema.safeParse({ limit: 10_000 }).success).toBe(false);
    expect(pageQuerySchema.parse({ limit: PAGE_LIMIT_MAX }).limit).toBe(PAGE_LIMIT_MAX);
  });

  it.each([0, -1, 1.5])("refuses a limit of %p", (limit) => {
    expect(pageQuerySchema.safeParse({ limit }).success).toBe(false);
  });

  it("passes an opaque cursor through untouched", () => {
    const cursor = "eyJ0IjoiRk9MREVSIn0";
    expect(pageQuerySchema.parse({ cursor }).cursor).toBe(cursor);
  });
});

describe("pageSchema", () => {
  const page = pageSchema(z.object({ id: z.string() }));

  it("accepts a page with a following cursor", () => {
    expect(page.safeParse({ items: [{ id: "a" }], nextCursor: "abc" }).success).toBe(true);
  });

  it("accepts a last page, where nextCursor is null", () => {
    expect(page.safeParse({ items: [], nextCursor: null }).success).toBe(true);
  });

  it("requires nextCursor to be present, so the last page is explicit", () => {
    expect(page.safeParse({ items: [] }).success).toBe(false);
  });

  it("validates the items against the given schema", () => {
    expect(page.safeParse({ items: [{ id: 1 }], nextCursor: null }).success).toBe(false);
  });
});

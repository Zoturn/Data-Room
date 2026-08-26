import { z } from "zod";
import { decodeCursor, encodeCursor } from "./cursor";
import { toPage } from "./paginate";
import { ValidationFailedError } from "../errors/domain-error";

const schema = z.object({ name: z.string(), id: z.string() });

describe("cursors", () => {
  it("round-trips a payload", () => {
    const cursor = encodeCursor({ name: "Reports", id: "abc" });

    expect(decodeCursor(cursor, schema)).toEqual({ name: "Reports", id: "abc" });
  });

  it("produces a URL-safe string, since a cursor travels in a query parameter", () => {
    const cursor = encodeCursor({ name: "a/b+c=d", id: "x" });

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor, schema)).toEqual({ name: "a/b+c=d", id: "x" });
  });

  it.each([
    ["not base64 at all", "!!!!"],
    ["base64 of nonsense", Buffer.from("nonsense").toString("base64url")],
    ["base64 of an array", Buffer.from("[1,2]").toString("base64url")],
    ["a payload of the wrong shape", encodeCursor({ unexpected: "field" })],
  ])("rejects %s as a client error, not a server fault", (_label, cursor) => {
    // A cursor arrives in a URL, so it is attacker-controlled. A tampered one must be a
    // 400 naming the parameter, never a 500.
    expect(() => decodeCursor(cursor, schema)).toThrow(ValidationFailedError);

    try {
      decodeCursor(cursor, schema);
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationFailedError);
      if (error instanceof ValidationFailedError) {
        expect(error.status).toBe(400);
        expect(error.details?.[0]?.field).toBe("cursor");
      }
    }
  });
});

describe("toPage", () => {
  const rows = [
    { id: "1", name: "a" },
    { id: "2", name: "b" },
    { id: "3", name: "c" },
  ];

  it("returns a cursor when the over-fetched row proves more exist", () => {
    // Callers query limit + 1; the extra row is what proves another page exists, so no
    // COUNT(*) is needed to decide whether to keep going.
    const page = toPage(
      rows,
      2,
      (row) => row.id,
      (row) => encodeCursor({ id: row.id }),
    );

    expect(page.items).toEqual(["1", "2"]);
    expect(page.nextCursor).not.toBeNull();
  });

  it("ends with a null cursor on the last page", () => {
    const page = toPage(
      rows.slice(0, 2),
      2,
      (row) => row.id,
      (row) => row.id,
    );

    expect(page.items).toEqual(["1", "2"]);
    expect(page.nextCursor).toBeNull();
  });

  it("handles an empty result", () => {
    const page = toPage(
      [],
      10,
      (row: { id: string }) => row.id,
      (row) => row.id,
    );

    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});

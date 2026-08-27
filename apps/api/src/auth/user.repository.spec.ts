import { Test } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { EmailAlreadyRegisteredError } from "./auth.errors";
import { UserRepository, type UserRecord } from "./user.repository";

/**
 * What this spec is for: the *translation* layer. A Prisma error code must never escape the
 * repository (errors-and-validation.md rule 8), and the reads must not quietly widen the set
 * of columns they return — a `passwordHash` that leaks does so one careless `select` at a
 * time.
 *
 * What it deliberately does not do: assert that the queries themselves are correct. Mocking
 * Prisma to test a query tests the mock (testing.md anti-patterns), so the real round trips —
 * that the unique index exists, that two concurrent registrations resolve to one account —
 * are covered by the Cypress API suite against a real Postgres.
 */
type UserRow = UserRecord;

type PrismaUserStub = {
  findUnique: jest.Mock<Promise<UserRow | null>, [unknown]>;
  create: jest.Mock<Promise<UserRow>, [unknown]>;
  update: jest.Mock<Promise<UserRow>, [unknown]>;
};

const CLIENT_VERSION = "test";

const OWNER: UserRow = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "owner@acme.com",
  displayName: "Owner",
  passwordHash: "$argon2id$v=19$m=19456,p=1,t=2$c2FsdA$aGFzaA",
};

/** Every column the repository is allowed to read, and nothing else. */
const EXPECTED_SELECT = {
  id: true,
  email: true,
  displayName: true,
  passwordHash: true,
};

function uniqueViolation(target?: string | string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: CLIENT_VERSION,
    ...(target === undefined ? {} : { meta: { target } }),
  });
}

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Database said no", {
    code,
    clientVersion: CLIENT_VERSION,
  });
}

function buildStub(): PrismaUserStub {
  return {
    findUnique: jest.fn<Promise<UserRow | null>, [unknown]>().mockResolvedValue(null),
    create: jest.fn<Promise<UserRow>, [unknown]>().mockResolvedValue(OWNER),
    update: jest.fn<Promise<UserRow>, [unknown]>().mockResolvedValue(OWNER),
  };
}

async function buildRepository(user: PrismaUserStub): Promise<UserRepository> {
  const moduleRef = await Test.createTestingModule({
    providers: [UserRepository, { provide: PrismaService, useValue: { user } }],
  }).compile();

  return moduleRef.get(UserRepository);
}

describe("UserRepository", () => {
  let prismaUser: PrismaUserStub;
  let users: UserRepository;

  beforeEach(async () => {
    prismaUser = buildStub();
    users = await buildRepository(prismaUser);
  });

  describe("reads", () => {
    it("looks a user up by id, selecting only the documented columns", async () => {
      prismaUser.findUnique.mockResolvedValue(OWNER);

      await expect(users.findById(OWNER.id)).resolves.toEqual(OWNER);
      expect(prismaUser.findUnique).toHaveBeenCalledWith({
        where: { id: OWNER.id },
        select: EXPECTED_SELECT,
      });
    });

    it("looks a user up by the already-normalised email", async () => {
      await users.findByEmail("owner@acme.com");

      expect(prismaUser.findUnique).toHaveBeenCalledWith({
        where: { email: "owner@acme.com" },
        select: EXPECTED_SELECT,
      });
    });


    it("returns null for an address nobody registered", async () => {
      await expect(users.findByEmail("nobody@acme.com")).resolves.toBeNull();
    });

    it("never selects a column outside the documented set", () => {
      // A regression guard with teeth: if someone adds `createdAt` to the select because a
      // caller wanted it, they have to come here and think about what else rides along.
      expect(Object.keys(EXPECTED_SELECT).sort()).toEqual([
        "displayName",
        "email",
        "id",
        "passwordHash",
      ]);
    });
  });

  describe("createWithPassword", () => {
    it("inserts without reading first, so two concurrent registrations cannot both pass", async () => {
      await users.createWithPassword({
        email: "new@acme.com",
        passwordHash: "digest",
        displayName: "New",
      });

      // The unique index decides, not a check-then-insert that both racers survive.
      expect(prismaUser.findUnique).not.toHaveBeenCalled();
      expect(prismaUser.create).toHaveBeenCalledWith({
        data: { email: "new@acme.com", passwordHash: "digest", displayName: "New" },
        select: EXPECTED_SELECT,
      });
    });

    it("maps the P2002 unique violation to a 409 EMAIL_ALREADY_REGISTERED", async () => {
      prismaUser.create.mockRejectedValue(uniqueViolation(["email"]));

      await expect(
        users.createWithPassword({ email: OWNER.email, passwordHash: "d", displayName: "O" }),
      ).rejects.toMatchObject({
        code: "EMAIL_ALREADY_REGISTERED",
        status: 409,
      });
    });

    it("maps a P2002 reported as a constraint name rather than a field name", async () => {
      // Prisma has reported both shapes across versions; the mapping must not depend on it.
      prismaUser.create.mockRejectedValue(uniqueViolation("users_email_key"));

      await expect(
        users.createWithPassword({ email: OWNER.email, passwordHash: "d", displayName: "O" }),
      ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
    });

    it("maps a P2002 that carries no target information at all", async () => {
      prismaUser.create.mockRejectedValue(uniqueViolation());

      await expect(
        users.createWithPassword({ email: OWNER.email, passwordHash: "d", displayName: "O" }),
      ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
    });

    it("never puts the password digest in the error it raises", async () => {
      prismaUser.create.mockRejectedValue(uniqueViolation(["email"]));

      await expect(
        users.createWithPassword({
          email: OWNER.email,
          passwordHash: "$argon2id$secret",
          displayName: "O",
        }),
      ).rejects.toThrow(/^An account with that email address already exists\.$/);
    });

    it("rethrows a Prisma error that is not a unique violation", async () => {
      // Swallowing this would turn a broken foreign key into "email taken", which is a lie
      // the client cannot recover from.
      const foreignKeyViolation = prismaError("P2003");
      prismaUser.create.mockRejectedValue(foreignKeyViolation);

      await expect(
        users.createWithPassword({ email: "new@acme.com", passwordHash: "d", displayName: "N" }),
      ).rejects.toBe(foreignKeyViolation);
    });

    it("rethrows something that is not a Prisma error", async () => {
      const outage = new Error("connection reset");
      prismaUser.create.mockRejectedValue(outage);

      await expect(
        users.createWithPassword({ email: "new@acme.com", passwordHash: "d", displayName: "N" }),
      ).rejects.toBe(outage);
    });
  });
});

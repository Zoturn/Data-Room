import { Test } from "@nestjs/testing";
import { sessionUserSchema, type LoginInput } from "@data-room/shared";
import { AuthService } from "./auth.service";
import {
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  UnauthenticatedError,
} from "./auth.errors";
import { PendingGrantBinder } from "../sharing/shares.service";
import { PasswordService } from "./password.service";
import { TokenService, type IssuedSession } from "./token.service";
import {
  UserRepository,
  type NewPasswordUser,
  type UserRecord,
} from "./user.repository";

/**
 * Covers auth-and-guards.md rules 3 (one normalised email everywhere), 4 (the uniform 401)
 *
 * Everything below the service is substituted: Argon2id is deliberately slow, and the point
 * of these tests is the decisions the service makes, not the cryptography — which
 * `password.service.spec.ts` and `token.service.spec.ts` own.
 */
type UserRepositoryStub = {
  findById: jest.Mock<Promise<UserRecord | null>, [string]>;
  findByEmail: jest.Mock<Promise<UserRecord | null>, [string]>;
  createWithPassword: jest.Mock<Promise<UserRecord>, [NewPasswordUser]>;
};

type PasswordServiceStub = {
  hash: jest.Mock<Promise<string>, [string]>;
  verify: jest.Mock<Promise<boolean>, [string, string]>;
};

type TokenServiceStub = {
  issue: jest.Mock<Promise<IssuedSession>, [string]>;
};

const PASSWORD = "correct horse battery staple";
const REAL_DIGEST = "$argon2id$v=19$m=19456,p=1,t=2$c2FsdA$b3duZXI";

const OWNER: UserRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "owner@acme.com",
  displayName: "Owner",
  passwordHash: REAL_DIGEST,
};

/** An account whose password digest is null — the state the nullable column allows. */
const NO_PASSWORD: UserRecord = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "no-password@acme.com",
  displayName: "No Password",
  passwordHash: null,
};

const SESSION: IssuedSession = {
  userId: OWNER.id,
  familyId: "33333333-3333-4333-8333-333333333333",
  accessToken: "header.payload.signature",
  accessTokenExpiresAt: new Date("2026-01-01T00:15:00.000Z"),
  refreshToken: "opaque-refresh-token",
  refreshTokenExpiresAt: new Date("2026-01-31T00:00:00.000Z"),
};

function buildUsers(): UserRepositoryStub {
  return {
    findById: jest.fn<Promise<UserRecord | null>, [string]>().mockResolvedValue(null),
    findByEmail: jest.fn<Promise<UserRecord | null>, [string]>().mockResolvedValue(null),
    createWithPassword: jest.fn<Promise<UserRecord>, [NewPasswordUser]>().mockResolvedValue(OWNER),
  };
}

function buildPasswords(): PasswordServiceStub {
  return {
    // Deterministic and traceable: a digest names the plaintext that produced it, so a test
    // can prove which value reached the verifier.
    hash: jest.fn<Promise<string>, [string]>((plain) => Promise.resolve(`hashed:${plain}`)),
    verify: jest.fn<Promise<boolean>, [string, string]>().mockResolvedValue(false),
  };
}

function buildTokens(): TokenServiceStub {
  return { issue: jest.fn<Promise<IssuedSession>, [string]>().mockResolvedValue(SESSION) };
}

async function buildService(
  users: UserRepositoryStub,
  passwords: PasswordServiceStub,
  tokens: TokenServiceStub,
): Promise<AuthService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      // Binding a pending invitation to a new account is the sharing module's behaviour and is
      // tested there; here it must only not prevent an account from being created.
      {
        provide: PendingGrantBinder,
        useValue: { bindPendingGrants: (): Promise<number> => Promise.resolve(0) },
      },
      AuthService,
      { provide: UserRepository, useValue: users },
      { provide: PasswordService, useValue: passwords },
      { provide: TokenService, useValue: tokens },
    ],
  }).compile();

  return moduleRef.get(AuthService);
}

/** The failure, described in the terms a client would actually observe. */
function describeFailure(error: unknown): {
  constructor: string;
  code: string;
  status: number;
  message: string;
} {
  if (!(error instanceof InvalidCredentialsError)) {
    throw new Error(`Expected InvalidCredentialsError, received ${String(error)}`);
  }

  return {
    constructor: error.name,
    code: error.code,
    status: error.status,
    message: error.message,
  };
}

async function captureLoginFailure(auth: AuthService, input: LoginInput): Promise<unknown> {
  try {
    await auth.login(input);
  } catch (error) {
    return error;
  }

  throw new Error("login was expected to fail and did not");
}

function verifyArguments(passwords: PasswordServiceStub, index = 0): [string, string] {
  const call = passwords.verify.mock.calls[index];
  if (call === undefined) throw new Error(`verify was not called ${index + 1} time(s)`);
  return call;
}

describe("AuthService", () => {
  let users: UserRepositoryStub;
  let passwords: PasswordServiceStub;
  let tokens: TokenServiceStub;
  let auth: AuthService;

  beforeEach(async () => {
    users = buildUsers();
    passwords = buildPasswords();
    tokens = buildTokens();
    auth = await buildService(users, passwords, tokens);
  });

  describe("register", () => {
    it("normalises the email before it is stored", async () => {
      // Rule 3: one definition of "the same address", or a later share grant resolves to a
      // different person.
      await auth.register({ email: "  Owner@ACME.com  ", password: PASSWORD });

      expect(users.createWithPassword).toHaveBeenCalledWith(
        expect.objectContaining({ email: "owner@acme.com" }),
      );
    });

    it("stores an Argon2id digest and never the plaintext", async () => {
      await auth.register({ email: "owner@acme.com", password: PASSWORD });

      const [input] = users.createWithPassword.mock.calls[0] ?? [];
      expect(input).toBeDefined();
      expect(passwords.hash).toHaveBeenCalledWith(PASSWORD);
      expect(input?.passwordHash).toBe(`hashed:${PASSWORD}`);
      // The stored value is whatever the hasher returned, never the plaintext, and the
      // plaintext is not carried alongside it under some other name. (A substring search
      // would prove nothing here: the fake digest echoes its input on purpose so a test can
      // trace which value reached the hasher.)
      expect(input?.passwordHash).not.toBe(PASSWORD);
      expect(input).not.toHaveProperty("password");
    });

    it("inserts straight away rather than checking whether the address is taken", async () => {
      // A `findByEmail` first would be passed by both of two concurrent registrations; the
      // unique index is the only thing that actually decides.
      await auth.register({ email: "owner@acme.com", password: PASSWORD });

      expect(users.findByEmail).not.toHaveBeenCalled();
    });

    it("keeps the display name the user chose", async () => {
      await auth.register({
        email: "owner@acme.com",
        password: PASSWORD,
        displayName: "Ada Lovelace",
      });

      expect(users.createWithPassword).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: "Ada Lovelace" }),
      );
    });

    it("falls back to the local part of the address when no name was given", async () => {
      await auth.register({ email: "Ada.Lovelace@acme.com", password: PASSWORD });

      expect(users.createWithPassword).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: "ada.lovelace" }),
      );
    });

    it("signs the new user in and returns a session user carrying no secrets", async () => {
      const result = await auth.register({ email: "owner@acme.com", password: PASSWORD });

      expect(tokens.issue).toHaveBeenCalledWith(OWNER.id);
      expect(result.session).toBe(SESSION);
      expect(result.user).toEqual({
        id: OWNER.id,
        email: OWNER.email,
        displayName: OWNER.displayName,
        hasPassword: true,
      });
    });

    it("surfaces the repository's 409 for an address that is already registered", async () => {
      users.createWithPassword.mockRejectedValue(new EmailAlreadyRegisteredError());

      await expect(
        auth.register({ email: "owner@acme.com", password: PASSWORD }),
      ).rejects.toMatchObject({ code: "EMAIL_ALREADY_REGISTERED", status: 409 });
      expect(tokens.issue).not.toHaveBeenCalled();
    });
  });

  describe("login", () => {
    describe("the uniform 401", () => {
      it("rejects an address nobody registered", async () => {
        users.findByEmail.mockResolvedValue(null);

        const error = await captureLoginFailure(auth, {
          email: "nobody@acme.com",
          password: PASSWORD,
        });

        expect(error).toBeInstanceOf(InvalidCredentialsError);
      });

      it("rejects the wrong password", async () => {
        users.findByEmail.mockResolvedValue(OWNER);
        passwords.verify.mockResolvedValue(false);

        const error = await captureLoginFailure(auth, {
          email: OWNER.email,
          password: "not the password",
        });

        expect(error).toBeInstanceOf(InvalidCredentialsError);
      });

      it("rejects a login against an account that has no password digest", async () => {
        users.findByEmail.mockResolvedValue(NO_PASSWORD);

        const error = await captureLoginFailure(auth, {
          email: NO_PASSWORD.email,
          password: PASSWORD,
        });

        expect(error).toBeInstanceOf(InvalidCredentialsError);
      });

      it("rejects it even if the verifier reports a match", async () => {
        // Defence in depth. A null digest can never verify, but the decision must not rest
        // on that: an account with no password credential cannot be entered with one.
        users.findByEmail.mockResolvedValue(NO_PASSWORD);
        passwords.verify.mockResolvedValue(true);

        await expect(
          auth.login({ email: NO_PASSWORD.email, password: PASSWORD }),
        ).rejects.toBeInstanceOf(InvalidCredentialsError);
        expect(tokens.issue).not.toHaveBeenCalled();
      });

      it("gives every failure the same class, code, status and message", async () => {
        users.findByEmail.mockResolvedValue(null);
        const unknownAddress = await captureLoginFailure(auth, {
          email: "nobody@acme.com",
          password: PASSWORD,
        });

        users.findByEmail.mockResolvedValue(OWNER);
        passwords.verify.mockResolvedValue(false);
        const wrongPassword = await captureLoginFailure(auth, {
          email: OWNER.email,
          password: "wrong",
        });

        users.findByEmail.mockResolvedValue(NO_PASSWORD);
        const noDigest = await captureLoginFailure(auth, {
          email: NO_PASSWORD.email,
          password: PASSWORD,
        });

        // Any difference here — even a stray word — is a user-enumeration oracle.
        expect(describeFailure(wrongPassword)).toEqual(describeFailure(unknownAddress));
        expect(describeFailure(noDigest)).toEqual(describeFailure(unknownAddress));
      });

      it("never names the address or hints that an account exists", async () => {
        users.findByEmail.mockResolvedValue(null);

        const error = await captureLoginFailure(auth, {
          email: "nobody@acme.com",
          password: PASSWORD,
        });

        const { message } = describeFailure(error);
        expect(message).not.toContain("nobody@acme.com");
        expect(message.toLowerCase()).not.toMatch(/no account|not found|unknown|unregistered/);
      });
    });

    describe("timing", () => {
      // Wall-clock assertions are flaky on shared CI, so these test the mechanism instead:
      // that the expensive comparison happens on every path, with a digest of real shape.
      it("still verifies a password when the address is unknown", async () => {
        users.findByEmail.mockResolvedValue(null);

        await captureLoginFailure(auth, { email: "nobody@acme.com", password: PASSWORD });

        expect(passwords.verify).toHaveBeenCalledTimes(1);
      });

      it("verifies against a decoy digest, not against the submitted password", async () => {
        users.findByEmail.mockResolvedValue(null);

        await captureLoginFailure(auth, { email: "nobody@acme.com", password: PASSWORD });

        const [digest, plain] = verifyArguments(passwords);
        expect(plain).toBe(PASSWORD);
        // Produced by the same hasher, so it costs the same to verify — and unrelated to the
        // caller's input, so the work cannot be short-circuited by a chosen password.
        expect(digest).toMatch(/^hashed:/);
        expect(digest).not.toContain(PASSWORD);
        expect(digest.length).toBeGreaterThan(0);
      });

      it("still pays for a verify against an account with no digest", async () => {
        users.findByEmail.mockResolvedValue(NO_PASSWORD);

        await captureLoginFailure(auth, { email: NO_PASSWORD.email, password: PASSWORD });

        const [digest] = verifyArguments(passwords);
        expect(passwords.verify).toHaveBeenCalledTimes(1);
        expect(digest).not.toBe(NO_PASSWORD.passwordHash);
      });

      it("verifies against the stored digest when the account does have a password", async () => {
        users.findByEmail.mockResolvedValue(OWNER);
        passwords.verify.mockResolvedValue(true);

        await auth.login({ email: OWNER.email, password: PASSWORD });

        expect(verifyArguments(passwords)).toEqual([REAL_DIGEST, PASSWORD]);
      });

      it("computes the decoy once and reuses it across logins", async () => {
        users.findByEmail.mockResolvedValue(null);

        await captureLoginFailure(auth, { email: "one@acme.com", password: PASSWORD });
        await captureLoginFailure(auth, { email: "two@acme.com", password: PASSWORD });

        expect(passwords.hash).toHaveBeenCalledTimes(1);
        expect(verifyArguments(passwords, 0)[0]).toBe(verifyArguments(passwords, 1)[0]);
      });

      it("warms the decoy at boot so the first failed login is not the slow one", async () => {
        await auth.onModuleInit();
        expect(passwords.hash).toHaveBeenCalledTimes(1);

        users.findByEmail.mockResolvedValue(null);
        await captureLoginFailure(auth, { email: "nobody@acme.com", password: PASSWORD });

        expect(passwords.hash).toHaveBeenCalledTimes(1);
      });
    });

    it("normalises the address before looking it up", async () => {
      users.findByEmail.mockResolvedValue(OWNER);
      passwords.verify.mockResolvedValue(true);

      await auth.login({ email: "  Owner@ACME.com  ", password: PASSWORD });

      expect(users.findByEmail).toHaveBeenCalledWith("owner@acme.com");
    });

    it("issues a session when the password matches", async () => {
      users.findByEmail.mockResolvedValue(OWNER);
      passwords.verify.mockResolvedValue(true);

      const result = await auth.login({ email: OWNER.email, password: PASSWORD });

      expect(tokens.issue).toHaveBeenCalledWith(OWNER.id);
      expect(result.session).toBe(SESSION);
      expect(result.user.id).toBe(OWNER.id);
    });
  });

  describe("toSessionUser", () => {
    it("produces a value that parses against the shared schema", () => {
      const parsed = sessionUserSchema.safeParse(auth.toSessionUser(OWNER));

      expect(parsed.success).toBe(true);
    });

    it("carries the four session fields and nothing else", () => {
      const sessionUser = auth.toSessionUser(OWNER);

      expect(Object.keys(sessionUser).sort()).toEqual([
        "displayName",
        "email",
        "hasPassword",
        "id",
      ]);
    });

    it("never exposes the password digest", () => {
      const serialised = JSON.stringify(auth.toSessionUser(OWNER));

      expect(serialised).not.toContain(REAL_DIGEST);
      expect(serialised).not.toContain("passwordHash");
    });

    it("reports that a credential exists, never the credential itself", () => {
      expect(auth.toSessionUser(OWNER)).toMatchObject({ hasPassword: true });
      expect(auth.toSessionUser(NO_PASSWORD)).toMatchObject({ hasPassword: false });
    });
  });

  describe("getSessionUser", () => {
    it("returns the caller behind a valid token", async () => {
      users.findById.mockResolvedValue(OWNER);

      await expect(auth.getSessionUser(OWNER.id)).resolves.toMatchObject({ id: OWNER.id });
    });

    it("treats a token whose subject no longer exists as no session at all", async () => {
      // A deleted account, or a token minted against a database that has been reset. 404
      // would be a statement about a resource; this is a statement about the caller.
      users.findById.mockResolvedValue(null);

      await expect(auth.getSessionUser(OWNER.id)).rejects.toBeInstanceOf(UnauthenticatedError);
    });
  });
});

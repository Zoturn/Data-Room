import { Injectable } from "@nestjs/common";
import { normalizeEmail, type CreateShareInput, type Page, type Share } from "@data-room/shared";
import type { AuthUser } from "../auth/jwt-auth.guard";
import { NotFoundError, ValidationFailedError } from "../common/errors/domain-error";
import { ConfigService } from "../config/config.service";
import { generateShareToken, hashShareToken, shareUrlFor } from "./share-token";

/** Narrowed from the contract rather than re-declared, so the two cannot drift apart. */
type ShareMode = Share["mode"];
type ShareRole = Share["role"];
type ShareGrant = Share["grants"][number];

/**
 * One recipient of a restricted share.
 *
 * `userId` is null until the person behind the address signs in — a grant is written against
 * an email precisely so that it can be made before its recipient has an account. `acceptedAt`
 * records when that binding happened, which is the only "has this person turned up yet?"
 * signal an owner gets without a mail delivery pipeline.
 */
export type ShareGrantRecord = {
  id: string;
  shareId: string;
  email: string;
  userId: string | null;
  acceptedAt: Date | null;
};

/**
 * A share as the store hands one out. Deliberately carries no token: the plaintext exists only
 * inside `createShare`, and the hash never leaves the store, so there is no field here for a
 * later refactor to serialise into a response by accident.
 *
 * `nodeName` is denormalised onto the record because every list rendering needs it and the
 * alternative is a second round trip per row.
 */
export type ShareRecord = {
  id: string;
  nodeId: string;
  nodeName: string;
  createdBy: string;
  mode: ShareMode;
  role: ShareRole;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  grants: ShareGrantRecord[];
};

/** What `createShare` writes. The caller has already hashed the token. */
export type NewShare = {
  nodeId: string;
  createdBy: string;
  mode: ShareMode;
  tokenHash: string;
  expiresAt: Date | null;
  emails: string[];
};

/**
 * Everything this service needs from the database, as an abstract class so it doubles as an
 * injection token and a unit test can substitute an in-memory double.
 *
 * Every method that names a caller takes an `ownerId` and is expected to apply it as a `where`
 * clause, never as a check after the read. That is what makes an unauthorised request
 * indistinguishable from a request for something that does not exist: both return `null`, and
 * both become the same 404 above.
 */
export abstract class ShareStore {
  /** The node, only if this caller owns the Data Room holding it. */
  abstract findOwnedNode(nodeId: string, ownerId: string): Promise<{ id: string } | null>;
  abstract createShare(share: NewShare): Promise<ShareRecord>;
  abstract findOwnedShare(shareId: string, ownerId: string): Promise<ShareRecord | null>;
  abstract listSharesForNode(
    nodeId: string,
    ownerId: string,
    limit: number,
    cursor: string | undefined,
  ): Promise<Page<ShareRecord>>;
  abstract revoke(shareId: string, revokedAt: Date): Promise<ShareRecord>;
  abstract setExpiry(shareId: string, expiresAt: Date | null): Promise<ShareRecord>;
  abstract addGrants(shareId: string, emails: string[]): Promise<ShareRecord>;
  /** False when the grant does not belong to this share, so a mismatched pair is a 404. */
  abstract removeGrant(shareId: string, grantId: string): Promise<boolean>;
}

/**
 * Binding pending grants to the account that turns out to hold the address.
 *
 * Declared here, beside the grants it operates on, but injected into `AuthService`: a grant may
 * be written months before its recipient has an account, so the moment it can be bound is the
 * moment somebody proves they hold that address — which happens at sign-in and nowhere else. An
 * abstract class, so the auth module depends on the operation rather than on Prisma.
 */
export abstract class PendingGrantBinder {
  /** Returns how many grants were bound, which is a metric and never a control decision. */
  abstract bindPendingGrants(userId: string, email: string): Promise<number>;
}

function toGrant(record: ShareGrantRecord, role: ShareRole): ShareGrant {
  return {
    id: record.id,
    email: record.email,
    // A grant has no role column: it inherits the share's, so the two cannot disagree about
    // what one recipient may do. When EDITOR arrives, per-grant roles are a column and a
    // migration rather than a rewrite of the resolver.
    role,
    acceptedAt: record.acceptedAt?.toISOString() ?? null,
  };
}

/**
 * The wire shape. `token` is passed only by `createShare` — every other caller has nothing to
 * pass, because the plaintext no longer exists anywhere. It is a parameter rather than a field
 * on `ShareRecord` so that "the link is shown once" is a property of what the store can hold.
 */
function toShare(record: ShareRecord, webAppUrl: string, token?: string): Share {
  return {
    id: record.id,
    nodeId: record.nodeId,
    nodeName: record.nodeName,
    mode: record.mode,
    role: record.role,
    // Both modes carry a link, because both are opened by following one — the owner has to be
    // able to send a restricted invitation somewhere. What the mode changes is what the link
    // is worth: a restricted one is useless without signing in as an address the owner named,
    // so showing it does not turn "only these people" into "anyone with the URL".
    //
    // `token` is present only on the response that created the share. Every later read passes
    // it as undefined and this is null, because the store keeps a hash and cannot produce the
    // original — which is what stops a link reaching a log, a list response or a support query.
    url: token === undefined ? null : shareUrlFor(webAppUrl, token),
    expiresAt: record.expiresAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    grants: record.grants.map((grant) => toGrant(grant, record.role)),
  };
}

/**
 * Normalised, de-duplicated, order preserved.
 *
 * The same rule authentication uses, called from the same function, because a grant for
 * `Buyer@Acme.com` and an account registered as `buyer@acme.com` have to be one person — a
 * second normaliser here would be a second definition of identity, and the two would eventually
 * disagree in exactly the case that matters.
 */
export function normalizeGrantEmails(emails: string[]): string[] {
  return [...new Set(emails.map(normalizeEmail))];
}

/**
 * The owner's side of sharing: create a share, see what is shared, take it back.
 *
 * Nothing here consults a share to decide whether the caller may proceed — every method
 * resolves the target **as the owner** and answers 404 when that resolves to nothing. A share
 * grants reading and only reading, and the way that is guaranteed is that no write path,
 * including these, ever asks the resolver a question.
 */
@Injectable()
export class SharesService {
  constructor(
    private readonly shares: ShareStore,
    private readonly config: ConfigService,
  ) {}

  /**
   * Mint a share and return the link exactly once.
   *
   * The plaintext token is generated here, hashed on the way to the database, and returned in
   * this one response. No endpoint can produce it again, because there is nothing left to
   * produce it from — recovering a lost link means creating a new share and revoking the old
   * one, which is the right outcome anyway: a link nobody can account for should stop working.
   */
  async createShare(user: AuthUser, input: CreateShareInput): Promise<Share> {
    const node = await this.shares.findOwnedNode(input.nodeId, user.id);
    if (node === null) throw new NotFoundError();

    const emails = this.grantEmailsFor(input.mode, input.emails);
    const expiresAt = this.parseExpiry(input.expiresAt);
    const token = generateShareToken();

    const record = await this.shares.createShare({
      nodeId: node.id,
      createdBy: user.id,
      mode: input.mode,
      tokenHash: hashShareToken(token),
      expiresAt,
      emails,
    });

    return toShare(record, this.webAppUrl, token);
  }

  /**
   * Every share on one node, revoked ones included.
   *
   * Revoked rows stay in the listing on purpose: "this link was turned off on the 4th" is the
   * answer an owner needs during diligence, and a list that silently dropped them would look
   * identical to one where a revocation never happened.
   */
  async listShares(
    user: AuthUser,
    nodeId: string,
    limit: number,
    cursor: string | undefined,
  ): Promise<Page<Share>> {
    const node = await this.shares.findOwnedNode(nodeId, user.id);
    if (node === null) throw new NotFoundError();

    const page = await this.shares.listSharesForNode(node.id, user.id, limit, cursor);

    // No token argument: past creation there is no plaintext to build a URL from, so every row
    // here reports `url: null` whatever its mode.
    return {
      items: page.items.map((record) => toShare(record, this.webAppUrl)),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * End access now, keep the content.
   *
   * Idempotent: revoking an already-revoked share returns it unchanged rather than failing. The
   * owner's intent is "this must not work any more", and that is already true — an error would
   * only tempt a client into presenting a satisfied request as an unsatisfied one.
   */
  async revokeShare(user: AuthUser, shareId: string): Promise<Share> {
    const share = await this.requireOwnedShare(user, shareId);
    if (share.revokedAt !== null) return toShare(share, this.webAppUrl);

    return toShare(await this.shares.revoke(share.id, new Date()), this.webAppUrl);
  }

  /**
   * Add recipients to a restricted share, by address.
   *
   * Idempotent per address, decided by the unique `(share_id, email)` index rather than by a
   * read-then-write check that two concurrent requests would both pass. Adding somebody who is
   * already on the list is therefore a no-op, not a 409 — the owner asked for that person to
   * have access, and they do.
   */
  async addGrants(user: AuthUser, shareId: string, emails: string[]): Promise<Share> {
    const share = await this.requireOwnedShare(user, shareId);
    const normalized = this.grantEmailsFor(share.mode, emails);

    if (normalized.length === 0) return toShare(share, this.webAppUrl);

    return toShare(await this.shares.addGrants(share.id, normalized), this.webAppUrl);
  }

  /**
   * Remove one recipient. 404 when the grant belongs to a different share: the pair has to
   * match, or a caller could strip grants off their own share by guessing ids from another.
   */
  async removeGrant(user: AuthUser, shareId: string, grantId: string): Promise<void> {
    const share = await this.requireOwnedShare(user, shareId);

    if (!(await this.shares.removeGrant(share.id, grantId))) throw new NotFoundError();
  }

  /** Set or clear an expiry. `null` clears it; an instant already past is refused. */
  async setExpiry(user: AuthUser, shareId: string, expiresAt: string | null): Promise<Share> {
    const share = await this.requireOwnedShare(user, shareId);
    const parsed = this.parseExpiry(expiresAt);

    return toShare(await this.shares.setExpiry(share.id, parsed), this.webAppUrl);
  }

  private get webAppUrl(): string {
    return this.config.get("WEB_APP_URL");
  }

  private async requireOwnedShare(user: AuthUser, shareId: string): Promise<ShareRecord> {
    const share = await this.shares.findOwnedShare(shareId, user.id);
    if (share === null) throw new NotFoundError();

    return share;
  }

  /**
   * A public link is public: attaching recipients to one would describe a restriction that does
   * not exist, and an owner reading that list back would reasonably conclude only those people
   * can see the folder. Refused rather than quietly dropped, because the difference matters and
   * a quiet drop is how somebody ends up believing the wrong thing about who is looking.
   */
  private grantEmailsFor(mode: ShareMode, emails: string[]): string[] {
    if (mode === "PUBLIC_LINK" && emails.length > 0) {
      throw new ValidationFailedError("A public link is open to anyone who has it.", [
        { field: "emails", message: "Choose a restricted share to name recipients." },
      ]);
    }

    return normalizeGrantEmails(emails);
  }

  /**
   * An expiry already in the past would create a share that never worked — almost always a
   * timezone mistake in a client rather than an intention, and one that looks from the owner's
   * side exactly like sharing succeeded.
   */
  private parseExpiry(value: string | null): Date | null {
    if (value === null) return null;

    const expiresAt = new Date(value);

    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new ValidationFailedError("That expiry has already passed.", [
        { field: "expiresAt", message: "Choose a date and time in the future." },
      ]);
    }

    return expiresAt;
  }
}

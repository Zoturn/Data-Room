import { Injectable } from "@nestjs/common";
import type { Breadcrumb, ContentUrl, NodeSummary, Page, SharedView } from "@data-room/shared";
import { UnauthenticatedError } from "../auth/auth.errors";
import { AccessTokenVerifier, type AuthUser } from "../auth/jwt-auth.guard";
import { NotFoundError } from "../common/errors/domain-error";
import { ConfigService } from "../config/config.service";
import { isPdfContentType } from "../files/pdf-signature";
import { ancestorIdsOf, toNodeSummary, type NodeRecord } from "../folders/folders.repository";
import { StorageService } from "../storage/storage.service";
import { hashShareToken, isShareTokenShaped } from "./share-token";

/**
 * A node as the public surface reads one. `storageKey` rides along because the recipient of a
 * shared file asks for its bytes in the same breath as its metadata, and a second lookup to
 * fetch one column would double the queries on the hottest anonymous read.
 */
export type SharedNodeRecord = NodeRecord & { storageKey: string | null };

/**
 * The share a token resolved to, with the node it points at.
 *
 * Neither the token nor its hash is carried forward: everything past resolution works from the
 * root node, so there is no field here for a later change to log or serialise by accident.
 */
export type SharedRoot = {
  shareId: string;
  mode: "PUBLIC_LINK" | "RESTRICTED";
  root: SharedNodeRecord;
};

/**
 * Everything the public surface needs from the database.
 *
 * An abstract class so it doubles as an injection token and a Jest spec can substitute an
 * in-memory double — the interesting cases here (a token that resolved to a revoked share, a
 * node one hop outside the shared subtree) are worth testing without a Postgres.
 *
 * Every method takes the resolved root and applies it as part of the query, never as a check
 * on a row that was already read. A node outside the shared subtree therefore does not match,
 * and "does not match" is the 404 the service answers — the same 404 an unknown token gets.
 */
export abstract class PublicShareStore {
  /**
   * The share behind a token, only while it is neither revoked nor expired.
   *
   * `now` is a parameter rather than a `new Date()` inside the query so that expiry is a value
   * a test can move, and so that one request cannot see a share as live for one route and dead
   * for the next.
   */
  abstract findActiveShareByTokenHash(tokenHash: string, now: Date): Promise<SharedRoot | null>;

  /** The node, only if it is the shared root itself or sits beneath it. */
  abstract findNodeInSubtree(
    root: SharedNodeRecord,
    nodeId: string,
  ): Promise<SharedNodeRecord | null>;

  abstract listChildren(
    folder: SharedNodeRecord,
    limit: number,
    cursor: string | undefined,
  ): Promise<Page<NodeSummary>>;

  /** Names for an already-scoped id list, in the order given. Ids outside it are never passed. */
  abstract namesFor(dataRoomId: string, ids: string[]): Promise<Map<string, string>>;

  /** Whether this signed-in account holds a grant on this share, by bound id or by address. */
  abstract holdsGrant(shareId: string, userId: string): Promise<boolean>;
}

/**
 * The ancestor chain of `node`, starting at the shared root and excluding everything above it.
 *
 * This function is the disclosure boundary of the whole recipient interface: a breadcrumb list
 * that started at the Data Room would name the folders an owner did *not* share — "Project
 * Neptune / Legal / Disclosure schedules" tells a bidder what else exists, which in a diligence
 * process is itself the confidential part. Re-rooting here rather than trimming in the frontend
 * means the names never leave this process.
 *
 * `null` means the node is not inside the shared subtree, which the caller turns into a 404.
 * Pure and id-only, so the truth table — self, child, grandchild, sibling, ancestor, a node in
 * another room — is a Jest spec with no database in it.
 */
export function scopedAncestorIds(
  rootId: string,
  node: { id: string; path: string },
): string[] | null {
  if (node.id === rootId) return [];

  const ancestors = ancestorIdsOf(node.path);
  const rootIndex = ancestors.indexOf(rootId);

  if (rootIndex === -1) return null;

  return ancestors.slice(rootIndex);
}

/**
 * The recipient's side of sharing: resolve a token, serve what it points at, and serve nothing
 * else.
 *
 * There is no write anywhere in this file, and that absence is the security property rather
 * than an omission — read-only is enforced by shape, so a recipient cannot escalate because
 * there is no code path in which a share is consulted for a mutation.
 *
 * Every denial is a `NotFoundError`. A wrong token, a revoked share, an expired share, a node
 * one hop outside the shared subtree and a file whose bytes are gone all answer identically, so
 * a client probing tokens learns nothing from the difference between them — including whether
 * a share ever existed.
 */
@Injectable()
export class PublicSharesService {
  constructor(
    private readonly shares: PublicShareStore,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    // The same verifier the global guard uses. These routes are `@Public()`, so nothing has
    // populated `request.user` by the time a handler runs; a restricted share still has to
    // know who is asking, and it asks the one component that can answer.
    private readonly verifier: AccessTokenVerifier,
  ) {}

  /** The shared item itself: what the link opens on. */
  async viewRoot(
    token: string,
    accessToken: string | undefined,
    limit: number,
    cursor: string | undefined,
  ): Promise<SharedView> {
    const share = await this.requireShare(token, accessToken);

    return this.viewOf(share.root, [], limit, cursor);
  }

  /** A node inside the shared subtree. Anything else is a 404, including the room above it. */
  async viewNode(
    token: string,
    nodeId: string,
    accessToken: string | undefined,
    limit: number,
    cursor: string | undefined,
  ): Promise<SharedView> {
    const share = await this.requireShare(token, accessToken);
    const node = await this.requireNode(share, nodeId);
    const scoped = scopedAncestorIds(share.root.id, node);

    // Belt and braces: the store already scoped the lookup to the subtree, so a null here
    // means the two disagree — which is a bug, and one that would disclose a path. 404.
    if (scoped === null) throw new NotFoundError();

    return this.viewOf(node, scoped, limit, cursor);
  }

  /**
   * A short-lived download URL for a shared file.
   *
   * Resolution happens before the URL is minted, and that order is the whole authorisation: a
   * signed URL carries its own credential, so signing first and checking afterwards has already
   * handed out the document (file-upload-storage.md rule 9).
   */
  async contentUrl(
    token: string,
    nodeId: string,
    accessToken: string | undefined,
  ): Promise<ContentUrl> {
    const share = await this.requireShare(token, accessToken);
    const node = await this.requireNode(share, nodeId);

    if (node.type !== "FILE" || node.storageKey === null) throw new NotFoundError();
    const storageKey = node.storageKey;

    // Re-read the stored type for the reason `FilesService.getContentUrl` gives: the signed
    // *upload* URL that put the object there outlives the commit, so a `READY` row can end up
    // pointing at something that is no longer a PDF. It matters more on this route, because
    // here the browser following the link belongs to somebody outside the organisation.
    const stat = await this.storage.statObject(storageKey);

    if (stat === null || !isPdfContentType(stat.contentType)) throw new NotFoundError();

    const signed = await this.storage.createDownloadUrl(
      storageKey,
      this.config.get("DOWNLOAD_URL_TTL_SECONDS"),
    );

    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }

  /**
   * Token to share, or 404.
   *
   * The shape check runs first so a string that could never have been minted is answered
   * without a database round trip — not a security control, but it keeps a client from timing
   * the difference between "no such token" and "not even a token".
   *
   * A restricted share opened without a session is the one denial that is *not* a 404: 401,
   * because the recipient is holding a link somebody deliberately sent them and the interface
   * has to be able to say "sign in to open this". That discloses only what the token holder
   * already knows. A signed-in caller with no grant is back to 404 — at that point the answer
   * would be describing somebody else's access.
   */
  private async requireShare(token: string, accessToken: string | undefined): Promise<SharedRoot> {
    if (!isShareTokenShaped(token)) throw new NotFoundError();

    const share = await this.shares.findActiveShareByTokenHash(hashShareToken(token), new Date());

    if (share === null) throw new NotFoundError();
    if (share.mode === "PUBLIC_LINK") return share;

    const viewer = await this.viewerFrom(accessToken);

    if (viewer === null) throw new UnauthenticatedError("Sign in to open this shared item.");
    if (!(await this.shares.holdsGrant(share.shareId, viewer.id))) throw new NotFoundError();

    return share;
  }

  private async requireNode(share: SharedRoot, nodeId: string): Promise<SharedNodeRecord> {
    const node = await this.shares.findNodeInSubtree(share.root, nodeId);

    if (node === null) throw new NotFoundError();

    return node;
  }

  /**
   * The caller, if they happen to have a session. Never throws: on this surface a bad or
   * expired cookie means "anonymous", and a public link must keep working for somebody whose
   * session went stale in another tab.
   */
  private async viewerFrom(accessToken: string | undefined): Promise<AuthUser | null> {
    if (accessToken === undefined || accessToken.length === 0) return null;

    try {
      const claims = await this.verifier.verifyAccessToken(accessToken);

      return { id: claims.sub };
    } catch {
      return null;
    }
  }

  /**
   * One node as a recipient sees it.
   *
   * `children` is null for a file rather than an empty page: a shared file discloses nothing
   * about the folder it sits in, and an empty list would invite an interface to render "this
   * folder is empty" over a document.
   */
  private async viewOf(
    node: SharedNodeRecord,
    scopedAncestors: string[],
    limit: number,
    cursor: string | undefined,
  ): Promise<SharedView> {
    const [breadcrumbs, children] = await Promise.all([
      this.breadcrumbsFor(node, scopedAncestors),
      node.type === "FOLDER" ? this.shares.listChildren(node, limit, cursor) : null,
    ]);

    return { node: toNodeSummary(node), breadcrumbs, children, canDownload: true };
  }

  private async breadcrumbsFor(
    node: SharedNodeRecord,
    scopedAncestors: string[],
  ): Promise<Breadcrumb[]> {
    const self: Breadcrumb = { id: node.id, name: node.name };

    if (scopedAncestors.length === 0) return [self];

    const names = await this.shares.namesFor(node.dataRoomId, scopedAncestors);

    const chain: Breadcrumb[] = [];
    for (const id of scopedAncestors) {
      const name = names.get(id);

      // A missing hop means the subtree is being deleted underneath this read. The next
      // request 404s and the recipient is told the item is no longer available; a crumb list
      // with a gap in it is better than a 500 on the way there.
      if (name !== undefined) chain.push({ id, name });
    }

    chain.push(self);
    return chain;
  }
}

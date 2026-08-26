import { Controller, Get, Header, Param, Query, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  pageQuerySchema,
  type ContentUrl,
  type PageQuery,
  type SharedView,
} from "@data-room/shared";
import { ACCESS_COOKIE_NAME } from "../auth/cookies";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { Public } from "../auth/public.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { PublicSharesService } from "./public-shares.service";

/** Pipes are stateless, so one instance per schema is built once here rather than per request. */
const pageQuery = new ZodValidationPipe(pageQuerySchema);

/**
 * Tighter than the baseline, because this is the one surface where a caller may guess at a
 * credential. A token is 256 bits, so throttling is not what makes guessing hopeless — it is
 * what stops a client turning the endpoint into a scanner and filling the logs while it does.
 * Generous enough for a recipient paging through a large folder, which is the real traffic.
 */
const PROBE_ATTEMPTS = 60;
const PROBE_WINDOW_MS = 60_000;

/**
 * What a recipient may reach with nothing but a link.
 *
 * Every route is `@Public()`, which on a default-deny codebase is a security decision taken
 * once, here, and stated: sharing exists precisely so that somebody without an account can
 * read a document. The token is the credential, and it is the *only* one — which is why this
 * controller is read-only from top to bottom. There is no POST, PATCH or DELETE in this file,
 * and there must never be one: read-only sharing is enforced by the shape of the surface, not
 * by a role check that a later refactor could invert.
 *
 * `X-Robots-Tag: noindex` on every response, because a shared link forwarded into an indexed
 * page would otherwise put a confidential folder listing into a search engine. Belt and braces
 * with the `noindex` meta tag on the recipient page: the header covers the JSON, which a
 * crawler can reach directly.
 *
 * An unknown, revoked or expired token is 404 — never 401 or 403 — so the response cannot
 * confirm that a share ever existed. The one exception is deliberate and narrow: a *valid*
 * restricted token presented without a session answers 401, because the holder of that link
 * was sent it on purpose and the interface has to be able to say "sign in to open this". A
 * signed-in caller who holds no grant is back to 404.
 *
 * The `:token` and `:nodeId` params are not validated as UUIDs by a pipe. A malformed value
 * names nothing, and "names nothing" is the 404 the service already answers — a 400 would tell
 * a probing client that its guess was at least well-formed.
 */
@Controller("public/shares")
@Public()
@Throttle({ default: { limit: PROBE_ATTEMPTS, ttl: PROBE_WINDOW_MS } })
export class PublicSharesController {
  constructor(private readonly shares: PublicSharesService) {}

  /** The shared item itself, with its first page of contents when it is a folder. */
  @Get(":token")
  @Header("X-Robots-Tag", "noindex")
  async view(
    @Param("token") token: string,
    @Query(pageQuery) query: PageQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<SharedView> {
    return this.shares.viewRoot(token, accessTokenFrom(request), query.limit, query.cursor);
  }

  /**
   * Navigating inside the shared subtree. A node id from outside it — an ancestor, a sibling,
   * another Data Room entirely — is 404, so the link cannot be walked upwards or sideways.
   */
  @Get(":token/nodes/:nodeId")
  @Header("X-Robots-Tag", "noindex")
  async viewNode(
    @Param("token") token: string,
    @Param("nodeId") nodeId: string,
    @Query(pageQuery) query: PageQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<SharedView> {
    return this.shares.viewNode(token, nodeId, accessTokenFrom(request), query.limit, query.cursor);
  }

  /**
   * A short-lived signed URL for one shared file. Separate from the metadata read so a viewer
   * can re-request a fresh URL when one expires, without re-fetching the document it is
   * already displaying — and so that access is re-resolved when it does.
   */
  @Get(":token/files/:nodeId/content-url")
  @Header("X-Robots-Tag", "noindex")
  async contentUrl(
    @Param("token") token: string,
    @Param("nodeId") nodeId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ContentUrl> {
    return this.shares.contentUrl(token, nodeId, accessTokenFrom(request));
  }
}

/**
 * The session cookie, if the browser happened to send one.
 *
 * Read here rather than through `@CurrentUser()` because these routes are `@Public()`: the
 * global guard returns before it verifies anything, so `request.user` is undefined even for a
 * signed-in owner opening their own link. A restricted share still needs to know who is asking,
 * so the raw cookie is handed to the service, which owns the one verifier that can answer.
 *
 * Cookie only, never a query parameter — a session token in a URL ends up in access logs and
 * `Referer` headers, and this is the one surface whose URLs get forwarded by design.
 */
function accessTokenFrom(request: AuthenticatedRequest): string | undefined {
  return request.cookies?.[ACCESS_COOKIE_NAME];
}

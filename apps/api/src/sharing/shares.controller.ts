import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  createShareInputSchema,
  nodeIdSchema,
  pageQuerySchema,
  type CreateShareInput,
  type Page,
  type Share,
} from "@data-room/shared";
import { z } from "zod";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/jwt-auth.guard";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { SharesService } from "./shares.service";

/**
 * Which node's shares to list. `nodeId` is required rather than optional: a bare `GET /shares`
 * would be "everything I have ever shared", which is a different screen with different sorting
 * and no natural page size, and quietly returning it here would make an accidental omission
 * look like a working request.
 */
const listSharesQuerySchema = pageQuerySchema.extend({ nodeId: nodeIdSchema });

/**
 * Bounded at the same 50 as `createShareInputSchema`, because the two are the same operation
 * arriving at different times and a limit that only one of them applies is not a limit.
 */
const addGrantsBodySchema = z.object({
  emails: z.array(z.string().email()).min(1).max(50),
});

/** `null` clears the expiry, which is why the field is nullable rather than optional. */
const setExpiryBodySchema = z.object({
  expiresAt: z.string().datetime().nullable(),
});

/** Pipes are stateless, so one instance per schema is built once here rather than per request. */
const createShareBody = new ZodValidationPipe(createShareInputSchema);
const listSharesQuery = new ZodValidationPipe(listSharesQuerySchema);
const addGrantsBody = new ZodValidationPipe(addGrantsBodySchema);
const setExpiryBody = new ZodValidationPipe(setExpiryBodySchema);

/**
 * The owner's share management surface. Every route here is session-only — there is no
 * `@Public()` in this file, and there must never be one: these are the endpoints that create
 * and destroy access, and a caller who cannot prove who they are has no business reaching them.
 *
 * No `@UseGuards` either. The JWT guard is global, so these routes are authenticated because
 * nobody did anything. Ownership is separate from authentication and is not a guard: it is a
 * `where` clause in the store, which is what makes a share belonging to someone else answer
 * exactly like a share id that was never real. Both are 404, never 403.
 *
 * The `:id` params are deliberately not validated as UUIDs here. A malformed id names nothing,
 * and "names nothing" is the 404 the service already answers — a 400 would tell a probing
 * client that its id was at least well-formed.
 */
@Controller("shares")
export class SharesController {
  constructor(private readonly shares: SharesService) {}

  /**
   * The one response that carries a share link. `url` is populated here and nowhere else,
   * because the token is hashed on the way to the database and the plaintext ends with this
   * request.
   */
  @Post()
  async create(
    @Body(createShareBody) input: CreateShareInput,
    @CurrentUser() user: AuthUser,
  ): Promise<Share> {
    return this.shares.createShare(user, input);
  }

  /** Shares on one node — active and revoked, newest first. */
  @Get()
  async list(
    @Query(listSharesQuery) query: z.infer<typeof listSharesQuerySchema>,
    @CurrentUser() user: AuthUser,
  ): Promise<Page<Share>> {
    return this.shares.listShares(user, query.nodeId, query.limit, query.cursor);
  }

  /**
   * POST rather than DELETE: revoking does not remove the share, it records that access ended
   * — the row stays, with a `revokedAt`, so the owner can still see that a link existed and
   * when it stopped working. A `DELETE` returning a body describing what still exists would be
   * a lie about what happened.
   */
  @Post(":id/revoke")
  async revoke(@Param("id") id: string, @CurrentUser() user: AuthUser): Promise<Share> {
    return this.shares.revokeShare(user, id);
  }

  /** Add recipients to a restricted share. Idempotent per address. */
  @Post(":id/grants")
  async addGrants(
    @Param("id") id: string,
    @Body(addGrantsBody) body: z.infer<typeof addGrantsBodySchema>,
    @CurrentUser() user: AuthUser,
  ): Promise<Share> {
    return this.shares.addGrants(user, id, body.emails);
  }

  /** Set or clear the expiry of an existing share. */
  @Patch(":id")
  async setExpiry(
    @Param("id") id: string,
    @Body(setExpiryBody) body: z.infer<typeof setExpiryBodySchema>,
    @CurrentUser() user: AuthUser,
  ): Promise<Share> {
    return this.shares.setExpiry(user, id, body.expiresAt);
  }

  /**
   * 204 with no body: the recipient is gone from the share, and the share itself is unchanged
   * — the client already has it and does not need it echoed back to remove one row from a list.
   */
  @Delete(":id/grants/:grantId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeGrant(
    @Param("id") id: string,
    @Param("grantId") grantId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.shares.removeGrant(user, id, grantId);
  }
}

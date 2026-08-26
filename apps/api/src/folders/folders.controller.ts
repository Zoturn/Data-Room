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
  createFolderInputSchema,
  pageQuerySchema,
  renameInputSchema,
  type CreateFolderInput,
  type DeletionPreview,
  type FolderContents,
  type NodeSummary,
  type Page,
  type PageQuery,
  type RenameInput,
  type SubtreeAggregate,
} from "@data-room/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/jwt-auth.guard";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { FoldersService } from "./folders.service";

/**
 * Pipes are stateless, so one instance per schema is built once here rather than per request.
 */
const createFolderBody = new ZodValidationPipe(createFolderInputSchema);
const renameBody = new ZodValidationPipe(renameInputSchema);
const pageQuery = new ZodValidationPipe(pageQuerySchema);

/**
 * The folder tree over HTTP. Every handler validates, delegates and returns — the rules are
 * in `FoldersService` and the queries in `FoldersRepository`.
 *
 * There is no `@UseGuards` here: the JWT guard is global, so these routes are protected
 * because nobody did anything. Ownership is not a guard either — it is a `where` clause in
 * the repository, which is what makes an unauthorised request indistinguishable from a
 * request for something that does not exist. Both are 404, never 403.
 *
 * The `:id` params are deliberately not validated as UUIDs at this layer. A malformed id
 * names nothing, and "names nothing" is a 404 — which is what the service answers — rather
 * than a 400 that would tell a probing client its id was at least well-formed.
 */
@Controller("folders")
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  @Post()
  async create(
    @Body(createFolderBody) input: CreateFolderInput,
    @CurrentUser() user: AuthUser,
  ): Promise<NodeSummary> {
    return this.folders.createFolder(user, input);
  }

  /** Opening a folder: metadata, the full breadcrumb chain, and the first page of children. */
  @Get(":id")
  async contents(
    @Param("id") id: string,
    @Query(pageQuery) query: PageQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<FolderContents> {
    return this.folders.getContents(user, id, query);
  }

  /** Subsequent pages of the same listing, followed by `nextCursor`. */
  @Get(":id/children")
  async children(
    @Param("id") id: string,
    @Query(pageQuery) query: PageQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<Page<NodeSummary>> {
    return this.folders.listChildren(user, id, query);
  }

  /** What the confirmation dialog states before anything is destroyed. */
  @Get(":id/deletion-preview")
  async deletionPreview(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<DeletionPreview> {
    return this.folders.deletionPreview(user, id);
  }

  /** Item counts and total size for the whole subtree, at every depth. */
  @Get(":id/aggregate")
  async aggregate(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<SubtreeAggregate> {
    return this.folders.subtreeAggregate(user, id);
  }

  @Patch(":id")
  async rename(
    @Param("id") id: string,
    @Body(renameBody) input: RenameInput,
    @CurrentUser() user: AuthUser,
  ): Promise<NodeSummary> {
    return this.folders.renameFolder(user, id, input);
  }

  /**
   * 204 with no body: the resource is gone, and there is nothing left to describe. The
   * numbers the owner was shown came from `deletion-preview` before they confirmed.
   */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string, @CurrentUser() user: AuthUser): Promise<void> {
    await this.folders.deleteFolder(user, id);
  }
}

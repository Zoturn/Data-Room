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
} from "@nestjs/common";
import {
  moveInputSchema,
  renameInputSchema,
  uploadIntentInputSchema,
  type ContentUrl,
  type FileDetail,
  type MoveInput,
  type NodeSummary,
  type RenameInput,
  type UploadIntent,
  type UploadIntentInput,
} from "@data-room/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/jwt-auth.guard";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { FilesService } from "./files.service";

/** Pipes are stateless, so one instance per schema is built once here rather than per request. */
const uploadIntentBody = new ZodValidationPipe(uploadIntentInputSchema);
const renameBody = new ZodValidationPipe(renameInputSchema);
const moveBody = new ZodValidationPipe(moveInputSchema);

/**
 * Files over HTTP. Every handler validates, delegates and returns — the rules are in
 * `FilesService` and the queries in `FilesRepository`.
 *
 * No `@UseGuards`: the JWT guard is global, so these routes are protected because nobody did
 * anything. Ownership is not a guard either — it is a `where` clause in the repository, which
 * is what makes an unauthorised request indistinguishable from a request for something that
 * does not exist. Both are 404, never 403.
 *
 * No route here accepts file bytes. They go browser → storage over a signed URL and never
 * pass through this process (file-upload-storage.md rule 1).
 */
@Controller("files")
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /**
   * Step one of the upload. Declared before the `:id` routes so `upload-intent` is read as a
   * literal rather than as a file id — Nest matches in declaration order.
   */
  @Post("upload-intent")
  async uploadIntent(
    @Body(uploadIntentBody) input: UploadIntentInput,
    @CurrentUser() user: AuthUser,
  ): Promise<UploadIntent> {
    return this.files.createUploadIntent(user, input);
  }

  /**
   * Step three. No body: everything this decides is read from the stored object, and a body
   * would only offer the client somewhere to lie about it.
   */
  @Post(":id/commit")
  async commit(@Param("id") id: string, @CurrentUser() user: AuthUser): Promise<NodeSummary> {
    return this.files.commitUpload(user, id);
  }

  /** Opening a file: its metadata and the breadcrumb chain that leads back out. */
  @Get(":id")
  async detail(@Param("id") id: string, @CurrentUser() user: AuthUser): Promise<FileDetail> {
    return this.files.getFile(user, id);
  }

  /**
   * A short-lived signed download URL, issued only after access has been checked. Separate
   * from the metadata read so the viewer can re-request a fresh URL when one expires, without
   * re-fetching the file it is already displaying.
   */
  @Get(":id/content-url")
  async contentUrl(@Param("id") id: string, @CurrentUser() user: AuthUser): Promise<ContentUrl> {
    return this.files.getContentUrl(user, id);
  }

  /** Returns the summary, because a collision resolves to a suffixed name rather than a 409. */
  @Patch(":id")
  async rename(
    @Param("id") id: string,
    @Body(renameBody) input: RenameInput,
    @CurrentUser() user: AuthUser,
  ): Promise<NodeSummary> {
    return this.files.renameFile(user, id, input);
  }

  /** POST rather than PATCH: the destination is not a field of the file's representation. */
  @Post(":id/move")
  async move(
    @Param("id") id: string,
    @Body(moveBody) input: MoveInput,
    @CurrentUser() user: AuthUser,
  ): Promise<NodeSummary> {
    return this.files.moveFile(user, id, input);
  }

  /** 204 with no body: the resource is gone, and there is nothing left to describe. */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string, @CurrentUser() user: AuthUser): Promise<void> {
    await this.files.deleteFile(user, id);
  }
}

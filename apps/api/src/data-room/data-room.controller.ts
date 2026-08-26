import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import {
  renameInputSchema,
  type DataRoom,
  type RenameInput,
  type SubtreeAggregate,
} from "@data-room/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/jwt-auth.guard";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { DataRoomService } from "./data-room.service";

const renameBody = new ZodValidationPipe(renameInputSchema);

/**
 * The owner's Data Room. There is no list endpoint and no create endpoint: a user has exactly
 * one room, it is created the first time they ask for it, and it is addressed as `me` — so
 * there is no id to guess and no room but your own to reach.
 */
@Controller("data-rooms")
export class DataRoomController {
  constructor(private readonly rooms: DataRoomService) {}

  /**
   * Where the application starts. Idempotent: the first call provisions the room and its root
   * folder, every later call returns the same one, and concurrent first calls still produce
   * one room.
   */
  @Get("me")
  async me(@CurrentUser() user: AuthUser): Promise<DataRoom> {
    return this.rooms.getOrProvision(user);
  }

  /** Declared after `me` so the literal segment is matched before the parameter. */
  @Get(":id/summary")
  async summary(@Param("id") id: string, @CurrentUser() user: AuthUser): Promise<SubtreeAggregate> {
    return this.rooms.summary(user, id);
  }

  @Patch(":id")
  async rename(
    @Param("id") id: string,
    @Body(renameBody) input: RenameInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DataRoom> {
    return this.rooms.rename(user, id, input);
  }
}

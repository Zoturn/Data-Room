import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { StorageModule } from "../storage/storage.module";
import { PublicSharesController } from "./public-shares.controller";
import { PublicSharesService, PublicShareStore } from "./public-shares.service";
import { PrismaPublicShareStore } from "./public-shares.store";

/**
 * The recipient's side of sharing: the only routes in this API that answer without a session.
 *
 * A third module rather than a corner of the other two, because this is the one surface where
 * `@Public()` is used at all. On a codebase whose guard is global and default-deny, the set of
 * routes that opt out is a thing worth being able to see in one file — and a reviewer asking
 * "what can be reached without signing in?" gets the whole answer from this module's
 * controller.
 *
 * It provides no store of its own beyond a read-only one, and exports nothing. Nothing else
 * in the API has a reason to reach the public surface, and a share cannot be created or
 * revoked from here.
 *
 * `AuthModule` is imported for the token verifier alone: these routes accept a session when
 * one happens to be present, because a RESTRICTED share needs to know who is asking, but they
 * never require one at the guard.
 */
@Module({
  imports: [AuthModule, StorageModule],
  controllers: [PublicSharesController],
  providers: [PublicSharesService, { provide: PublicShareStore, useClass: PrismaPublicShareStore }],
})
export class PublicSharesModule {}

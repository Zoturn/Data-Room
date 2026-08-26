import { Module } from "@nestjs/common";
import { PendingGrantBinder, SharesService, ShareStore } from "./shares.service";
import { PrismaPendingGrantBinder, PrismaShareStore } from "./shares.store";
import { SharesController } from "./shares.controller";

/**
 * The owner's side of sharing: minting links, listing them, taking them back.
 *
 * Separate from the module that resolves *access*, because the two have opposite jobs. This
 * one decides who may hand out reading rights and answers 404 to everybody else; that one
 * decides whether a reader may see a node. Keeping them apart is what makes it obvious, from
 * the imports alone, that nothing on a write path consults a share.
 *
 * `PendingGrantBinder` is exported and nothing else is. `AuthModule` needs exactly one
 * operation — bind the grants waiting on an address to the account that just proved it holds
 * it — and a sign-in has no business being able to reach `ShareStore` and create or revoke a
 * share. The narrow export is the statement of that boundary.
 */
@Module({
  controllers: [SharesController],
  providers: [
    SharesService,
    { provide: ShareStore, useClass: PrismaShareStore },
    { provide: PendingGrantBinder, useClass: PrismaPendingGrantBinder },
  ],
  exports: [PendingGrantBinder],
})
export class SharesModule {}

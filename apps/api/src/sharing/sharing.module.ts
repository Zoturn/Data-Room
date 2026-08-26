import { Module } from "@nestjs/common";
import { AccessResolver, ShareAccessResolver, ShareResolutionStore } from "./access.resolver";
import { NodeAccessService } from "./node-access.service";
import { PrismaShareResolutionStore } from "./sharing.repository";

/**
 * Access resolution: given a node and whoever is asking, what may they do?
 *
 * Deliberately separate from `SharesModule`, which mints and revokes shares. The two have
 * opposite jobs — one decides who may hand out reading rights, this one decides whether a
 * reader may see a node — and keeping them apart means the read modules import the decision
 * without also gaining the ability to create a share.
 *
 * `NodeAccessService` and `AccessResolver` are exported and nothing else is. A read path needs
 * the decision; nothing outside this module has any business querying `shares` directly, and
 * the narrow export is the statement of that boundary.
 */
@Module({
  providers: [
    NodeAccessService,
    { provide: AccessResolver, useClass: ShareAccessResolver },
    { provide: ShareResolutionStore, useClass: PrismaShareResolutionStore },
  ],
  exports: [NodeAccessService, AccessResolver],
})
export class SharingModule {}

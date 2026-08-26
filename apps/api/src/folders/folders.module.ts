import { Module } from "@nestjs/common";
import { FilesModule } from "../files/files.module";
import { SharingModule } from "../sharing/sharing.module";
import { FoldersController } from "./folders.controller";
import { FoldersRepository } from "./folders.repository";
import { FoldersService } from "./folders.service";

/**
 * The node tree: the folders inside a Data Room, and — once `add-file-management` lands —
 * the file rows that share the same table and the same operations.
 *
 * `FoldersService` is exported because the Data Room's summary is the aggregate over its root
 * folder, and `DataRoomModule` must reach it through this service rather than by querying
 * `nodes` itself (nestjs-architecture.md rule 5). The dependency runs one way only —
 * `DataRoomModule` imports this one, never the reverse — so there is no cycle to break.
 */
@Module({
  // For `BlobReleaseService` alone: a folder deletion frees the objects of every file beneath
  // it. One direction only — `FilesModule` imports nothing from here (it reuses this module's
  // pure path helpers by file import, not by injection), so there is no cycle.
  // `SharingModule` for the read paths only: it provides the decision a folder read needs and
  // nothing that could create or revoke a share.
  imports: [FilesModule, SharingModule],
  controllers: [FoldersController],
  providers: [FoldersService, FoldersRepository],
  exports: [FoldersService],
})
export class FoldersModule {}

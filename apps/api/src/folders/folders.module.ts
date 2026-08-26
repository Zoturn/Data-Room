import { Module } from "@nestjs/common";
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
  controllers: [FoldersController],
  providers: [FoldersService, FoldersRepository],
  exports: [FoldersService],
})
export class FoldersModule {}

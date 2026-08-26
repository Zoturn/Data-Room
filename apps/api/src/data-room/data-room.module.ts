import { Module } from "@nestjs/common";
import { FoldersModule } from "../folders/folders.module";
import { DataRoomController } from "./data-room.controller";
import { DataRoomRepository } from "./data-room.repository";
import { DataRoomService } from "./data-room.service";

/**
 * The owned container each user's tree hangs from.
 *
 * It imports `FoldersModule` for one reason: the room's summary is the subtree aggregate over
 * its root folder, and that query belongs to the module that owns `nodes`. Reaching it through
 * the exported service rather than querying the table here is what keeps one prefix aggregate
 * in one place (nestjs-architecture.md rule 5). Nothing flows back the other way, so the two
 * modules do not form a cycle.
 */
@Module({
  imports: [FoldersModule],
  controllers: [DataRoomController],
  providers: [DataRoomService, DataRoomRepository],
  exports: [DataRoomService],
})
export class DataRoomModule {}

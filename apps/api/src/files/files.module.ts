import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { BlobReleaseQueue } from "./blob-release.queue";
import { BlobReleaseService } from "./blob-release.service";
import { FilesController } from "./files.controller";
import { FilesRepository } from "./files.repository";
import { FilesService } from "./files.service";
import { UploadSweepService } from "./upload-sweep.service";

/**
 * File nodes and the upload pipeline. `StorageModule` is imported explicitly rather than
 * relied upon as global: this module cannot work without a `StorageService`, and stating the
 * dependency is what makes that failure a compile-time wiring error instead of a runtime one.
 *
 * `BlobReleaseQueue` is a provider of this module and therefore one instance: the service
 * that records a failed deletion and the sweep that retries it must be looking at the same
 * queue, or every failure would be recorded into an object nobody drains.
 *
 * `BlobReleaseService` is exported because deleting a folder frees the objects of every file
 * beneath it, and `FoldersModule` releases them through this seam rather than talking to
 * storage itself (nestjs-architecture.md rule 5).
 */
@Module({
  imports: [StorageModule],
  controllers: [FilesController],
  providers: [
    FilesService,
    FilesRepository,
    BlobReleaseService,
    BlobReleaseQueue,
    UploadSweepService,
  ],
  exports: [BlobReleaseService],
})
export class FilesModule {}

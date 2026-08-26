import { Module } from "@nestjs/common";
import { ConfigService } from "../config/config.service";
import { InMemoryStorageService } from "./in-memory-storage.service";
import { StorageService } from "./storage.service";
import { SupabaseStorageService } from "./supabase-storage.service";

/**
 * Binds the one `StorageService` the rest of the API depends on.
 *
 * The choice is made from `NODE_ENV` here rather than by each consumer, so nothing above this
 * module knows there is more than one implementation — and a spec that wants the fake asks
 * Nest to override this provider rather than importing a different service.
 *
 * Under `test` the in-memory implementation is bound because the alternative is a suite that
 * reaches a real bucket: slow, shared between whoever runs it at the same time, and green or
 * red depending on the network. `NODE_ENV` is validated to three values at boot, so this is a
 * closed choice rather than a string comparison that can silently fall through.
 */
@Module({
  providers: [
    {
      provide: StorageService,
      useFactory: (config: ConfigService): StorageService =>
        config.get("NODE_ENV") === "test"
          ? new InMemoryStorageService()
          : new SupabaseStorageService(config),
      inject: [ConfigService],
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}

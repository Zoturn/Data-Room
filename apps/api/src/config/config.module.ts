import { Global, Module } from "@nestjs/common";
import { ConfigService, ENV_SOURCE } from "./config.service";

@Global()
@Module({
  providers: [{ provide: ENV_SOURCE, useValue: process.env }, ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}

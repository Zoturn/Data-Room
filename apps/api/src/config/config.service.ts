import { Inject, Injectable } from "@nestjs/common";
import { parseEnv, type Env } from "./env.schema";

/**
 * Injection token for the raw environment. A token rather than a defaulted constructor
 * parameter, because Nest resolves every constructor argument through DI and a default
 * value does not exempt it — this also lets a test provide its own source.
 */
export const ENV_SOURCE = Symbol("ENV_SOURCE");

/** Typed, validated access to configuration. The only reader of `process.env`. */
@Injectable()
export class ConfigService {
  private readonly env: Env;

  constructor(@Inject(ENV_SOURCE) source: NodeJS.ProcessEnv) {
    this.env = parseEnv(source);
  }

  get<K extends keyof Env>(key: K): Env[K] {
    return this.env[key];
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === "production";
  }
}

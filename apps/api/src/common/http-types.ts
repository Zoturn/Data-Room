import type { Request } from "express";

/**
 * Express request carrying the id stamped by RequestIdMiddleware.
 *
 * Declared as an intersection rather than a global augmentation of
 * `express-serve-static-core`: that package is a transitive dependency and is not directly
 * resolvable under pnpm's strict layout, and a local type is easier to follow anyway.
 */
export type RequestWithId = Request & { requestId?: string };

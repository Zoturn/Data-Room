import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Response } from "express";
import { randomUUID } from "node:crypto";
import type { RequestWithId } from "./http-types";

/**
 * Stamps every request with an id. It is the one internal detail a client receives on a
 * failure, and the handle for finding the matching log line.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestWithId, res: Response, next: NextFunction): void {
    const id = randomUUID();
    req.requestId = id;
    res.setHeader("x-request-id", id);
    next();
  }
}

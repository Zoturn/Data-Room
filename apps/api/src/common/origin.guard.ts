import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { ConfigService } from "../config/config.service";
import { DomainError } from "./errors/domain-error";

/** Methods that change something, and so are worth a cross-site request to trigger. */
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class CrossSiteRequestError extends DomainError {
  readonly code = "UNAUTHENTICATED" as const;
  readonly status = 401;

  constructor() {
    super("This request did not come from an allowed origin.");
  }
}

/**
 * Rejects state-changing requests carrying a foreign `Origin`.
 *
 * CORS does not do this. `enableCors` decides which response *headers* to emit; it does not
 * refuse the request. A form post — or a `fetch` with `mode: "no-cors"` and a urlencoded
 * content type — is a CORS-simple request, so no preflight happens, the handler runs, and
 * `Set-Cookie` takes effect. The attacker never reads the reply and does not need to.
 *
 * Concretely, without this: a page on any origin posts the attacker's credentials to
 * `/auth/login`, the victim's browser stores the attacker's session, and every document the
 * victim uploads afterwards lands in the attacker's Data Room. No XSS, no stolen password.
 * Production runs `SameSite=None` because the frontend genuinely is cross-site, so the cookie
 * policy cannot be what prevents it.
 *
 * `Origin` is set by the browser on every state-changing request and cannot be forged by a
 * page. An absent `Origin` is allowed: that is a non-browser caller — curl, the Cypress API
 * specs, a platform health probe — which has no ambient cookies to abuse in the first place.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (!STATE_CHANGING.has(request.method)) return true;

    const origin = request.headers.origin;
    if (origin === undefined) return true;

    if (!this.config.get("CORS_ORIGINS").includes(origin)) {
      throw new CrossSiteRequestError();
    }

    return true;
  }
}

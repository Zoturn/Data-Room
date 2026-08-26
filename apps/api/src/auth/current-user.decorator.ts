import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { UnauthenticatedError, type AuthUser, type AuthenticatedRequest } from "./jwt-auth.guard";

/**
 * The extraction behind `@CurrentUser()`, named so it can be tested directly — a parameter
 * decorator's factory is otherwise reachable only through Nest's route-argument metadata.
 *
 * Throwing when the request carries no user is what keeps the type honest: the return type
 * is `AuthUser`, not `AuthUser | undefined`, so no handler has to defend against a caller
 * the guard should already have rejected. It fires only when a handler asks for the caller
 * on a route that `@Public()` opened — a mistake in the code, caught on the first request.
 */
export function currentUserFrom(_data: unknown, context: ExecutionContext): AuthUser {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  const user = request.user;

  if (user === undefined) throw new UnauthenticatedError();

  return user;
}

/**
 * The only way a handler obtains the caller. Services never read `request.user` — a service
 * that knows about the request has stopped being testable without one, and ownership rules
 * scattered across the transport layer are the ones that get forgotten.
 */
export const CurrentUser = createParamDecorator<unknown, AuthUser>(currentUserFrom);

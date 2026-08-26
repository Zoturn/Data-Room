import { SetMetadata, type CustomDecorator } from "@nestjs/common";

/**
 * Metadata key the globally registered `JwtAuthGuard` reads. Only the guard and its spec
 * should ever look at it — nothing else in the app branches on whether a route is public.
 */
export const IS_PUBLIC_KEY = "isPublic";

/**
 * Opens one handler, or a whole controller, to anonymous callers.
 *
 * The guard is registered globally, so an endpoint is protected because nobody did
 * anything. This decorator is the only way out of that, which makes adding it a security
 * decision rather than a convenience — say why in the pull request.
 *
 * See apps/api/.claude/rules/auth-and-guards.md.
 */
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);

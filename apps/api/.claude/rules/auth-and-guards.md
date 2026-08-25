---
paths:
  - "apps/api/src/auth/**/*.ts"
  - "apps/api/src/**/*.guard.ts"
  - "apps/api/src/**/*.strategy.ts"
  - "apps/api/src/**/*.decorator.ts"
---

# Authentication and guards

**Scope:** identity, sessions, cookie policy across environments, and the default-deny protection of every endpoint.

## Rules

1. The JWT guard is registered globally. An endpoint is protected because nobody did anything; exposure requires an explicit `@Public()`. Adding `@Public()` is a security decision — say why in the pull request.
2. Passwords are hashed with Argon2id and compared with the library's constant-time verify. Never log, return, or include a hash in any DTO.
3. Emails are normalised (trim, lower-case) by the same shared function used everywhere, before storage and before every comparison. Grants, logins and account linking must agree on what one address means.
4. Authentication failure is uniform: unknown email, wrong password and password login against a Google-only account all return 401 `INVALID_CREDENTIALS` with the same message and comparable timing. Do not add a helpful "no account with that email".
5. Tokens travel only in cookies. `httpOnly` is unconditional, in every environment. Never accept a token from a query string or a body, and never write one to `localStorage`.
6. `Secure` and `SameSite` are **configuration, not code**. They come from the env schema, never from an `if (isProd)` branch. See the local-development section below for the values and why they differ.
7. The refresh cookie is scoped to the refresh endpoint path so it is not sent with ordinary requests. That path is the same in every environment.
8. Refresh tokens are stored hashed with a `familyId` and rotate on every use. Presenting an already-rotated token revokes the whole family. A short grace window covers the client's own concurrent retry; anything beyond it is treated as theft.
9. Google sign-in requires `email_verified`. Match on the normalised email and link to the existing user; never create a second account for the same address. Validate the OAuth `state` on every callback.
10. The Google callback sets cookies and redirects to the frontend. It never returns JSON — the browser is mid-navigation.
11. `@CurrentUser()` is the only way a handler obtains the caller. Do not read `request.user` directly in a service.
12. Guards answer _may this caller proceed_ and nothing else. Resolving what a share permits belongs to the access resolver; see `sharing-authorization.md`.
13. Rate-limit register, login, refresh and the public share surface. The limiter is per-instance in memory today — with more than one instance it needs a shared store, and that is a real change, not a config tweak.

## Local development with httpOnly cookies

The production pair is genuinely cross-site — `app.vercel.app` calling `api.onrender.com` — so it needs `SameSite=None`, and browsers only accept that with `Secure`, which needs HTTPS. Locally there is no HTTPS, so the same settings would silently drop every cookie: the login response appears to succeed, and the next request arrives anonymous.

Locally the pair is **not** cross-site. `localhost:3000` and `localhost:3001` differ only by port, and port is not part of a _site_ — so `SameSite=Lax` cookies are sent on credentialed requests between them. That is what makes local development work without certificates.

|            | Local   | Production |
| ---------- | ------- | ---------- |
| `httpOnly` | `true`  | `true`     |
| `Secure`   | `false` | `true`     |
| `SameSite` | `lax`   | `none`     |
| `domain`   | unset   | unset      |

Both sides still need the credentialed-CORS handshake, which is easy to get wrong in either environment:

- The API must echo an explicit origin — `Access-Control-Allow-Origin: http://localhost:3000` — and send `Access-Control-Allow-Credentials: true`. A wildcard origin is rejected by the browser whenever credentials are involved.
- The web client must send `credentials: "include"` on every request, including the refresh call.
- Use `localhost` consistently on both sides. Mixing `localhost` and `127.0.0.1` makes them different sites and the cookie will not be sent.

Google OAuth locally needs `http://localhost:3001/api/auth/google/callback` registered as an authorised redirect URI alongside the production one, and `WEB_APP_URL` pointing at `http://localhost:3000` so the callback redirects back to the dev frontend.

If a browser ever does reject the local cookie — a hardened profile, or a device on the LAN testing against your machine — the fallback is to make the pair same-origin rather than to loosen the cookie: proxy `/api/*` from the Next.js dev server to the API, so the browser sees one origin and `SameSite` stops mattering. Never "fix" a local cookie problem by weakening the production policy.

## Examples

```ts
// apps/api/src/config/env.schema.ts — policy as configuration
COOKIE_SECURE: z.coerce.boolean().default(false),
COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
```

```ts
// apps/api/src/auth/cookies.ts — one place that knows the shape of a session cookie
private baseCookie(): CookieOptions {
  return {
    httpOnly: true,                          // never environment-dependent
    secure: this.config.get("COOKIE_SECURE"),
    sameSite: this.config.get("COOKIE_SAMESITE"),
    path: "/",
  };
}
```

```bash
# .env.example — local defaults; production sets COOKIE_SECURE=true, COOKIE_SAMESITE=none
WEB_APP_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000
COOKIE_SECURE=false
COOKIE_SAMESITE=lax
```

```ts
export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(ctx: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    return isPublic ? true : super.canActivate(ctx);
  }
}
```

## Anti-patterns

- `sameSite: isProd ? "none" : "lax"` inline at a call site — the policy then lives in several places and drifts.
- Dropping `httpOnly` locally "to make debugging easier". Debug from the network tab.
- `Access-Control-Allow-Origin: *` together with credentials — the browser refuses it.
- Mixing `localhost` and `127.0.0.1` between the frontend and the API.
- `@UseGuards(JwtAuthGuard)` per controller — one omission exposes a route.
- Distinct messages for "no such user" and "wrong password".
- A refresh endpoint that reissues without rotating.

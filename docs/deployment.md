# Deployment runbook

Follow this in order. Each step says what to click, what to copy, and how to know it worked. Stop at the first step that does not verify — later steps depend on it.

Three services, all on free tiers:

| Service           | Hosts                     | Why                                                                        |
| ----------------- | ------------------------- | -------------------------------------------------------------------------- |
| Supabase          | Postgres and file storage | One provider for both, with signed upload URLs built in                    |
| Railway or Render | `apps/api`                | The NestJS server needs a long-running process, which Vercel does not give |
| Vercel            | `apps/web`                | Next.js deploys there with no configuration                                |

You will end up with two public URLs to put in the README.

---

## 1. Supabase — database

1. Sign in at <https://supabase.com/dashboard> and choose **New project**.
2. Name it `data-room`. Pick the region nearest you — every query pays that latency.
3. Set a database password and **save it somewhere safe now**. Supabase shows it once, and both connection strings below contain it.
4. Wait for provisioning (1–2 minutes).

### Copy the two connection strings

Click the green **Connect** button in the top bar, beside the project name. (Older guides say
Settings → Database — that page no longer exists.)

In the dialog, choose the **ORM** tab. It is built for Prisma and gives you both variables
already formatted. The **Direct** tab also works, but hands you one string to adapt by hand;
the **Server** and **Framework** tabs are for the Supabase client library, which this project
does not use — the API talks to Postgres through Prisma.

You need two values, and they differ by port:

| Variable       | Connection type        | Port   | Used for         |
| -------------- | ---------------------- | ------ | ---------------- |
| `DATABASE_URL` | **Transaction pooler** | `6543` | the running API  |
| `DIRECT_URL`   | **Direct connection**  | `5432` | `prisma migrate` |

Append `?pgbouncer=true` to the `DATABASE_URL` value. Prisma needs to be told it is talking to
a pooler, or it will try to use prepared statements the pooler cannot hold.

The split is not optional. The transaction pooler gives a new connection per statement, and
Prisma migrations need a session that lives across statements; pointing migrations at port
6543 fails with a confusing advisory-lock error.

> **If the direct connection will not connect, use the Session pooler string instead.**
> Supabase's direct connection is IPv6-only. Plenty of home networks, CI runners and hosting
> platforms are IPv4-only, and the failure looks like an unreachable host rather than an
> address-family problem. The **Session pooler** tab gives an IPv4-reachable string on the
> same port 5432 that holds a session, which is what migrations actually need.

Replace `[YOUR-PASSWORD]` in both with the password from step 3.

These strings are live credentials. They belong in `apps/api/.env`, which is gitignored —
never in a commit, a screenshot, or a chat message.

### Verify

```bash
cd apps/api
cp .env.example .env      # then paste both URLs into .env
pnpm prisma:generate
pnpm prisma:deploy
```

`prisma:deploy` should report that migrations were applied. Confirm in the dashboard under **Database → Tables**.

---

## 2. Supabase — storage bucket

Needed by `add-file-management`. Set it up now so the credentials are in place.

1. **Storage** in the left sidebar → **New bucket**. Name it `data-room-files`.
2. Leave it **private** — that is the default, and it is the right one. The API issues
   short-lived signed URLs for every read; a public bucket would make every document
   readable by anyone who guesses a key, which defeats the entire product.
3. Set the bucket's own limits while you are there, if the create dialog offers them
   (otherwise open the bucket's settings afterwards):
   - **Allowed MIME types**: `application/pdf`
   - **File size limit**: `50MB`

   These duplicate checks the API already makes, deliberately. Storage is the last line: a
   bug in the commit-time validation cannot land a 2 GB executable in the bucket if the
   bucket itself refuses it.

4. **Settings → API Keys**, or the **Server** tab of the **Connect** dialog, and copy:
   - the **Project URL** → `SUPABASE_URL`
   - the **secret key**, starting `sb_secret_` → `SUPABASE_SECRET_KEY`

   Supabase renamed these: what older documentation calls the `service_role` key is now the
   **secret key**. The **publishable** key (`sb_publishable_`) is the old `anon` key and is
   not what we want — it is deliberately safe to expose, which is the opposite of what the
   API needs in order to mint signed upload URLs.

> The secret key bypasses every access rule. It is server-side only. It must never appear in
> `apps/web`, in a `NEXT_PUBLIC_*` variable, or in a commit. If it ever leaks, rotate it in
> the dashboard immediately.

### There is no CORS to configure

Supabase's hosted Storage does not expose any CORS setting, per bucket or per project — it
responds with a permissive origin by default. If you go looking for one you will not find it,
and nothing is wrong.

This is worth stating because it differs from S3 and R2, where a bucket CORS policy is a
required step for browser uploads. Here the browser can PUT to a signed upload URL with no
configuration at all. If a direct upload ever does fail with what looks like a CORS error, the
cause is elsewhere — an expired signed URL, or a wrong content type — not a missing policy.

## 3. Deploy the API

Railway and Render both work. Railway is quicker; Render's free tier sleeps and gives a reviewer a cold first request. Either is fine — pick one and note it in the README.

### Railway

1. <https://railway.app> → **New Project → Deploy from GitHub repo** → pick `Data-Room`.
2. **Settings → Root Directory**: leave at the repository root. This is a pnpm workspace, so
   the build must run from the top, and `railpack.json` in the repo root already describes
   the whole build.
3. **Build and start commands** — set both in **Settings → Build** and
   **Settings → Deploy**:

   ```
   Build:  pnpm install --frozen-lockfile && pnpm --filter @data-room/shared build && pnpm --filter @data-room/api prisma:generate && pnpm --filter @data-room/api build
   Start:  pnpm --filter @data-room/api prisma:deploy && pnpm --filter @data-room/api start
   ```

   The start command runs migrations before booting, which keeps the schema and the deployed
   code in step. A baseline migration is committed at `apps/api/prisma/migrations/0_init`
   precisely so this works from the first deploy: `prisma migrate deploy` **fails** when the
   migrations directory is empty, and because the commands are chained with `&&`, that
   failure takes the server down with it — the service reports active and every request
   returns 502.

   Setting them here overrides Railpack's inference, which is what you want: auto-detection
   sees a workspace with two applications and cannot know that this service builds only the
   API. Running migrations in the start command keeps the schema and the deployed code in
   step.

   Note this deploys **the API only**. The web app goes to Vercel in step 4 — one service
   cannot start both.

   > A committed `railpack.json` is the more reviewable alternative and was tried here first.
   > It is easy to get wrong in a way that produces a misleading error: a Railpack step
   > declares the filesystem it operates on, so overriding the `install` step also replaces
   > the part that copies `package.json` into the layer, and the build fails with
   > `[ERR_PNPM_NO_PKG_MANIFEST] No package.json found in /app` — which reads as a missing
   > file rather than a step that was never handed one. If you do reintroduce the file,
   > override only the `commands` of steps you need to change and leave `install` alone.

4. **Deploy from the `main` branch.** Railway defaults to it. Make sure the code has actually
   been merged there: a branch-per-task-group workflow leaves `main` holding nothing but the
   specification, and Railpack then reports the same "could not determine how to build"
   error because there is genuinely no application in the tree it was given.

5. **Variables** — add every one of these. The API refuses to boot if any is missing, which
   is deliberate: a half-configured deploy should fail loudly, not serve confusing errors.

   | Variable              | Value                                       |
   | --------------------- | ------------------------------------------- |
   | `NODE_ENV`            | `production`                                |
   | `DATABASE_URL`        | pooled string from step 1                   |
   | `DIRECT_URL`          | direct or session-pooler string from step 1 |
   | `SUPABASE_URL`        | from step 2                                 |
   | `SUPABASE_SECRET_KEY` | from step 2                                 |
   | `SUPABASE_BUCKET`     | `data-room-files`                           |
   | `WEB_APP_URL`         | _fill in after step 4_                      |
   | `CORS_ORIGINS`        | _fill in after step 4_                      |
   | `COOKIE_SECURE`       | `true`                                      |
   | `COOKIE_SAMESITE`     | `none`                                      |

   Leave `PORT` unset — Railway injects it, and the env schema defaults it otherwise.

   The three storage variables are safe to set now and are simply ignored: the env schema
   drops keys it does not declare, and nothing reads them until `add-file-management` lands.
   Only `DATABASE_URL` and `DIRECT_URL` are required for the API to boot today.

   `COOKIE_SECURE=true` and `COOKIE_SAMESITE=none` are what make the session work across two
   different sites. They require HTTPS on both, which both platforms give you.

6. **Settings → Networking → Generate Domain**. Copy the URL — this is your API URL.

### Verify

```bash
curl https://YOUR-API-URL/api/health
```

Expect `{"status":"ok","database":"up"}`. If you get `"database":"down"`, the connection string is wrong — the service is up, which is the point of that endpoint.

---

## 4. Deploy the web app

1. <https://vercel.com/new> → import `Data-Room`.
2. **Root Directory**: `apps/web`. Tick **Include files outside the root directory** — the app depends on `packages/shared`.
3. **Framework preset**: Next.js. Leave the build command as the default.
4. **Environment variable**:

   | Variable              | Value                      |
   | --------------------- | -------------------------- |
   | `NEXT_PUBLIC_API_URL` | `https://YOUR-API-URL/api` |

   Note the `/api` suffix — the server mounts everything under that prefix.

5. Deploy, then copy the production URL.

### Close the loop

Go back to the API host and set the two variables you left blank:

- `WEB_APP_URL` = `https://YOUR-VERCEL-URL`
- `CORS_ORIGINS` = `https://YOUR-VERCEL-URL`

Redeploy the API. Until you do this, the browser will refuse every request as a CORS failure.

---

## 5. Verify the deployed pair

This is the step that catches the mistakes the earlier ones hide.

1. Open the Vercel URL. The page should render, not spin.
2. Open the browser devtools **Network** tab and reload. Requests to the API should return 200, not a CORS error.
3. Once `add-authentication` is deployed: sign in, then **reload the page**. Staying signed in after a reload is what proves the cross-site cookie actually works. This is the single most likely thing to be broken, and it always looks like a login bug rather than a cookie bug.
4. Try it in Safari as well as Chrome. Safari's tracking prevention is stricter about cross-site cookies, and a reviewer may well use it.

---

## 6. Record the URLs

Put both in the README's **Hosted URLs** table, and tick tasks 7.2–7.6 in `openspec/changes/add-project-foundation/tasks.md`.

---

## When something breaks

| Symptom                                          | Cause                                                                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| API exits at boot, logs a variable name          | That variable is missing. It is meant to fail this way.                                                                     |
| `/health` says `"database":"down"`               | `DATABASE_URL` is wrong, or the Supabase project is paused. Free projects pause when idle — open the dashboard to wake it.  |
| Migrations hang or fail on an advisory lock      | `DIRECT_URL` is pointing at port 6543. Migrations need 5432.                                                                |
| Browser shows a CORS error                       | `CORS_ORIGINS` does not exactly match the Vercel origin. No trailing slash, and the scheme must match.                      |
| Login succeeds, next request is anonymous        | The cookie was dropped. Check `COOKIE_SECURE=true` and `COOKIE_SAMESITE=none` in production, and that both sides are HTTPS. |
| Upload fails with an opaque network error        | Bucket CORS is not configured for the web origin.                                                                           |
| Everything works locally, nothing works deployed | Almost always `NEXT_PUBLIC_API_URL` missing its `/api` suffix.                                                              |

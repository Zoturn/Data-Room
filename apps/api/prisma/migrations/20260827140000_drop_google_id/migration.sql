-- Google sign-in was specified and never built: the task asks for Google *or* email and
-- password, and email and password is what shipped. The column and its unique index were
-- carried for a provider that has no callback, no route and no code reading them.
--
-- Dropped rather than left in place because an always-null unique index is a promise the
-- schema makes and nothing keeps. Re-adding it is one additive migration on the day a
-- provider actually exists, and no row has ever held a value to lose.
DROP INDEX IF EXISTS "users_google_id_key";

ALTER TABLE "users" DROP COLUMN IF EXISTS "google_id";

-- Absolute session lifetime.
--
-- The refresh TTL is an idle timeout: every rotation pushes expiry forward, so a session used
-- regularly never ends — and neither does a stolen token rotated regularly by someone else.
-- family_started_at is the fixed point that lets rotation cap a successor's expiry at
-- "when this sign-in happened, plus a maximum".
--
-- Existing rows are backfilled from created_at: for a token that has never rotated they are
-- the same instant, and for one that has, created_at is the closest available lower bound. It
-- can only shorten a live session, never extend one, which is the safe direction.

ALTER TABLE "refresh_tokens" ADD COLUMN "family_started_at" TIMESTAMP(3);

UPDATE "refresh_tokens" SET "family_started_at" = "created_at" WHERE "family_started_at" IS NULL;

ALTER TABLE "refresh_tokens" ALTER COLUMN "family_started_at" SET NOT NULL;

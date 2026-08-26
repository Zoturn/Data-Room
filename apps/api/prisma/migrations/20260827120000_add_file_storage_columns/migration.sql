-- What a file row carries on top of a tree node: where its bytes live, what they are served
-- as, and whether they have arrived yet.
--
-- Additive and nullable, so every existing folder row is untouched and no backfill runs. No
-- FILE row exists yet — files arrive with this change — which is why the check constraint
-- below can be added without first repairing anything.
--
-- Rollback is `ALTER TABLE "nodes" DROP CONSTRAINT "nodes_storage_columns_match_type",
-- DROP COLUMN "upload_state", DROP COLUMN "checksum", DROP COLUMN "content_type",
-- DROP COLUMN "storage_key"; DROP INDEX "nodes_pending_upload_idx"; DROP TYPE "upload_state";`.

-- CreateEnum
CREATE TYPE "upload_state" AS ENUM ('PENDING', 'READY');

-- AlterTable
ALTER TABLE "nodes"
    ADD COLUMN "storage_key" TEXT,
    ADD COLUMN "content_type" TEXT,
    ADD COLUMN "checksum" TEXT,
    ADD COLUMN "upload_state" "upload_state";

-- CreateIndex
-- The sweep's only query: the oldest reservations past their window. Partial, so the index
-- holds just the handful of rows that are mid-upload rather than an entry per file in the
-- system — and it stays that size however many files accumulate, because a row leaves the
-- index the moment it commits.
--
-- Prisma has no syntax for a partial index, so it is declared here and not in schema.prisma.
-- Do not "fix" the resulting drift by dropping it.
CREATE INDEX "nodes_pending_upload_idx" ON "nodes" ("created_at") WHERE "upload_state" = 'PENDING';

-- AddCheckConstraint
-- The storage columns belong to files and to nothing else. A folder with a storage key would
-- be a folder the blob release path deletes bytes for; a file without one is a row the commit
-- path and the sweep can both see and neither can finish. Both are unreachable through the
-- application — this is what keeps them unreachable through a migration, a backfill or a
-- console session too.
--
-- Prisma cannot express a check constraint either; same drift note as above applies.
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_storage_columns_match_type" CHECK (
    ("type" = 'FILE'
        AND "storage_key" IS NOT NULL
        AND "upload_state" IS NOT NULL)
    OR
    ("type" = 'FOLDER'
        AND "storage_key" IS NULL
        AND "content_type" IS NULL
        AND "checksum" IS NULL
        AND "upload_state" IS NULL)
);

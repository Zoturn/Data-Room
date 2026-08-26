-- The Data Room and the tree inside it.
--
-- Additive: `users` and `refresh_tokens` already exist and are not touched. No backfill —
-- both tables are new, and existing users are provisioned lazily on their next request.
--
-- Rollback is `DROP TABLE "nodes"; DROP TABLE "data_rooms"; DROP TYPE "node_type";`.

-- CreateEnum
CREATE TYPE "node_type" AS ENUM ('FOLDER', 'FILE');

-- CreateTable
CREATE TABLE "data_rooms" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nodes" (
    "id" UUID NOT NULL,
    "data_room_id" UUID NOT NULL,
    "parent_id" UUID,
    "type" "node_type" NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,
    "size_bytes" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One Data Room per owner. This is also the concurrency control for provisioning: two
-- simultaneous first requests race here, one inserts and the other reads the winner's row.
CREATE UNIQUE INDEX "data_rooms_owner_id_key" ON "data_rooms"("owner_id");

-- CreateIndex
CREATE INDEX "nodes_data_room_id_path_idx" ON "nodes"("data_room_id", "path");

-- CreateIndex
CREATE INDEX "nodes_parent_id_type_name_id_idx" ON "nodes"("parent_id", "type", "name", "id");

-- CreateIndex
-- Sibling names, unique after normalisation. The application catches this violation and maps
-- it to 409 NAME_CONFLICT; nothing checks for a duplicate before inserting, because two
-- concurrent requests would both pass such a check.
CREATE UNIQUE INDEX "nodes_parent_id_normalized_name_key" ON "nodes"("parent_id", "normalized_name");

-- CreateIndex
-- Subtree scans are `path LIKE '/a/b/%'`. Under any non-C collation the default btree above
-- cannot serve a LIKE prefix, so the planner would fall back to a sequential scan over every
-- node in the room. text_pattern_ops compares character by character, which is exactly what a
-- prefix match needs — and the path is a chain of UUIDs, so the pattern can never contain a
-- `%` or `_` that would reach beyond the intended subtree.
--
-- Prisma has no syntax for an operator class, so this index is declared here and not in
-- schema.prisma. Do not "fix" the resulting drift by dropping it.
CREATE INDEX "nodes_data_room_path_prefix_idx" ON "nodes" ("data_room_id", "path" text_pattern_ops);

-- AddForeignKey
ALTER TABLE "data_rooms" ADD CONSTRAINT "data_rooms_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_data_room_id_fkey" FOREIGN KEY ("data_room_id") REFERENCES "data_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- Cascade is the safety net, not the delete path: recursive delete is one statement over the
-- path prefix, so the storage keys of the files being removed can be collected first.
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

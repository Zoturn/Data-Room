-- Shares and their named recipients.
--
-- Additive: two new tables and two new enums. Nothing existing is altered, no backfill runs,
-- and no node, file or user row is touched — a Data Room that has never been shared is
-- byte-for-byte what it was before this ran.
--
-- Rollback is `DROP TABLE "share_grants"; DROP TABLE "shares";
-- DROP TYPE "share_role"; DROP TYPE "share_mode";`.

-- CreateEnum
CREATE TYPE "share_mode" AS ENUM ('PUBLIC_LINK', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "share_role" AS ENUM ('VIEWER');

-- CreateTable
CREATE TABLE "shares" (
    "id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "mode" "share_mode" NOT NULL,
    "role" "share_role" NOT NULL DEFAULT 'VIEWER',
    -- SHA-256 of the token and never the token itself, exactly as `refresh_tokens` stores its
    -- credential. The plaintext lives in the link the owner copied; a dump of this table — or
    -- a support query someone runs against it — hands out no working link.
    "token_hash" TEXT,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_grants" (
    "id" UUID NOT NULL,
    "share_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "user_id" UUID,
    "accepted_at" TIMESTAMP(3),

    CONSTRAINT "share_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Token lookup is a point read on this index, so resolution costs one probe whatever the
-- table holds. Nullable: a RESTRICTED share has no link, and Postgres treats nulls as
-- distinct, so any number of them coexist under a unique index.
CREATE UNIQUE INDEX "shares_token_hash_key" ON "shares"("token_hash");

-- CreateIndex
-- Resolution's other query: candidate shares for a node id and every ancestor id taken from
-- `nodes.path`, in one `IN` rather than a lookup per level.
CREATE INDEX "shares_node_id_idx" ON "shares"("node_id");

-- CreateIndex
-- Inviting the same address twice is the same grant. Enforced here rather than by a
-- read-then-write check, which two concurrent invitations would both pass.
CREATE UNIQUE INDEX "share_grants_share_id_email_key" ON "share_grants"("share_id", "email");

-- CreateIndex
-- Binding outstanding grants when that address registers or signs in. Emails are stored
-- already lower-cased, so this plain btree serves the match — a `lower(email)` expression
-- index would only be needed if the column kept the case it was typed in.
CREATE INDEX "share_grants_email_idx" ON "share_grants"("email");

-- CreateIndex
-- The reverse lookup: everything shared with one account, once its grants have bound.
CREATE INDEX "share_grants_user_id_idx" ON "share_grants"("user_id");

-- AddForeignKey
-- Cascade is the revocation path, not just a safety net: deleting a shared node must end its
-- shares, and doing it in the database means no code path can forget. Content is never
-- deleted the other way round — revoking a share writes `revoked_at` and touches no node.
ALTER TABLE "shares" ADD CONSTRAINT "shares_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_grants" ADD CONSTRAINT "share_grants_share_id_fkey" FOREIGN KEY ("share_id") REFERENCES "shares"("id") ON DELETE CASCADE ON UPDATE CASCADE;

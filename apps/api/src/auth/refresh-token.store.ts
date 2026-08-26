import { Injectable } from "@nestjs/common";
import { Prisma, type RefreshToken as RefreshTokenRow } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RefreshTokenAlreadyRotatedError } from "./auth.errors";
import { RefreshTokenStore, type NewRefreshToken, type RefreshTokenRecord } from "./token.service";

/** Prisma's code for a unique constraint violation. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Rows are mapped field by field rather than handed back as they arrive, so the port's shape
 * is the only thing that ever leaves this file. A column added to the model later cannot
 * reach a caller — or a log line — until someone lists it here.
 */
function toRecord(row: RefreshTokenRow): RefreshTokenRecord {
  return {
    id: row.id,
    userId: row.userId,
    familyId: row.familyId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    replacedById: row.replacedById,
    createdAt: row.createdAt,
    familyStartedAt: row.familyStartedAt,
  };
}

/**
 * The Prisma-backed `RefreshTokenStore`.
 *
 * Only the SHA-256 hash of a token is ever written. The plaintext exists in the client's
 * cookie and nowhere else, so a dumped database yields no usable session — and because
 * neither `NewRefreshToken` nor `RefreshTokenRecord` carries a plaintext field, that is a
 * property of the types rather than a convention to remember. Nothing here logs: a hash is
 * still credential material once it has been copied into a log aggregator.
 */
@Injectable()
export class PrismaRefreshTokenStore extends RefreshTokenStore {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  override async findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    return row === null ? null : toRecord(row);
  }

  override async findById(id: string): Promise<RefreshTokenRecord | null> {
    const row = await this.prisma.refreshToken.findUnique({ where: { id } });
    return row === null ? null : toRecord(row);
  }

  override async create(token: NewRefreshToken): Promise<RefreshTokenRecord> {
    const row = await this.prisma.refreshToken.create({
      // Columns are listed one by one rather than spread from the input, so a field added to
      // NewRefreshToken later cannot reach a column without someone deciding that it should.
      data: {
        userId: token.userId,
        familyId: token.familyId,
        tokenHash: token.tokenHash,
        expiresAt: token.expiresAt,
        familyStartedAt: token.familyStartedAt,
      },
    });
    return toRecord(row);
  }

  /**
   * Insert the successor and spend the predecessor as one unit.
   *
   * The service reads the presented token and then asks for this write, and those are two
   * statements, so two requests arriving with the same cookie can both read an unrotated
   * token and both arrive here. What separates them is the `replacedById: null` in the WHERE
   * clause, not the read that happened earlier:
   *
   * 1. Both transactions insert their own successor — different generated ids, no conflict.
   * 2. Both then UPDATE the same predecessor row. Postgres takes a row lock, so the second
   *    one waits rather than proceeding from its stale snapshot.
   * 3. The winner commits `replaced_by_id = <its successor>`. At READ COMMITTED the waiter
   *    re-evaluates its WHERE against the row version that just committed, where
   *    `replaced_by_id IS NULL` no longer holds, so it matches zero rows.
   * 4. Zero rows means this request lost the race. Throwing here aborts the transaction,
   *    which takes the loser's orphan successor with it — that is precisely why the insert
   *    shares a transaction with the update, and why a crash between the two can leave
   *    neither a spent token that still works nor a successor with no ancestor.
   *
   * `TokenService.rotate` catches the resulting error, re-reads, and lets the grace window
   * decide whether this was the client's own parallel retry or a replay of a stolen token.
   *
   * The unique index on `replaced_by_id` is a second line of defence rather than the
   * detector: both writers aim at the same row, so the guard in the WHERE fires first. The
   * index is what stops two different predecessors from ever claiming one successor, and a
   * violation of it is reported as the same error.
   *
   * A predecessor that no longer exists also matches zero rows. Reporting that as "already
   * rotated" is right for the caller: it re-reads by hash, finds nothing, and rejects.
   */
  override async rotate(
    predecessorId: string,
    successor: NewRefreshToken,
    rotatedAt: Date,
  ): Promise<RefreshTokenRecord> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.refreshToken.create({
        data: {
          userId: successor.userId,
          familyId: successor.familyId,
          tokenHash: successor.tokenHash,
          expiresAt: successor.expiresAt,
          familyStartedAt: successor.familyStartedAt,
        },
      });

      const linked = await this.link(tx, predecessorId, row.id, rotatedAt);
      if (linked === 0) throw new RefreshTokenAlreadyRotatedError();

      return toRecord(row);
    });
  }

  /**
   * Kill a family: logout, and the blunt instrument reuse detection reaches for.
   *
   * `familyId` alone scopes the write — no user-wide or age-based predicate — so revoking
   * one session can never reach a sibling session the same user still wants. The
   * `revokedAt: null` guard preserves the timestamps already sitting on rotated rows, since
   * the service measures its grace window from them and overwriting one would silently move
   * that window. Together the two make the call idempotent: run it again and it matches
   * nothing, updates nothing, and still returns normally.
   */
  override async revokeFamily(familyId: string, revokedAt: Date): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt },
    });
  }

  /**
   * Delete tokens that are past their expiry, returning how many went.
   *
   * An expired row is already refused by the service, so this reclaims space rather than
   * enforcing anything — which is what makes it safe on a timer. It is one DELETE over a
   * predicate: a second run finds nothing, and a run overlapping another simply deletes
   * fewer rows. Neither can fail because of the other.
   *
   * Deliberately not part of `RefreshTokenStore`: that port describes what the token service
   * needs, and housekeeping is not part of it. A scheduled sweeper injects this class.
   *
   * The predicate is on `expires_at` alone, which the `(user_id, expires_at)` index cannot
   * serve; at this table's size that is a cheap scan, and a dedicated index is the answer if
   * it ever stops being one.
   */
  async deleteExpired(asOf: Date = new Date()): Promise<number> {
    const deleted = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lte: asOf } },
    });
    return deleted.count;
  }

  /** Spend the predecessor, but only while it is still unspent. Returns the rows matched. */
  private async link(
    tx: Prisma.TransactionClient,
    predecessorId: string,
    successorId: string,
    rotatedAt: Date,
  ): Promise<number> {
    try {
      const result = await tx.refreshToken.updateMany({
        where: { id: predecessorId, replacedById: null },
        data: { replacedById: successorId, revokedAt: rotatedAt },
      });
      return result.count;
    } catch (error) {
      // Narrowed to this one statement on purpose. A unique violation raised by the insert
      // above would be a token hash collision — a different and far stranger problem — and
      // dressing that up as a lost rotation race would send the caller down the grace-window
      // path holding a token nobody has ever seen.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        return 0;
      }
      throw error;
    }
  }
}

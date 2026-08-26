import { Injectable, Logger } from "@nestjs/common";
import {
  FILE_SIZE_MAX_BYTES,
  type ContentUrl,
  type FileDetail,
  type MoveInput,
  type NodeSummary,
  type RenameInput,
  type UploadIntent,
  type UploadIntentInput,
} from "@data-room/shared";
import type { AuthUser } from "../auth/jwt-auth.guard";
import { NotFoundError } from "../common/errors/domain-error";
import { ConfigService } from "../config/config.service";
import { StorageService } from "../storage/storage.service";
import { subtreePrefixOf, toNodeSummary } from "../folders/folders.repository";
import { BlobReleaseService } from "./blob-release.service";
import { applyStemRename } from "./file-name";
import { FilesRepository, type FileRecord } from "./files.repository";
import {
  FileTooLargeError,
  InvalidMoveTargetError,
  UnsupportedFileTypeError,
  UploadExpiredError,
} from "./files.errors";
import { hasPdfSignature, isPdfContentType, PDF_MAGIC_BYTES } from "./pdf-signature";

/**
 * Files, as the product talks about them: reserve a name, commit the bytes, open, rename,
 * move and delete.
 *
 * Every method starts by resolving the file **for this caller**, and a file the caller does
 * not own resolves to nothing — so an unauthorised request follows exactly the same path as a
 * request for something that never existed, and both answer 404. A `PENDING` reservation is
 * equally invisible: it is a held name, not a file.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly files: FilesRepository,
    private readonly storage: StorageService,
    private readonly blobs: BlobReleaseService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Step one of three. The name is resolved and the node reserved **before** a single byte
   * exists, because the reservation is what holds the name: two simultaneous uploads of
   * `report.pdf` are arbitrated here by the unique index, not after both have spent bandwidth.
   */
  async createUploadIntent(user: AuthUser, input: UploadIntentInput): Promise<UploadIntent> {
    const parent = await this.requireFolder(user, input.parentId);

    // The declared size is a client claim, so this is an early courtesy rather than the
    // enforcement — commit re-checks what storage actually holds, which is the number that
    // cannot be wrong (file-upload-storage.md rule 6).
    if (input.sizeBytes > FILE_SIZE_MAX_BYTES) throw new FileTooLargeError(FILE_SIZE_MAX_BYTES);

    const reserved = await this.files.reserveFile(
      parent,
      input.name,
      input.contentType,
      input.sizeBytes,
    );

    try {
      const signed = await this.storage.createUploadUrl(
        reserved.storageKey,
        input.contentType,
        this.config.get("UPLOAD_URL_TTL_SECONDS"),
      );

      return {
        nodeId: reserved.id,
        uploadUrl: signed.url,
        resolvedName: reserved.name,
        expiresAt: signed.expiresAt.toISOString(),
      };
    } catch (error) {
      // Without this the name stays reserved until the sweep for an upload that can never
      // happen — the client has no URL to send bytes to.
      await this.discardReservation(reserved);
      throw error;
    }
  }

  /**
   * Step three. Everything decided here comes from the stored object, never from the request:
   * the request body is empty on purpose.
   *
   * Any rejection takes the reservation and the object with it, so a file that cannot be
   * validated leaves nothing behind — not a held name, and not a stray blob.
   */
  async commitUpload(user: AuthUser, fileId: string): Promise<NodeSummary> {
    const reservation = await this.files.findReservationForOwner(fileId, user.id);

    // One answer for "never existed", "someone else's", and "already committed". Committing
    // twice is not a partial success to be reported, and distinguishing the three would tell a
    // prober which of them applied.
    if (reservation === null) throw new UploadExpiredError();

    const storageKey = reservation.storageKey;
    if (storageKey === null) {
      // A FILE row without a key cannot be committed and cannot be swept by key either. The
      // check constraint makes this unreachable; leaving it un-handled would make it a 500.
      await this.files.deleteReservation(reservation.id);
      throw new UploadExpiredError();
    }

    if (this.hasExpired(reservation.createdAt)) {
      await this.discardReservation({ ...reservation, storageKey });
      throw new UploadExpiredError();
    }

    const stat = await this.storage.statObject(storageKey);

    // No object means the PUT never happened or never finished. The reservation is over
    // either way; the client requests a fresh intent rather than retrying this id.
    if (stat === null) {
      await this.discardReservation({ ...reservation, storageKey });
      throw new UploadExpiredError();
    }

    if (stat.sizeBytes > FILE_SIZE_MAX_BYTES) {
      await this.discardReservation({ ...reservation, storageKey });
      throw new FileTooLargeError(FILE_SIZE_MAX_BYTES);
    }

    // Two separate questions, and both have to be answered here.
    //
    // The bytes decide whether this *is* a PDF. The stored content type decides what a
    // browser will do with it, and that header is set by the PUT — not by the intent, which
    // the signing endpoint does not carry a type on. Without this check an owner can send
    // `Content-Type: text/html` with `%PDF-` as the first five bytes: the signature passes,
    // the row commits, and `/files/:id/content-url` then hands out a URL that serves attacker
    // HTML from the storage origin — reachable from the viewer's own "Open in a new tab".
    // The bucket's allowed-MIME setting would also stop it, but that is ops configuration
    // this process cannot verify, so it is the backstop and this is the enforcement.
    if (!isPdfContentType(stat.contentType)) {
      await this.discardReservation({ ...reservation, storageKey });
      throw new UnsupportedFileTypeError();
    }

    const head = await this.storage.readRange(storageKey, PDF_MAGIC_BYTES.length);

    if (!hasPdfSignature(head)) {
      await this.discardReservation({ ...reservation, storageKey });
      throw new UnsupportedFileTypeError();
    }

    const committed = await this.files.markReady(reservation.id, stat.sizeBytes, null);

    // Zero rows updated: the sweep expired this reservation while its bytes were being
    // checked. The object is now unreferenced, so it goes with it.
    if (committed === null) {
      await this.blobs.release(storageKey);
      throw new UploadExpiredError();
    }

    return committed;
  }

  async getFile(user: AuthUser, fileId: string): Promise<FileDetail> {
    const file = await this.requireFile(user, fileId);
    const breadcrumbs = await this.files.breadcrumbsFor(file);

    return { file: toNodeSummary(file), breadcrumbs };
  }

  /**
   * The access check happens **before** the URL is minted, and that order is the whole
   * authorisation: a signed URL needs no cookie, so signing first and checking afterwards has
   * already handed out the file (file-upload-storage.md rule 9).
   */
  async getContentUrl(user: AuthUser, fileId: string): Promise<ContentUrl> {
    const file = await this.requireFile(user, fileId);

    if (file.storageKey === null) throw new NotFoundError("That file is no longer available.");
    const storageKey = file.storageKey;

    // Commit validated this object, but the signed *upload* URL that put it there outlives the
    // commit: its token is bound to a key and an expiry, not to a single use, and the provider
    // will overwrite on request — Supabase does, on `x-upsert`. So the sequence PUT a real
    // PDF, commit, then PUT `text/html` over the same URL leaves a `READY` row pointing at a
    // page, and the viewer's "Open in a new tab" loads it as a top-level document on the
    // storage origin. Every commit-time check is a time-of-check against this time-of-use.
    //
    // Re-reading the stored type here is the last moment the truth is knowable. It is the
    // served header rather than the bytes because the header is what decides whether the
    // browser renders or downloads — and a second range read on every view would cost a round
    // trip to learn something no attacker needs to change.
    const stat = await this.storage.statObject(storageKey);

    if (stat === null) throw new NotFoundError("That file is no longer available.");

    if (!isPdfContentType(stat.contentType)) {
      // Loud, because a committed row whose object is no longer a PDF is either an attack or
      // a bucket someone edited by hand. The object is left alone: refusing to sign it stops
      // the harm, and deleting on a read path would let one bad stat destroy a real document.
      this.logger.error(
        `File ${fileId} is stored as ${stat.contentType ?? "no content type"}; refusing to sign it.`,
      );
      throw new UnsupportedFileTypeError();
    }

    const signed = await this.storage.createDownloadUrl(
      storageKey,
      this.config.get("DOWNLOAD_URL_TTL_SECONDS"),
    );

    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }

  /**
   * The extension is not part of the editable name: a user cannot turn `report.pdf` into
   * `report.docx` and relabel bytes that did not change. A collision suffixes rather than
   * fails, so the caller reads the resolved name off the response.
   */
  async renameFile(user: AuthUser, fileId: string, input: RenameInput): Promise<NodeSummary> {
    const file = await this.requireFile(user, fileId);

    return this.files.renameFile(file, applyStemRename(file.name, input.name));
  }

  async moveFile(user: AuthUser, fileId: string, input: MoveInput): Promise<NodeSummary> {
    const file = await this.requireFile(user, fileId);
    const target = await this.files.findNodeForOwner(input.parentId, user.id);

    // A destination in someone else's Data Room, or none at all, is absent rather than
    // forbidden — the same 404 either way.
    if (target === null) throw new NotFoundError("That folder is no longer available.");

    // A destination in a *different* room of the caller's own is 404 too: the id is real to
    // them, but the move is not a thing that can happen, and the spec names 404 for it.
    if (target.dataRoomId !== file.dataRoomId) {
      throw new NotFoundError("That folder is no longer available.");
    }

    // A target the caller can plainly see and that is simply the wrong kind of thing. This is
    // the one move failure that is 400 rather than 404, because it leaks nothing.
    if (target.type !== "FOLDER") {
      throw new InvalidMoveTargetError("Files can only be moved into a folder.");
    }

    // Vacuous for a file, which contains nothing — but this is the check that stops a folder
    // move from re-parenting a folder inside itself and detaching the subtree from the root.
    if (target.id === file.id || target.path.startsWith(subtreePrefixOf(file))) {
      throw new InvalidMoveTargetError("A folder cannot be moved inside itself.");
    }

    return this.files.moveFile(file, target);
  }

  /**
   * The row goes transactionally; the object goes afterwards, best-effort. A storage outage
   * must never resurrect a file the owner has confirmed deleting.
   */
  async deleteFile(user: AuthUser, fileId: string): Promise<void> {
    const file = await this.requireFile(user, fileId);
    const releasedKey = await this.files.deleteFile(file.id);

    if (releasedKey !== null) await this.blobs.release(releasedKey);
  }

  /**
   * Undo a reservation completely: the row first, then the object.
   *
   * That order matters. Row-then-object can at worst leak an object the sweep already knows
   * how to find; object-then-row leaves a name reserved for bytes that no longer exist.
   */
  private async discardReservation(
    reservation: FileRecord & { storageKey: string },
  ): Promise<void> {
    const removed = await this.files.deleteReservation(reservation.id);

    if (!removed) {
      // Someone else got there first — the sweep, or a concurrent commit. Either way this
      // call no longer owns the object and must not delete bytes a `READY` row may point at.
      this.logger.warn(`Reservation ${reservation.id} was already gone; leaving its object alone.`);
      return;
    }

    await this.blobs.release(reservation.storageKey);
  }

  private hasExpired(createdAt: Date): boolean {
    const ttlMs = this.config.get("UPLOAD_RESERVATION_TTL_SECONDS") * 1000;

    return Date.now() - createdAt.getTime() > ttlMs;
  }

  /**
   * The one ownership decision for a committed file. Anything the caller does not own is
   * absent rather than forbidden, so there is a single place to be right about it.
   */
  private async requireFile(user: AuthUser, fileId: string): Promise<FileRecord> {
    const file = await this.files.findFileForOwner(fileId, user.id);

    if (file === null) throw new NotFoundError("That file is no longer available.");

    return file;
  }

  private async requireFolder(user: AuthUser, folderId: string): Promise<FileRecord> {
    const folder = await this.files.findFolderForOwner(folderId, user.id);

    if (folder === null) throw new NotFoundError("That folder is no longer available.");

    return folder;
  }
}

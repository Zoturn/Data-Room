import { Injectable } from "@nestjs/common";
import type {
  CreateFolderInput,
  DeletionPreview,
  FolderContents,
  NodeSummary,
  Page,
  PageQuery,
  RenameInput,
  SubtreeAggregate,
} from "@data-room/shared";
import type { AuthUser } from "../auth/jwt-auth.guard";
import { DomainError, NotFoundError, ValidationFailedError } from "../common/errors/domain-error";
import { BlobReleaseService } from "../files/blob-release.service";
import { FoldersRepository, toNodeSummary, type NodeRecord } from "./folders.repository";

/**
 * How deep a folder may sit below the root. Bounded so paths stay short, breadcrumbs stay
 * legible and a runaway client cannot build a chain nothing can render. The error names the
 * limit, because "too deep" without a number is not actionable.
 *
 * A constant rather than an environment variable for now: it is a product decision, and the
 * env schema is validated at boot in another module. Moving it there is a one-line change
 * the day it needs to differ between environments.
 */
export const MAX_FOLDER_DEPTH = 20;

/**
 * Nesting past the configured limit. Lives here rather than in `common/errors` because it is
 * this module's rule — see errors-and-validation.md rule 3.
 */
export class MaxDepthExceededError extends DomainError {
  readonly code = "MAX_DEPTH_EXCEEDED" as const;
  readonly status = 400;

  constructor(limit: number) {
    super(`Folders can only be nested ${limit} levels deep.`);
  }
}

/**
 * The tree, as the product talks about it: create in a parent, open, list, rename, preview a
 * deletion and carry it out.
 *
 * Every method starts by resolving the folder **for this caller**, and a folder the caller
 * does not own resolves to nothing — so an unauthorised request follows exactly the same path
 * as a request for something that never existed, and both answer 404. That equality is the
 * point: a distinct 403 would confirm the id is real.
 */
@Injectable()
export class FoldersService {
  constructor(
    private readonly tree: FoldersRepository,
    // Reached through the seam `FilesModule` exports rather than by talking to storage here:
    // deleting a folder is the one operation in this module that frees objects, and it must
    // free them the same way a file deletion does (nestjs-architecture.md rule 5).
    private readonly blobs: BlobReleaseService,
  ) {}

  async createFolder(user: AuthUser, input: CreateFolderInput): Promise<NodeSummary> {
    const parent = await this.requireFolder(user, input.parentId);

    if (parent.depth + 1 > MAX_FOLDER_DEPTH) throw new MaxDepthExceededError(MAX_FOLDER_DEPTH);

    // No duplicate-name check here on purpose: the unique index decides, and the repository
    // translates the violation. Two simultaneous creates of the same name therefore leave
    // exactly one winner, which a read-then-write check would not.
    return this.tree.createFolder(parent, input.name);
  }

  /**
   * Opening a folder: where you are, how you got there, and the first page of what is inside
   * — in one response, because an interface that renders a breadcrumb and a list from two
   * round trips shows one of them late.
   */
  async getContents(user: AuthUser, folderId: string, query: PageQuery): Promise<FolderContents> {
    const folder = await this.requireFolder(user, folderId);

    const [breadcrumbs, children] = await Promise.all([
      this.tree.breadcrumbsFor(folder),
      this.tree.listChildren(folder, query.limit, query.cursor),
    ]);

    return { folder: toNodeSummary(folder), breadcrumbs, children };
  }

  async listChildren(
    user: AuthUser,
    folderId: string,
    query: PageQuery,
  ): Promise<Page<NodeSummary>> {
    const folder = await this.requireFolder(user, folderId);

    return this.tree.listChildren(folder, query.limit, query.cursor);
  }

  async renameFolder(user: AuthUser, folderId: string, input: RenameInput): Promise<NodeSummary> {
    const folder = await this.requireFolder(user, folderId);

    // The root folder carries the Data Room's name, so renaming it is renaming the room.
    // Allowing it here as well would give one name two owners and let them disagree.
    if (folder.parentId === null) {
      throw new ValidationFailedError("Rename the Data Room to change this name.", [
        { field: "name", message: "The root folder is renamed through the Data Room." },
      ]);
    }

    return this.tree.renameNode(folder.id, input.name);
  }

  /**
   * The numbers the confirmation dialog states. It is the same query the deletion itself
   * spans, run at confirm time, so what the owner reads is what is about to disappear.
   */
  async deletionPreview(user: AuthUser, folderId: string): Promise<DeletionPreview> {
    return this.subtreeAggregate(user, folderId);
  }

  async subtreeAggregate(user: AuthUser, folderId: string): Promise<SubtreeAggregate> {
    const folder = await this.requireFolder(user, folderId);

    return this.tree.subtreeAggregate(folder);
  }

  /**
   * Deletes the folder and everything under it. There is no trash: the brief asks for delete
   * behind a warning, and the warning is `deletionPreview`.
   */
  async deleteFolder(user: AuthUser, folderId: string): Promise<void> {
    const folder = await this.requireFolder(user, folderId);

    // Deleting the root would leave a Data Room with no folder to open, which the interface
    // has no state for. Emptying it is a selection of its children.
    if (folder.parentId === null) {
      throw new ValidationFailedError("The Data Room root cannot be deleted.", [
        { field: "id", message: "Delete the folders inside it instead." },
      ]);
    }

    const releasedKeys = await this.tree.deleteSubtree(folder);

    // After the commit, never inside it: a storage outage must not roll back a deletion the
    // owner has already confirmed. `releaseAll` swallows failures onto the sweep's queue, so
    // this cannot throw — and until it runs, the bytes of every PDF under the folder are
    // still sitting in the bucket with no row left pointing at them.
    await this.blobs.releaseAll(releasedKeys);
  }

  /**
   * The one ownership decision in this module. Anything the caller does not own is absent
   * rather than forbidden, so there is a single place to be right about it.
   */
  private async requireFolder(user: AuthUser, folderId: string): Promise<NodeRecord> {
    const folder = await this.tree.findFolderForOwner(folderId, user.id);

    if (folder === null) throw new NotFoundError("That folder is no longer available.");

    return folder;
  }
}

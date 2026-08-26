/** Where a batch of dropped files is going, and what to call it on screen. */
export type UploadDestination = {
  readonly folderId: string;
  readonly folderName: string;
};

/**
 * The attributes a folder row publishes so a drop can land in it. The row cannot hand the
 * drop zone a callback — the zone wraps the listing and never sees a row's props — so the
 * destination travels as markup, and this is the one place that names it.
 */
export const FOLDER_DROP_ID_ATTRIBUTE = "data-folder-drop-id";
export const FOLDER_DROP_NAME_ATTRIBUTE = "data-folder-drop-name";
export const FOLDER_DROP_SELECTOR = `[${FOLDER_DROP_ID_ATTRIBUTE}]`;

/**
 * Resolves the two attributes found under the pointer into a destination.
 *
 * A row missing either half is treated as no row at all rather than as a half-known folder:
 * the highlight names where the files are going, and naming it wrongly is worse than falling
 * back to the folder the user already has open.
 */
export function destinationFromRow(
  folderId: string | null,
  folderName: string | null,
  fallback: UploadDestination,
): UploadDestination {
  if (folderId === null || folderId === "") return fallback;
  if (folderName === null || folderName === "") return fallback;

  return { folderId, folderName };
}

/**
 * Whether a drag is carrying files at all. Dragging selected text or a link across the
 * listing must not light up a target that would refuse whatever was dropped on it.
 */
export function isFileDrag(types: readonly string[] | undefined): boolean {
  return types?.includes("Files") ?? false;
}

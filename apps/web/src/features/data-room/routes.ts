/**
 * The open folder is a location, not component state: it lives in the URL so the back
 * button, a refresh and a pasted link all land in the same place — see
 * apps/web/.claude/rules/nextjs-app-router.md rule 5.
 *
 * Ids are encoded rather than interpolated. They are UUIDs today, but a helper that only
 * works for one alphabet is a trap for whoever changes the id scheme.
 */
export function folderHref(roomId: string, folderId: string): string {
  return `/rooms/${encodeURIComponent(roomId)}/folders/${encodeURIComponent(folderId)}`;
}

/** The Data Room's own address, which resolves to its root folder. */
export function roomHref(roomId: string): string {
  return `/rooms/${encodeURIComponent(roomId)}`;
}

/**
 * One file, open on its own page. A file is a location like a folder is — the viewer has to
 * survive a refresh and be linkable, and the room id keeps the address self-describing for
 * anyone reading it in a browser bar or a log.
 */
export function fileHref(roomId: string, fileId: string): string {
  return `/rooms/${encodeURIComponent(roomId)}/files/${encodeURIComponent(fileId)}`;
}

import { formatBytes, pluralise } from "@/features/data-room/format";
import { isUploadActive, type UploadItem } from "./queue";

/**
 * The one line of text a row shows under its name.
 *
 * A failed row shows the failure's own sentence, which was already written for a human by
 * `describeUploadFailure` — restating it here would give the same fault two wordings.
 */
export function describeUploadRow(item: UploadItem): string {
  switch (item.status) {
    case "queued":
      return `Waiting · ${formatBytes(item.sizeBytes)}`;
    case "reserving":
      return "Preparing…";
    case "sending":
      // The percentage and the size together, because a percentage alone says nothing about
      // whether the remaining half is one second or one minute away.
      return `${String(Math.round(item.progress * 100))}% of ${formatBytes(item.sizeBytes)}`;
    case "committing":
      return "Finishing…";
    case "done":
      return `Uploaded · ${formatBytes(item.sizeBytes)}`;
    case "cancelled":
      return "Cancelled";
    case "failed":
      return item.error ?? "Upload failed.";
  }
}

/**
 * What the file ended up called. A collision suffixes rather than rejects, so the row has to
 * say so — otherwise the user watches `report.pdf` upload and then cannot find it in the
 * listing, where it is now `report (2).pdf`.
 */
export function resolvedNameNote(item: UploadItem): string | null {
  if (item.resolvedName === null || item.resolvedName === item.name) return null;
  return `Saved as “${item.resolvedName}”`;
}

/** The panel's heading: what the queue as a whole is doing, in one phrase. */
export function summariseQueue(items: readonly UploadItem[]): string {
  const active = items.filter((item) => isUploadActive(item)).length;
  if (active > 0) return `Uploading ${String(active)} of ${pluralise(items.length, "file")}`;

  const failed = items.filter((item) => item.status === "failed").length;
  if (failed > 0) return `${pluralise(failed, "upload")} failed`;

  const cancelled = items.filter((item) => item.status === "cancelled").length;
  const done = items.filter((item) => item.status === "done").length;
  if (done > 0 && cancelled === 0) return `${pluralise(done, "file")} uploaded`;
  if (done > 0) return `${pluralise(done, "file")} uploaded · ${String(cancelled)} cancelled`;

  return `${pluralise(cancelled, "upload")} cancelled`;
}

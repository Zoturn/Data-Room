import type { SubtreeAggregate } from "@data-room/shared";

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/**
 * Sizes as a person reads them: "2.3 GB", not "2469606195". The confirmation dialog states
 * how much is about to be lost, and a raw byte count states nothing.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const unit = BYTE_UNITS[unitIndex] ?? "B";
  // Whole bytes never want a decimal; above that, one digit separates 2.3 GB from 2.9 GB
  // and any more is noise.
  const rendered =
    unitIndex === 0 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/u, "");

  return `${rendered} ${unit}`;
}

export function pluralise(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

/**
 * The consequence sentence's middle, built from the server's own preview — "12 folders and
 * 143 files (2.3 GB)". `null` means the subtree is empty, which the caller states plainly
 * instead of alarming someone about nothing.
 */
export function describeSubtree(aggregate: SubtreeAggregate): string | null {
  const parts: string[] = [];

  if (aggregate.folders > 0) parts.push(pluralise(aggregate.folders, "folder"));
  if (aggregate.files > 0) {
    parts.push(`${pluralise(aggregate.files, "file")} (${formatBytes(aggregate.bytes)})`);
  }

  return parts.length === 0 ? null : parts.join(" and ");
}

/** The header stat line, where zeroes are informative rather than alarming. */
export function summariseAggregate(aggregate: SubtreeAggregate): string {
  return [
    pluralise(aggregate.folders, "folder"),
    pluralise(aggregate.files, "file"),
    formatBytes(aggregate.bytes),
  ].join(" · ");
}

/** Built once and reused: a folder listing formats one of these per row. */
let relativeTimeFormat: Intl.RelativeTimeFormat | null = null;

function relativeFormat(): Intl.RelativeTimeFormat {
  relativeTimeFormat ??= new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  return relativeTimeFormat;
}

const RELATIVE_UNITS: ReadonlyArray<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: "week", ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: "day", ms: 24 * 60 * 60 * 1000 },
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
];

/**
 * "3 hours ago" tells someone whether a folder changed while they were away; a timestamp
 * makes them do the arithmetic. The exact time is still one hover away — see
 * `formatExactTime`, which the row renders as the cell's title.
 */
export function formatUpdatedAt(iso: string, now: Date = new Date()): string {
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return "";

  const difference = moment.getTime() - now.getTime();
  const distance = Math.abs(difference);

  for (const { unit, ms } of RELATIVE_UNITS) {
    if (distance >= ms) return relativeFormat().format(Math.round(difference / ms), unit);
  }

  return "just now";
}

let exactTimeFormat: Intl.DateTimeFormat | null = null;

/** The precise moment, for the row's `title` — one hover away from the relative wording. */
export function formatExactTime(iso: string): string {
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return "";

  exactTimeFormat ??= new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return exactTimeFormat.format(moment);
}

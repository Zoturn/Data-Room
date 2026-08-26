import { formatBytes } from "@/features/data-room/format";

/**
 * All the queue and the screening need from a chosen file. `File` satisfies it, and so does
 * a plain object — which is what lets both be exercised by Jest without a DOM.
 */
export type UploadSource = {
  readonly name: string;
  readonly size: number;
  readonly type: string;
};

export type UploadLimits = {
  readonly contentType: string;
  readonly maxBytes: number;
};

export type RejectionReason = "type" | "size" | "empty";

export type RejectedFile = {
  readonly name: string;
  readonly reason: RejectionReason;
  /** Names the rule that was broken, and the limit, so nobody has to guess it. */
  readonly message: string;
};

export type ScreenedFiles<TFile extends UploadSource> = {
  readonly accepted: readonly TFile[];
  readonly rejected: readonly RejectedFile[];
};

/**
 * A drag-and-drop of a folder full of documents can contain anything. Screening here means
 * a `.docx` is refused in the same instant it is dropped, before an upload URL is issued for
 * it — the server checks the same things again, and checks the bytes rather than the label,
 * because everything below is attacker-controlled.
 */
export function screenFiles<TFile extends UploadSource>(
  files: readonly TFile[],
  limits: UploadLimits,
): ScreenedFiles<TFile> {
  const accepted: TFile[] = [];
  const rejected: RejectedFile[] = [];

  for (const file of files) {
    const rejection = rejectionFor(file, limits);
    if (rejection === null) accepted.push(file);
    else rejected.push(rejection);
  }

  return { accepted, rejected };
}

function rejectionFor(file: UploadSource, limits: UploadLimits): RejectedFile | null {
  if (!looksLikePdf(file, limits.contentType)) {
    return {
      name: file.name,
      reason: "type",
      message: `“${file.name}” is not a PDF. This Data Room accepts PDF files only.`,
    };
  }

  if (file.size <= 0) {
    return {
      name: file.name,
      reason: "empty",
      message: `“${file.name}” is empty, so there is nothing to upload.`,
    };
  }

  if (file.size > limits.maxBytes) {
    return {
      name: file.name,
      reason: "size",
      message: `“${file.name}” is ${formatBytes(file.size)}. The largest file this Data Room accepts is ${formatBytes(limits.maxBytes)}.`,
    };
  }

  return null;
}

/**
 * The declared type is trusted for this first pass only. It is also frequently absent — a
 * drag from some file managers, and some Windows installs with no PDF handler registered,
 * hand over an empty `type` — so the extension is the fallback rather than the other way
 * around, and neither is what finally decides: the API sniffs the stored bytes at commit.
 */
function looksLikePdf(file: UploadSource, contentType: string): boolean {
  if (file.type === contentType) return true;
  return file.type === "" && file.name.toLowerCase().endsWith(".pdf");
}

/** The stem and the extension, split the way the rename dialog and the panel both read it. */
export function splitFileName(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf(".");
  // A leading dot is part of the name, not an extension: `.env` has no extension.
  if (dot <= 0 || dot === name.length - 1) return { stem: name, extension: "" };

  return { stem: name.slice(0, dot), extension: name.slice(dot) };
}

/**
 * Pairs a screened file with the canonical content type. The browser's guess is discarded
 * here on purpose: it is what the reservation declares and what the PUT sets, and the two
 * disagreeing is a rejection from storage that reads like a CORS fault and is not one.
 */
export function toUploadFile(file: File, limits: UploadLimits): UploadSource & { body: Blob } {
  return { name: file.name, size: file.size, type: limits.contentType, body: file };
}

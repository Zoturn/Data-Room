/**
 * The arithmetic behind file names: where the extension starts, what the next candidate name
 * is, and what a rename is allowed to change.
 *
 * Pure on purpose. The database arbitrates a race between two uploads of the same name, but
 * it does not decide what the next name should be — that decision is here, where it can be
 * tested against the spec's examples without a Postgres.
 */

/** A name split at its extension. `extension` carries its leading dot, or is empty. */
export type SplitName = {
  stem: string;
  extension: string;
};

/**
 * Splits at the **last** dot, and only when that dot has something on both sides.
 *
 * A leading dot names the file rather than describing its type, so `.gitignore` is all stem —
 * suffixing it as ` (1).gitignore` would invent a file called ` (1)`. A trailing dot is kept
 * in the stem for the same reason: an empty extension is not an extension.
 */
export function splitFileName(name: string): SplitName {
  const dot = name.lastIndexOf(".");

  if (dot <= 0 || dot === name.length - 1) return { stem: name, extension: "" };

  return { stem: name.slice(0, dot), extension: name.slice(dot) };
}

/**
 * The nth name in a collision family. Index 0 is the requested name itself, so a caller
 * probing upwards starts at 0 and the common "no conflict at all" case needs no special path.
 *
 * The counter goes before the extension — `report (1).pdf`, never `report.pdf (1)` — because
 * the extension is what tells a browser and an operating system what the bytes are. This is
 * the shape every desktop file manager produces, which is why it needs no explanation in the
 * interface.
 */
export function nthCandidateName(name: string, index: number): string {
  if (index === 0) return name;

  const { stem, extension } = splitFileName(name);

  return `${stem} (${index})${extension}`;
}

/**
 * The name a rename actually produces: the caller's text as the stem, with the file's
 * original extension re-attached.
 *
 * The extension is not part of the editable name. A user who submits `q4-report` keeps
 * `.pdf`, and a user who submits `q4-report.docx` gets `q4-report.docx.pdf` rather than a PDF
 * relabelled as a Word document — the bytes did not change, so neither may the type. The one
 * case that is not an addition is a submission that already ends in the original extension,
 * which is the dialog's own round trip and must not double it.
 */
export function applyStemRename(currentName: string, requestedName: string): string {
  const { extension } = splitFileName(currentName);

  if (extension === "") return requestedName;

  const alreadySuffixed =
    requestedName.length >= extension.length &&
    requestedName.slice(-extension.length).toLowerCase() === extension.toLowerCase();

  const stem = alreadySuffixed ? requestedName.slice(0, -extension.length) : requestedName;

  // `.pdf` submitted whole leaves nothing to be a stem. Returning the submission unchanged is
  // better than composing `.pdf.pdf`: it is a legal name, and zod already proved it non-empty.
  if (stem === "") return requestedName;

  return `${stem}${extension}`;
}

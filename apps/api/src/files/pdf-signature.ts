import { PDF_CONTENT_TYPE } from "@data-room/shared";

/**
 * What a commit is allowed to accept.
 *
 * A declared content type and a `.pdf` extension are both written by the client, so neither
 * can decide what was actually stored — see file-upload-storage.md rule 5. The bytes can, and
 * `hasPdfSignature` is that check.
 *
 * The stored object's own content type is checked as well, by `isPdfContentType`. It is not a
 * second opinion on what the file is: it is the header the provider will serve the bytes with,
 * and bytes that are a PDF served as `text/html` are a page, not a document.
 */

/** `%PDF-`, the header every PDF since 1.0 opens with. */
export const PDF_MAGIC_BYTES = Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0x2d);

/**
 * Compared byte by byte rather than by decoding to a string: the head of a binary file is
 * not necessarily valid UTF-8, and a lossy decode turns an unrelated file into one that
 * happens to start with the replacement character rather than one that is simply not a PDF.
 *
 * A short read is a rejection, not a crash — an object smaller than the signature cannot
 * contain it.
 */
export function hasPdfSignature(head: Uint8Array): boolean {
  if (head.length < PDF_MAGIC_BYTES.length) return false;

  return PDF_MAGIC_BYTES.every((byte, index) => head[index] === byte);
}

/**
 * Whether the *stored* object will be served as a PDF.
 *
 * A companion to the byte check rather than a substitute for it, and it answers a different
 * question: not "are these bytes a PDF" but "what will a browser do when a signed URL hands
 * them over". The provider takes that header from the upload PUT, so it is client-written and
 * a `%PDF-` prefix alone does not constrain it — a `text/html` object whose first five bytes
 * happen to be the signature renders as a page.
 *
 * A missing type is a rejection, not a pass: this is the header that decides how the bytes are
 * interpreted, and an upload that did not pin it down is not one to commit.
 */
export function isPdfContentType(contentType: string | null): boolean {
  if (contentType === null) return false;

  // `application/pdf; charset=binary` is the same media type. Everything after the first
  // semicolon is a parameter, and comparison is case-insensitive per RFC 9110.
  const [mediaType = ""] = contentType.split(";");

  return mediaType.trim().toLowerCase() === PDF_CONTENT_TYPE;
}

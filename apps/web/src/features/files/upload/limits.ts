import { FILE_SIZE_MAX_BYTES, PDF_CONTENT_TYPE } from "@data-room/shared";
import type { UploadLimits } from "./select";

/**
 * The client's copy of the server's rules, imported rather than restated so the message the
 * user reads and the limit the API enforces cannot drift apart.
 */
export const UPLOAD_LIMITS: UploadLimits = {
  contentType: PDF_CONTENT_TYPE,
  maxBytes: FILE_SIZE_MAX_BYTES,
};

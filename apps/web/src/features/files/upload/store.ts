import { PDF_CONTENT_TYPE } from "@data-room/shared";
import { commitUpload, createUploadIntent } from "@/features/files/api/uploads";
import { createUploadQueue, type UploadPipeline, type UploadQueue } from "./queue";
import { putObject } from "./transport";

/**
 * The real three steps. Reserve and commit speak to the API; the middle step speaks to
 * storage directly, which is why the bytes never enter this app's API client.
 *
 * `contentType` is the shared constant rather than the browser's guess: the reservation and
 * the PUT must declare the same type or storage refuses a URL the API just approved, and a
 * drag from some file managers supplies no type at all.
 */
const pipeline: UploadPipeline = {
  reserve({ folderId, file }, signal) {
    return createUploadIntent(
      {
        parentId: folderId,
        name: file.name,
        contentType: PDF_CONTENT_TYPE,
        sizeBytes: file.size,
      },
      signal,
    );
  },

  send({ url, body, contentType, signal, onProgress }) {
    return putObject({ url, body, contentType, signal, onProgress });
  },

  commit(nodeId, signal) {
    return commitUpload(nodeId, signal);
  },
};

let queue: UploadQueue | null = null;

/**
 * One queue for the whole tab, created on first use.
 *
 * Deliberately not React state and not a context: an upload outlives the folder it started
 * in. Owning it in the tree would mean the router unmounting a 40 MB transfer the moment the
 * user opened another folder to carry on working, which is precisely when they expect it to
 * keep running.
 */
export function uploadQueue(): UploadQueue {
  queue ??= createUploadQueue({ pipeline });
  return queue;
}

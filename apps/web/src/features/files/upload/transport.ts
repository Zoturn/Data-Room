import { UploadAbortedError, UploadTransportError, kindForStatus } from "./errors";

/** How a single transfer ended, as the adapter below reports it. */
export type UploadOutcome =
  | { kind: "response"; status: number }
  | { kind: "network" }
  | { kind: "timeout" }
  | { kind: "aborted" };

/**
 * The slice of `XMLHttpRequest` this transport uses, named as a shape of our own. "Adapter"
 * rather than "request" because `queue.ts` already exports an `UploadRequest`, and one file
 * queued for upload and one PUT in flight are not the same thing.
 *
 * XHR — not `fetch` — because `fetch` still has no upload progress event, and per-file
 * progress is the point of this screen. Declaring the adapter rather than the browser
 * object is what lets Jest drive the promise, the abort path and the error mapping in a
 * `node` environment where `XMLHttpRequest` does not exist.
 */
export type UploadRequestAdapter = {
  /** Reports transferred bytes; the adapter drops events whose total is not yet known. */
  onProgress(handler: (loaded: number, total: number) => void): void;
  onSettled(handler: (outcome: UploadOutcome) => void): void;
  send(input: { url: string; body: Blob; contentType: string }): void;
  abort(): void;
};

export function createXhrRequest(): UploadRequestAdapter {
  const xhr = new XMLHttpRequest();

  let progress: ((loaded: number, total: number) => void) | null = null;
  let settled: ((outcome: UploadOutcome) => void) | null = null;

  // Every terminal event is funnelled through one call, so a browser that fires both
  // `error` and `loadend` cannot settle the promise twice.
  let done = false;
  function settle(outcome: UploadOutcome): void {
    if (done) return;
    done = true;
    settled?.(outcome);
  }

  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable) progress?.(event.loaded, event.total);
  };
  xhr.onload = () => {
    settle({ kind: "response", status: xhr.status });
  };
  xhr.onerror = () => {
    settle({ kind: "network" });
  };
  xhr.ontimeout = () => {
    settle({ kind: "timeout" });
  };
  xhr.onabort = () => {
    settle({ kind: "aborted" });
  };

  return {
    onProgress(handler) {
      progress = handler;
    },
    onSettled(handler) {
      settled = handler;
    },
    send({ url, body, contentType }) {
      xhr.open("PUT", url);
      xhr.setRequestHeader("Content-Type", contentType);
      xhr.send(body);
    },
    abort() {
      xhr.abort();
    },
  };
}

export type PutObjectInput = {
  /** The signed URL from the upload intent. Bytes go here, never through the API. */
  url: string;
  body: Blob;
  contentType: string;
  signal: AbortSignal;
  /** Fraction between 0 and 1. Called only when the length is known. */
  onProgress?: (fraction: number) => void;
};

/**
 * PUTs one file to its signed URL and resolves when storage has it.
 *
 * The promise rejects with `UploadAbortedError` for a cancel and `UploadTransportError` for
 * everything else, so the queue can tell "the user stopped this" from "this failed" without
 * inspecting a status anywhere else.
 */
export function putObject(
  input: PutObjectInput,
  createRequest: () => UploadRequestAdapter = createXhrRequest,
): Promise<void> {
  const { url, body, contentType, signal, onProgress } = input;

  if (signal.aborted) return Promise.reject(new UploadAbortedError());

  return new Promise<void>((resolve, reject) => {
    const request = createRequest();

    function stopListening(): void {
      signal.removeEventListener("abort", handleAbort);
    }

    function handleAbort(): void {
      request.abort();
    }

    request.onProgress((loaded, total) => {
      if (total <= 0) return;
      onProgress?.(Math.min(1, Math.max(0, loaded / total)));
    });

    request.onSettled((outcome) => {
      stopListening();

      switch (outcome.kind) {
        case "response":
          if (outcome.status >= 200 && outcome.status < 300) {
            // A completed transfer has moved every byte, whatever the last progress event said.
            onProgress?.(1);
            resolve();
            return;
          }
          reject(
            new UploadTransportError(
              kindForStatus(outcome.status),
              outcome.status,
              `Storage answered ${String(outcome.status)} for the upload.`,
            ),
          );
          return;
        case "aborted":
          reject(new UploadAbortedError());
          return;
        case "timeout":
          reject(new UploadTransportError("timeout", null, "The upload timed out."));
          return;
        case "network":
          reject(new UploadTransportError("network", null, "The upload could not be sent."));
      }
    });

    signal.addEventListener("abort", handleAbort);
    request.send({ url, body, contentType });
  });
}

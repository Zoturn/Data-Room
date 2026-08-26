import type { NodeSummary, UploadIntent } from "@data-room/shared";
import { UploadAbortedError, describeUploadFailure } from "./errors";
import type { UploadSource } from "./select";

/**
 * Where one file is in the three-step pipeline. `reserving` and `committing` are separated
 * from `sending` because only the middle one has a meaningful percentage — a row that showed
 * a bar during the two API calls would sit at 0% and then at 100% for no visible reason.
 */
export type UploadStatus =
  "queued" | "reserving" | "sending" | "committing" | "done" | "failed" | "cancelled";

const ACTIVE_STATUSES: readonly UploadStatus[] = ["queued", "reserving", "sending", "committing"];

export function isUploadActive(item: UploadItem): boolean {
  return ACTIVE_STATUSES.includes(item.status);
}

/**
 * A chosen file plus its bytes. Split from `UploadSource` so screening needs no `Blob`.
 *
 * `type` is the content type both the reservation and the PUT declare, so it must be the
 * canonical one rather than whatever the browser guessed — a drag from some file managers
 * hands over an empty `type`, and storage would then reject a PUT the intent had approved.
 * `toUploadFile` in `select.ts` is what normalises it.
 */
export type UploadFile = UploadSource & { readonly body: Blob };

export type UploadRequest = {
  readonly folderId: string;
  /** Shown in the panel, because a batch can be spread across several destinations. */
  readonly folderName: string;
  readonly file: UploadFile;
};

export type UploadItem = {
  /** Ours, not the server's: it exists before a reservation does and survives a retry. */
  readonly id: string;
  readonly folderId: string;
  readonly folderName: string;
  /** What the user chose. Kept even after the server renames it, so the row stays findable. */
  readonly name: string;
  /** What it will actually be called — `null` until the reservation answers. */
  readonly resolvedName: string | null;
  readonly sizeBytes: number;
  readonly status: UploadStatus;
  /** Fraction of the bytes transferred, 0 to 1. Only moves during `sending`. */
  readonly progress: number;
  /** One sentence for the row, already written for a human. `null` unless failed. */
  readonly error: string | null;
  readonly retryable: boolean;
  readonly nodeId: string | null;
};

/**
 * The three steps, injected rather than imported, so this module holds the concurrency,
 * cancel and retry rules and nothing else. Jest drives it with resolvers it controls; the
 * browser gets the real one from `store.ts`.
 */
export type UploadPipeline = {
  reserve(
    input: { readonly folderId: string; readonly file: UploadFile },
    signal: AbortSignal,
  ): Promise<UploadIntent>;
  /** PUTs the bytes straight to storage. They never pass through the API. */
  send(input: {
    readonly url: string;
    readonly body: Blob;
    readonly contentType: string;
    readonly signal: AbortSignal;
    readonly onProgress: (fraction: number) => void;
  }): Promise<void>;
  commit(nodeId: string, signal: AbortSignal): Promise<NodeSummary>;
};

/** Emitted the moment a file becomes real, which is when its folder listing is stale. */
export type UploadCommitted = {
  readonly folderId: string;
  readonly file: NodeSummary;
};

export type UploadQueue = {
  /** Stable between changes, so `useSyncExternalStore` does not loop. */
  getItems(): readonly UploadItem[];
  subscribe(listener: () => void): () => void;
  onCommitted(listener: (event: UploadCommitted) => void): () => void;
  enqueue(requests: readonly UploadRequest[]): readonly string[];
  cancel(id: string): void;
  retry(id: string): void;
  /** Drops one finished row from the panel. Never touches an upload still in flight. */
  dismiss(id: string): void;
  clearFinished(): void;
  activeCount(): number;
};

/**
 * Three at a time. Enough to keep a fast link busy, few enough that a thirty-file drop does
 * not open thirty sockets and starve the API calls that bracket each transfer.
 */
export const DEFAULT_UPLOAD_CONCURRENCY = 3;

export type UploadQueueOptions = {
  readonly pipeline: UploadPipeline;
  readonly concurrency?: number;
  /** Overridden by specs that assert on ids; the default is a counter, not a UUID. */
  readonly createId?: () => string;
};

type Runtime = {
  readonly request: UploadRequest;
  controller: AbortController | null;
  /**
   * Set by `cancel` so a transfer that was already past the point of no return cannot
   * report success over the top of a row the user has stopped.
   */
  cancelled: boolean;
};

const NO_ITEMS: readonly UploadItem[] = [];

export function createUploadQueue(options: UploadQueueOptions): UploadQueue {
  const { pipeline } = options;
  const concurrency = options.concurrency ?? DEFAULT_UPLOAD_CONCURRENCY;

  let sequence = 0;
  const createId = options.createId ?? (() => `upload-${String((sequence += 1))}`);

  let items: readonly UploadItem[] = NO_ITEMS;
  const runtimes = new Map<string, Runtime>();
  const listeners = new Set<() => void>();
  const committedListeners = new Set<(event: UploadCommitted) => void>();
  let running = 0;

  function publish(): void {
    for (const listener of listeners) listener();
  }

  function patch(id: string, changes: Partial<UploadItem>): void {
    let touched = false;
    const next = items.map((item) => {
      if (item.id !== id) return item;
      touched = true;
      return { ...item, ...changes };
    });

    if (!touched) return;
    items = next;
    publish();
  }

  /** Every write from inside a running transfer, so a cancel silences the rest of it. */
  function patchRunning(id: string, changes: Partial<UploadItem>): void {
    if (runtimes.get(id)?.cancelled === true) return;
    patch(id, changes);
  }

  function pump(): void {
    while (running < concurrency) {
      const next = items.find((item) => item.status === "queued");
      if (next === undefined) return;

      // Marked before the transfer starts: this same loop would otherwise pick it again.
      patch(next.id, { status: "reserving", error: null, retryable: false, progress: 0 });
      running += 1;
      void run(next.id);
    }
  }

  async function run(id: string): Promise<void> {
    const entry = runtimes.get(id);
    if (entry === undefined) {
      running -= 1;
      return;
    }

    const controller = new AbortController();
    entry.controller = controller;

    try {
      const intent = await reserveAndSend(id, entry, controller.signal);

      patchRunning(id, { status: "committing", progress: 1 });
      const file = await pipeline.commit(intent.nodeId, controller.signal);

      if (!entry.cancelled) {
        patch(id, { status: "done", resolvedName: file.name, progress: 1, error: null });
        for (const listener of committedListeners) {
          listener({ folderId: entry.request.folderId, file });
        }
      }
    } catch (cause) {
      if (entry.cancelled || isAbortError(cause)) {
        patch(id, { status: "cancelled", error: null, retryable: true });
      } else {
        const failure = describeUploadFailure(cause);
        patch(id, { status: "failed", error: failure.message, retryable: failure.retryable });
      }
    } finally {
      entry.controller = null;
      running -= 1;
      pump();
    }
  }

  /**
   * The reservation and the transfer, with one automatic second reservation when the signed
   * URL expired mid-flight. A slow link on a large file can outlive its URL through nobody's
   * fault, and making the user press Retry for that is a worse answer than taking a fresh
   * URL silently. The abandoned reservation is swept server-side.
   */
  async function reserveAndSend(
    id: string,
    entry: Runtime,
    signal: AbortSignal,
  ): Promise<UploadIntent> {
    const { folderId, file } = entry.request;

    let intent = await pipeline.reserve({ folderId, file }, signal);
    patchRunning(id, { nodeId: intent.nodeId, resolvedName: intent.resolvedName, progress: 0 });

    try {
      await transfer(id, intent, file, signal);
      return intent;
    } catch (cause) {
      if (entry.cancelled || isAbortError(cause)) throw cause;
      if (!describeUploadFailure(cause).expired) throw cause;

      intent = await pipeline.reserve({ folderId, file }, signal);
      patchRunning(id, { nodeId: intent.nodeId, resolvedName: intent.resolvedName, progress: 0 });
      await transfer(id, intent, file, signal);
      return intent;
    }
  }

  function transfer(
    id: string,
    intent: UploadIntent,
    file: UploadFile,
    signal: AbortSignal,
  ): Promise<void> {
    patchRunning(id, { status: "sending" });
    return pipeline.send({
      url: intent.uploadUrl,
      body: file.body,
      contentType: file.type,
      signal,
      onProgress: (fraction) => {
        patchRunning(id, { progress: fraction });
      },
    });
  }

  return {
    getItems() {
      return items;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    onCommitted(listener) {
      committedListeners.add(listener);
      return () => {
        committedListeners.delete(listener);
      };
    },

    enqueue(requests) {
      const created: UploadItem[] = [];

      for (const request of requests) {
        const id = createId();
        runtimes.set(id, { request, controller: null, cancelled: false });
        created.push({
          id,
          folderId: request.folderId,
          folderName: request.folderName,
          name: request.file.name,
          resolvedName: null,
          sizeBytes: request.file.size,
          status: "queued",
          progress: 0,
          error: null,
          retryable: false,
          nodeId: null,
        });
      }

      if (created.length === 0) return [];

      items = [...items, ...created];
      publish();
      pump();

      return created.map((item) => item.id);
    },

    cancel(id) {
      const item = items.find((candidate) => candidate.id === id);
      const entry = runtimes.get(id);
      if (item === undefined || entry === undefined || !isUploadActive(item)) return;

      // Marked first: the row must answer the click even when the abort takes a moment to
      // reach the transfer, and a queued file has no transfer to abort at all.
      entry.cancelled = true;
      patch(id, { status: "cancelled", error: null, retryable: true });
      entry.controller?.abort();
    },

    retry(id) {
      const item = items.find((candidate) => candidate.id === id);
      const entry = runtimes.get(id);
      if (item === undefined || entry === undefined) return;
      if (item.status !== "failed" && item.status !== "cancelled") return;

      entry.cancelled = false;
      entry.controller = null;
      // The reservation is dropped rather than reused: a retry re-resolves the name, which
      // may have been taken in the meantime, and the stale `PENDING` row is swept.
      patch(id, {
        status: "queued",
        error: null,
        retryable: false,
        progress: 0,
        nodeId: null,
        resolvedName: null,
      });
      pump();
    },

    dismiss(id) {
      const item = items.find((candidate) => candidate.id === id);
      if (item === undefined || isUploadActive(item)) return;

      runtimes.delete(id);
      items = items.filter((candidate) => candidate.id !== id);
      publish();
    },

    clearFinished() {
      const remaining = items.filter((item) => isUploadActive(item));
      if (remaining.length === items.length) return;

      for (const item of items) {
        if (!isUploadActive(item)) runtimes.delete(item.id);
      }
      items = remaining;
      publish();
    },

    activeCount() {
      return items.filter((item) => isUploadActive(item)).length;
    },
  };
}

/**
 * A cancel arrives as `UploadAbortedError` from the transport and as a `DOMException` named
 * `AbortError` from the two `fetch` calls that bracket it. Both are the user, not a fault.
 */
function isAbortError(cause: unknown): boolean {
  if (cause instanceof UploadAbortedError) return true;
  return cause instanceof Error && cause.name === "AbortError";
}

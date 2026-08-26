import { describe, expect, it, jest } from "@jest/globals";
import type { NodeSummary, UploadIntent } from "@data-room/shared";
import { ApiError } from "@/lib/api/errors";
import { UploadTransportError } from "./errors";
import {
  createUploadQueue,
  type UploadCommitted,
  type UploadFile,
  type UploadItem,
  type UploadPipeline,
  type UploadQueue,
} from "./queue";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (cause: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (cause: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, resolve, reject };
}

/** The queue hands work off across several microtasks; this waits for all of them. */
function settle(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

type Reservation = {
  readonly name: string;
  readonly folderId: string;
  readonly signal: AbortSignal;
  readonly deferred: Deferred<UploadIntent>;
};

type Transfer = {
  readonly url: string;
  readonly contentType: string;
  readonly signal: AbortSignal;
  readonly onProgress: (fraction: number) => void;
  readonly deferred: Deferred<void>;
};

type Commit = {
  readonly nodeId: string;
  readonly signal: AbortSignal;
  readonly deferred: Deferred<NodeSummary>;
};

function intent(nodeId: string, resolvedName: string): UploadIntent {
  return {
    nodeId,
    uploadUrl: `https://storage.example/${nodeId}`,
    resolvedName,
    expiresAt: "2026-08-26T12:00:00.000Z",
  };
}

function summary(id: string, name: string): NodeSummary {
  return { id, type: "FILE", name, updatedAt: "2026-08-26T12:00:00.000Z", sizeBytes: 1024 };
}

function file(name: string, size = 1024): UploadFile {
  return { name, size, type: "application/pdf", body: new Blob(["%PDF-1.7"]) };
}

type Harness = {
  readonly queue: UploadQueue;
  readonly reservations: Reservation[];
  readonly transfers: Transfer[];
  readonly commits: Commit[];
  readonly committed: UploadCommitted[];
  item(id: string): UploadItem;
};

function harness(concurrency = 3): Harness {
  const reservations: Reservation[] = [];
  const transfers: Transfer[] = [];
  const commits: Commit[] = [];
  const committed: UploadCommitted[] = [];

  const pipeline: UploadPipeline = {
    reserve({ folderId, file: source }, signal) {
      const pending = deferred<UploadIntent>();
      reservations.push({ name: source.name, folderId, signal, deferred: pending });
      return pending.promise;
    },
    send({ url, contentType, signal, onProgress }) {
      const pending = deferred<void>();
      transfers.push({ url, contentType, signal, onProgress, deferred: pending });
      return pending.promise;
    },
    commit(nodeId, signal) {
      const pending = deferred<NodeSummary>();
      commits.push({ nodeId, signal, deferred: pending });
      return pending.promise;
    },
  };

  let sequence = 0;
  const queue = createUploadQueue({
    pipeline,
    concurrency,
    createId: () => `u${String((sequence += 1))}`,
  });
  queue.onCommitted((event) => committed.push(event));

  return {
    queue,
    reservations,
    transfers,
    commits,
    committed,
    item(id) {
      const found = queue.getItems().find((candidate) => candidate.id === id);
      if (found === undefined) throw new Error(`no upload row ${id}`);
      return found;
    },
  };
}

function enqueueOne(context: Harness, name = "report.pdf"): string {
  const [id] = context.queue.enqueue([
    { folderId: "folder-1", folderName: "Diligence", file: file(name) },
  ]);
  if (id === undefined) throw new Error("enqueue returned no id");
  return id;
}

/** Drives one file through reserve → send → commit, resolving each step in turn. */
async function completeFirst(context: Harness, resolvedName = "report.pdf"): Promise<void> {
  const reservation = context.reservations.at(-1);
  if (reservation === undefined) throw new Error("nothing reserved");
  reservation.deferred.resolve(intent("node-1", resolvedName));
  await settle();

  const transfer = context.transfers.at(-1);
  if (transfer === undefined) throw new Error("nothing sent");
  transfer.deferred.resolve();
  await settle();

  const commit = context.commits.at(-1);
  if (commit === undefined) throw new Error("nothing committed");
  commit.deferred.resolve(summary("node-1", resolvedName));
  await settle();
}

describe("createUploadQueue", () => {
  it("runs the three steps in order and reports the name the server actually used", async () => {
    const context = harness();
    const id = enqueueOne(context);

    expect(context.item(id).status).toBe("reserving");

    const reservation = context.reservations.at(-1);
    if (reservation === undefined) throw new Error("nothing reserved");
    expect(reservation.name).toBe("report.pdf");
    expect(reservation.folderId).toBe("folder-1");

    await completeFirst(context, "report (1).pdf");

    const item = context.item(id);
    expect(item.status).toBe("done");
    // The requested name is kept beside the resolved one: the panel says both, so nobody
    // watches a file upload under a name it does not end up having.
    expect(item.name).toBe("report.pdf");
    expect(item.resolvedName).toBe("report (1).pdf");
    expect(item.progress).toBe(1);
  });

  it("PUTs the bytes to the signed URL from the reservation, not to the API", async () => {
    const context = harness();
    enqueueOne(context);

    context.reservations[0]?.deferred.resolve(intent("node-9", "report.pdf"));
    await settle();

    expect(context.transfers.at(0)?.url).toBe("https://storage.example/node-9");
    expect(context.transfers.at(0)?.contentType).toBe("application/pdf");
  });

  it("announces each commit with the folder it landed in, so that listing can refresh", async () => {
    const context = harness();
    enqueueOne(context);
    await completeFirst(context, "report.pdf");

    expect(context.committed).toEqual([
      { folderId: "folder-1", file: summary("node-1", "report.pdf") },
    ]);
  });

  it("moves the row's progress only while bytes are moving", async () => {
    const context = harness();
    const id = enqueueOne(context);

    context.reservations[0]?.deferred.resolve(intent("node-1", "report.pdf"));
    await settle();

    expect(context.item(id).status).toBe("sending");
    context.transfers[0]?.onProgress(0.4);
    expect(context.item(id).progress).toBe(0.4);

    context.transfers[0]?.deferred.resolve();
    await settle();

    // Committing has no percentage of its own, so the bar sits full rather than resetting.
    expect(context.item(id).status).toBe("committing");
    expect(context.item(id).progress).toBe(1);
  });

  it("runs no more than the configured number at once and starts the next as one finishes", async () => {
    const context = harness(2);
    context.queue.enqueue(
      ["a.pdf", "b.pdf", "c.pdf", "d.pdf"].map((name) => ({
        folderId: "folder-1",
        folderName: "Diligence",
        file: file(name),
      })),
    );

    expect(context.reservations).toHaveLength(2);
    expect(context.queue.getItems().filter((item) => item.status === "queued")).toHaveLength(2);

    await completeFirst(context, "b.pdf");

    expect(context.reservations).toHaveLength(3);
    expect(context.reservations.at(-1)?.name).toBe("c.pdf");
  });

  it("lets the rest of the batch through when one file fails", async () => {
    const context = harness(1);
    const ids = context.queue.enqueue(
      ["a.pdf", "b.pdf"].map((name) => ({
        folderId: "folder-1",
        folderName: "Diligence",
        file: file(name),
      })),
    );

    context.reservations[0]?.deferred.reject(
      new UploadTransportError("rejected", 422, "Storage said no."),
    );
    await settle();

    const [first, second] = ids;
    if (first === undefined || second === undefined) throw new Error("expected two rows");
    expect(context.item(first).status).toBe("failed");
    expect(context.item(first).error).toBe("Storage refused this file.");
    expect(context.item(first).retryable).toBe(false);
    // One file's failure is not the batch's failure.
    expect(context.item(second).status).toBe("reserving");
  });

  it("repeats the API's own sentence when the API is the one refusing", async () => {
    const context = harness();
    const id = enqueueOne(context);

    context.reservations[0]?.deferred.reject(
      new ApiError({
        code: "FILE_TOO_LARGE",
        message: "That file is larger than the 50 MB limit.",
        status: 413,
        requestId: "req-1",
      }),
    );
    await settle();

    expect(context.item(id).error).toBe("That file is larger than the 50 MB limit.");
  });

  it("cancels a file that has not started without ever reserving a name for it", async () => {
    const context = harness(1);
    const ids = context.queue.enqueue(
      ["a.pdf", "b.pdf"].map((name) => ({
        folderId: "folder-1",
        folderName: "Diligence",
        file: file(name),
      })),
    );

    const queued = ids[1];
    if (queued === undefined) throw new Error("expected a queued row");
    context.queue.cancel(queued);

    expect(context.item(queued).status).toBe("cancelled");
    await settle();
    expect(context.reservations).toHaveLength(1);
  });

  it("aborts a transfer in flight and does not report success arriving after the cancel", async () => {
    const context = harness();
    const id = enqueueOne(context);

    context.reservations[0]?.deferred.resolve(intent("node-1", "report.pdf"));
    await settle();

    const transfer = context.transfers.at(0);
    if (transfer === undefined) throw new Error("nothing sent");
    expect(transfer.signal.aborted).toBe(false);

    context.queue.cancel(id);
    expect(context.item(id).status).toBe("cancelled");
    expect(transfer.signal.aborted).toBe(true);

    // A transfer already past the point of no return still settles; the row must not flip
    // back to a success the user has explicitly stopped.
    transfer.deferred.resolve();
    await settle();
    context.commits.at(0)?.deferred.resolve(summary("node-1", "report.pdf"));
    await settle();

    expect(context.item(id).status).toBe("cancelled");
    expect(context.committed).toHaveLength(0);
  });

  it("takes one fresh reservation when the signed URL expired mid-transfer", async () => {
    const context = harness();
    const id = enqueueOne(context);

    context.reservations[0]?.deferred.resolve(intent("node-1", "report.pdf"));
    await settle();
    context.transfers[0]?.deferred.reject(
      new UploadTransportError("expired", 400, "Storage answered 400 for the upload."),
    );
    await settle();

    // The row keeps working rather than asking the user to press Retry for a clock.
    expect(context.item(id).status).not.toBe("failed");
    expect(context.reservations).toHaveLength(2);

    context.reservations[1]?.deferred.resolve(intent("node-2", "report (1).pdf"));
    await settle();
    context.transfers[1]?.deferred.resolve();
    await settle();
    context.commits[0]?.deferred.resolve(summary("node-2", "report (1).pdf"));
    await settle();

    expect(context.item(id).status).toBe("done");
    expect(context.item(id).resolvedName).toBe("report (1).pdf");
  });

  it("gives up after the second expiry rather than re-reserving forever", async () => {
    const context = harness();
    const id = enqueueOne(context);

    context.reservations[0]?.deferred.resolve(intent("node-1", "report.pdf"));
    await settle();
    context.transfers[0]?.deferred.reject(new UploadTransportError("expired", 400, "expired"));
    await settle();
    context.reservations[1]?.deferred.resolve(intent("node-2", "report (1).pdf"));
    await settle();
    context.transfers[1]?.deferred.reject(new UploadTransportError("expired", 400, "expired"));
    await settle();

    expect(context.reservations).toHaveLength(2);
    expect(context.item(id).status).toBe("failed");
    expect(context.item(id).retryable).toBe(true);
  });

  it("retries a failed file from a fresh reservation", async () => {
    const context = harness();
    const id = enqueueOne(context);

    context.reservations[0]?.deferred.reject(
      new UploadTransportError("network", null, "The upload could not be sent."),
    );
    await settle();
    expect(context.item(id).status).toBe("failed");

    context.queue.retry(id);

    expect(context.item(id).status).toBe("reserving");
    expect(context.item(id).error).toBeNull();
    // The old reservation is abandoned to the sweep rather than reused: the name it held
    // may have been taken by someone else in the meantime.
    expect(context.reservations).toHaveLength(2);

    await completeFirst(context, "report.pdf");
    expect(context.item(id).status).toBe("done");
  });

  it("retries a cancelled file, and does not retry one that is still running", async () => {
    const context = harness();
    const id = enqueueOne(context);

    context.queue.cancel(id);
    context.queue.retry(id);
    expect(context.item(id).status).toBe("reserving");

    context.queue.retry(id);
    // Still reserving — a second retry must not queue the same file twice.
    expect(context.item(id).status).toBe("reserving");
    expect(context.reservations).toHaveLength(2);
  });

  it("fails the row when the commit is refused, and leaves it retryable", async () => {
    const context = harness();
    const id = enqueueOne(context);

    context.reservations[0]?.deferred.resolve(intent("node-1", "report.pdf"));
    await settle();
    context.transfers[0]?.deferred.resolve();
    await settle();
    context.commits[0]?.deferred.reject(
      new ApiError({
        code: "UNSUPPORTED_FILE_TYPE",
        message: "That file is not a PDF.",
        status: 415,
        requestId: "req-2",
      }),
    );
    await settle();

    expect(context.item(id).status).toBe("failed");
    expect(context.item(id).error).toBe("That file is not a PDF.");
  });

  it("treats an aborted fetch as a cancel rather than a failure", async () => {
    const context = harness();
    const id = enqueueOne(context);

    const abort = new Error("The operation was aborted.");
    abort.name = "AbortError";
    context.reservations[0]?.deferred.reject(abort);
    await settle();

    expect(context.item(id).status).toBe("cancelled");
    expect(context.item(id).error).toBeNull();
  });

  it("counts what is still in flight, which is what the unload warning asks", async () => {
    const context = harness(1);
    const ids = context.queue.enqueue(
      ["a.pdf", "b.pdf"].map((name) => ({
        folderId: "folder-1",
        folderName: "Diligence",
        file: file(name),
      })),
    );

    expect(context.queue.activeCount()).toBe(2);

    for (const id of ids) context.queue.cancel(id);
    expect(context.queue.activeCount()).toBe(0);
  });

  it("clears finished rows and keeps the ones still running", async () => {
    const context = harness(1);
    const ids = context.queue.enqueue(
      ["a.pdf", "b.pdf"].map((name) => ({
        folderId: "folder-1",
        folderName: "Diligence",
        file: file(name),
      })),
    );
    const [first, second] = ids;
    if (first === undefined || second === undefined) throw new Error("expected two rows");

    await completeFirst(context, "a.pdf");
    await settle();

    context.queue.clearFinished();

    expect(context.queue.getItems().map((item) => item.id)).toEqual([second]);

    // A row still in flight cannot be dismissed out from under its own transfer.
    context.queue.dismiss(second);
    expect(context.queue.getItems()).toHaveLength(1);
  });

  it("keeps the same snapshot reference until something actually changes", () => {
    const context = harness();
    const listener = jest.fn();
    context.queue.subscribe(listener);

    const before = context.queue.getItems();
    context.queue.cancel("no-such-row");

    expect(context.queue.getItems()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops notifying a listener that has unsubscribed", () => {
    const context = harness();
    const listener = jest.fn();
    const unsubscribe = context.queue.subscribe(listener);

    enqueueOne(context);
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    listener.mockClear();
    enqueueOne(context, "second.pdf");
    expect(listener).not.toHaveBeenCalled();
  });
});

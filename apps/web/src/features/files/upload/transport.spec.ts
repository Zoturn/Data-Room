import { describe, expect, it, jest } from "@jest/globals";
import { UploadAbortedError, UploadTransportError } from "./errors";
import { putObject, type UploadOutcome, type UploadRequestAdapter } from "./transport";

/**
 * A stand-in for the browser object, driven by the spec. The transport is defined against
 * the adapter interface precisely so this is possible without a DOM.
 */
type FakeRequest = UploadRequestAdapter & {
  emitProgress: (loaded: number, total: number) => void;
  settle: (outcome: UploadOutcome) => void;
  sent: { url: string; contentType: string } | null;
  aborts: number;
};

function fakeRequest(): FakeRequest {
  let progress: ((loaded: number, total: number) => void) | null = null;
  let settled: ((outcome: UploadOutcome) => void) | null = null;

  const request: FakeRequest = {
    sent: null,
    aborts: 0,
    onProgress(handler) {
      progress = handler;
    },
    onSettled(handler) {
      settled = handler;
    },
    send({ url, contentType }) {
      request.sent = { url, contentType };
    },
    abort() {
      request.aborts += 1;
      settled?.({ kind: "aborted" });
    },
    emitProgress(loaded, total) {
      progress?.(loaded, total);
    },
    settle(outcome) {
      settled?.(outcome);
    },
  };

  return request;
}

const body = new Blob(["%PDF-1.7"]);

function put(request: FakeRequest, signal: AbortSignal, onProgress?: (fraction: number) => void) {
  const input = {
    url: "https://storage.example/signed",
    body,
    contentType: "application/pdf",
    signal,
    ...(onProgress ? { onProgress } : {}),
  };
  return putObject(input, () => request);
}

describe("putObject", () => {
  it("PUTs to the signed URL with the declared content type", async () => {
    const request = fakeRequest();
    const pending = put(request, new AbortController().signal);

    expect(request.sent).toEqual({
      url: "https://storage.example/signed",
      contentType: "application/pdf",
    });

    request.settle({ kind: "response", status: 200 });
    await expect(pending).resolves.toBeUndefined();
  });

  it("reports progress as a fraction and finishes at 1", async () => {
    const request = fakeRequest();
    const seen: number[] = [];
    const pending = put(request, new AbortController().signal, (fraction) => seen.push(fraction));

    request.emitProgress(25, 100);
    request.emitProgress(50, 100);
    request.settle({ kind: "response", status: 201 });
    await pending;

    // The last progress event a browser fires can precede the final ack, so a row would
    // otherwise sit at 98% next to the word "done".
    expect(seen).toEqual([0.25, 0.5, 1]);
  });

  it("ignores progress events whose total is unknown", async () => {
    const request = fakeRequest();
    const onProgress = jest.fn<(fraction: number) => void>();
    const pending = put(request, new AbortController().signal, onProgress);

    request.emitProgress(10, 0);
    expect(onProgress).not.toHaveBeenCalled();

    request.settle({ kind: "response", status: 200 });
    await pending;
  });

  it("aborts the request when the signal fires, and rejects as cancelled rather than failed", async () => {
    const request = fakeRequest();
    const controller = new AbortController();
    const pending = put(request, controller.signal);

    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(UploadAbortedError);
    expect(request.aborts).toBe(1);
  });

  it("rejects immediately when the signal was already aborted, without opening a request", async () => {
    const request = fakeRequest();
    const controller = new AbortController();
    controller.abort();

    await expect(put(request, controller.signal)).rejects.toBeInstanceOf(UploadAbortedError);
    expect(request.sent).toBeNull();
  });

  it("maps an expired signed URL to a retryable expiry rather than a hard rejection", async () => {
    const request = fakeRequest();
    const pending = put(request, new AbortController().signal);

    request.settle({ kind: "response", status: 400 });

    const error: unknown = await pending.catch((cause: unknown) => cause);
    if (!(error instanceof UploadTransportError)) throw new Error("expected a transport error");
    expect(error.kind).toBe("expired");
    expect(error.status).toBe(400);
  });

  it("distinguishes storage being unwell from storage saying no", async () => {
    const failing = fakeRequest();
    const failingPut = put(failing, new AbortController().signal);
    failing.settle({ kind: "response", status: 503 });

    const refusing = fakeRequest();
    const refusingPut = put(refusing, new AbortController().signal);
    refusing.settle({ kind: "response", status: 422 });

    const failure: unknown = await failingPut.catch((cause: unknown) => cause);
    const refusal: unknown = await refusingPut.catch((cause: unknown) => cause);

    if (!(failure instanceof UploadTransportError)) throw new Error("expected a transport error");
    if (!(refusal instanceof UploadTransportError)) throw new Error("expected a transport error");
    expect(failure.kind).toBe("server");
    expect(refusal.kind).toBe("rejected");
  });

  it("reports a dead connection and a timeout as their own kinds", async () => {
    const dead = fakeRequest();
    const deadPut = put(dead, new AbortController().signal);
    dead.settle({ kind: "network" });

    const slow = fakeRequest();
    const slowPut = put(slow, new AbortController().signal);
    slow.settle({ kind: "timeout" });

    const network: unknown = await deadPut.catch((cause: unknown) => cause);
    const timeout: unknown = await slowPut.catch((cause: unknown) => cause);

    if (!(network instanceof UploadTransportError)) throw new Error("expected a transport error");
    if (!(timeout instanceof UploadTransportError)) throw new Error("expected a transport error");
    expect(network.kind).toBe("network");
    expect(timeout.kind).toBe("timeout");
  });

  it("settles once, so a browser that fires two terminal events cannot resolve a failure", async () => {
    const request = fakeRequest();
    const pending = put(request, new AbortController().signal);

    request.settle({ kind: "network" });
    request.settle({ kind: "response", status: 200 });

    await expect(pending).rejects.toBeInstanceOf(UploadTransportError);
  });
});

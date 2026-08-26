import { describe, expect, it } from "@jest/globals";
import { installUnloadWarning, type UnloadEvent, type UnloadTarget } from "./unload-guard";

type FakeTarget = UnloadTarget & {
  listenerCount: () => number;
  fire: () => { prevented: boolean; returnValue: unknown };
};

function fakeTarget(): FakeTarget {
  const listeners = new Set<(event: UnloadEvent) => void>();

  return {
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
    listenerCount: () => listeners.size,
    fire() {
      let prevented = false;
      const event: UnloadEvent = {
        preventDefault() {
          prevented = true;
        },
        returnValue: undefined,
      };
      for (const listener of listeners) listener(event);
      return { prevented, returnValue: event.returnValue };
    },
  };
}

describe("installUnloadWarning", () => {
  it("does not interrupt a departure when nothing is uploading", () => {
    const target = fakeTarget();
    installUnloadWarning(target, () => false);

    expect(target.fire().prevented).toBe(false);
  });

  it("blocks the departure while an upload is in flight", () => {
    const target = fakeTarget();
    installUnloadWarning(target, () => true);

    const result = target.fire();
    expect(result.prevented).toBe(true);
    // Chrome ignores the text but still requires the property to be set.
    expect(result.returnValue).toBe(true);
  });

  it("reads the predicate at each departure, so a queue that empties stops warning", () => {
    const target = fakeTarget();
    let uploading = true;
    installUnloadWarning(target, () => uploading);

    expect(target.fire().prevented).toBe(true);
    uploading = false;
    expect(target.fire().prevented).toBe(false);
  });

  it("removes its listener when uninstalled", () => {
    const target = fakeTarget();
    const uninstall = installUnloadWarning(target, () => true);

    uninstall();

    expect(target.listenerCount()).toBe(0);
    expect(target.fire().prevented).toBe(false);
  });
});

/**
 * The two members of `beforeunload` this guard touches, declared as our own shape rather
 * than reaching for `BeforeUnloadEvent`. That keeps the guard testable in Jest's `node`
 * environment, where neither the event nor `window` exists.
 */
export type UnloadEvent = {
  preventDefault(): void;
  returnValue: unknown;
};

export type UnloadTarget = {
  addEventListener(type: "beforeunload", listener: (event: UnloadEvent) => void): void;
  removeEventListener(type: "beforeunload", listener: (event: UnloadEvent) => void): void;
};

/**
 * Asks the browser to confirm before the tab closes while uploads are still running.
 *
 * The predicate is read at the moment the event fires rather than captured as a boolean, so
 * one listener covers a queue that empties and fills again — re-subscribing on every progress
 * event would be the alternative, and browsers throttle that.
 *
 * The wording is the browser's own and cannot be changed: every engine ignores the string
 * and shows its own sentence. Setting `returnValue` is nonetheless still required by Chrome,
 * so both it and `preventDefault` are called.
 */
export function installUnloadWarning(
  target: UnloadTarget,
  hasWorkInFlight: () => boolean,
): () => void {
  function handleBeforeUnload(event: UnloadEvent): void {
    if (!hasWorkInFlight()) return;
    event.preventDefault();
    event.returnValue = true;
  }

  target.addEventListener("beforeunload", handleBeforeUnload);

  return () => {
    target.removeEventListener("beforeunload", handleBeforeUnload);
  };
}

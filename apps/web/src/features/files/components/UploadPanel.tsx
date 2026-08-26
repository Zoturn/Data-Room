"use client";

import { RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useUnloadWarning,
  useUploadItems,
  useUploadQueue,
} from "@/features/files/hooks/useUploads";
import { isUploadActive, type UploadItem, type UploadQueue } from "@/features/files/upload/queue";
import {
  describeUploadRow,
  resolvedNameNote,
  summariseQueue,
} from "@/features/files/upload/summary";

/**
 * Every upload in the tab, one row each.
 *
 * Per file rather than one aggregate bar: a batch where one file fails and four succeed is
 * the ordinary case, and a single bar can neither say which failed nor offer to retry it.
 * The panel is a sibling of the listing rather than a child of the drop zone, because an
 * upload keeps running after the user has navigated to another folder.
 */
export function UploadPanel() {
  const queue = useUploadQueue();
  const items = useUploadItems();
  useUnloadWarning();

  if (items.length === 0) return null;

  const hasFinished = items.some((item) => !isUploadActive(item));

  return (
    <section
      aria-label="Uploads"
      className="fixed bottom-4 right-4 z-20 flex w-[min(24rem,calc(100vw-2rem))] flex-col rounded-lg border border-border bg-background shadow-lg"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="text-sm font-medium">{summariseQueue(items)}</h2>

        {hasFinished ? (
          <Button variant="ghost" size="sm" onClick={() => queue.clearFinished()}>
            Clear finished
          </Button>
        ) : null}
      </header>

      <ul className="max-h-72 overflow-y-auto">
        {items.map((item) => (
          <UploadRow key={item.id} item={item} queue={queue} />
        ))}
      </ul>
    </section>
  );
}

function UploadRow({ item, queue }: { item: UploadItem; queue: UploadQueue }) {
  const active = isUploadActive(item);
  const note = resolvedNameNote(item);
  const percent = Math.round(item.progress * 100);

  return (
    <li className="flex items-center gap-2 border-b border-border px-3 py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm" title={item.name}>
          {item.name}
        </p>

        <p
          className={
            item.status === "failed" ? "text-xs text-destructive" : "text-xs text-muted-foreground"
          }
        >
          {describeUploadRow(item)}
        </p>

        {note === null ? null : <p className="text-xs text-muted-foreground">{note}</p>}

        {item.status === "sending" ? (
          <div
            role="progressbar"
            aria-label={`Uploading ${item.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="mt-1 h-1 w-full overflow-hidden rounded bg-muted"
          >
            <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
          </div>
        ) : null}
      </div>

      {/* Retry and dismiss are the same slot: a row is never both in flight and finished. */}
      {active ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Cancel upload of ${item.name}`}
          onClick={() => queue.cancel(item.id)}
        >
          <X aria-hidden />
        </Button>
      ) : (
        <div className="flex items-center">
          {item.retryable ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Retry upload of ${item.name}`}
              onClick={() => queue.retry(item.id)}
            >
              <RotateCcw aria-hidden />
            </Button>
          ) : null}

          <Button
            variant="ghost"
            size="icon"
            aria-label={`Dismiss ${item.name}`}
            onClick={() => queue.dismiss(item.id)}
          >
            <X aria-hidden />
          </Button>
        </div>
      )}
    </li>
  );
}

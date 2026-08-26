"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, FileText, Folder, Loader2 } from "lucide-react";
import type { NodeSummary, SharedView } from "@data-room/shared";
import { Button } from "@/components/ui/button";
import { ListSkeleton, EmptyState, ErrorState } from "@/components/states";
import { ApiError } from "@/lib/api/client";
import { fetchSharedContentUrl, fetchSharedNode, fetchSharedView } from "../api/shares";

/**
 * What a recipient sees: the shared item, and — if it is a folder — what is inside it.
 *
 * Every control that would change something is **absent**, not disabled. A disabled Delete
 * still tells a viewer this is a system where they might delete things, and the API would
 * refuse it anyway; the honest interface simply does not offer what it cannot do.
 *
 * Navigation is component state rather than the URL. The token is already a credential in
 * the path, and pushing a node id beside it would multiply the number of URLs carrying that
 * credential into browser history, chat clients and referrer headers for no gain — a
 * recipient's deep link is the share link.
 */
export function SharedBrowser({ token }: { token: string }) {
  const [view, setView] = useState<SharedView | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "gone" | "signin" | "error">(
    "loading",
  );
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [trail, setTrail] = useState<ReadonlyArray<{ id: string; name: string }>>([]);

  const load = useCallback(
    async (targetId: string | null, signal: AbortSignal) => {
      setStatus("loading");
      try {
        const next =
          targetId === null
            ? await fetchSharedView(token, signal)
            : await fetchSharedNode(token, targetId, signal);

        setView(next);
        setStatus("ready");
      } catch (error) {
        if (signal.aborted) return;

        if (error instanceof ApiError && error.status === 401) {
          // The one denial that is not a 404: the holder of this link is expected, they just
          // have to prove who they are.
          setStatus("signin");
          return;
        }
        // Revoked, expired, deleted, moved out of the shared subtree, or never real. The
        // recipient is told the same thing for all of them, because the difference is not
        // theirs to know.
        setStatus(error instanceof ApiError && error.status === 404 ? "gone" : "error");
      }
    },
    [token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(nodeId, controller.signal);

    return () => {
      controller.abort();
    };
  }, [load, nodeId]);

  if (status === "signin") {
    return (
      <EmptyState
        title="Sign in to open this"
        description="This item was shared with specific people. Sign in with the address it was sent to."
        action={
          <Button asChild>
            <a href={`/sign-in?next=${encodeURIComponent(`/shared/${token}`)}`}>Sign in</a>
          </Button>
        }
      />
    );
  }

  if (status === "gone") {
    return (
      <EmptyState
        title="This link is no longer available"
        description="It may have been revoked, expired, or the item may have been removed."
      />
    );
  }

  if (status === "error") {
    return (
      <ErrorState
        title="Could not open this share"
        description="This is usually temporary."
        onRetry={() => {
          const controller = new AbortController();
          void load(nodeId, controller.signal);
        }}
      />
    );
  }

  if (status === "loading" || view === null) return <ListSkeleton />;

  const children = view.children?.items ?? [];

  return (
    <div className="grid gap-4">
      <nav aria-label="Shared location" className="flex flex-wrap items-center gap-1 text-sm">
        <button
          type="button"
          className="rounded px-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            setTrail([]);
            setNodeId(null);
          }}
        >
          {/* The trail starts at what was shared. Nothing above it is ever named — the owner
              shared one folder, not the path to it. */}
          {view.breadcrumbs[0]?.name ?? "Shared"}
        </button>
        {trail.map((step, index) => (
          <span key={step.id} className="flex items-center gap-1">
            <span aria-hidden className="text-muted-foreground">
              /
            </span>
            <button
              type="button"
              className="rounded px-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                setTrail(trail.slice(0, index + 1));
                setNodeId(step.id);
              }}
            >
              {step.name}
            </button>
          </span>
        ))}
      </nav>

      <header className="flex items-center justify-between gap-3">
        <h1 className="truncate text-2xl font-semibold">{view.node.name}</h1>
        {view.node.type === "FILE" ? <DownloadButton token={token} node={view.node} /> : null}
      </header>

      {view.node.type === "FILE" ? (
        <SharedFileFrame token={token} node={view.node} />
      ) : children.length === 0 ? (
        <EmptyState title="Nothing here" description="This folder is empty." />
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {children.map((child) => (
            <li key={child.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  setTrail([...trail, { id: view.node.id, name: view.node.name }]);
                  setNodeId(child.id);
                }}
              >
                {child.type === "FOLDER" ? (
                  <Folder aria-hidden className="size-4 text-muted-foreground" />
                ) : (
                  <FileText aria-hidden className="size-4 text-muted-foreground" />
                )}
                <span className="flex-1 truncate text-sm">{child.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A signed URL is fetched per action rather than held, because it expires in minutes and one
 * kept in component state becomes a blank frame the first time a recipient leaves the tab open.
 */
function useSharedContentUrl(token: string, nodeId: string) {
  const [isFetching, setFetching] = useState(false);

  const fetchUrl = useCallback(async (): Promise<string | null> => {
    setFetching(true);
    try {
      // Through the shared client, so the response is parsed against the same schema the API
      // declares rather than trusted field by field.
      const issued = await fetchSharedContentUrl(token, nodeId);

      return issued.url;
    } catch {
      // A URL that cannot be issued is a share that is no longer usable, which the view
      // above already knows how to say.
      return null;
    } finally {
      setFetching(false);
    }
  }, [token, nodeId]);

  return { fetchUrl, isFetching };
}

function DownloadButton({ token, node }: { token: string; node: NodeSummary }) {
  const { fetchUrl, isFetching } = useSharedContentUrl(token, node.id);

  return (
    <Button
      type="button"
      disabled={isFetching}
      onClick={() => {
        void fetchUrl().then((url) => {
          if (url !== null) window.open(url, "_blank", "noopener,noreferrer");
        });
      }}
    >
      {isFetching ? (
        <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
      ) : (
        <Download aria-hidden />
      )}
      Download
    </Button>
  );
}

function SharedFileFrame({ token, node }: { token: string; node: NodeSummary }) {
  const { fetchUrl } = useSharedContentUrl(token, node.id);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchUrl().then((next) => {
      if (!cancelled) setUrl(next);
    });

    return () => {
      cancelled = true;
    };
  }, [fetchUrl]);

  if (url === null) return <ListSkeleton rows={3} />;

  return (
    <object
      data={url}
      type="application/pdf"
      className="h-[70vh] w-full rounded-md border border-border"
    >
      {/* Inline PDF rendering varies by browser; the fallback is a real way to read it
          rather than an apology. */}
      <p className="p-4 text-sm">
        This browser cannot display the PDF inline.{" "}
        <a href={url} className="underline" target="_blank" rel="noopener noreferrer">
          Open it in a new tab
        </a>
        .
      </p>
    </object>
  );
}

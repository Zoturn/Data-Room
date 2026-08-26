import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { FileViewer } from "@/features/data-room/components/FileViewer";

export const metadata: Metadata = {
  title: "Data Room",
  // Private by definition, and reachable only with a session — but say so anyway.
  robots: { index: false, follow: false },
};

/**
 * One file, open on its own page rather than in an overlay: a document being read has to
 * survive a refresh, be linkable and give Back somewhere sensible to return to, and none of
 * that is true of state held in the folder listing.
 *
 * The segment stays a server component so the client boundary sits on `FileViewer`, which
 * is where the data is — the metadata is per-user and cookie-authorised, and the bytes come
 * from a signed URL the browser fetches directly, so there is nothing here to prerender.
 */
export default async function FilePage({
  params,
}: {
  params: Promise<{ roomId: string; fileId: string }>;
}) {
  const { roomId, fileId } = await params;

  return (
    <AppShell>
      <FileViewer roomId={roomId} fileId={fileId} />
    </AppShell>
  );
}

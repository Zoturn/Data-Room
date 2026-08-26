import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { FolderContents } from "@/features/data-room/components/FolderContents";

export const metadata: Metadata = {
  title: "Data Room",
  // Private by definition, and reachable only with a session — but say so anyway.
  robots: { index: false, follow: false },
};

/**
 * The open folder is the URL. Back, forward, refresh and a pasted link all resolve to the
 * same folder because nothing about where you are lives in React state.
 *
 * The segment stays a server component so the client boundary sits on `FolderContents`,
 * which is where the data actually is: folder contents are per-user, cookie-authorised and
 * mutated constantly, so rendering them on the server buys nothing.
 */
export default async function FolderPage({
  params,
}: {
  params: Promise<{ roomId: string; folderId: string }>;
}) {
  const { roomId, folderId } = await params;

  return (
    <AppShell>
      <FolderContents roomId={roomId} folderId={folderId} />
    </AppShell>
  );
}

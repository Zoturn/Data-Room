import type { Metadata } from "next";
import { SharedBrowser } from "@/features/sharing/components/SharedBrowser";

/**
 * A shared item, opened from a link.
 *
 * Outside the `(app)` route group on purpose: that group's layout requires a session, and a
 * recipient of a public link has none. Putting this route inside it would redirect every
 * recipient to sign-in, which is the bug the group's fail-closed default is supposed to cause
 * everywhere except here.
 */
export const metadata: Metadata = {
  title: "Shared · Data Room",
  // The API sends X-Robots-Tag on its responses; this is the same instruction for the page
  // itself, because a share link that reaches a crawler is a document vault in a search index.
  robots: { index: false, follow: false },
};

export default async function SharedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <SharedBrowser token={token} />
    </main>
  );
}

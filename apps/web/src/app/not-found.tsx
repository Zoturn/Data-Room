import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <AppShell>
      <EmptyState
        title="This page does not exist"
        description="The link may be wrong, or the item may have been deleted or its share revoked."
        action={
          <Button asChild variant="outline">
            <Link href="/">Back to the Data Room</Link>
          </Button>
        }
      />
    </AppShell>
  );
}

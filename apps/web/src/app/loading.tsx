import { AppShell } from "@/components/app-shell";
import { ListSkeleton } from "@/components/states";

export default function Loading() {
  return (
    <AppShell>
      <ListSkeleton />
    </AppShell>
  );
}

import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/states";
import { FolderLock } from "lucide-react";

export default function HomePage() {
  return (
    <AppShell>
      <h1 className="mb-6 text-2xl font-semibold">Data Room</h1>
      <EmptyState
        icon={<FolderLock className="size-8" aria-hidden />}
        title="Nothing here yet"
        description="Sign-in arrives with add-authentication, and folders and files with the changes after it. The shell, the API client and the shared contract are in place."
      />
    </AppShell>
  );
}

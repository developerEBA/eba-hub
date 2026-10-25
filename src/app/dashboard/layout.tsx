import { AppShell } from "@/components/layout/app-shell";
import { loadWorkspace } from "@/modules/operations/queries";
export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const data = await loadWorkspace();
  return (
    <AppShell
      preview={data.session.preview}
      header={{
        displayName: data.session.preview
          ? "Setup required"
          : data.session.displayName,
        role: data.session.preview ? "" : data.session.role,
        ready: data.ready,
        counts: data.counts,
      }}
    >
      {children}
    </AppShell>
  );
}

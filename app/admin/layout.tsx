import { AppShell } from "@/components/app-shell";
import { requireAdmin } from "@/lib/authz";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  return <AppShell role="ADMIN" userName={user.name} title="Administrator workspace">{children}</AppShell>;
}

import { AppShell } from "@/components/app-shell";
import { requireIntern } from "@/lib/authz";

export default async function InternLayout({ children }: { children: React.ReactNode }) {
  const user = await requireIntern();
  return <AppShell role="INTERN" userName={user.name} title="Intern workspace">{children}</AppShell>;
}

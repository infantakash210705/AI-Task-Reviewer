import Link from "next/link";
import { Activity, BriefcaseBusiness, ChartNoAxesCombined, ClipboardList, FileText, LayoutDashboard, UsersRound, Video } from "lucide-react";
import { Brand } from "@/components/brand";
import { SignOutButton } from "@/components/sign-out-button";
import { MobileNavigation } from "@/components/mobile-navigation";

const adminLinks = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/interns", label: "Interns", icon: UsersRound },
  { href: "/admin/tasks", label: "Tasks", icon: ClipboardList },
  { href: "/admin/assignments", label: "Assignments", icon: BriefcaseBusiness },
  { href: "/admin/meetings", label: "Meetings", icon: Video },
  { href: "/admin/automation", label: "Automation", icon: Activity },
];
const internLinks = [
  { href: "/intern", label: "My overview", icon: LayoutDashboard },
  { href: "/intern/tasks", label: "My tasks", icon: ClipboardList },
  { href: "/intern/submissions", label: "Submissions", icon: FileText },
  { href: "/intern/reviews", label: "Reviews", icon: ChartNoAxesCombined },
];

export function AppShell({ children, role, userName, title }: { children: React.ReactNode; role: "ADMIN" | "INTERN"; userName: string; title: string }) {
  const links = role === "ADMIN" ? adminLinks : internLinks;
  const home = role === "ADMIN" ? "/admin" : "/intern";
  return (
    <div className="layout">
      <aside className="sidebar">
        <Link href={home}><Brand light /></Link>
        <div className="nav-label">Workspace</div>
        {links.map(({ href, label, icon: Icon }) => <Link className={`nav-link${title === label ? " active" : ""}`} key={href} href={href}><Icon size={16} />{label}</Link>)}
        <div className="sidebar-bottom">
          <div style={{ color: "white", fontWeight: 650, marginBottom: 5 }}>{userName || "Account"}</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{role === "ADMIN" ? "Administrator" : "Intern"}</span>
            <SignOutButton />
          </div>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar"><MobileNavigation role={role} /><div className="page-title">{title}</div><div style={{ color: "#718096", fontSize: 12 }}>Internship &amp; Project Management</div></header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { BriefcaseBusiness, ClipboardList, FileText, LayoutDashboard, Menu, UsersRound, Video, X } from "lucide-react";

const links = {
  ADMIN: [
    { href: "/admin", label: "Overview", icon: LayoutDashboard },
    { href: "/admin/interns", label: "Interns", icon: UsersRound },
    { href: "/admin/tasks", label: "Tasks", icon: ClipboardList },
    { href: "/admin/assignments", label: "Assignments", icon: BriefcaseBusiness },
    { href: "/admin/meetings", label: "Meetings", icon: Video },
  ],
  INTERN: [
    { href: "/intern", label: "My overview", icon: LayoutDashboard },
    { href: "/intern/tasks", label: "My tasks", icon: ClipboardList },
    { href: "/intern/submissions", label: "Submissions", icon: FileText },
    { href: "/intern/reviews", label: "Reviews", icon: BriefcaseBusiness },
  ],
};

export function MobileNavigation({ role }: { role: "ADMIN" | "INTERN" }) {
  const [open, setOpen] = useState(false);
  return <div className="mobile-menu">
    <button type="button" className="button" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X size={17} /> : <Menu size={17} />}</button>
    {open && <div style={{ position: "fixed", inset: "66px 0 0", background: "#14233bf2", zIndex: 20, padding: 20 }}><nav aria-label="Mobile navigation">{links[role].map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setOpen(false)} className="nav-link" style={{ padding: 14 }}><Icon size={17} />{label}</Link>)}</nav></div>}
  </div>;
}

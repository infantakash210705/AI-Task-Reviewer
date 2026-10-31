"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

export function SignOutButton() {
  return <button type="button" aria-label="Sign out" onClick={() => signOut({ callbackUrl: "/login" })} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: 0, background: "transparent", color: "#d5deed", cursor: "pointer", fontSize: 11 }}><LogOut size={14} /> Sign out</button>;
}

"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export function SelfProfileForm() {
  const router = useRouter(); const [busy, setBusy] = useState(false);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/intern/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        department: data.get("department"), internshipTitle: data.get("internshipTitle"), startDate: data.get("startDate"), expectedEndDate: data.get("expectedEndDate"), phone: data.get("phone"),
      }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not save your profile.");
      toast.success("Your internship profile is ready."); router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save your profile."); }
    finally { setBusy(false); }
  }
  return <form className="card-body" onSubmit={onSubmit} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
    <input className="input" name="department" placeholder="Department" required maxLength={100} />
    <input className="input" name="internshipTitle" placeholder="Internship title" required maxLength={120} />
    <label className="subtle">Start date<input className="input" name="startDate" type="date" required /></label>
    <label className="subtle">Expected end date<input className="input" name="expectedEndDate" type="date" required /></label>
    <input className="input" name="phone" placeholder="Phone (optional)" maxLength={30} />
    <button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Complete profile"}</button>
  </form>;
}

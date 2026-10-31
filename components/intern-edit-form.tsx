"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export function InternEditForm({ intern }: { intern: { id: string; department: string; internshipTitle: string; startDate: string; expectedEndDate: string; status: string } }) {
  const router = useRouter(); const [busy, setBusy] = useState(false);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/interns/${intern.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        department: data.get("department"), internshipTitle: data.get("internshipTitle"), startDate: data.get("startDate"), expectedEndDate: data.get("expectedEndDate"), status: data.get("status"),
      }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not update profile.");
      toast.success("Intern profile updated."); router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update profile."); }
    finally { setBusy(false); }
  }
  return <form className="card-body" onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
    <label>Department<input className="input" name="department" defaultValue={intern.department} required /></label>
    <label>Internship title<input className="input" name="internshipTitle" defaultValue={intern.internshipTitle} required /></label>
    <label>Start date<input className="input" name="startDate" type="date" defaultValue={new Date(intern.startDate).toISOString().slice(0, 10)} required /></label>
    <label>Expected end date<input className="input" name="expectedEndDate" type="date" defaultValue={new Date(intern.expectedEndDate).toISOString().slice(0, 10)} required /></label>
    <label>Status<select className="input" name="status" defaultValue={intern.status}><option>ACTIVE</option><option>COMPLETED</option><option>INACTIVE</option></select></label>
    <button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
    <p className="subtle">The linked account identity and intern code cannot be changed here.</p>
  </form>;
}

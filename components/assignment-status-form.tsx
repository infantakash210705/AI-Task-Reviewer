"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export function AssignmentStatusForm({ assignmentId, status }: { assignmentId: string; status: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/assignments/${assignmentId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: data.get("status") }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not update assignment.");
      toast.success("Assignment status updated."); router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update assignment."); }
    finally { setBusy(false); }
  }
  const next: Record<string, string[]> = { ASSIGNED: ["IN_PROGRESS", "COMPLETED"], IN_PROGRESS: ["SUBMITTED", "COMPLETED"], SUBMITTED: ["IN_REVIEW", "REVISION_REQUIRED", "COMPLETED"], IN_REVIEW: ["REVISION_REQUIRED", "COMPLETED"], REVISION_REQUIRED: ["IN_PROGRESS", "SUBMITTED", "COMPLETED"], COMPLETED: [] };
  return <form className="toolbar" onSubmit={onSubmit}><select className="input" name="status" required defaultValue=""><option value="" disabled>Choose next status</option>{(next[status] || []).map((value) => <option key={value}>{value}</option>)}</select><button className="button" disabled={busy || !next[status]?.length}>{busy ? "Saving…" : "Update status"}</button></form>;
}

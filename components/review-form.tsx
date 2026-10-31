"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type SubmissionOption = { id: string; version: number };
export function ReviewForm({ assignmentId, submissions }: { assignmentId: string; submissions: SubmissionOption[] }) {
  const router = useRouter(); const [busy, setBusy] = useState(false);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); const data = new FormData(event.currentTarget);
    const asList = (name: string) => String(data.get(name) || "").split("\n").map((value) => value.trim()).filter(Boolean);
    try {
      const response = await fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        assignmentId, submissionId: data.get("submissionId"), summary: data.get("summary"), findings: asList("findings"),
        recommendations: asList("recommendations"), result: data.get("result"),
      }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not save the review.");
      toast.success("Review record added."); event.currentTarget.reset(); router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save the review."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={onSubmit} className="card-body" style={{ display: "grid", gap: 10 }}>
    <label>Submission<select className="input" name="submissionId" required defaultValue=""><option value="" disabled>Select submission</option>{submissions.map((item) => <option key={item.id} value={item.id}>Version {item.version}</option>)}</select></label>
    <label>Summary<input className="input" name="summary" required maxLength={2000} /></label>
    <label>Findings<textarea className="input" name="findings" rows={3} placeholder="One finding per line" /></label>
    <label>Recommendations<textarea className="input" name="recommendations" rows={3} placeholder="One recommendation per line" /></label>
    <label>Result<select className="input" name="result" defaultValue="IN_REVIEW"><option value="IN_REVIEW">In review</option><option value="REVISION_REQUIRED">Revision required</option><option value="APPROVED">Approved</option></select></label>
    <button className="button button-primary" disabled={busy || !submissions.length}>{busy ? "Saving…" : "Add review record"}</button>
    <div className="subtle">This records administrator-entered feedback. Automated GitHub reviews are handled separately.</div>
  </form>;
}

"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export type MeetingRequestView = {
  id: string;
  topic: string;
  status: "PENDING" | "APPROVED" | "DECLINED" | "CANCELLED";
  adminNote?: string;
  createdAt: string;
  meetUrl?: string;
  scheduledAt?: string;
  timezone?: string;
};

export function MeetingRequestForm({ assignmentId, requests, disabled }: { assignmentId: string; requests: MeetingRequestView[]; disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const hasPending = requests.some((request) => request.status === "PENDING");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const proposedTimes = ["time1", "time2"]
      .map((name) => String(data.get(name) || ""))
      .filter(Boolean)
      .map((value) => new Date(value).toISOString());
    setBusy(true);
    try {
      const response = await fetch("/api/intern/meeting-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId, topic: data.get("topic"), proposedTimes, consent: data.get("consent") === "on" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.details?.topic?.[0] || body.details?.consent?.[0] || body.error || "Could not send your request.");
      toast.success("Request sent. Your admin will confirm a time.");
      form.reset();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send your request.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/intern/meeting-requests/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "CANCEL" }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not cancel the request.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel the request.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="card-body" style={{ display: "grid", gap: 12 }}>
    {disabled ? <p className="subtle">This task is complete, so no more meetings can be requested for it.</p>
      : hasPending ? <p className="subtle">You have a request waiting for your admin. You can ask for another once it is answered.</p>
        : <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
          <p className="subtle">Stuck on something or unsure what the task needs? Ask for a short clarification call. Your admin approves it and picks the time.</p>
          <textarea className="input" name="topic" rows={3} required minLength={10} maxLength={1500} placeholder="What would you like to clear up? (for example: I'm not sure how the pagination should behave)" />
          <label className="subtle">Preferred time (optional)<input className="input" type="datetime-local" name="time1" /></label>
          <label className="subtle">Another option (optional)<input className="input" type="datetime-local" name="time2" /></label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input type="checkbox" name="consent" required />
            <span className="subtle">I understand the session is led by Shortfundly&apos;s virtual mentor, my speech is turned into text during the call so it can reply, and only the text is kept (no audio or video).</span>
          </label>
          <button className="button button-primary" disabled={busy} type="submit">{busy ? "Sending…" : "Request a meeting"}</button>
        </form>}
    {requests.length > 0 && <div style={{ display: "grid", gap: 8 }}>
      <strong>Your requests</strong>
      {requests.map((request) => <div key={request.id} className="placeholder-row" style={{ alignItems: "flex-start" }}>
        <div>
          <span className="badge">{request.status}</span>
          <div className="subtle" style={{ marginTop: 6 }}>{request.topic}</div>
          {request.status === "APPROVED" && request.scheduledAt && <div className="subtle">{new Date(request.scheduledAt).toLocaleString("en", { timeZone: request.timezone || "UTC", dateStyle: "medium", timeStyle: "short" })} · {request.timezone || "UTC"}{request.meetUrl && <> · <a href={request.meetUrl} target="_blank" rel="noreferrer">Join Meet</a></>}</div>}
          {request.adminNote && <div className="subtle">Admin note: {request.adminNote}</div>}
        </div>
        {request.status === "PENDING" && <button className="button" type="button" disabled={busy} onClick={() => void cancel(request.id)}>Cancel</button>}
      </div>)}
    </div>}
  </div>;
}

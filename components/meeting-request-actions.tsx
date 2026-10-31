"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function MeetingRequestActions({ requestId, suggestedTime }: { requestId: string; suggestedTime?: string }) {
  const router = useRouter();
  const [when, setWhen] = useState(toLocalInput(suggestedTime));
  const [duration, setDuration] = useState(30);
  const [note, setNote] = useState("");
  const [meetUrl, setMeetUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(action: "APPROVE" | "DECLINE") {
    if (action === "APPROVE" && !when) { toast.error("Pick a date and time first."); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/meeting-requests/${encodeURIComponent(requestId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "APPROVE" ? { action, scheduledAt: new Date(when).toISOString(), durationMinutes: duration, adminNote: note, ...(meetUrl.trim() ? { meetUrl: meetUrl.trim() } : {}) } : { action, adminNote: note }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not update the request.");
      toast.success(action === "APPROVE" ? (body.emailSent === false ? "Approved. The email could not be sent, so tell the intern directly." : "Approved. Meet link created and intern notified.") : "Declined.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the request.");
    } finally {
      setBusy(false);
    }
  }

  return <div style={{ display: "grid", gap: 8, minWidth: 240 }}>
    <label className="subtle">Meeting time (your local time)<input className="input" type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} /></label>
    <label className="subtle">Length<select className="input" value={duration} onChange={(event) => setDuration(Number(event.target.value))}><option value={15}>15 min</option><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option></select></label>
    <input className="input" placeholder="Google Meet link (optional, e.g. meet.google.com/xxx-yyyy-zzz)" value={meetUrl} onChange={(event) => setMeetUrl(event.target.value)} />
    <input className="input" placeholder="Note to the intern (optional)" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
    <div style={{ display: "flex", gap: 8 }}>
      <button className="button button-primary" type="button" disabled={busy} onClick={() => void send("APPROVE")}>{busy ? "Working…" : "Approve & schedule"}</button>
      <button className="button" type="button" disabled={busy} onClick={() => void send("DECLINE")}>Decline</button>
    </div>
  </div>;
}

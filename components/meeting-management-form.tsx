"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function MeetingManagementForm({ meetingId }: { meetingId: string }) {
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function send(action: "RESCHEDULE" | "CANCEL", event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (action === "CANCEL" && !window.confirm("Cancel this Google Calendar event and its meeting reminders?")) return;
    if (action === "RESCHEDULE" && !date) {
      setError("Choose a new meeting date and time.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/meetings/${encodeURIComponent(meetingId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(action === "RESCHEDULE" ? { scheduledAt: new Date(date).toISOString() } : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Meeting update failed.");
      router.refresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Meeting update failed.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="meeting-actions">
    <form onSubmit={(event) => void send("RESCHEDULE", event)}>
      <label htmlFor={`meeting-date-${meetingId}`}>New time (your local timezone)</label>
      <input id={`meeting-date-${meetingId}`} className="input" type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} disabled={busy} />
      <button className="button" type="submit" disabled={busy}>{busy ? "Updating…" : "Reschedule"}</button>
    </form>
    <button className="button" type="button" onClick={() => void send("CANCEL")} disabled={busy}>{busy ? "Updating…" : "Cancel meeting"}</button>
    {error && <div className="setup-note" role="alert">{error}</div>}
  </div>;
}

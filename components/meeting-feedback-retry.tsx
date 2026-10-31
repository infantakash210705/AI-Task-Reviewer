"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export function MeetingFeedbackRetry({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function retry() {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/meetings/${encodeURIComponent(meetingId)}/feedback`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not queue the feedback email.");
      toast.success("Feedback queued. Refresh in a minute.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not queue the feedback email.");
    } finally { setBusy(false); }
  }
  return <button className="button" type="button" disabled={busy} onClick={() => void retry()}>{busy ? "Queuing…" : "Send feedback now"}</button>;
}

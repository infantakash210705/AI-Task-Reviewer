"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export function SubmissionRetryButton({ submissionId, label = "Retry AI review" }: { submissionId: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function retry() {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/submissions/${submissionId}/retry`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not queue review retry.");
      toast.success("AI review queued.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not queue review retry.");
    } finally {
      setBusy(false);
    }
  }

  return <button className="button" disabled={busy} onClick={retry} type="button">{busy ? "Queueing…" : label}</button>;
}

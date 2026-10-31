"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AutomationRetryButton({ assignmentId }: { assignmentId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function retry() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/assignments/${encodeURIComponent(assignmentId)}/automation/retry`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Automation could not be retried.");
      router.refresh();
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "Automation could not be retried.");
    } finally {
      setBusy(false);
    }
  }

  return <span>
    <button className="button" type="button" onClick={() => void retry()} disabled={busy}>{busy ? "Retrying…" : "Retry workflow"}</button>
    {error && <span className="setup-note" role="alert">{error}</span>}
  </span>;
}

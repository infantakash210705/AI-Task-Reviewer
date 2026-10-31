"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot, CheckCircle, ExternalLink, Mic, Sparkles, Video } from "lucide-react";

type MeetingIntent = "CODE_REVIEW" | "ACCEPTANCE_CRITERIA" | "DEBUG_ERROR" | "ARCHITECTURE" | "GENERAL_QUERY";

const INTENTS: { id: MeetingIntent; label: string; icon: string; suggestions: string[] }[] = [
  {
    id: "CODE_REVIEW",
    label: "Code Review & Feedback",
    icon: "🔍",
    suggestions: [
      "Review my submitted GitHub repository code against the acceptance criteria.",
      "Explain what changes are needed to resolve my latest review findings.",
      "Check if my implementation follows best code practices and modular structure.",
    ],
  },
  {
    id: "ACCEPTANCE_CRITERIA",
    label: "Clarify Acceptance Criteria",
    icon: "📋",
    suggestions: [
      "Clarify what edge cases should be handled for this task.",
      "Explain what requirement #2 expects for input validation.",
      "What are the mandatory deliverables for passing this assignment?",
    ],
  },
  {
    id: "DEBUG_ERROR",
    label: "Help Debug Error",
    icon: "🐛",
    suggestions: [
      "I'm encountering an issue where the API returns 500 on valid requests.",
      "Help me troubleshoot why my unit tests are failing.",
      "My database query or async pipeline is timing out.",
    ],
  },
  {
    id: "ARCHITECTURE",
    label: "Architecture & DB Design",
    icon: "🏛️",
    suggestions: [
      "Walk me through the recommended architecture and schema structure.",
      "How should I structure the folder hierarchy and route handlers?",
      "What is the best way to handle authentication and state management here?",
    ],
  },
  {
    id: "GENERAL_QUERY",
    label: "General Q&A",
    icon: "💡",
    suggestions: [
      "I have questions on the overall workflow and delivery timeline.",
      "Can you give me an overview of the key concepts needed for this task?",
      "How will my final submission be evaluated by the team?",
    ],
  },
];

export function MeetBotForm({
  assignmentId,
  taskTitle,
  clarificationQuestions = [],
  disabled = false,
}: {
  assignmentId: string;
  taskTitle?: string;
  clarificationQuestions?: string[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [meetUrl, setMeetUrl] = useState("");
  const [topic, setTopic] = useState("");
  const [intent, setIntent] = useState<MeetingIntent>("CODE_REVIEW");
  const [reviewType, setReviewType] = useState<"REVIEW" | "CLARIFICATION">("REVIEW");
  const [scheduleMode, setScheduleMode] = useState<"NOW" | "LATER">("NOW");
  const [scheduledAt, setScheduledAt] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [successInfo, setSuccessInfo] = useState<{
    meetUrl: string;
    isImmediate: boolean;
    message: string;
  } | null>(null);

  const activeIntent = INTENTS.find((i) => i.id === intent) || INTENTS[0];
  const combinedSuggestions = Array.from(
    new Set([...activeIntent.suggestions, ...(clarificationQuestions || [])]),
  ).slice(0, 6);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!meetUrl.trim()) {
      toast.error("Please enter your Google Meet link.");
      return;
    }
    if (!topic.trim()) {
      toast.error("Please describe what queries you want to review or clarify.");
      return;
    }
    if (!consent) {
      toast.error("Please accept the session consent notice.");
      return;
    }
    if (scheduleMode === "LATER" && !scheduledAt) {
      toast.error("Please choose a date and time for the scheduled meeting.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/intern/assignments/${encodeURIComponent(assignmentId)}/meet-bot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetUrl: meetUrl.trim(),
          topic: topic.trim(),
          intent,
          reviewType,
          scheduleMode,
          scheduledAt: scheduleMode === "LATER" ? new Date(scheduledAt).toISOString() : undefined,
          consent: true,
        }),
      });

      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.details?.meetUrl?.[0] || body.details?.topic?.[0] || body.error || "Could not invite bot.");
      }

      setSuccessInfo({
        meetUrl: body.meetUrl,
        isImmediate: body.isImmediate,
        message: body.message,
      });

      toast.success(body.isImmediate ? "AI mentor bot invited to your Google Meet!" : "AI mentor bot scheduled!");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not invite bot.");
    } finally {
      setBusy(false);
    }
  }

  if (disabled) {
    return (
      <div className="card-body">
        <p className="subtle">This task is completed. Meeting reviews and bot requests are concluded.</p>
      </div>
    );
  }

  return (
    <div className="card-body" style={{ display: "grid", gap: 14 }}>
      {successInfo ? (
        <div style={{ padding: 16, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#166534", fontWeight: 600 }}>
            <CheckCircle size={18} />
            <span>{successInfo.isImmediate ? "Bot Dispatched to Google Meet" : "Bot Scheduled Successfully"}</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "#15803d", lineHeight: 1.5 }}>{successInfo.message}</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <a
              href={successInfo.meetUrl}
              target="_blank"
              rel="noreferrer"
              className="button button-primary"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Video size={15} /> Join Google Meet Call <ExternalLink size={13} />
            </a>
            <button
              type="button"
              className="button"
              onClick={() => {
                setSuccessInfo(null);
                setMeetUrl("");
                setTopic("");
              }}
            >
              Invite to another meeting
            </button>
          </div>
          <p className="subtle" style={{ margin: 0, fontSize: 12 }}>
            💡 <strong>Tip:</strong> Recall AI connects as a meeting participant. When &quot;Arjun | Shortfundly Virtual Mentor&quot; knocks, click <strong>Admit</strong> in Google Meet. Arjun&apos;s microphone is unmuted, so he will greet you aloud, directly answer your specific intent, and ask guiding questions. After your call, an automated review feedback email will be sent to you based on your discussion and GitHub repository.
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
          <div>
            <p className="subtle" style={{ margin: "0 0 6px 0", fontSize: 13 }}>
              Paste your Google Meet link below. Our virtual mentor bot will join the meeting via Recall.ai to discuss and review {taskTitle ? `"${taskTitle}"` : "your task"}, clarify your doubts aloud, and follow up with a detailed feedback email.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, fontSize: 12, color: "#166534" }}>
              <Mic size={14} color="#16a34a" />
              <span><strong>Virtual Microphone Active:</strong> The bot speaks aloud in your meeting, answers your selected intent directly, and asks follow-up questions to clarify all details.</span>
            </div>
          </div>

          <div>
            <label className="subtle" style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
              Google Meet Link
            </label>
            <input
              type="text"
              className="input"
              value={meetUrl}
              onChange={(e) => setMeetUrl(e.target.value)}
              placeholder="https://meet.google.com/abc-defg-hij"
              required
              disabled={busy}
            />
          </div>

          <div>
            <label className="subtle" style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>
              What is your primary intent for this meeting?
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {INTENTS.map((item) => {
                const isSelected = intent === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setIntent(item.id);
                      setReviewType(item.id === "CODE_REVIEW" ? "REVIEW" : "CLARIFICATION");
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 12px",
                      borderRadius: 18,
                      border: isSelected ? "1.5px solid #4f46e5" : "1px solid #e2e8f0",
                      background: isSelected ? "#eef2ff" : "#ffffff",
                      color: isSelected ? "#4338ca" : "#475569",
                      fontWeight: isSelected ? 600 : 400,
                      fontSize: 12,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label className="subtle" style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
                Meeting Purpose
              </label>
              <select
                className="input"
                value={reviewType}
                onChange={(e) => setReviewType(e.target.value as "REVIEW" | "CLARIFICATION")}
                disabled={busy}
              >
                <option value="REVIEW">Code Review & Feedback</option>
                <option value="CLARIFICATION">Doubt & Task Clarification</option>
              </select>
            </div>
            <div>
              <label className="subtle" style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
                Join Timing
              </label>
              <select
                className="input"
                value={scheduleMode}
                onChange={(e) => setScheduleMode(e.target.value as "NOW" | "LATER")}
                disabled={busy}
              >
                <option value="NOW">Join right now (immediate)</option>
                <option value="LATER">Schedule for later</option>
              </select>
            </div>
          </div>

          {scheduleMode === "LATER" && (
            <div>
              <label className="subtle" style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
                Scheduled Start Time (at least 10 min ahead)
              </label>
              <input
                type="datetime-local"
                className="input"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                required={scheduleMode === "LATER"}
                disabled={busy}
              />
            </div>
          )}

          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <Sparkles size={14} color="#6366f1" />
              <span className="subtle" style={{ fontWeight: 500, fontSize: 12 }}>
                Suggested queries for &quot;{activeIntent.label}&quot; (click to add):
              </span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {combinedSuggestions.map((suggestion, index) => (
                <button
                  type="button"
                  key={index}
                  onClick={() => setTopic((prev) => (prev ? `${prev} ${suggestion}` : suggestion))}
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: 14,
                    padding: "3px 10px",
                    fontSize: 11,
                    color: "#475569",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  title="Click to insert query"
                >
                  + {suggestion}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="subtle" style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
              Specific questions or topics for this call
            </label>
            <textarea
              className="input"
              rows={3}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={`E.g., for ${activeIntent.label.toLowerCase()}: I want to review my implementation for requirement #2 and clarify edge cases...`}
              required
              disabled={busy}
            />
          </div>

          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              required
              disabled={busy}
              style={{ marginTop: 2 }}
            />
            <span className="subtle">
              I understand that Shortfundly&apos;s virtual mentor bot (Arjun) will join the Google Meet call as a participant with microphone active. It answers questions aloud in real time and asks follow-up questions. Only transcript text is stored, and an AI review summary will be emailed to me after the session.
            </span>
          </label>

          <button
            type="submit"
            className="button button-primary"
            disabled={busy || !consent || !meetUrl.trim() || !topic.trim()}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}
          >
            <Bot size={16} />
            {busy ? "Connecting..." : scheduleMode === "NOW" ? "Invite AI Bot to Google Meet Now" : "Schedule AI Mentor Bot"}
          </button>
        </form>
      )}
    </div>
  );
}

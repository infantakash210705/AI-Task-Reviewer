import Link from "next/link";
import { AutomationRetryButton } from "@/components/automation-retry-button";
import { MeetingManagementForm } from "@/components/meeting-management-form";
import { SubmissionRetryButton } from "@/components/submission-retry-button";
import { connectDB } from "@/lib/db";
import { Assignment, AutomationRun, EmailLog, Meeting, Review, Submission } from "@/lib/models";
import { meetingAgentConfiguration } from "@/lib/automation/meeting-agent-provider";

export const dynamic = "force-dynamic";

type RunRow = {
  _id?: unknown;
  assignmentId?: unknown;
  status?: string;
  attemptCount?: number;
  updatedAt?: Date | string;
  lastError?: string;
};

type AssignmentRow = {
  _id?: unknown;
  taskSnapshot?: { title?: string };
  automationStatus?: string;
  explanationStatus?: string;
  lastAutomationError?: string;
};

type MeetingRow = {
  _id?: unknown;
  assignmentId?: { _id?: unknown; taskSnapshot?: { title?: string }; internId?: { userId?: { name?: string } } };
  meetingType?: string;
  scheduledAt?: Date | string;
  timezone?: string;
  conferenceUrl?: string;
  meetingUrl?: string;
  meetingProvider?: string;
  agentConsentStatus?: string;
  agentStatus?: string;
  agentRecordingEnabled?: boolean;
};

type FailedSubmissionRow = {
  _id?: unknown;
  version?: number;
  errorSummary?: string;
  assignmentId?: { _id?: unknown; taskSnapshot?: { title?: string } };
  internId?: { userId?: { name?: string } };
};

type ReviewQueueRow = {
  _id?: unknown;
  version?: number;
  assignmentId?: { taskSnapshot?: { title?: string } };
  internId?: { userId?: { name?: string } };
};

export default async function AdminAutomationPage() {
  await connectDB();
  const now = new Date();
  const [
    completed, pending, failed, failedMeetings, queuedReviews, processingReviews, revisionReviews,
    clarificationReviews, completedReviews, failedSubmissions, queuedSubmissions, waitingForExplanation,
    upcomingMeetings, failedEmails, recentRuns,
  ] = await Promise.all([
    AutomationRun.countDocuments({ status: "COMPLETED" }),
    AutomationRun.countDocuments({ status: { $in: ["PENDING", "PROCESSING"] } }),
    AutomationRun.countDocuments({ status: "FAILED" }),
    Meeting.countDocuments({ status: "FAILED" }),
    Submission.countDocuments({ processingStatus: "QUEUED" }),
    Submission.countDocuments({ processingStatus: "PROCESSING" }),
    Review.countDocuments({ outcome: "REVISION_REQUIRED" }),
    Review.countDocuments({ outcome: "NEEDS_CLARIFICATION" }),
    Review.countDocuments({ outcome: "PASS" }),
    Submission.find({ processingStatus: "FAILED" })
      .populate({ path: "assignmentId", select: "taskSnapshot" })
      .populate({ path: "internId", populate: { path: "userId", select: "name" } })
      .sort({ submittedAt: -1 }).limit(20).lean(),
    Submission.find({ processingStatus: "QUEUED" })
      .populate({ path: "assignmentId", select: "taskSnapshot" })
      .populate({ path: "internId", populate: { path: "userId", select: "name" } })
      .sort({ submittedAt: 1 }).limit(20).lean(),
    Assignment.find({ $or: [{ explanationStatus: { $in: ["PENDING", "PROCESSING", "FAILED"] } }, { automationStatus: "FAILED" }] }).sort({ createdAt: -1 }).limit(20).lean(),
    Meeting.find({ status: "SCHEDULED", scheduledAt: { $gte: now } })
      .populate({ path: "assignmentId", select: "taskSnapshot internId", populate: { path: "internId", populate: { path: "userId", select: "name" } } })
      .sort({ scheduledAt: 1 }).limit(20).lean(),
    EmailLog.find({ status: { $in: ["FAILED", "BOUNCED"] } }).sort({ lastAttemptAt: -1 }).limit(20).lean(),
    AutomationRun.find({}).sort({ updatedAt: -1 }).limit(15).lean(),
  ]);
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY);
  const calendarConfigured = Boolean(process.env.GOOGLE_CALENDAR_CLIENT_ID && process.env.GOOGLE_CALENDAR_CLIENT_SECRET && process.env.GOOGLE_CALENDAR_REFRESH_TOKEN);
  const smtpConfigured = Boolean(
    process.env.SMTP_USER?.trim()
    && process.env.SMTP_PASSWORD?.trim()
    && process.env.EMAIL_FROM?.trim()
    && (process.env.SMTP_HOST?.trim() || "smtp.gmail.com")
    && (process.env.SMTP_PORT?.trim() || "465"),
  );
  const inngestConfigured = Boolean(process.env.INNGEST_EVENT_KEY && process.env.INNGEST_SIGNING_KEY);
  const meetingAgent = meetingAgentConfiguration();
  const meetingAgentLabel = meetingAgent.provider === "DISABLED"
    ? "Disabled"
    : meetingAgent.missingCredentials.length
      ? "Pending configuration"
      : meetingAgent.integrationStatus === "READY" ? "Configured (not live-verified)" : "Pending integration";

  return <>
    <div className="page-heading"><div><h1>Automation</h1><p>Workflow health, confirmed sessions, and recoverable failures.</p></div></div>
    <div className="stat-grid">
      {[["Completed workflows", completed], ["Pending / processing", pending], ["Failed workflows", failed], ["Failed meetings", failedMeetings], ["Reviews queued", queuedReviews], ["Reviews processing", processingReviews], ["Revision required", revisionReviews], ["Needs clarification", clarificationReviews], ["Projects completed", completedReviews], ["Failed or bounced emails", failedEmails.length]].map(([label, count]) => <div className="card stat-card" key={String(label)}><div className="stat-top"><span>{label}</span></div><div className="stat-value">{count}</div><div className="stat-foot">Live persisted records</div></div>)}
    </div>
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-header"><div className="card-title">Submissions waiting for AI review</div></div>
      <div className="card-body">{queuedSubmissions.length ? queuedSubmissions.map((submission: ReviewQueueRow) => <div className="placeholder-row" key={String(submission._id)}><span><strong>{submission.assignmentId?.taskSnapshot?.title || "Assignment"} · v{submission.version}</strong><span className="subtle" style={{ display: "block" }}>{submission.internId?.userId?.name || "Intern"}</span></span><SubmissionRetryButton submissionId={String(submission._id)} label="Run AI review" /></div>) : <div className="empty">No submissions are waiting for AI review.</div>}</div>
    </section>
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-header"><div className="card-title">Submission review failures</div></div>
      <div className="card-body">{failedSubmissions.length ? failedSubmissions.map((submission: FailedSubmissionRow) => <div className="placeholder-row" key={String(submission._id)}><span><strong>{submission.assignmentId?.taskSnapshot?.title || "Assignment"} · v{submission.version}</strong><span className="subtle" style={{ display: "block" }}>{submission.internId?.userId?.name || "Intern"} · {submission.errorSummary || "Review processing failed."}</span></span><SubmissionRetryButton submissionId={String(submission._id)} /></div>) : <div className="empty">No failed submission reviews.</div>}</div>
    </section>
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-header"><div className="card-title">Provider configuration</div></div>
      <div className="card-body automation-providers">
        {[["Gemini AI", geminiConfigured], ["Google Calendar / Meet", calendarConfigured], ["Gmail SMTP", smtpConfigured], ["Inngest workflows", inngestConfigured]].map(([name, ready]) => <div className="placeholder-row" key={String(name)}><span>{name}</span><span className="badge">{ready ? "Configured" : "Not configured"}</span></div>)}
        <div className="placeholder-row"><span>AI Google Meet participant</span><span className="badge">{meetingAgentLabel}</span></div>
        {meetingAgent.missingCredentials.length > 0 && <p className="subtle">Missing server settings: {meetingAgent.missingCredentials.join(", ")}.</p>}
        <p className="subtle">Recall scheduling and status-webhook integration are implemented, but a real Google Meet session has not been verified. Browser speech recognition and spoken output depend on Recall&apos;s webpage runtime and remain unverified. Hosts may need to admit the bot; withdrawing consent stops its AI media page but may not remove the participant from the call. No credentials are displayed here.</p>
      </div>
    </section>
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-header"><div className="card-title">Assignments needing explanation or recovery</div></div>
      <div className="card-body">{waitingForExplanation.length ? waitingForExplanation.map((item: AssignmentRow) => <div className="placeholder-row" key={String(item._id)}><span><strong>{item.taskSnapshot?.title || "Assignment"}</strong><span className="subtle" style={{ display: "block" }}>{item.explanationStatus || "PENDING"} · automation {item.automationStatus || "PENDING"}</span>{item.lastAutomationError && <span className="subtle" style={{ display: "block" }}>{item.lastAutomationError}</span>}</span><span style={{ display: "flex", gap: 8, alignItems: "center" }}><Link className="button" href={`/admin/assignments/${item._id}`}>Details</Link>{item.automationStatus === "FAILED" && <AutomationRetryButton assignmentId={String(item._id)} />}</span></div>) : <div className="empty">No assignments are waiting for explanation generation.</div>}</div>
    </section>
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-header"><div className="card-title">Upcoming explanation sessions and reviews</div></div>
      <div className="card-body">{upcomingMeetings.length ? upcomingMeetings.map((meeting: MeetingRow) => <div className="automation-meeting-row" key={String(meeting._id)}><div className="placeholder-row"><span><strong>{meeting.assignmentId?.taskSnapshot?.title || "Assignment"}</strong><span className="subtle" style={{ display: "block" }}>{meeting.meetingType} · {meeting.assignmentId?.internId?.userId?.name || "Intern"} · {new Date(meeting.scheduledAt ?? Date.now()).toLocaleString("en", { timeZone: meeting.timezone || "UTC" })} ({meeting.timezone || "UTC"})</span>{meeting.meetingType === "TASK_EXPLANATION" && <span className="subtle" style={{ display: "block" }}>mentor: {meeting.agentConsentStatus || "REQUIRED"} · {meeting.agentStatus || "NOT_REQUESTED"} · recording off</span>}</span><span style={{ display: "flex", gap: 8, alignItems: "center" }}>{meeting.meetingProvider === "INTERNAL" && meeting.assignmentId?._id ? <Link className="button" href={`/intern/tasks/${meeting.assignmentId._id}/mentor`}>Mentor room</Link> : meeting.conferenceUrl && <a className="button" href={meeting.conferenceUrl} target="_blank" rel="noreferrer">Meet</a>}<Link className="button" href={`/admin/assignments/${meeting.assignmentId?._id}`}>Assignment</Link></span></div><MeetingManagementForm meetingId={String(meeting._id)} /></div>) : <div className="empty">No confirmed upcoming sessions.</div>}</div>
    </section>
    <div className="content-grid">
      <section className="card"><div className="card-header"><div className="card-title">Failed or bounced emails</div></div><div className="card-body">{failedEmails.length ? failedEmails.map((email: { _id?: unknown; templateType?: string; recipient?: string; lastError?: string; attemptCount?: number }) => <div className="placeholder-row" key={String(email._id)}><span><strong>{email.templateType}</strong><span className="subtle" style={{ display: "block" }}>{email.recipient} · {email.attemptCount || 0} attempts</span><span className="subtle" style={{ display: "block" }}>{email.lastError}</span></span></div>) : <div className="empty">No failed or bounced emails.</div>}</div></section>
      <section className="card"><div className="card-header"><div className="card-title">Recent workflow activity</div></div><div className="card-body">{recentRuns.length ? recentRuns.map((run: RunRow) => <div className="placeholder-row" key={String(run._id)}><span><Link href={`/admin/assignments/${run.assignmentId}`}>Assignment {String(run.assignmentId)}</Link><span className="subtle" style={{ display: "block" }}>Attempt {run.attemptCount || 0} · {run.updatedAt ? new Date(run.updatedAt).toLocaleString() : "—"}</span>{run.lastError && <span className="subtle" style={{ display: "block" }}>{run.lastError}</span>}</span><span className="badge">{run.status}</span></div>) : <div className="empty">No automation activity yet.</div>}</div></section>
    </div>
  </>;
}

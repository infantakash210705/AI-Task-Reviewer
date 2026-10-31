import { notFound } from "next/navigation";
import Link from "next/link";
import { requireIntern } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { Assignment, Intern, Meeting, MeetingRequest, Review, Submission, TaskExplanation } from "@/lib/models";
import { ProgressForm, SubmissionForm } from "@/components/admin-forms";
import { MeetingRequestForm, type MeetingRequestView } from "@/components/meeting-request-form";
import { MeetBotForm } from "@/components/meet-bot-form";

export const dynamic = "force-dynamic";

type TaskDetailRecord = {
  title?: string;
  shortDescription?: string;
  difficulty?: string;
  fullDescription?: string;
  requirements?: string[];
  acceptanceCriteria?: string[];
  expectedDeliverables?: string[];
  requiredSkills?: string[];
};

type MeetingRecord = {
  _id?: unknown;
  meetingType?: string;
  scheduledAt?: Date | string;
  durationMinutes?: number;
  timezone?: string;
  conferenceUrl?: string;
  meetingUrl?: string;
  meetingProvider?: "GOOGLE_CALENDAR" | "INTERNAL";
  status?: string;
  agentConsentStatus?: "REQUIRED" | "GRANTED" | "REVOKED";
  agentStatus?: string;
  agentStartedAt?: Date | string | null;
};

type SubmissionRecord = {
  _id?: unknown;
  version?: number;
  submittedAt?: Date | string;
  status?: string;
  processingStatus?: string;
  errorSummary?: string;
  repositoryUrl?: string;
  repositoryMetadata?: {
    name?: string;
    owner?: string;
    description?: string;
    defaultBranch?: string;
    latestCommitSha?: string;
    latestCommitMessage?: string;
    latestCommitDate?: string;
    latestCommitAuthor?: string;
  };
  projectUrl?: string;
  commitSha?: string;
  submissionType?: string;
  uploadedFileReferences?: Array<{ storageKey: string; filename: string; contentType: string; size: number }>;
};

type ReviewRecord = {
  _id?: unknown;
  result?: string;
  outcome?: string;
  summary?: string;
  findings?: string[];
  recommendations?: string[];
  modelIdentifier?: string;
  reviewedAt?: Date | string;
  reviewLimitations?: string[];
  submissionId?: { version?: number };
  requirementsAssessed?: Array<{ criterion?: string; status?: string; explanation?: string }>;
  structuredFindings?: Array<{ findingId?: string; severity?: string; title?: string; explanation?: string; filePath?: string; lineStart?: number; lineEnd?: number; recommendedFix?: string; blocksCompletion?: boolean }>;
};

export default async function InternTaskDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireIntern(); await connectDB();
  const intern = await Intern.findOne({ userId: user._id }).select("_id").lean();
  const assignment = intern ? await Assignment.findOne({ _id: id, internId: intern._id }).populate("taskId").lean() : null;
  if (!assignment) notFound();
  const [submissions, reviews, meetings, requestDocs, taskExplanation] = await Promise.all([
    Submission.find({ assignmentId: assignment._id, internId: intern?._id }).sort({ submittedAt: -1 }).limit(20).lean(),
    Review.find({ assignmentId: assignment._id }).populate("submissionId", "version").sort({ createdAt: -1 }).limit(20).lean(),
    Meeting.find({ assignmentId: assignment._id, status: "SCHEDULED" }).sort({ scheduledAt: 1 }).limit(5).lean(),
    MeetingRequest.find({ assignmentId: assignment._id }).sort({ createdAt: -1 }).limit(10).lean(),
    TaskExplanation.findOne({ assignmentId: assignment._id }).select("content").lean(),
  ]);
  const meetingsByRequest = new Map((await Meeting.find({ requestId: { $in: requestDocs.map((item) => item._id) } }).select("requestId scheduledAt timezone conferenceUrl").lean()).map((meeting) => [String(meeting.requestId), meeting]));
  const requestViews: MeetingRequestView[] = requestDocs.map((item) => {
    const meeting = meetingsByRequest.get(String(item._id));
    return { id: String(item._id), topic: item.topic, status: item.status, adminNote: item.adminNote || "", createdAt: new Date(item.createdAt).toISOString(), meetUrl: meeting?.conferenceUrl || "", scheduledAt: meeting ? new Date(meeting.scheduledAt).toISOString() : undefined, timezone: meeting?.timezone || "UTC" };
  });
  const task = (assignment.taskSnapshot ?? assignment.taskId) as TaskDetailRecord | null | undefined;
  const taskGroups: Array<[string, string[] | undefined]> = [
    ["Requirements", task?.requirements],
    ["Acceptance criteria", task?.acceptanceCriteria],
    ["Expected deliverables", task?.expectedDeliverables],
    ["Required skills", task?.requiredSkills],
  ];
  return <>
    <div className="page-heading"><div><div className="subtle"><Link href="/intern/tasks">My tasks</Link> / Assignment</div><h1>{task?.title || "Assignment"}</h1><p>{task?.shortDescription}</p></div><span className="badge">{(assignment.status || "").replaceAll("_", " ")}</span></div>
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-header"><div><div className="card-title">Your mentor</div><div className="subtle">Walk through the task, ask questions, talk it out loud</div></div><span className="badge">{assignment.explanationStatus === "COMPLETED" ? "READY" : (assignment.explanationStatus || "PENDING").replaceAll("_", " ")}</span></div>
      <div className="card-body"><p className="subtle">{assignment.explanationStatus === "COMPLETED" ? "Your task walkthrough is ready." : assignment.explanationStatus === "FAILED" ? "Your walkthrough hit a problem. Open your mentor page and tap retry." : "Your walkthrough is being prepared."}</p><Link className="button button-primary" href={`/intern/tasks/${assignment._id}/mentor`}>Talk to your mentor</Link></div>
    </section>
    <div className="content-grid">
      <section className="card"><div className="card-header"><div className="card-title">Task brief</div><span className="badge">{task?.difficulty}</span></div><div className="card-body">
        <p className="subtle">{task?.fullDescription}</p>
        <div className="placeholder-row"><strong>Due date</strong><span>{new Date(assignment.dueDate ?? Date.now()).toLocaleDateString()}</span></div>
        {taskGroups.map(([label, list]) => <div key={label} style={{ marginTop: 20 }}><strong>{label}</strong>{list?.length ? <ul className="subtle">{list.map((value: string, index: number) => <li key={`${label}-${index}`}>{value}</li>)}</ul> : <p className="subtle">No {label.toLowerCase()} added for this task.</p>}</div>)}
      </div></section>
      <div style={{ display: "grid", gap: 15, alignContent: "start" }}>
        <section className="card"><div className="card-header"><div className="card-title">Your progress</div><span className="badge">{assignment.progress ?? 0}%</span></div><ProgressForm assignmentId={String(assignment._id)} progress={assignment.progress ?? 0} /></section>
        {assignment.status !== "COMPLETED" && <section className="card"><div className="card-header"><div className="card-title">Submit an updated version</div></div><SubmissionForm assignmentId={String(assignment._id)} /></section>}
        <section className="card"><div className="card-header"><div className="card-title">Upcoming meetings</div></div><div className="card-body">{meetings.length ? meetings.map((meeting: MeetingRecord) => <div key={String(meeting._id)} className="placeholder-row" style={{ paddingBottom: 12, borderBottom: "1px solid #edf0f4" }}><span>{meeting.meetingType === "DOUBT_CLARIFICATION" ? "Clarification meeting" : meeting.meetingType === "TASK_EXPLANATION" || meeting.meetingType === "EXPLANATION" ? "Task walkthrough" : "Review meeting"}<span style={{ display: "block", color: "#8490a1", marginTop: 4 }}>{new Date(meeting.scheduledAt ?? Date.now()).toLocaleString("en", { timeZone: meeting.timezone || "UTC", dateStyle: "medium", timeStyle: "short" })} · {meeting.timezone || "UTC"}</span></span>{meeting.meetingProvider === "INTERNAL" ? <Link className="button" href={`/intern/tasks/${assignment._id}/mentor`}>Open room</Link> : meeting.conferenceUrl && <a className="button" href={meeting.conferenceUrl} target="_blank" rel="noreferrer">Join Meet</a>}</div>) : <div className="empty">No meetings scheduled.</div>}</div></section>
        <section className="card"><div className="card-header"><div className="card-title">Add Google Meet Link for Bot Review &amp; Doubts</div></div><MeetBotForm assignmentId={String(assignment._id)} taskTitle={task?.title || "Assignment"} clarificationQuestions={taskExplanation?.content?.clarificationQuestions} disabled={assignment.status === "COMPLETED"} /></section>
                <section className="card"><div className="card-header"><div className="card-title">Need a clarification meeting?</div></div><MeetingRequestForm assignmentId={String(assignment._id)} requests={requestViews} disabled={assignment.status === "COMPLETED"} /></section>
      </div>
    </div>
    <section className="card" style={{ marginTop: 16 }}><div className="card-header"><div className="card-title">Submission history</div></div><div className="table-wrap"><table><thead><tr><th>Version</th><th>Submitted</th><th>Type</th><th>Repository / Files</th><th>Default branch</th><th>Latest commit</th><th>Review status</th></tr></thead><tbody>{submissions.length ? submissions.map((item: SubmissionRecord) => <tr key={String(item._id)}><td>v{item.version}</td><td>{new Date(item.submittedAt ?? Date.now()).toLocaleString()}</td><td><span className="badge">{(item.submissionType || "REPOSITORY_URL").replace(/_/g, " ")}</span></td><td>{item.repositoryUrl ? <><a className="subtle" href={item.repositoryUrl} target="_blank" rel="noreferrer">{item.repositoryMetadata?.owner && item.repositoryMetadata.name ? `${item.repositoryMetadata.owner}/${item.repositoryMetadata.name}` : "Open repository"} ↗</a>{item.repositoryMetadata?.description && <div className="subtle">{item.repositoryMetadata.description}</div>}</> : null}{item.uploadedFileReferences && item.uploadedFileReferences.length > 0 && <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>{item.uploadedFileReferences.map((f, i) => <li key={i} className="subtle">{f.filename} ({(f.size / 1024).toFixed(0)} KB)</li>)}</ul>}{!item.repositoryUrl && (!item.uploadedFileReferences || item.uploadedFileReferences.length === 0) && "—"}</td><td>{item.repositoryMetadata?.defaultBranch || "—"}</td><td>{item.repositoryMetadata?.latestCommitSha ? <><span title={item.repositoryMetadata.latestCommitSha}>{item.repositoryMetadata.latestCommitSha.slice(0, 12)}</span>{item.repositoryMetadata.latestCommitMessage && <div className="subtle">{item.repositoryMetadata.latestCommitMessage}</div>}<div className="subtle">{item.repositoryMetadata.latestCommitAuthor}{item.repositoryMetadata.latestCommitDate ? ` · ${new Date(item.repositoryMetadata.latestCommitDate).toLocaleDateString()}` : ""}</div></> : item.commitSha ? item.commitSha.slice(0, 12) : item.uploadedFileReferences?.length ? "N/A" : "Pending"}</td><td><span className="badge">{item.processingStatus || "COMPLETED"}</span>{item.errorSummary && <div className="subtle">{item.errorSummary}</div>}</td></tr>) : <tr><td colSpan={7} className="table-empty">No submissions yet.</td></tr>}</tbody></table></div></section>
    <section className="card" style={{ marginTop: 16 }}><div className="card-header"><div className="card-title">Review history</div></div><div className="card-body">{reviews.length ? reviews.map((review: ReviewRecord) => <article className="placeholder-row" key={String(review._id)}><div><strong>{(review.outcome || review.result || "").replaceAll("_", " ")}</strong><div className="subtle">{review.summary}</div><div className="subtle">Reviewed {new Date(review.reviewedAt ?? Date.now()).toLocaleString()} · {review.modelIdentifier || "Human review"}</div>{review.requirementsAssessed?.map((item, index) => <div className="subtle" key={index}>{item.status}: {item.criterion} — {item.explanation}</div>)}{review.structuredFindings?.map((finding) => <div className="subtle" key={finding.findingId}><strong>{finding.severity} · {finding.title}</strong> {finding.explanation}{finding.filePath ? ` (${finding.filePath}:${finding.lineStart}${finding.lineEnd && finding.lineEnd !== finding.lineStart ? `-${finding.lineEnd}` : ""})` : ""}{finding.recommendedFix ? ` Suggested fix: ${finding.recommendedFix}` : ""}</div>)}<div style={{ marginTop: 8 }}><Link className="button" href={`/intern/tasks/${assignment._id}/reviews/${review._id}`}>View review details</Link></div></div><span>v{review.submissionId?.version || "—"}</span></article>) : <div className="empty">No review records available.</div>}</div></section>
  </>;
}

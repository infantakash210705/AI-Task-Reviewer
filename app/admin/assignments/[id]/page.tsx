import Link from "next/link";
import { notFound } from "next/navigation";
import { AssignmentStatusForm } from "@/components/assignment-status-form";
import { ReviewForm } from "@/components/review-form";
import { SubmissionRetryButton } from "@/components/submission-retry-button";
import { connectDB } from "@/lib/db";
import { Assignment, AutomationRun, Review, Submission } from "@/lib/models";

export const dynamic = "force-dynamic";

type AssignmentTask = {
  _id?: unknown;
  title?: string;
  fullDescription?: string;
  requirements?: string[];
  acceptanceCriteria?: string[];
  expectedDeliverables?: string[];
};

type AssignmentIntern = {
  userId?: { name?: string; email?: string };
};

type SubmissionRow = {
  _id?: unknown;
  version?: number;
  submittedAt?: Date | string;
  submissionType?: string;
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
  status?: string;
  processingStatus?: string;
  errorSummary?: string;
};

type ReviewRow = {
  _id?: unknown;
  result?: string;
  outcome?: string;
  reviewerType?: string;
  modelIdentifier?: string;
  notificationStatus?: string;
  summary?: string;
  requirementsAssessed?: Array<{ criterion?: string; status?: string; explanation?: string; evidenceReferences?: Array<{ filePath?: string; lineStart?: number; lineEnd?: number }> }>;
  structuredFindings?: Array<{ severity?: string; category?: string; title?: string; explanation?: string; recommendedFix?: string; evidenceReferences?: Array<{ filePath?: string; lineStart?: number; lineEnd?: number }> }>;
  suggestedNextActions?: string[];
  reviewLimitations?: string[];
  submissionId?: { version?: number };
};

type AutomationStep = {
  name?: string;
  status?: string;
  attemptCount?: number;
  completedAt?: Date | string | null;
  lastError?: string;
};

export default async function AdminAssignmentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connectDB();
  const assignment = await Assignment.findById(id).populate("taskId").populate({ path: "internId", populate: { path: "userId", select: "name email" } }).lean();
  if (!assignment) notFound();
  const [submissions, reviews, automation] = await Promise.all([
    Submission.find({ assignmentId: assignment._id }).sort({ submittedAt: -1 }).limit(50).lean(),
    Review.find({ assignmentId: assignment._id }).populate("submissionId", "version").sort({ createdAt: -1 }).limit(50).lean(),
    AutomationRun.findOne({ assignmentId: assignment._id }).lean(),
  ]);
  const task = (assignment.taskSnapshot ?? assignment.taskId) as AssignmentTask | null | undefined;
  const intern = assignment.internId as AssignmentIntern | null | undefined;
  const taskSections: Array<[string, string[] | undefined]> = [
    ["Requirements", task?.requirements],
    ["Acceptance criteria", task?.acceptanceCriteria],
    ["Deliverables", task?.expectedDeliverables],
  ];
  return <>
    <div className="page-heading"><div><div className="subtle"><Link href="/admin/assignments">Assignments</Link> / Details</div><h1>{task?.title || "Assignment"}</h1><p>{intern?.userId?.name || "Intern"} · due {new Date(assignment.dueDate ?? Date.now()).toLocaleDateString()}</p></div><span className="badge">{(assignment.status || "").replaceAll("_", " ")}</span></div>
    <div className="content-grid"><section className="card"><div className="card-header"><div className="card-title">Task requirements</div><Link className="subtle" href={`/admin/tasks/${String((assignment.taskId as { _id?: unknown } | null | undefined)?._id)}`}>View task →</Link></div><div className="card-body"><p className="subtle">{task?.fullDescription}</p>{taskSections.map(([label, list]) => <div key={label} style={{ marginTop: 18 }}><strong>{label}</strong><ul className="subtle">{list?.map((value: string, index: number) => <li key={`${label}-${index}`}>{value}</li>)}</ul></div>)}</div></section>
      <section className="card"><div className="card-header"><div className="card-title">Assignment status</div></div><div className="card-body"><div className="placeholder-row"><span>Reported progress</span><strong>{assignment.progress ?? 0}%</strong></div><div className="placeholder-row"><span>Due date</span><strong>{new Date(assignment.dueDate ?? Date.now()).toLocaleDateString()}</strong></div><div className="placeholder-row"><span>Intern</span><strong>{intern?.userId?.name}</strong></div><AssignmentStatusForm assignmentId={String(assignment._id)} status={assignment.status} /></div></section></div>
    <section className="card" style={{ marginTop: 16 }}><div className="card-header"><div className="card-title">Automation timeline</div><span className="badge">{assignment.automationStatus || "PENDING"}</span></div><div className="card-body">
      <div className="placeholder-row"><span>Explanation</span><strong>{assignment.explanationStatus || "PENDING"}</strong></div>
      <div className="placeholder-row"><span>Workflow</span><strong>{automation?.workflowId || assignment.automationWorkflowId || "Not queued"}</strong></div>
      <div className="placeholder-row"><span>Attempts</span><strong>{automation?.attemptCount || 0}</strong></div>
      {assignment.lastAutomationError && <p className="setup-note" role="status">{assignment.lastAutomationError}</p>}
      {automation?.steps?.length ? automation.steps.map((step: AutomationStep) => <div className="placeholder-row" key={step.name}><span>{step.name?.replaceAll("-", " ")}</span><span className="badge">{step.status} · {step.attemptCount || 0} attempts</span>{step.lastError && <span className="subtle">{step.lastError}</span>}</div>) : <p className="subtle">No workflow steps recorded yet.</p>}
    </div></section>
    <section className="card" style={{ marginTop: 16 }}><div className="card-header"><div className="card-title">Submissions</div></div><div className="table-wrap"><table><thead><tr><th>Version</th><th>Submitted</th><th>Repository</th><th>Branch</th><th>Latest commit</th><th>Status</th><th>AI review</th></tr></thead><tbody>{submissions.length ? submissions.map((item: SubmissionRow) => {
      const canQueueReview = item.processingStatus === "QUEUED" || item.processingStatus === "FAILED" || (!item.processingStatus && item.status === "SUBMITTED");
      return <tr key={String(item._id)}><td>v{item.version}</td><td>{new Date(item.submittedAt ?? Date.now()).toLocaleString()}</td><td>{item.repositoryUrl || item.projectUrl ? <><a className="subtle" href={item.repositoryUrl || item.projectUrl} target="_blank" rel="noreferrer">{item.repositoryMetadata?.owner && item.repositoryMetadata.name ? `${item.repositoryMetadata.owner}/${item.repositoryMetadata.name}` : "Open"} ↗</a>{item.repositoryMetadata?.description && <div className="subtle">{item.repositoryMetadata.description}</div>}</> : "—"}</td><td>{item.repositoryMetadata?.defaultBranch || "—"}</td><td>{item.repositoryMetadata?.latestCommitSha ? <><span title={item.repositoryMetadata.latestCommitSha}>{item.repositoryMetadata.latestCommitSha.slice(0, 12)}</span>{item.repositoryMetadata.latestCommitMessage && <div className="subtle">{item.repositoryMetadata.latestCommitMessage}</div>}<div className="subtle">{item.repositoryMetadata.latestCommitAuthor}{item.repositoryMetadata.latestCommitDate ? ` · ${new Date(item.repositoryMetadata.latestCommitDate).toLocaleDateString()}` : ""}</div></> : "—"}</td><td>{item.status}<div className="subtle">{item.processingStatus?.replaceAll("_", " ") || "Review not queued"}</div>{item.errorSummary && <div className="subtle">{item.errorSummary}</div>}</td><td>{canQueueReview && <SubmissionRetryButton submissionId={String(item._id)} label={item.processingStatus === "FAILED" ? "Retry AI review" : "Run AI review"} />}</td></tr>;
    }) : <tr><td className="table-empty" colSpan={7}>No submissions yet.</td></tr>}</tbody></table></div></section>
    <div className="content-grid" style={{ marginTop: 16 }}><section className="card"><div className="card-header"><div className="card-title">Add a human review</div></div><ReviewForm assignmentId={String(assignment._id)} submissions={submissions.filter((item: SubmissionRow) => typeof item.version === "number").map((item: SubmissionRow) => ({ id: String(item._id), version: item.version as number }))} /></section>
      <section className="card"><div className="card-header"><div className="card-title">AI and human review history</div></div><div className="card-body">{reviews.length ? reviews.map((review: ReviewRow) => <article key={String(review._id)} style={{ padding: "12px 0", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
        <div className="placeholder-row"><span><strong>{review.outcome || review.result}</strong><span className="subtle" style={{ display: "block" }}>{review.reviewerType === "AI" ? `AI reviewer · ${review.modelIdentifier || "configured model"}` : `${review.reviewerType || "Human"} reviewer`} · email {review.notificationStatus || "QUEUED"}</span></span><span>v{review.submissionId?.version || "—"}</span></div>
        {review.summary && <p>{review.summary}</p>}
        {!!review.requirementsAssessed?.length && <div><strong>Acceptance criteria and deliverables</strong><ul>{review.requirementsAssessed.map((item, index) => <li key={`${String(review._id)}-criterion-${index}`}><strong>{item.status}</strong> — {item.criterion}<br />{item.explanation}{item.evidenceReferences?.map((evidence, evidenceIndex) => <span className="subtle" style={{ display: "block" }} key={`${String(review._id)}-criterion-evidence-${index}-${evidenceIndex}`}>Evidence: {evidence.filePath}:{evidence.lineStart}-{evidence.lineEnd}</span>)}</li>)}</ul></div>}
        {!!review.structuredFindings?.length && <div><strong>Findings</strong><ul>{review.structuredFindings.map((finding, index) => <li key={`${String(review._id)}-finding-${index}`}><strong>{finding.severity} · {finding.title}</strong>{finding.category ? ` (${finding.category})` : ""}<br />{finding.explanation}{finding.recommendedFix && <div><strong>Recommended fix:</strong> {finding.recommendedFix}</div>}{finding.evidenceReferences?.map((evidence, evidenceIndex) => <span className="subtle" style={{ display: "block" }} key={`${String(review._id)}-finding-evidence-${index}-${evidenceIndex}`}>Evidence: {evidence.filePath}:{evidence.lineStart}-{evidence.lineEnd}</span>)}</li>)}</ul></div>}
        {!!review.suggestedNextActions?.length && <div><strong>Recommended next actions</strong><ul>{review.suggestedNextActions.map((action, index) => <li key={`${String(review._id)}-action-${index}`}>{action}</li>)}</ul></div>}
        {!!review.reviewLimitations?.length && <div><strong>Review limitations</strong><ul>{review.reviewLimitations.map((limitation, index) => <li key={`${String(review._id)}-limitation-${index}`}>{limitation}</li>)}</ul></div>}
      </article>) : <div className="empty">No review records yet.</div>}</div></section></div>
  </>;
}

import Link from "next/link";
import { notFound } from "next/navigation";
import mongoose from "mongoose";
import { requireIntern } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { Assignment, Intern, Review, Submission } from "@/lib/models";

export const dynamic = "force-dynamic";

type Assessment = {
  criterionId?: string;
  criterion?: string;
  status?: string;
  explanation?: string;
  evidenceReferences?: Array<{ filePath?: string; lineStart?: number; lineEnd?: number; excerpt?: string }>;
};

type Finding = {
  findingId?: string;
  category?: string;
  severity?: string;
  title?: string;
  explanation?: string;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  relatedCriterionId?: string;
  recommendedFix?: string;
  blocksCompletion?: boolean;
  verified?: boolean;
};

export default async function InternReviewDetail({ params }: { params: Promise<{ id: string; reviewId: string }> }) {
  const { id, reviewId } = await params;
  if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(reviewId)) notFound();
  const user = await requireIntern();
  await connectDB();
  const intern = await Intern.findOne({ userId: user._id, status: { $ne: "INACTIVE" } }).select("_id").lean();
  const assignment = intern ? await Assignment.findOne({ _id: id, internId: intern._id }).select("_id taskSnapshot").lean() : null;
  if (!assignment) notFound();
  const review = await Review.findOne({ _id: reviewId, assignmentId: assignment._id }).lean();
  if (!review) notFound();
  const submission = await Submission.findOne({ _id: review.submissionId, internId: intern?._id }).select("version commitSha branch submittedAt").lean();
  if (!submission) notFound();

  const assessments = (review.requirementsAssessed || []) as Assessment[];
  const findings = (review.structuredFindings || []) as Finding[];
  return <>
    <div className="page-heading">
      <div><div className="subtle"><Link href={`/intern/tasks/${id}`}>Back to assignment</Link></div><h1>Submission review</h1><p>{assignment.taskSnapshot?.title} · Version {submission.version} · {submission.commitSha ? submission.commitSha.slice(0, 12) : "Commit unavailable"}</p></div>
      <span className="badge">{review.outcome || review.result}</span>
    </div>
    <section className="card" style={{ marginBottom: 16 }}><div className="card-header"><div className="card-title">Review summary</div></div><div className="card-body"><p>{review.summary}</p><p className="subtle">Reviewed {new Date(review.reviewedAt || review.createdAt).toLocaleString()} · Model {review.modelIdentifier || "not recorded"} · Task version {review.taskVersion || 1}</p>{review.reviewLimitations?.length > 0 && <div><strong>Limitations</strong><ul>{review.reviewLimitations.map((limitation: string, index: number) => <li className="subtle" key={index}>{limitation}</li>)}</ul></div>}</div></section>
    <section className="card" style={{ marginBottom: 16 }}><div className="card-header"><div className="card-title">Acceptance criteria and deliverables</div></div><div className="card-body">{assessments.length ? assessments.map((assessment) => <div className="placeholder-row" key={assessment.criterionId}><span><strong>{assessment.criterion}</strong><span className="subtle" style={{ display: "block" }}>{assessment.explanation}</span>{assessment.evidenceReferences?.map((evidence, index) => <span className="subtle" style={{ display: "block" }} key={index}>{evidence.filePath}:{evidence.lineStart}-{evidence.lineEnd}{evidence.excerpt ? ` — ${evidence.excerpt}` : ""}</span>)}</span><span className="badge">{assessment.status}</span></div>) : <div className="empty">No criterion-level results were recorded.</div>}</div></section>
    <section className="card"><div className="card-header"><div className="card-title">Findings and recommended fixes</div></div><div className="card-body">{findings.length ? findings.map((finding) => <article className="placeholder-row" key={finding.findingId}><div><strong>{finding.title}</strong><span className="subtle" style={{ display: "block" }}>{finding.severity} · {finding.category}{finding.blocksCompletion ? " · blocks completion" : ""}</span><p>{finding.explanation}</p>{finding.filePath && <p className="subtle">{finding.filePath}:{finding.lineStart}{finding.lineEnd && finding.lineEnd !== finding.lineStart ? `-${finding.lineEnd}` : ""}</p>}{finding.recommendedFix && <p><strong>Suggested fix:</strong> {finding.recommendedFix}</p>}</div></article>) : <div className="empty">No findings were recorded.</div>}</div></section>
  </>;
}

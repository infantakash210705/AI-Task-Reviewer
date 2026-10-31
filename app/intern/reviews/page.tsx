import { requireIntern } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { Assignment, Intern, Review, Submission } from "@/lib/models";
import { ReviewTable } from "@/components/record-tables";

export const dynamic = "force-dynamic";
export default async function InternReviewsPage() {
  const user = await requireIntern();
  await connectDB();
  const intern = await Intern.findOne({ userId: user._id, status: { $ne: "INACTIVE" } }).select("_id").lean();
  const assignmentIds = intern ? await Assignment.distinct("_id", { internId: intern._id }) : [];
  const [items, pendingSubmissions] = assignmentIds.length ? await Promise.all([
    Review.find({ assignmentId: { $in: assignmentIds } })
      .populate("submissionId", "version")
      .populate({ path: "assignmentId", select: "taskId", populate: { path: "taskId", select: "title" } })
      .sort({ createdAt: -1 }).limit(50).lean(),
    Submission.find({
      internId: intern?._id,
      assignmentId: { $in: assignmentIds },
      $or: [
        { processingStatus: { $in: ["QUEUED", "PROCESSING", "FAILED"] } },
        { processingStatus: { $exists: false }, status: "SUBMITTED" },
      ],
    }).populate({ path: "assignmentId", select: "taskId", populate: { path: "taskId", select: "title" } })
      .sort({ submittedAt: -1 }).limit(20).lean(),
  ]) : [[], []];
  return <>
    <div className="page-heading"><div><h1>Review history</h1><p>AI and administrator feedback connected to your submissions.</p></div></div>
    {!!pendingSubmissions.length && <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-header"><div className="card-title">Submission review status</div></div>
      <div className="card-body">{pendingSubmissions.map((submission) => {
        const processingStatus = submission.processingStatus || "QUEUED";
        const statusMessage = processingStatus === "FAILED"
          ? "The automated review could not finish. An administrator can retry it."
          : processingStatus === "PROCESSING"
            ? "AI is reviewing this submission."
            : "Your submission is waiting for the AI review workflow.";
        return <div className="placeholder-row" key={String(submission._id)}>
          <span><strong>{submission.assignmentId?.taskId?.title || "Assignment"} · v{submission.version}</strong><span className="subtle" style={{ display: "block" }}>{statusMessage}</span></span>
          <span className="badge">{processingStatus.replaceAll("_", " ")}</span>
        </div>;
      })}</div>
    </section>}
    <section className="card"><ReviewTable items={JSON.parse(JSON.stringify(items))} /></section>
  </>;
}

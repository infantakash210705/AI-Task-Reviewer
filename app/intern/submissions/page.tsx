import { requireIntern } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { Intern, Submission } from "@/lib/models";
import { SubmissionTable } from "@/components/record-tables";

export const dynamic = "force-dynamic";
export default async function InternSubmissionsPage() {
  const user = await requireIntern(); await connectDB();
  const intern = await Intern.findOne({ userId: user._id }).select("_id").lean();
  const items = intern ? await Submission.find({ internId: intern._id }).populate({ path: "assignmentId", select: "taskId", populate: { path: "taskId", select: "title" } }).sort({ submittedAt: -1 }).limit(50).lean() : [];
  return <><div className="page-heading"><div><h1>Submissions</h1><p>Your submitted repositories and their saved public GitHub metadata.</p></div></div><section className="card"><SubmissionTable items={JSON.parse(JSON.stringify(items))} /></section><p className="subtle" style={{ marginTop: 12 }}>Public repository metadata is fetched by the server from the GitHub REST API. Automated review does not execute submitted code.</p></>;
}

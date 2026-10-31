import Link from "next/link";
import { notFound } from "next/navigation";
import { connectDB } from "@/lib/db";
import { Assignment, Intern, Review, Submission } from "@/lib/models";
import { InternEditForm } from "@/components/intern-edit-form";

export const dynamic = "force-dynamic";

type InternAssignmentItem = {
  _id?: unknown;
  taskId?: { title?: string };
  status?: string;
  progress?: number;
};

type InternSubmissionItem = {
  _id?: unknown;
  version?: number;
  submittedAt?: Date | string;
  status?: string;
};

export default async function AdminInternDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connectDB();
  const intern = await Intern.findById(id).populate("userId", "name email image").lean();
  if (!intern) notFound();
  const [assignments, submissions, reviews] = await Promise.all([
    Assignment.find({ internId: intern._id }).populate("taskId", "title").sort({ dueDate: -1 }).limit(50).lean(),
    Submission.find({ internId: intern._id }).populate("assignmentId", "taskId").sort({ submittedAt: -1 }).limit(50).lean(),
    Review.find({ assignmentId: { $in: await Assignment.distinct("_id", { internId: intern._id }) } }).sort({ createdAt: -1 }).limit(50).lean(),
  ]);
  const user = intern.userId as { name?: string; email?: string } | null | undefined;
  return <>
    <div className="page-heading"><div><div className="subtle"><Link href="/admin/interns">Interns</Link> / Profile</div><h1>{user?.name || "Intern"}</h1><p>{user?.email}</p></div><span className="badge">{intern.status}</span></div>
    <div className="content-grid"><section className="card"><div className="card-header"><div className="card-title">Internship profile</div></div><div className="card-body"><div className="placeholder-row"><span>Intern code</span><strong>{intern.internCode}</strong></div><div className="placeholder-row"><span>Department</span><strong>{intern.department}</strong></div><div className="placeholder-row"><span>Title</span><strong>{intern.internshipTitle}</strong></div><div className="placeholder-row"><span>Start date</span><strong>{new Date(intern.startDate).toLocaleDateString()}</strong></div><div className="placeholder-row"><span>Expected end</span><strong>{new Date(intern.expectedEndDate).toLocaleDateString()}</strong></div></div><InternEditForm intern={{ id: String(intern._id), department: intern.department, internshipTitle: intern.internshipTitle, startDate: new Date(intern.startDate).toISOString(), expectedEndDate: new Date(intern.expectedEndDate).toISOString(), status: intern.status }} /></section>
      <section className="card"><div className="card-header"><div className="card-title">Activity</div></div><div className="card-body"><div className="placeholder-row"><span>Assignments</span><strong>{assignments.length}</strong></div><div className="placeholder-row"><span>Submissions</span><strong>{submissions.length}</strong></div><div className="placeholder-row"><span>Reviews</span><strong>{reviews.length}</strong></div></div></section></div>
    <section className="card" style={{ marginTop: 16 }}><div className="card-header"><div className="card-title">Assigned tasks</div></div><div className="card-body">{assignments.length ? assignments.map((item: InternAssignmentItem) => <div className="placeholder-row" key={String(item._id)}><Link href={`/admin/assignments/${item._id}`}>{item.taskId?.title || "Task"}</Link><span>{(item.status || "").replaceAll("_", " ")} · {item.progress ?? 0}%</span></div>) : <div className="empty">No tasks assigned.</div>}</div></section>
    <section className="card" style={{ marginTop: 16 }}><div className="card-header"><div className="card-title">Submission history</div></div><div className="card-body">{submissions.length ? submissions.map((item: InternSubmissionItem) => <div className="placeholder-row" key={String(item._id)}><span>Version {item.version} · {new Date(item.submittedAt ?? Date.now()).toLocaleDateString()}</span><span className="badge">{item.status}</span></div>) : <div className="empty">No submissions.</div>}</div></section>
  </>;
}

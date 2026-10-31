import Link from "next/link";
import { BriefcaseBusiness, CheckCircle2, Clock3, FileText } from "lucide-react";
import { requireIntern } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { Assignment, Intern, Submission } from "@/lib/models";
import { SelfProfileForm } from "@/components/self-profile-form";

export const dynamic = "force-dynamic";

type AssignmentListItem = {
  _id?: unknown;
  taskSnapshot?: {
    title?: string;
    shortDescription?: string;
  };
  taskId?: { title?: string; shortDescription?: string };
  dueDate?: Date | string;
  status?: string;
  progress?: number;
};

export default async function InternDashboard() {
  const user = await requireIntern();
  await connectDB();
  const intern = await Intern.findOne({ userId: user._id }).select("_id status department internshipTitle").lean();
  const assignments = intern ? await Assignment.find({ internId: intern._id }).populate("taskId", "title shortDescription").sort({ dueDate: 1 }).limit(20).lean() : [];
  const assignmentIds = assignments.map((item: AssignmentListItem) => item._id);
  const [total, working, completed, pending] = await Promise.all([
    intern ? Assignment.countDocuments({ internId: intern._id }) : 0,
    intern ? Assignment.countDocuments({ internId: intern._id, status: { $in: ["IN_PROGRESS", "ASSIGNED"] } }) : 0,
    intern ? Assignment.countDocuments({ internId: intern._id, status: "COMPLETED" }) : 0,
    intern ? Submission.countDocuments({ internId: intern._id, status: "SUBMITTED" }) : 0,
  ]);
  const stats = [{ label: "Assigned tasks", count: total, icon: BriefcaseBusiness }, { label: "In progress", count: working, icon: Clock3 }, { label: "Pending reviews", count: pending, icon: FileText }, { label: "Completed", count: completed, icon: CheckCircle2 }];
  return <>
    <div className="page-heading"><div><h1>Welcome, {user.name?.split(" ")[0] || "there"}</h1><p>Your internship work, milestones, and feedback in one place.</p></div></div>
    {!intern && <section className="card" style={{ marginBottom: 18 }}><div className="card-header"><div className="card-title">Complete your internship profile</div></div><div className="card-body"><p className="subtle">Add the profile details your program needs. This does not grant administrator access.</p></div><SelfProfileForm /></section>}
    <div className="stat-grid">{stats.map(({ label, count, icon: Icon }) => <div className="card stat-card" key={label}><div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon size={17} /></span></div><div className="stat-value">{count}</div><div className="stat-foot">Based on your records</div></div>)}</div>
    <section className="card"><div className="card-header"><div className="card-title">Your assignments</div><Link href="/intern/tasks" className="subtle">View all →</Link></div>
      {assignments.length ? <div className="table-wrap"><table><thead><tr><th>Task</th><th>Due date</th><th>Status</th><th>Progress</th><th></th></tr></thead><tbody>{assignments.map((item: AssignmentListItem) => <tr key={String(item._id)}><td><strong>{item.taskSnapshot?.title || item.taskId?.title || "Task"}</strong><div className="subtle">{item.taskSnapshot?.shortDescription || item.taskId?.shortDescription}</div></td><td>{new Date(item.dueDate ?? Date.now()).toLocaleDateString()}</td><td><span className="badge">{(item.status || "").replaceAll("_", " ")}</span></td><td>{item.progress ?? 0}%</td><td><Link className="button" href={`/intern/tasks/${item._id}`}>Open</Link> <Link className="button" href={`/intern/tasks/${item._id}/mentor`}>Mentor</Link></td></tr>)}</tbody></table></div> : <div className="empty"><strong>No assignments yet</strong>{intern ? "When a task is allocated to you, it will appear here." : "Your profile needs to be completed first."}</div>}
    </section>
    {assignmentIds.length > 0 && <p className="subtle" style={{ marginTop: 14 }}>Progress is self-reported. Completion is verified by an administrator.</p>}
  </>;
}

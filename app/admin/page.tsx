import Link from "next/link";
import { ArrowUpRight, BriefcaseBusiness, CheckCircle2, Clock3, ClipboardList, UsersRound } from "lucide-react";
import { connectDB } from "@/lib/db";
import { Assignment, Intern, Meeting, Submission, Task } from "@/lib/models";

export const dynamic = "force-dynamic";

type StatusItem = { _id?: string; count?: number };
type DashboardAssignment = {
  _id?: unknown;
  taskId?: { title?: string };
  internId?: { userId?: { name?: string } };
  dueDate?: Date | string;
  status?: string;
};
type DashboardSubmission = {
  _id?: unknown;
  internId?: { userId?: { name?: string } };
  version?: number;
  submittedAt?: Date | string;
  status?: string;
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
};
type MeetingItem = {
  _id?: unknown;
  meetingType?: string;
  scheduledAt?: Date | string;
  durationMinutes?: number;
};

function Stat({ label, value, icon: Icon, note }: { label: string; value: number; icon: typeof UsersRound; note: string }) {
  return <div className="card stat-card"><div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon size={17} /></span></div><div className="stat-value">{value}</div><div className="stat-foot">{note}</div></div>;
}

export default async function AdminDashboard() {
  await connectDB();
  const now = new Date();
  const [interns, activeInterns, activeTasks, assignments, inProgress, pending, completed, meetings, recentAssignments, recentSubmissions, statuses] = await Promise.all([
    Intern.countDocuments({}),
    Intern.countDocuments({ status: "ACTIVE" }),
    Task.countDocuments({ status: "ACTIVE" }),
    Assignment.countDocuments({}),
    Assignment.countDocuments({ status: "IN_PROGRESS" }),
    Submission.countDocuments({ status: "SUBMITTED" }),
    Assignment.countDocuments({ status: "COMPLETED" }),
    Meeting.find({ scheduledAt: { $gte: now }, status: "SCHEDULED" }).populate("assignmentId", "taskId").sort({ scheduledAt: 1 }).limit(5).lean(),
    Assignment.find({}).populate("taskId", "title").populate({ path: "internId", populate: { path: "userId", select: "name" } }).sort({ createdAt: -1 }).limit(5).lean(),
    Submission.find({}).populate("assignmentId", "taskId").populate({ path: "internId", populate: { path: "userId", select: "name" } }).sort({ submittedAt: -1 }).limit(5).lean(),
    Assignment.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
  ]);
  const distribution = ["ASSIGNED", "IN_PROGRESS", "SUBMITTED", "IN_REVIEW", "REVISION_REQUIRED", "COMPLETED"].map((status) => ({ status, count: statuses.find((item: StatusItem) => item._id === status)?.count || 0 }));
  return <>
    <div className="page-heading"><div><h1>Good to have you back</h1><p>Here&apos;s what&apos;s happening across your internship program.</p></div><Link href="/admin/tasks" className="button button-primary">Create a task <ArrowUpRight size={14} /></Link></div>
    <div className="stat-grid">
      <Stat label="Registered interns" value={interns} icon={UsersRound} note={`${activeInterns} currently active`} />
      <Stat label="Active tasks" value={activeTasks} icon={ClipboardList} note="Available to allocate" />
      <Stat label="Assignments" value={assignments} icon={BriefcaseBusiness} note={`${inProgress} in progress`} />
      <Stat label="Completed projects" value={completed} icon={CheckCircle2} note={`${pending} submissions awaiting review`} />
    </div>
    <div className="content-grid">
      <section className="card"><div className="card-header"><div className="card-title">Recent assignments</div><Link className="subtle" href="/admin/assignments">View all →</Link></div><div className="card-body">
        {recentAssignments.length ? recentAssignments.map((item: DashboardAssignment) => <div className="placeholder-row" key={String(item._id)}><span><strong>{item.taskId?.title || "Task"}</strong><span style={{ display: "block", color: "#8490a1", marginTop: 4 }}>{item.internId?.userId?.name || "Intern"} · due {new Date(item.dueDate ?? Date.now()).toLocaleDateString()}</span></span><span className="badge">{(item.status || "").replaceAll("_", " ")}</span></div>) : <div className="empty"><strong>No assignments yet</strong>Allocate a task to an active intern to get started.</div>}
      </div></section>
      <section className="card"><div className="card-header"><div className="card-title">Assignment status</div></div><div className="card-body">
        {distribution.map((item) => <div key={item.status} style={{ padding: "10px 0", borderBottom: "1px solid #f0f2f6" }}><div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 7 }}><span>{item.status.replaceAll("_", " ")}</span><strong>{item.count}</strong></div><div style={{ height: 5, background: "#eef1f6", borderRadius: 5 }}><div style={{ width: `${assignments ? Math.max(2, item.count / assignments * 100) : 0}%`, height: "100%", background: "#4169e1", borderRadius: 5 }} /></div></div>)}
      </div></section>
      <section className="card"><div className="card-header"><div className="card-title">Recent submissions</div><Link className="subtle" href="/admin/assignments">Review queue →</Link></div><div className="card-body">
        {recentSubmissions.length ? recentSubmissions.map((item: DashboardSubmission) => <div className="placeholder-row" key={String(item._id)}><span><strong>{item.internId?.userId?.name || "Intern"}</strong><span style={{ display: "block", color: "#8490a1", marginTop: 4 }}>Version {item.version} · {new Date(item.submittedAt ?? Date.now()).toLocaleDateString()}</span>{item.repositoryMetadata?.name && <span style={{ display: "block", marginTop: 6 }}><a href={item.repositoryUrl} target="_blank" rel="noreferrer">{item.repositoryMetadata.owner}/{item.repositoryMetadata.name} ↗</a></span>}{item.repositoryMetadata?.description && <span className="subtle" style={{ display: "block" }}>{item.repositoryMetadata.description}</span>}{item.repositoryMetadata?.defaultBranch && <span className="subtle" style={{ display: "block" }}>Default branch: {item.repositoryMetadata.defaultBranch}</span>}{item.repositoryMetadata?.latestCommitSha && <span className="subtle" style={{ display: "block" }}>Latest commit {item.repositoryMetadata.latestCommitSha.slice(0, 12)}{item.repositoryMetadata.latestCommitMessage ? ` · ${item.repositoryMetadata.latestCommitMessage}` : ""}{item.repositoryMetadata.latestCommitAuthor ? ` · ${item.repositoryMetadata.latestCommitAuthor}` : ""}{item.repositoryMetadata.latestCommitDate ? ` · ${new Date(item.repositoryMetadata.latestCommitDate).toLocaleDateString()}` : ""}</span>}</span><span className="badge">{(item.status || "").replaceAll("_", " ")}</span></div>) : <div className="empty"><strong>No submissions yet</strong>Submissions will appear here when interns share their work.</div>}
      </div></section>
      <section className="card"><div className="card-header"><div className="card-title">Upcoming review sessions</div><Clock3 size={16} color="#738198" /></div><div className="card-body">
        {meetings.length ? meetings.map((meeting: MeetingItem) => <div className="placeholder-row" key={String(meeting._id)}><span>{meeting.meetingType === "REVIEW" ? "Review meeting" : "Task explanation"}<span style={{ display: "block", color: "#8490a1", marginTop: 4 }}>{new Date(meeting.scheduledAt ?? Date.now()).toLocaleString()}</span></span><span className="badge">{meeting.durationMinutes ?? 0} min</span></div>) : <div className="empty"><strong>No meetings scheduled</strong>Meetings appear here only when real meeting records exist.</div>}
      </div></section>
    </div>
    <p className="subtle" style={{ marginTop: 18, fontSize: 11 }}>All figures are calculated from persisted records. No demo metrics are included.</p>
  </>;
}

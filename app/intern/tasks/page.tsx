import Link from "next/link";
import { connectDB } from "@/lib/db";
import { requireIntern } from "@/lib/authz";
import { Assignment, Intern } from "@/lib/models";

export const dynamic = "force-dynamic";

type TaskListItem = {
  _id?: unknown;
  taskSnapshot?: {
    title?: string;
    shortDescription?: string;
    category?: string;
  };
  taskId?: { title?: string; shortDescription?: string; category?: string };
  dueDate?: Date | string;
  status?: string;
  progress?: number;
};

export default async function InternTasksPage() {
  const user = await requireIntern(); await connectDB();
  const intern = await Intern.findOne({ userId: user._id }).select("_id").lean();
  const assignments = intern ? await Assignment.find({ internId: intern._id }).populate("taskId", "title shortDescription category").sort({ dueDate: 1 }).limit(50).lean() : [];
  return <><div className="page-heading"><div><h1>My tasks</h1><p>Task expectations and due dates for your internship.</p></div></div>
    <section className="card">    {assignments.length ? <div className="table-wrap"><table><thead><tr><th>Task</th><th>Category</th><th>Due date</th><th>Status</th><th>Progress</th><th></th></tr></thead><tbody>{assignments.map((item: TaskListItem) => <tr key={String(item._id)}><td><strong>{item.taskSnapshot?.title || item.taskId?.title || "Task"}</strong><div className="subtle">{item.taskSnapshot?.shortDescription || item.taskId?.shortDescription}</div></td><td>{item.taskSnapshot?.category || item.taskId?.category}</td><td>{new Date(item.dueDate ?? Date.now()).toLocaleDateString()}</td><td><span className="badge">{(item.status || "").replaceAll("_", " ")}</span></td><td>{item.progress ?? 0}%</td><td><Link className="button" href={`/intern/tasks/${item._id}`}>Details</Link> <Link className="button" href={`/intern/tasks/${item._id}/mentor`}>Mentor</Link></td></tr>)}</tbody></table></div> : <div className="empty"><strong>No tasks assigned</strong>Assignments from your administrator will appear here.</div>}</section>
  </>;
}

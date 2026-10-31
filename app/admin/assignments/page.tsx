import { connectDB } from "@/lib/db";
import { Assignment, Intern, Task } from "@/lib/models";
import { AssignmentCreateForm } from "@/components/admin-forms";
import { AssignmentTable } from "@/components/record-tables";

export const dynamic = "force-dynamic";

type InternOption = {
  _id?: unknown;
  userId?: { name?: string };
  internCode?: string;
};

type TaskOption = {
  _id?: unknown;
  title?: string;
};

export default async function AdminAssignmentsPage() {
  await connectDB();
  const [assignments, interns, tasks] = await Promise.all([
    Assignment.find({}).populate("taskId", "title").populate({ path: "internId", populate: { path: "userId", select: "name email" } }).sort({ createdAt: -1 }).limit(50).lean(),
    Intern.find({ status: "ACTIVE" }).populate({ path: "userId", select: "name email" }).sort({ createdAt: -1 }).limit(100).lean(),
    Task.find({ status: "ACTIVE" }).select("title").sort({ title: 1 }).limit(100).lean(),
  ]);
  const internOptions = interns.map((intern: InternOption) => ({ id: String(intern._id), name: intern.userId?.name || intern.internCode || "Intern" }));
  const taskOptions = tasks.map((task: TaskOption) => ({ id: String(task._id), name: task.title || "Task" }));
  return <>
    <div className="page-heading"><div><h1>Assignments</h1><p>Allocate active tasks and keep delivery progress visible.</p></div></div>
    <AssignmentCreateForm interns={internOptions} tasks={taskOptions} />
    <section className="card"><div className="card-header"><div className="card-title">Assignment history</div><span className="badge">{assignments.length} shown</span></div><AssignmentTable items={JSON.parse(JSON.stringify(assignments))} /></section>
  </>;
}

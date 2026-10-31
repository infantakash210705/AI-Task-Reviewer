import { connectDB } from "@/lib/db";
import { Task } from "@/lib/models";
import { BulkTaskUpload, TaskCreateForm } from "@/components/admin-forms";
import { TaskTable } from "@/components/record-tables";

export const dynamic = "force-dynamic";
export default async function AdminTasksPage() {
  await connectDB();
  const tasks = await Task.find({}).sort({ createdAt: -1 }).limit(50).lean();
  return <>
    <div className="page-heading"><div><h1>Tasks</h1><p>Create and manage reusable internship project briefs.</p></div></div>
    <TaskCreateForm />
    <BulkTaskUpload />
    <section className="card"><div className="card-header"><div className="card-title">Task library</div><span className="badge">{tasks.length} shown</span></div><TaskTable items={JSON.parse(JSON.stringify(tasks))} /></section>
  </>;
}

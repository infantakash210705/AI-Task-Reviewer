import Link from "next/link";
import { notFound } from "next/navigation";
import { connectDB } from "@/lib/db";
import { Task, Assignment } from "@/lib/models";
import { TaskEditForm } from "@/components/admin-forms";

export const dynamic = "force-dynamic";
export default async function AdminTaskDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connectDB();
  const task = await Task.findById(id).lean();
  if (!task) notFound();
  const assignmentCount = await Assignment.countDocuments({ taskId: task._id });
  const detailGroups: Array<[string, string[] | undefined]> = [
    ["Requirements", task.requirements],
    ["Acceptance criteria", task.acceptanceCriteria],
    ["Deliverables", task.expectedDeliverables],
    ["Required skills", task.requiredSkills],
  ];
  return <>
    <div className="page-heading"><div><div className="subtle"><Link href="/admin/tasks">Tasks</Link> / Details</div><h1>{task.title}</h1><p>{task.shortDescription}</p></div><span className="badge">{task.status}</span></div>
    <div className="content-grid"><section className="card"><div className="card-header"><div className="card-title">Task brief</div></div><div className="card-body"><p className="subtle">{task.fullDescription}</p>
      {detailGroups.map(([name, values]) => <div key={name} style={{ marginTop: 18 }}><strong>{name}</strong><ul className="subtle">{values?.length ? values.map((value: string, index: number) => <li key={`${name}-${index}`}>{value}</li>) : <li>None provided.</li>}</ul></div>)}
      </div></section><section className="card"><div className="card-header"><div className="card-title">Task details</div></div><div className="card-body"><div className="placeholder-row"><span>Category</span><strong>{task.category}</strong></div><div className="placeholder-row"><span>Difficulty</span><strong>{task.difficulty}</strong></div><div className="placeholder-row"><span>Estimated duration</span><strong>{task.estimatedDuration} days</strong></div><div className="placeholder-row"><span>Assignments</span><strong>{assignmentCount}</strong></div></div><TaskEditForm task={{ id: String(task._id), title: task.title, shortDescription: task.shortDescription, fullDescription: task.fullDescription, category: task.category, difficulty: task.difficulty, estimatedDuration: task.estimatedDuration, status: task.status, requiredSkills: task.requiredSkills, requirements: task.requirements, acceptanceCriteria: task.acceptanceCriteria, expectedDeliverables: task.expectedDeliverables }} /></section></div>
  </>;
}

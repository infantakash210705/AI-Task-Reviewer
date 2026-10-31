"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";

type UserSummary = { name?: string; email?: string };
type TaskRecord = { _id: string; title: string; category: string; difficulty: string; status: string; shortDescription: string };
type InternRecord = { _id: string; internCode: string; department: string; internshipTitle: string; status: string; startDate: string; expectedEndDate: string; userId?: UserSummary };
type AssignmentRecord = { _id: string; dueDate: string; status: string; progress: number; taskId?: { title?: string }; internId?: { internCode?: string; userId?: UserSummary } };

function SearchFilter({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div className="toolbar" style={{ padding: "12px 15px 0" }}><input className="input" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} /></div>;
}

export function TaskTable({ items }: { items: TaskRecord[] }) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => items.filter((item) => `${item.title} ${item.category} ${item.status}`.toLowerCase().includes(search.toLowerCase())), [items, search]);
  const router = useRouter();
  async function archive(id: string) {
    if (!window.confirm("Archive this task? Existing assignment history will be preserved.")) return;
    const response = await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "ARCHIVED" }) });
    const body = await response.json();
    if (!response.ok) toast.error(body.error || "Could not archive task."); else { toast.success("Task archived."); router.refresh(); }
  }
  return <><SearchFilter value={search} onChange={setSearch} placeholder="Search tasks…" /><div className="table-wrap"><table><thead><tr><th>Task</th><th>Category</th><th>Level</th><th>Status</th><th>Action</th></tr></thead><tbody>
    {filtered.length ? filtered.map((task) => <tr key={task._id}><td><Link href={`/admin/tasks/${task._id}`}><strong>{task.title}</strong></Link><div className="subtle">{task.shortDescription}</div></td><td>{task.category}</td><td>{task.difficulty}</td><td><span className="badge">{task.status}</span></td><td>{task.status !== "ARCHIVED" && <button className="button" onClick={() => archive(task._id)}>Archive</button>}</td></tr>) : <tr><td className="table-empty" colSpan={5}>No tasks match your search.</td></tr>}
  </tbody></table></div></>;
}

export function InternTable({ items }: { items: InternRecord[] }) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => items.filter((item) => `${item.userId?.name || ""} ${item.userId?.email || ""} ${item.internCode} ${item.department}`.toLowerCase().includes(search.toLowerCase())), [items, search]);
  return <><SearchFilter value={search} onChange={setSearch} placeholder="Search name, email, code, department…" /><div className="table-wrap"><table><thead><tr><th>Intern</th><th>Code</th><th>Department</th><th>Title</th><th>Dates</th><th>Status</th></tr></thead><tbody>
    {filtered.length ? filtered.map((intern) => <tr key={intern._id}><td><Link href={`/admin/interns/${intern._id}`}><strong>{intern.userId?.name || "Intern"}</strong></Link><div className="subtle">{intern.userId?.email}</div></td><td>{intern.internCode}</td><td>{intern.department}</td><td>{intern.internshipTitle}</td><td>{new Date(intern.startDate).toLocaleDateString()} – {new Date(intern.expectedEndDate).toLocaleDateString()}</td><td><span className="badge">{intern.status}</span></td></tr>) : <tr><td className="table-empty" colSpan={6}>No intern profiles match your search.</td></tr>}
  </tbody></table></div></>;
}

export function AssignmentTable({ items }: { items: AssignmentRecord[] }) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => items.filter((item) => `${item.taskId?.title || ""} ${item.internId?.userId?.name || ""} ${item.status}`.toLowerCase().includes(search.toLowerCase())), [items, search]);
  return <><SearchFilter value={search} onChange={setSearch} placeholder="Search task, intern, or status…" /><div className="table-wrap"><table><thead><tr><th>Task</th><th>Intern</th><th>Due date</th><th>Status</th><th>Progress</th></tr></thead><tbody>
    {filtered.length ? filtered.map((assignment) => <tr key={assignment._id}><td><Link href={`/admin/assignments/${assignment._id}`}>{assignment.taskId?.title || "Task"}</Link></td><td>{assignment.internId?.userId?.name || assignment.internId?.internCode || "Intern"}</td><td>{new Date(assignment.dueDate).toLocaleDateString()}</td><td><span className="badge">{assignment.status.replaceAll("_", " ")}</span></td><td>{assignment.progress}%</td></tr>) : <tr><td className="table-empty" colSpan={5}>No assignments match your search.</td></tr>}
  </tbody></table></div></>;
}

type SubmissionRecord = {
  _id: string;
  submissionType: string;
  repositoryUrl?: string;
  projectUrl?: string;
  repositoryMetadata?: {
    name?: string;
    owner?: string;
    description?: string;
    defaultBranch?: string;
    latestCommitSha?: string;
    latestCommitMessage?: string;
  };
  version: number;
  submittedAt: string;
  status: string;
  assignmentId?: { taskId?: { title?: string } };
};
export function SubmissionTable({ items }: { items: SubmissionRecord[] }) {
  return <div className="table-wrap"><table><thead><tr><th>Task</th><th>Version</th><th>Submitted</th><th>Repository</th><th>Default branch</th><th>Latest commit</th><th>Status</th></tr></thead><tbody>
    {items.length ? items.map((item) => { const url = item.repositoryUrl || item.projectUrl; return <tr key={item._id}><td>{item.assignmentId?.taskId?.title || "Assignment"}</td><td>v{item.version}</td><td>{new Date(item.submittedAt).toLocaleString()}</td><td>{url ? <><a href={url} target="_blank" rel="noreferrer" className="subtle">{item.repositoryMetadata?.owner && item.repositoryMetadata.name ? `${item.repositoryMetadata.owner}/${item.repositoryMetadata.name}` : "Open link"} ↗</a>{item.repositoryMetadata?.description && <div className="subtle">{item.repositoryMetadata.description}</div>}</> : "—"}</td><td>{item.repositoryMetadata?.defaultBranch || "—"}</td><td>{item.repositoryMetadata?.latestCommitSha ? <><span title={item.repositoryMetadata.latestCommitSha}>{item.repositoryMetadata.latestCommitSha.slice(0, 12)}</span>{item.repositoryMetadata.latestCommitMessage && <div className="subtle">{item.repositoryMetadata.latestCommitMessage}</div>}</> : "—"}</td><td><span className="badge">{item.status.replaceAll("_", " ")}</span></td></tr>; }) : <tr><td className="table-empty" colSpan={7}>No submissions yet.</td></tr>}
  </tbody></table></div>;
}

type ReviewRecord = {
  _id: string;
  summary: string;
  findings: string[];
  recommendations: string[];
  result: string;
  outcome?: string;
  reviewerType?: string;
  createdAt: string;
  assignmentId?: { _id?: string; taskId?: { title?: string } };
  submissionId?: { version?: number };
};
export function ReviewTable({ items }: { items: ReviewRecord[] }) {
  return <div className="table-wrap"><table><thead><tr><th>Task</th><th>Submission</th><th>Reviewer</th><th>Summary</th><th>Result</th><th>Date</th><th>Details</th></tr></thead><tbody>
    {items.length ? items.map((review) => <tr key={review._id}><td>{review.assignmentId?.taskId?.title || "Assignment"}</td><td>v{review.submissionId?.version || "—"}</td><td>{review.reviewerType === "AI" ? "AI" : review.reviewerType === "SYSTEM" ? "System" : "Administrator"}</td><td><strong>{review.summary}</strong><div className="subtle">{review.findings?.join("; ")}</div><div className="subtle">Recommendations: {review.recommendations?.join("; ") || "None"}</div></td><td><span className="badge">{(review.outcome || review.result).replaceAll("_", " ")}</span></td><td>{new Date(review.createdAt).toLocaleDateString()}</td><td>{review.assignmentId?._id && <Link className="button" href={`/intern/tasks/${review.assignmentId._id}/reviews/${review._id}`}>View review</Link>}</td></tr>) : <tr><td className="table-empty" colSpan={7}>No review records are available yet.</td></tr>}
  </tbody></table></div>;
}

import Link from "next/link";
import mongoose from "mongoose";
import { notFound, redirect } from "next/navigation";
import { MentorChat } from "@/components/mentor-chat";
import { requireUser } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { Assignment, Intern } from "@/lib/models";

export const dynamic = "force-dynamic";

export default async function InternTaskMentorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!mongoose.isValidObjectId(id)) notFound();
  await connectDB();
  if (user.role === "ADMIN") {
    const assignment = await Assignment.findById(id).select("_id taskSnapshot.title").lean();
    if (!assignment) notFound();
    return <>
      <div className="page-heading">
        <div><div className="subtle"><Link href="/admin/automation">Automation</Link> / Mentor room</div><h1>Mentor room access</h1><p>This room is available to the assigned intern.</p></div>
      </div>
      <section className="card">
        <div className="card-header"><div className="card-title">Intern-only room</div></div>
        <div className="card-body">
          <p className="subtle">The mentor chat and voice session use the intern&apos;s account so their conversation stays attributed to them. Open the assignment to review its details and activity.</p>
          <Link className="button button-primary" href={`/admin/assignments/${assignment._id}`}>View assignment</Link>
        </div>
      </section>
    </>;
  }
  if (user.role !== "INTERN") redirect("/unauthorized");
  const intern = await Intern.findOne({ userId: user._id, status: { $ne: "INACTIVE" } }).select("_id").lean();
  const assignment = intern ? await Assignment.findOne({ _id: id, internId: intern._id }).select("_id taskSnapshot.title").lean() : null;
  if (!assignment) notFound();
  return <>
    <div className="page-heading">
      <div><div className="subtle"><Link href={`/intern/tasks/${id}`}>Assignment</Link> / Mentor</div><h1>Task mentor</h1><p>Task-specific guidance based on your assignment brief.</p></div>
    </div>
    <MentorChat assignmentId={String(assignment._id)} title={assignment.taskSnapshot?.title || "Assigned task"} />
  </>;
}

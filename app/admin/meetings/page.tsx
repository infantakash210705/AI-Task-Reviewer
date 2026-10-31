import { connectDB } from "@/lib/db";
import { Assignment, Intern, Meeting, MeetingRequest, User } from "@/lib/models";
import { MeetingRequestActions } from "@/components/meeting-request-actions";
import { MeetingFeedbackRetry } from "@/components/meeting-feedback-retry";
import { MeetingManagementForm } from "@/components/meeting-management-form";

export const dynamic = "force-dynamic";

const fmt = (value: Date | string, timezone = "UTC") => new Date(value).toLocaleString("en", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" });

export default async function AdminMeetingsPage() {
  await connectDB();
  const timezone = process.env.DEFAULT_TIMEZONE?.trim() || "UTC";
  const requests = await MeetingRequest.find({}).sort({ createdAt: -1 }).limit(60).lean();
  const assignments = await Assignment.find({ _id: { $in: requests.map((request) => request.assignmentId) } }).select("taskSnapshot.title").lean();
  const interns = await Intern.find({ _id: { $in: requests.map((request) => request.internId) } }).select("userId").lean();
  const users = await User.find({ _id: { $in: interns.map((intern) => intern.userId) } }).select("name email").lean();
  const meetings = await Meeting.find({ requestId: { $in: requests.map((request) => request._id) } }).lean();
  const taskTitle = new Map(assignments.map((item) => [String(item._id), item.taskSnapshot?.title || "Task"]));
  const internUser = new Map(interns.map((intern) => [String(intern._id), users.find((user) => String(user._id) === String(intern.userId))]));
  const meetingByRequest = new Map(meetings.map((meeting) => [String(meeting.requestId), meeting]));
  const pending = requests.filter((request) => request.status === "PENDING");
  const handled = requests.filter((request) => request.status !== "PENDING");

  return <>
    <div className="page-heading"><div><h1>Meetings</h1><p>Interns ask for a clarification meeting. Approving one creates the Google Meet link and sends the mentor in at the scheduled time.</p></div></div>
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-header"><div className="card-title">Waiting for you</div><span className="badge">{pending.length}</span></div>
      <div className="card-body" style={{ display: "grid", gap: 18 }}>
        {pending.length === 0 && <div className="empty">No pending requests.</div>}
        {pending.map((request) => {
          const person = internUser.get(String(request.internId));
          return <article key={String(request._id)} className="placeholder-row" style={{ alignItems: "flex-start", gap: 20, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 280px" }}>
              <strong>{person?.name || "Intern"}</strong> <span className="subtle">· {taskTitle.get(String(request.assignmentId))}</span>
              <p style={{ margin: "8px 0" }}>{request.topic}</p>
              <div className="subtle">Asked {fmt(request.createdAt, timezone)}</div>
              {request.proposedTimes?.length > 0 && <div className="subtle">Preferred: {request.proposedTimes.map((time: Date) => fmt(time, timezone)).join(" · ")}</div>}
            </div>
            <MeetingRequestActions requestId={String(request._id)} suggestedTime={request.proposedTimes?.[0] ? new Date(request.proposedTimes[0]).toISOString() : undefined} />
          </article>;
        })}
      </div>
    </section>
    <section className="card">
      <div className="card-header"><div className="card-title">Handled requests</div></div>
      <div className="table-wrap"><table><thead><tr><th>Intern</th><th>Task</th><th>Status</th><th>When</th><th>Mentor</th><th>Feedback email</th><th>Manage</th></tr></thead><tbody>
        {handled.length === 0 && <tr><td colSpan={7} className="table-empty">Nothing here yet.</td></tr>}
        {handled.map((request) => {
          const meeting = meetingByRequest.get(String(request._id));
          return <tr key={String(request._id)}>
            <td>{internUser.get(String(request.internId))?.name || "Intern"}</td>
            <td>{taskTitle.get(String(request.assignmentId))}</td>
            <td><span className="badge">{request.status}</span>{request.adminNote && <div className="subtle">{request.adminNote}</div>}</td>
            <td>{meeting ? <>{fmt(meeting.scheduledAt, meeting.timezone)}{meeting.conferenceUrl && <> · <a href={meeting.conferenceUrl} target="_blank" rel="noreferrer">Meet</a></>}</> : "—"}</td>
            <td>{meeting ? <><span className="badge">{(meeting.agentStatus || "").replaceAll("_", " ")}</span>{meeting.agentLastError && <div className="subtle">{meeting.agentLastError}</div>}</> : "—"}</td>
            <td>{meeting ? <><span className="badge">{meeting.feedbackStatus || "NONE"}</span>{meeting.feedbackError && <div className="subtle">{meeting.feedbackError}</div>}{meeting.agentStatus === "COMPLETED" && meeting.feedbackStatus !== "SENT" && meeting.feedbackStatus !== "PENDING" && <MeetingFeedbackRetry meetingId={String(meeting._id)} />}</> : "—"}</td>
            <td>{meeting && meeting.status === "SCHEDULED" && new Date(meeting.scheduledAt).getTime() > Date.now() ? <MeetingManagementForm meetingId={String(meeting._id)} /> : "—"}</td>
          </tr>;
        })}
      </tbody></table></div>
    </section>
  </>;
}

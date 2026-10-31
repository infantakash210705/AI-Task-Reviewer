import { addDays } from "date-fns";
import mongoose from "mongoose";
import { z } from "zod";
import { apiUser } from "@/lib/authz";
import { cancelCalendarMeeting, rescheduleCalendarMeeting } from "@/lib/automation/calendar";
import { sendMeetingCancellationEmail, sendMeetingUpdateEmail } from "@/lib/automation/email-templates";
import { inngest } from "@/lib/inngest/client";
import { connectDB } from "@/lib/db";
import { Assignment, Intern, Meeting, User } from "@/lib/models";
import { handleApiError, jsonError } from "@/lib/http";
import { getMeetingAgentProvider } from "@/lib/automation/meeting-agent-provider";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("RESCHEDULE"), scheduledAt: z.coerce.date(), durationMinutes: z.coerce.number().int().min(5).max(480).optional() }).strict(),
  z.object({ action: z.literal("CANCEL") }).strict(),
]);

function configDays(): number {
  const days = Number(process.env.FIRST_REVIEW_INTERVAL_DAYS);
  return Number.isInteger(days) && days >= 1 && days <= 30 ? days : 3;
}

async function stopScheduledAgent(meeting: { _id: unknown; agentStatus?: string; agentProviderSessionId?: string }): Promise<boolean> {
  if (["COMPLETED", "NO_SHOW", "FAILED", "CANCELLED"].includes(meeting.agentStatus || "")) return true;
  if (!meeting.agentProviderSessionId) return !["CONNECTING", "IN_MEETING"].includes(meeting.agentStatus || "");
  try {
    const provider = getMeetingAgentProvider();
    if (meeting.agentStatus === "CONNECTING" || meeting.agentStatus === "IN_MEETING") {
      await provider.leaveSession(meeting.agentProviderSessionId);
    } else {
      await provider.cancelSession(meeting.agentProviderSessionId);
    }
    return true;
  } catch {
    console.error("[meeting-agent] could not stop session before calendar change", { meetingId: String(meeting._id) });
    return false;
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "ADMIN") return jsonError("Administrator access required.", 403);
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return jsonError("Meeting not found.", 404);
  try {
    await connectDB();
    const input = inputSchema.parse(await request.json());
    const meeting = await Meeting.findById(id);
    if (!meeting) return jsonError("Meeting not found.", 404);
    if (!["TASK_EXPLANATION", "FIRST_REVIEW"].includes(meeting.meetingType)) return jsonError("This meeting type cannot be changed by automation tools.", 409);
    if (meeting.status !== "SCHEDULED") return jsonError("Only scheduled meetings can be changed.", 409);
    const assignment = await Assignment.findById(meeting.assignmentId).lean();
    if (!assignment) return jsonError("The related assignment no longer exists.", 404);
    const intern = await Intern.findById(assignment.internId).lean();
    const user = intern ? await User.findById(intern.userId).select("name email isActive").lean() : null;
    if (!user?.isActive || !user.email) return jsonError("The assigned intern is no longer active or has no email address.", 409);
    const otherMeeting = await Meeting.findOne({
      assignmentId: assignment._id,
      meetingType: meeting.meetingType === "TASK_EXPLANATION" ? "FIRST_REVIEW" : "TASK_EXPLANATION",
      status: meeting.meetingType === "TASK_EXPLANATION" && input.action === "CANCEL"
        ? { $in: ["SCHEDULED", "CANCELLED"] }
        : "SCHEDULED",
    }).lean();

    if (input.action === "CANCEL") {
      if (!["SCHEDULED", "CANCELLED"].includes(meeting.status)) return jsonError("Only scheduled meetings can be changed.", 409);
      if (meeting.meetingType === "TASK_EXPLANATION" && !(await stopScheduledAgent(meeting))) {
        return jsonError("The mentor could not be confirmed stopped. The meeting was not cancelled.", 503);
      }
      await cancelCalendarMeeting(String(meeting._id));
      meeting.status = "CANCELLED";
      if (meeting.meetingType === "TASK_EXPLANATION") {
        meeting.agentConsentStatus = "REVOKED";
        meeting.agentStatus = "CANCELLED";
        meeting.agentProviderSessionId = "";
        meeting.agentLastError = "";
      }
      await meeting.save();
      if (meeting.meetingType === "TASK_EXPLANATION" && otherMeeting) {
        await cancelCalendarMeeting(String(otherMeeting._id));
        if (otherMeeting.status !== "CANCELLED") {
          await Meeting.updateOne({ _id: otherMeeting._id }, { $set: { status: "CANCELLED", lastSyncedAt: new Date() } });
        }
      }
      await Assignment.updateOne({ _id: assignment._id }, { $set: { firstReviewScheduledAt: null } });
      await inngest.send({
        id: `${String(meeting._id)}:cancelled:${Date.now()}`,
        name: "internflow/meeting.changed",
        data: { meetingId: String(meeting._id), assignmentId: String(assignment._id) },
      });
      if (meeting.meetingType === "TASK_EXPLANATION" && otherMeeting) {
        await inngest.send({
          id: `${String(otherMeeting._id)}:cancelled:${Date.now()}`,
          name: "internflow/meeting.changed",
          data: { meetingId: String(otherMeeting._id), assignmentId: String(assignment._id) },
        });
      }
      await sendMeetingCancellationEmail(user.email, String(assignment._id), assignment.taskSnapshot.title, meeting.meetingType, meeting.scheduledAt);
      if (meeting.meetingType === "TASK_EXPLANATION" && otherMeeting) {
        await sendMeetingCancellationEmail(user.email, String(assignment._id), assignment.taskSnapshot.title, "FIRST_REVIEW", otherMeeting.scheduledAt);
      }
      return Response.json({ status: "CANCELLED" });
    }

    if (meeting.status !== "SCHEDULED") return jsonError("Only scheduled meetings can be changed.", 409);
    if (meeting.meetingType === "TASK_EXPLANATION" && meeting.agentStartedAt) {
      return jsonError("An mentor session has already started; this meeting cannot be rescheduled.", 409);
    }
    if (input.scheduledAt.getTime() < Date.now() + 10 * 60_000) return jsonError("Choose a start time at least 10 minutes in the future.", 400);
    if (meeting.meetingType === "TASK_EXPLANATION" && !(await stopScheduledAgent(meeting))) {
      return jsonError("The mentor could not be confirmed stopped. The meeting was not rescheduled.", 503);
    }
    const durationMinutes = input.durationMinutes || meeting.durationMinutes;
    await rescheduleCalendarMeeting(String(meeting._id), input.scheduledAt, durationMinutes);
    meeting.scheduledAt = input.scheduledAt;
    meeting.durationMinutes = durationMinutes;
    meeting.lastSyncedAt = new Date();
    if (meeting.meetingType === "TASK_EXPLANATION") {
      meeting.agentConsentStatus = "REVOKED";
      meeting.agentStatus = "CONSENT_REQUIRED";
      meeting.agentProviderSessionId = "";
      meeting.agentLastError = "The meeting time changed; consent must be renewed.";
      meeting.agentRecordingEnabled = false;
    }
    await meeting.save();

    let reviewDate = meeting.meetingType === "FIRST_REVIEW" ? input.scheduledAt : otherMeeting?.scheduledAt || assignment.firstReviewScheduledAt;
    if (meeting.meetingType === "TASK_EXPLANATION" && otherMeeting) {
      reviewDate = addDays(input.scheduledAt, configDays());
      await rescheduleCalendarMeeting(String(otherMeeting._id), reviewDate, otherMeeting.durationMinutes);
      await Meeting.updateOne({ _id: otherMeeting._id }, { $set: { scheduledAt: reviewDate, lastSyncedAt: new Date() } });
      await Assignment.updateOne({ _id: assignment._id }, { $set: { firstReviewScheduledAt: reviewDate } });
      await inngest.send({
        id: `${String(otherMeeting._id)}:${reviewDate.getTime()}:changed`,
        name: "internflow/meeting.changed",
        data: { meetingId: String(otherMeeting._id), assignmentId: String(assignment._id) },
      });
      await inngest.send({
        id: `${String(otherMeeting._id)}:${reviewDate.getTime()}:reminder`,
        name: "internflow/meeting.reminder",
        data: { assignmentId: String(assignment._id), meetingId: String(otherMeeting._id), meetingType: "FIRST_REVIEW", scheduledAt: reviewDate.toISOString() },
      });
    }
    await inngest.send({
      id: `${String(meeting._id)}:${input.scheduledAt.getTime()}:changed`,
      name: "internflow/meeting.changed",
      data: { meetingId: String(meeting._id), assignmentId: String(assignment._id) },
    });

    const explanationMeeting = meeting.meetingType === "TASK_EXPLANATION" ? meeting : otherMeeting;
    const firstReviewMeeting = meeting.meetingType === "FIRST_REVIEW" ? meeting : otherMeeting;
    if (
      (meeting.meetingType === "TASK_EXPLANATION" && !explanationMeeting?.conferenceUrl)
      || (meeting.meetingType === "FIRST_REVIEW" && !firstReviewMeeting?.conferenceUrl)
      || (meeting.meetingType === "TASK_EXPLANATION" && otherMeeting && !firstReviewMeeting?.conferenceUrl)
    ) {
      return jsonError("The calendar event changed, but confirmed meeting details are incomplete. Check the automation status before notifying the intern.", 502);
    }
    const emailContext = {
      assignmentId: String(assignment._id),
      internName: user.name,
      internEmail: user.email,
      taskTitle: assignment.taskSnapshot.title,
      taskSummary: assignment.taskSnapshot.shortDescription,
      dueDate: assignment.dueDate,
      explanationDate: explanationMeeting?.scheduledAt || meeting.scheduledAt,
      explanationMeetUrl: explanationMeeting?.conferenceUrl || "",
      reviewDate: reviewDate || meeting.scheduledAt,
      reviewMeetUrl: firstReviewMeeting?.conferenceUrl || "",
      timezone: meeting.timezone || process.env.DEFAULT_TIMEZONE || "UTC",
    };
    if (meeting.meetingType === "TASK_EXPLANATION") {
      await sendMeetingUpdateEmail(emailContext, "TASK_EXPLANATION");
      if (otherMeeting) await sendMeetingUpdateEmail(emailContext, "FIRST_REVIEW");
    } else {
      await sendMeetingUpdateEmail(emailContext, "FIRST_REVIEW");
    }
    await inngest.send({
      id: `${String(meeting._id)}:${input.scheduledAt.getTime()}:reminder`,
      name: "internflow/meeting.reminder",
      data: { assignmentId: String(assignment._id), meetingId: String(meeting._id), meetingType: meeting.meetingType, scheduledAt: input.scheduledAt.toISOString() },
    });
    return Response.json({ status: "RESCHEDULED", scheduledAt: input.scheduledAt.toISOString() });
  } catch (error) {
    return handleApiError(error, "automation.meeting.update");
  }
}

import mongoose from "mongoose";
import { z } from "zod";
import { apiUser } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { handleApiError, jsonError } from "@/lib/http";
import { Assignment, Intern, Meeting, MeetingRequest, User } from "@/lib/models";
import { confirmedMeetUrl, ensureCalendarMeeting } from "@/lib/automation/calendar";
import { sendMeetingApprovedEmail, sendMeetingDeclinedEmail } from "@/lib/automation/email-meetings";
import { meetingAgentConfiguration } from "@/lib/automation/meeting-agent-provider";
import { inngest } from "@/lib/inngest/client";

const inputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("APPROVE"),
    scheduledAt: z.coerce.date(),
    durationMinutes: z.coerce.number().int().min(10).max(120).default(30),
    adminNote: z.string().trim().max(1000).default(""),
    meetUrl: z.string().trim().max(2048).optional(),
  }).strict(),
  z.object({ action: z.literal("DECLINE"), adminNote: z.string().trim().max(1000).default("") }).strict(),
]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "ADMIN") return jsonError("Administrator access required.", 403);
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return jsonError("Request not found.", 404);
  try {
    await connectDB();
    const input = inputSchema.parse(await request.json());
    const meetingRequest = await MeetingRequest.findById(id);
    if (!meetingRequest) return jsonError("Request not found.", 404);
    if (meetingRequest.status !== "PENDING") return jsonError("This request has already been handled.", 409);

    const assignment = await Assignment.findById(meetingRequest.assignmentId).lean();
    const intern = assignment ? await Intern.findById(assignment.internId).select("userId status").lean() : null;
    const user = intern ? await User.findById(intern.userId).select("name email isActive").lean() : null;
    if (!assignment || !user?.isActive || !user.email) return jsonError("The intern or task for this request is no longer available.", 409);

    if (input.action === "DECLINE") {
      meetingRequest.status = "DECLINED";
      meetingRequest.adminNote = input.adminNote;
      meetingRequest.decidedBy = auth.user._id;
      meetingRequest.decidedAt = new Date();
      await meetingRequest.save();
      let emailSent = true;
      try {
        await sendMeetingDeclinedEmail({ requestId: id, assignmentId: String(assignment._id), internName: user.name, internEmail: user.email, taskTitle: assignment.taskSnapshot.title, adminNote: input.adminNote });
      } catch { emailSent = false; }
      return Response.json({ status: "DECLINED", emailSent });
    }

    if (assignment.status === "COMPLETED") return jsonError("This task is already complete.", 409);
    if (input.scheduledAt.getTime() < Date.now() + 15 * 60_000) return jsonError("Choose a start time at least 15 minutes from now so the mentor can be scheduled.", 400);

    const customMeetUrl = input.meetUrl ? confirmedMeetUrl(input.meetUrl) : undefined;
    let conferenceUrl = customMeetUrl;
    if (!conferenceUrl) {
      const details = await ensureCalendarMeeting({
        assignmentId: String(assignment._id),
        requestId: id,
        internEmail: user.email,
        taskTitle: assignment.taskSnapshot.title,
        meetingType: "DOUBT_CLARIFICATION",
        scheduledAt: input.scheduledAt,
        durationMinutes: input.durationMinutes,
      });
      conferenceUrl = details.conferenceUrl;
    } else {
      await Meeting.findOneAndUpdate(
        { assignmentId: assignment._id, meetingType: "DOUBT_CLARIFICATION", requestId: meetingRequest._id },
        {
          $set: {
            scheduledAt: input.scheduledAt,
            durationMinutes: input.durationMinutes,
            meetingUrl: conferenceUrl,
            meetingProvider: "GOOGLE_CALENDAR",
            conferenceUrl,
            timezone: process.env.DEFAULT_TIMEZONE?.trim() || "UTC",
            status: "SCHEDULED",
            lastSyncedAt: new Date(),
          },
          $setOnInsert: { assignmentId: assignment._id, meetingType: "DOUBT_CLARIFICATION", requestId: meetingRequest._id },
        },
        { upsert: true, new: true, runValidators: true },
      );
    }

    const configuration = meetingAgentConfiguration();
    const consentAt = new Date(meetingRequest.consentAt);
    const meeting = await Meeting.findOneAndUpdate(
      { assignmentId: assignment._id, meetingType: "DOUBT_CLARIFICATION", requestId: meetingRequest._id },
      {
        $set: {
          agentConsentStatus: "GRANTED",
          agentConsentAt: consentAt,
          agentConsentPolicyVersion: meetingRequest.consentPolicyVersion,
          agentProvider: configuration.provider,
          agentStatus: "REQUESTED",
          agentRequestedAt: new Date(),
          agentRecordingEnabled: false,
          agentLastError: "",
          feedbackStatus: "NONE",
        },
      },
      { new: true },
    );
    if (!meeting) throw new Error("The meeting record could not be saved.");

    meetingRequest.status = "APPROVED";
    meetingRequest.adminNote = input.adminNote;
    meetingRequest.decidedBy = auth.user._id;
    meetingRequest.decidedAt = new Date();
    meetingRequest.meetingId = meeting._id;
    await meetingRequest.save();

    await inngest.send({
      id: `${String(meeting._id)}:consent:${consentAt.getTime()}`,
      name: "internflow/meeting-agent.consent-granted",
      data: { meetingId: String(meeting._id), consentAt: consentAt.toISOString() },
    });

    let emailSent = true;
    try {
      await sendMeetingApprovedEmail({
        requestId: id,
        assignmentId: String(assignment._id),
        internName: user.name,
        internEmail: user.email,
        taskTitle: assignment.taskSnapshot.title,
        scheduledAt: input.scheduledAt,
        durationMinutes: input.durationMinutes,
        timezone: process.env.DEFAULT_TIMEZONE?.trim() || "UTC",
        meetUrl: conferenceUrl,
        adminNote: input.adminNote,
      });
    } catch { emailSent = false; }
    return Response.json({ status: "APPROVED", meetingId: String(meeting._id), meetUrl: conferenceUrl, emailSent });
  } catch (error) {
    return handleApiError(error, "admin.meeting-requests.decide");
  }
}

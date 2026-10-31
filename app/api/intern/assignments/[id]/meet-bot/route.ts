import mongoose from "mongoose";
import { z } from "zod";
import { apiUser } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { handleApiError, jsonError } from "@/lib/http";
import { Assignment, Intern, Meeting, MeetingRequest } from "@/lib/models";
import { confirmedMeetUrl } from "@/lib/automation/calendar";
import {
  getMeetingAgentProvider,
  meetingAgentConfiguration,
  MEETING_AGENT_CONSENT_POLICY_VERSION,
} from "@/lib/automation/meeting-agent-provider";
import { botDisplayName } from "@/lib/automation/mentor-persona";
import { inngest } from "@/lib/inngest/client";

const meetBotInputSchema = z.object({
  meetUrl: z.string().trim().min(5, "Enter a Google Meet link."),
  topic: z.string().trim().min(3, "Tell the mentor what you'd like to review or clarify.").max(1500),
  intent: z.enum([
    "CODE_REVIEW",
    "ACCEPTANCE_CRITERIA",
    "DEBUG_ERROR",
    "ARCHITECTURE",
    "GENERAL_QUERY",
  ]).optional(),
  reviewType: z.enum(["REVIEW", "CLARIFICATION"]).default("REVIEW"),
  scheduleMode: z.enum(["NOW", "LATER"]).default("NOW"),
  scheduledAt: z.coerce.date().optional(),
  consent: z.literal(true, { message: "Please accept the session notice to invite the bot." }),
}).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "INTERN") return jsonError("Intern access required.", 403);
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return jsonError("Assignment not found.", 404);

  try {
    await connectDB();
    const input = meetBotInputSchema.parse(await request.json());
    const canonicalMeetUrl = confirmedMeetUrl(input.meetUrl);
    if (!canonicalMeetUrl) {
      return jsonError("Enter a valid Google Meet link (e.g. https://meet.google.com/abc-defg-hij).", 400);
    }

    const intern = await Intern.findOne({ userId: auth.user._id, status: { $ne: "INACTIVE" } }).select("_id").lean();
    if (!intern) return jsonError("An active intern profile is required.", 403);

    const assignment = await Assignment.findOne({ _id: id, internId: intern._id }).lean();
    if (!assignment) return jsonError("Assignment not found.", 404);
    if (assignment.status === "COMPLETED") {
      return jsonError("This task is already completed. Reviews and meetings are closed.", 409);
    }

    const now = Date.now();
    let meetingDate: Date;
    if (input.scheduleMode === "LATER") {
      if (!input.scheduledAt) {
        return jsonError("Select a date and time for the scheduled meeting.", 400);
      }
      meetingDate = new Date(input.scheduledAt);
      if (meetingDate.getTime() < now + 10 * 60_000) {
        return jsonError("Scheduled meetings must be at least 10 minutes in the future, or choose 'Join right now'.", 400);
      }
    } else {
      meetingDate = new Date();
    }

    const configuration = meetingAgentConfiguration();
    const meetingType = input.reviewType === "REVIEW" ? "FIRST_REVIEW" : "DOUBT_CLARIFICATION";

    const INTENT_LABELS: Record<string, string> = {
      CODE_REVIEW: "Code Review & Feedback",
      ACCEPTANCE_CRITERIA: "Clarify Acceptance Criteria",
      DEBUG_ERROR: "Help Debug Error",
      ARCHITECTURE: "Architecture & Design",
      GENERAL_QUERY: "General Query",
    };
    const intentPrefix = input.intent && INTENT_LABELS[input.intent] ? `[Intent: ${INTENT_LABELS[input.intent]}] ` : "";
    const sessionTopic = `${intentPrefix}${input.topic}`;

    // Create tracking MeetingRequest
    const meetingRequest = await MeetingRequest.create({
      assignmentId: assignment._id,
      internId: intern._id,
      userId: auth.user._id,
      topic: sessionTopic,
      proposedTimes: [meetingDate],
      consentAt: new Date(),
      consentPolicyVersion: MEETING_AGENT_CONSENT_POLICY_VERSION,
      status: "APPROVED",
      adminNote: "Direct Google Meet bot invitation by intern",
      decidedBy: auth.user._id,
      decidedAt: new Date(),
    });

    const consentAt = new Date();
    const meeting = await Meeting.create({
      assignmentId: assignment._id,
      meetingType,
      requestId: meetingRequest._id,
      scheduledAt: meetingDate,
      durationMinutes: 30,
      meetingUrl: canonicalMeetUrl,
      conferenceUrl: canonicalMeetUrl,
      meetingProvider: "GOOGLE_CALENDAR",
      timezone: process.env.DEFAULT_TIMEZONE?.trim() || "UTC",
      status: "SCHEDULED",
      agentConsentStatus: "GRANTED",
      agentConsentAt: consentAt,
      agentConsentPolicyVersion: MEETING_AGENT_CONSENT_POLICY_VERSION,
      agentProvider: configuration.provider,
      agentStatus: "REQUESTED",
      agentRequestedAt: new Date(),
      agentRecordingEnabled: false,
      agentLastError: "",
      feedbackStatus: "NONE",
    });

    meetingRequest.meetingId = meeting._id;
    await meetingRequest.save();

    // Note: Do NOT schedule directly here AND trigger Inngest event, as that creates duplicate bots in the meeting.
    // Trigger Inngest workflow which idempotently schedules the bot and manages background notifications.
    let providerBotId = "";
    try {
      await inngest.send({
        id: `${String(meeting._id)}:consent:${consentAt.getTime()}`,
        name: "internflow/meeting-agent.consent-granted",
        data: { meetingId: String(meeting._id), consentAt: consentAt.toISOString() },
      });
    } catch (inngestErr) {
      console.warn("[meet-bot] inngest send error", inngestErr);
    }

    return Response.json({
      success: true,
      meetingId: String(meeting._id),
      meetUrl: canonicalMeetUrl,
      scheduledAt: meetingDate.toISOString(),
      isImmediate: input.scheduleMode === "NOW",
      botProvider: configuration.provider,
      botSessionId: providerBotId,
      message: input.scheduleMode === "NOW"
        ? `Bot requested to join ${canonicalMeetUrl}. Please open your Google Meet and admit '${botDisplayName()}' from the waiting room when it knocks.`
        : `Bot scheduled to join ${canonicalMeetUrl} at ${meetingDate.toLocaleString()}.`,
    }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "intern.assignments.meet-bot");
  }
}

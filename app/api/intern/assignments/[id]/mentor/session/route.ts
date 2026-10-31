import mongoose from "mongoose";
import { z } from "zod";
import { apiUser } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { Assignment, Intern, Meeting, MentorConversation, MentorSession, User } from "@/lib/models";
import { handleApiError, jsonError } from "@/lib/http";
import { sendVoiceMentorFeedbackEmail } from "@/lib/automation/email-templates";
import { cancelCalendarMeeting } from "@/lib/automation/calendar";
import { inngest } from "@/lib/inngest/client";

const sessionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("START"), consent: z.literal(true) }).strict(),
  z.object({ action: z.literal("END"), sessionId: z.string().min(1).max(64) }).strict(),
]);

const consentPolicyVersion = "2026-10-browser-speech-qwen-v1";

async function ownedContext(assignmentId: string, userId: string) {
  const intern = await Intern.findOne({ userId, status: "ACTIVE" }).select("_id").lean();
  if (!intern) return null;
  const assignment = await Assignment.findOne({ _id: assignmentId, internId: intern._id }).lean();
  if (!assignment?.taskSnapshot) return null;
  const user = await User.findById(userId).select("name email isActive").lean();
  if (!user?.isActive || !user.email) return null;
  return { intern, assignment, user };
}

function sessionSummary(messages: Array<{ role?: string; content?: string }>): string {
  const relevant = messages
    .filter((message) => typeof message.content === "string" && message.content.trim())
    .slice(-12)
    .map((message) => `${message.role === "ASSISTANT" ? "mentor feedback" : "Intern question"}: ${message.content?.trim()}`);
  return relevant.join("\n\n").slice(0, 3900);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "INTERN") return jsonError("Intern access required.", 403);
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return jsonError("Assignment not found.", 404);

  try {
    await connectDB();
    const input = sessionInput.parse(await request.json());
    const context = await ownedContext(id, String(auth.user._id));
    if (!context) return jsonError("Active intern assignment not found.", 404);

    if (input.action === "START") {
      const existing = await MentorSession.findOne({
        assignmentId: context.assignment._id,
        userId: auth.user._id,
        status: "ACTIVE",
      }).select("_id startedAt").lean();
      if (existing) {
        return Response.json({
          sessionId: String(existing._id),
          startedAt: new Date(existing.startedAt).toISOString(),
          status: "ACTIVE",
          resumed: true,
        });
      }
      const now = new Date();
      const session = await MentorSession.create({
        assignmentId: context.assignment._id,
        internId: context.intern._id,
        userId: auth.user._id,
        status: "ACTIVE",
        consentAt: now,
        consentPolicyVersion,
        startedAt: now,
        recordingEnabled: false,
      });
      return Response.json({ sessionId: String(session._id), startedAt: now.toISOString(), status: "ACTIVE" }, { status: 201 });
    }

    const session = await MentorSession.findOne({
      _id: input.sessionId,
      assignmentId: context.assignment._id,
      userId: auth.user._id,
    });
    if (!session) return jsonError("Mentor session not found.", 404);
    if (session.status === "ACTIVE") {
      const endedAt = new Date();
      const conversation = await MentorConversation.findOne({
        assignmentId: context.assignment._id,
        userId: auth.user._id,
      }).select("messages").lean();
      const messages = (conversation?.messages || [])
        .filter((message: { sessionId?: string }) => message.sessionId === input.sessionId);
      const summary = sessionSummary(messages);
      session.status = "COMPLETED";
      session.endedAt = endedAt;
      session.summary = summary;
      session.feedbackEmailStatus = "PENDING";
      await session.save();
    }

    const endedAt = session.endedAt || new Date();
    const timezone = process.env.DEFAULT_TIMEZONE?.trim() || "UTC";
    let nextReview = await Meeting.findOne({
      assignmentId: context.assignment._id,
      meetingType: "FIRST_REVIEW",
      status: "SCHEDULED",
      scheduledAt: { $gt: endedAt },
    }).sort({ scheduledAt: 1 });
    const origin = (process.env.APP_BASE_URL?.trim() || process.env.NEXTAUTH_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");

    if (!nextReview) {
      const interval = Number(process.env.FIRST_REVIEW_INTERVAL_DAYS);
      const days = Number.isInteger(interval) && interval >= 1 && interval <= 30 ? interval : 3;
      const nextDate = new Date(endedAt.getTime() + days * 24 * 60 * 60_000);
      const roomUrl = `${origin}/intern/tasks/${encodeURIComponent(id)}/mentor`;
      nextReview = await Meeting.findOneAndUpdate(
        { assignmentId: context.assignment._id, meetingType: "FIRST_REVIEW" },
        {
          $set: {
            scheduledAt: nextDate,
            durationMinutes: 30,
            meetingUrl: roomUrl,
            meetingProvider: "INTERNAL",
            conferenceUrl: "",
            calendarId: "",
            timezone,
            status: "SCHEDULED",
            agentConsentStatus: "REQUIRED",
            agentConsentAt: null,
            agentConsentPolicyVersion: "",
            agentProvider: "DISABLED",
            agentStatus: "NOT_REQUESTED",
            agentProviderSessionId: "",
            agentStartedAt: null,
            agentEndedAt: null,
            agentSummary: "",
            agentRecordingEnabled: false,
            agentEventIds: [],
          },
          $unset: { googleCalendarEventId: "" },
        },
        { upsert: true, new: true, runValidators: true },
      );
      await Assignment.updateOne(
        { _id: context.assignment._id },
        { $set: { firstReviewScheduledAt: nextDate } },
      );
    } else if (nextReview.meetingProvider === "GOOGLE_CALENDAR" && nextReview.googleCalendarEventId) {
      await cancelCalendarMeeting(String(nextReview._id));
      const internalUrl = `${origin}/intern/tasks/${encodeURIComponent(id)}/mentor`;
      nextReview.meetingUrl = internalUrl;
      nextReview.meetingProvider = "INTERNAL";
      nextReview.conferenceUrl = "";
      nextReview.calendarId = "";
      nextReview.set("googleCalendarEventId", undefined);
      await nextReview.save();
    }

    const nextReviewUrl = `${origin}/intern/tasks/${encodeURIComponent(id)}/mentor`;
    let reminderScheduled = true;
    if (new Date(nextReview.scheduledAt).getTime() > Date.now()) {
      try {
        await inngest.send({
          id: `${String(nextReview._id)}:${new Date(nextReview.scheduledAt).getTime()}:reminder`,
          name: "internflow/meeting.reminder",
          data: {
            assignmentId: id,
            meetingId: String(nextReview._id),
            meetingType: "FIRST_REVIEW",
            scheduledAt: new Date(nextReview.scheduledAt).toISOString(),
          },
        });
      } catch {
        reminderScheduled = false;
        console.error("[mentor-voice] next-review reminder could not be queued", { meetingId: String(nextReview._id) });
      }
    }
    try {
      await sendVoiceMentorFeedbackEmail({
        assignmentId: id,
        sessionId: String(session._id),
        internName: context.user.name,
        internEmail: context.user.email,
        taskTitle: context.assignment.taskSnapshot.title,
        summary: session.summary,
        requirements: context.assignment.taskSnapshot.requirements || [],
        acceptanceCriteria: context.assignment.taskSnapshot.acceptanceCriteria || [],
        deliverables: context.assignment.taskSnapshot.expectedDeliverables || [],
        dueDate: new Date(context.assignment.dueDate),
        timezone,
        nextReview: { date: new Date(nextReview.scheduledAt), timezone: nextReview.timezone || timezone, url: nextReviewUrl },
      });
      await MentorSession.updateOne(
        { _id: session._id },
        { $set: { feedbackEmailStatus: "SENT", feedbackEmailSentAt: new Date(), nextMeetingId: nextReview._id } },
      );
    } catch {
      await MentorSession.updateOne(
        { _id: session._id },
        { $set: { feedbackEmailStatus: "FAILED", nextMeetingId: nextReview._id } },
      );
      console.error("[mentor-voice] feedback email failed", { sessionId: String(session._id) });
      return jsonError("The session ended and next review was scheduled, but the feedback email could not be sent. Check SMTP settings and retry.", 503);
    }

    return Response.json({
      status: "COMPLETED",
      summary: session.summary,
      feedbackEmailStatus: "SENT",
      reminderScheduled,
      nextMeeting: {
        scheduledAt: new Date(nextReview.scheduledAt).toISOString(),
        timezone: nextReview.timezone || timezone,
        url: nextReviewUrl,
        reminderScheduled,
      },
    });
  } catch (error) {
    return handleApiError(error, "mentor.session");
  }
}

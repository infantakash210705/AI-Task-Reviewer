import { connectDB } from "@/lib/db";
import { Assignment, Intern, Meeting, User } from "@/lib/models";
import {
  sendMeetingAgentFailureEmail,
  sendMeetingAgentPendingEmail,
  sendMeetingAgentSummaryEmail,
} from "@/lib/automation/email-templates";
import {
  getMeetingAgentProvider,
  meetingAgentConfiguration,
  type MeetingAgentSessionRequest,
} from "@/lib/automation/meeting-agent-provider";
import { confirmedMeetUrl } from "@/lib/automation/calendar";
import { botDisplayName } from "@/lib/automation/mentor-persona";
import { inngest } from "@/lib/inngest/client";

type ConsentEvent = { meetingId: string; consentAt: string };
type OutcomeEvent = { meetingId: string; eventId: string; type: "SESSION_ENDED" | "SESSION_NO_SHOW" | "SESSION_FAILED" };

export const scheduleMeetingAgent = inngest.createFunction(
  {
    id: "schedule-meeting-agent",
    retries: 3,
    triggers: [{ event: "internflow/meeting-agent.consent-granted" }],
    cancelOn: [
      { event: "internflow/meeting-agent.consent-revoked", if: "async.data.meetingId == event.data.meetingId" },
      { event: "internflow/meeting.changed", if: "async.data.meetingId == event.data.meetingId" },
    ],
    onFailure: async ({ event }) => {
      const meetingId = (event.data as { event?: { data?: { meetingId?: string } } }).event?.data?.meetingId;
      if (!meetingId) return;
      await connectDB();
      const update = await Meeting.updateOne(
        { _id: meetingId, agentConsentStatus: "GRANTED", agentStartedAt: null },
        { $set: { agentStatus: "FAILED", agentLastError: "Meeting-agent scheduling failed; an administrator can review the automation status." } },
      );
      if (!update.modifiedCount) return;
      console.error("[meeting-agent] scheduling workflow exhausted retries", { meetingId });
      const consentAt = (event.data as { event?: { data?: { consentAt?: string } } }).event?.data?.consentAt;
      const meeting = await Meeting.findById(meetingId).lean();
      const assignment = meeting ? await Assignment.findById(meeting.assignmentId).lean() : null;
      const intern = assignment ? await Intern.findById(assignment.internId).lean() : null;
      const user = intern ? await User.findById(intern.userId).select("email isActive").lean() : null;
      if (!meeting || !assignment || !user?.isActive || !user.email || !consentAt) return;
      const notification = {
        assignmentId: String(assignment._id),
        meetingId,
        eventId: `scheduling-failure:${consentAt}`,
        taskTitle: assignment.taskSnapshot.title,
        status: "FAILED" as const,
      };
      try {
        await sendMeetingAgentFailureEmail({ ...notification, recipient: user.email });
        const adminEmail = process.env.ADMIN_EMAIL?.trim();
        if (adminEmail) await sendMeetingAgentFailureEmail({ ...notification, recipient: adminEmail });
      } catch {
        console.error("[meeting-agent] scheduling failure notification could not be sent", { meetingId });
      }
    },
  },
  async ({ event, step }) => {
    const { meetingId, consentAt } = event.data as ConsentEvent;
    const context = await step.run("load-consented-meeting", async () => {
      await connectDB();
      const meeting = await Meeting.findById(meetingId).lean();
      if (!meeting || !["TASK_EXPLANATION", "DOUBT_CLARIFICATION", "FIRST_REVIEW", "REVIEW"].includes(meeting.meetingType) || meeting.status !== "SCHEDULED"
        || meeting.agentConsentStatus !== "GRANTED"
        || new Date(meeting.agentConsentAt || 0).toISOString() !== consentAt) return null;
      const assignment = await Assignment.findById(meeting.assignmentId).lean();
      if (!assignment || !assignment.taskSnapshot) return null;
      if (assignment.status === "COMPLETED") {
        await Meeting.updateOne(
          { _id: meetingId, agentConsentStatus: "GRANTED", agentStartedAt: null },
          { $set: { agentConsentStatus: "REVOKED", agentStatus: "CANCELLED", agentLastError: "The assignment was completed before the scheduled session." } },
        );
        return null;
      }
      const intern = await Intern.findOne({ _id: assignment.internId, status: "ACTIVE" }).lean();
      const user = intern ? await User.findById(intern.userId).select("name email isActive").lean() : null;
      if (!user?.isActive || !user.email) return null;
      const meetUrl = confirmedMeetUrl(meeting.conferenceUrl);
      if (!meetUrl) {
        await Meeting.updateOne(
          { _id: meetingId, agentConsentStatus: "GRANTED", agentStartedAt: null },
          { $set: { agentStatus: "FAILED", agentLastError: "A confirmed Google Meet URL is required for the mentor session." } },
        );
        return null;
      }
      return {
        meeting: {
          id: String(meeting._id),
          scheduledAt: new Date(meeting.scheduledAt).toISOString(),
          agentStatus: meeting.agentStatus,
          durationMinutes: meeting.durationMinutes,
          conferenceUrl: meetUrl,
          timezone: meeting.timezone || process.env.DEFAULT_TIMEZONE || "UTC",
        },
        assignment: {
          id: String(assignment._id),
          dueDate: new Date(assignment.dueDate).toISOString(),
          task: assignment.taskSnapshot,
        },
        intern: { name: user.name, email: user.email },
      };
    });
    if (!context) return { meetingId, status: "CANCELLED_OR_NOT_ELIGIBLE" };

    const meetingWindowEnd = new Date(context.meeting.scheduledAt).getTime() + (context.meeting.durationMinutes || 30) * 60_000;
    if (context.meeting.agentStatus === "REQUESTED" && meetingWindowEnd <= Date.now()) {
      const markedFailed = await step.run("record-missed-session-window", async () => {
        const update = await Meeting.updateOne(
          { _id: meetingId, agentConsentStatus: "GRANTED", agentStatus: "REQUESTED", agentStartedAt: null },
          { $set: { agentStatus: "FAILED", agentLastError: "The consent workflow ran after the scheduled start; no agent was started." } },
        );
        return update.modifiedCount > 0;
      });
      if (!markedFailed) return { meetingId, status: "CANCELLED_OR_NOT_ELIGIBLE" };
      await step.run("notify-missed-session-window", () => sendMeetingAgentFailureEmail({
        assignmentId: context.assignment.id,
        meetingId,
        eventId: `missed-window:${consentAt}`,
        recipient: context.intern.email,
        taskTitle: context.assignment.task.title,
        status: "FAILED",
      }));
      return { meetingId, status: "MISSED_SCHEDULE_WINDOW" };
    }

    const configuration = meetingAgentConfiguration();
    const provider = getMeetingAgentProvider();
    const request: MeetingAgentSessionRequest = {
      meetingId,
      assignmentId: context.assignment.id,
      idempotencyKey: `${meetingId}:${consentAt}`,
      meetingUrl: context.meeting.conferenceUrl,
      scheduledAt: new Date(context.meeting.scheduledAt),
      durationMinutes: context.meeting.durationMinutes,
      botName: botDisplayName(),
      taskContext: {
        title: context.assignment.task.title,
        description: context.assignment.task.fullDescription,
        requirements: context.assignment.task.requirements || [],
        acceptanceCriteria: context.assignment.task.acceptanceCriteria || [],
        expectedDeliverables: context.assignment.task.expectedDeliverables || [],
        dueDate: context.assignment.dueDate,
      },
    };
    const scheduled = await step.run("schedule-with-provider-adapter", () => provider.scheduleSession(request));
    if (
      scheduled.status === "PENDING_INTEGRATION"
      || provider.status !== "READY"
      || configuration.integrationStatus !== "READY"
      || configuration.missingCredentials.length
    ) {
      const reason = configuration.missingCredentials.length
        ? "The meeting-agent server configuration is incomplete."
        : provider.status === "PENDING_INTEGRATION"
          ? "The provider adapter has not been implemented and verified."
          : "The meeting-agent provider is not enabled.";
      const markedPending = await step.run("record-provider-pending", async () => {
        const update = await Meeting.updateOne(
          { _id: meetingId, agentConsentStatus: "GRANTED", agentStartedAt: null },
          {
            $set: {
              agentProvider: configuration.provider,
              agentStatus: "PROVIDER_PENDING",
              agentLastError: reason.slice(0, 500),
              agentRecordingEnabled: false,
            },
          },
        );
        return update.modifiedCount > 0;
      });
      if (!markedPending) return { meetingId, status: "CANCELLED_OR_NOT_ELIGIBLE" };
      await step.run("notify-provider-pending", () => sendMeetingAgentPendingEmail({
        assignmentId: context.assignment.id,
        meetingId,
        internName: context.intern.name,
        internEmail: context.intern.email,
        taskTitle: context.assignment.task.title,
        scheduledAt: new Date(context.meeting.scheduledAt),
        timezone: context.meeting.timezone,
        consentAt: new Date(consentAt),
      }));
      console.info("[meeting-agent] provider pending", { meetingId, provider: configuration.provider });
      return { meetingId, status: "PROVIDER_PENDING" };
    }

    await step.run("persist-provider-session", async () => {
      const update = await Meeting.updateOne(
        {
          _id: meetingId,
          agentConsentStatus: "GRANTED",
          agentStatus: { $in: ["CONSENT_REQUIRED", "REQUESTED", "PROVIDER_PENDING", "SCHEDULED"] },
          agentStartedAt: null,
        },
        {
          $set: {
            agentProvider: configuration.provider,
            agentStatus: "SCHEDULED",
            agentProviderSessionId: scheduled.providerSessionId,
            agentLastError: "",
            agentRecordingEnabled: false,
          },
        },
      );
      if (!update.modifiedCount) throw new Error("Meeting-agent consent or lifecycle state changed before scheduling completed.");
    });
    return { meetingId, status: "SCHEDULED" };
  },
);

export const notifyMeetingAgentOutcome = inngest.createFunction(
  {
    id: "notify-meeting-agent-outcome",
    retries: 3,
    triggers: [{ event: "internflow/meeting-agent.terminal" }],
  },
  async ({ event, step }) => {
    const { meetingId, eventId, type } = event.data as OutcomeEvent;
    const context = await step.run("load-terminal-meeting-context", async () => {
      await connectDB();
      const meeting = await Meeting.findById(meetingId).lean();
      if (!meeting || !meeting.agentEventIds.includes(eventId)) return null;
      const assignment = await Assignment.findById(meeting.assignmentId).lean();
      if (!assignment || !assignment.taskSnapshot) return null;
      const intern = await Intern.findById(assignment.internId).lean();
      const user = intern ? await User.findById(intern.userId).select("name email isActive").lean() : null;
      if (!user?.isActive || !user.email) return null;
      const review = await Meeting.findOne({
        assignmentId: assignment._id,
        meetingType: "FIRST_REVIEW",
        status: "SCHEDULED",
        scheduledAt: { $gt: meeting.agentEndedAt || new Date() },
      }).sort({ scheduledAt: 1 }).lean();
      return {
        meeting,
        assignment,
        intern: { name: user.name, email: user.email },
        review: review ? {
          scheduledAt: new Date(review.scheduledAt).toISOString(),
          timezone: review.timezone || process.env.DEFAULT_TIMEZONE || "UTC",
          meetUrl: review.conferenceUrl,
        } : undefined,
      };
    });
    if (!context) return { meetingId, status: "IGNORED" };

    if (type === "SESSION_ENDED" && context.meeting.agentStatus === "COMPLETED" && context.meeting.meetingType !== "DOUBT_CLARIFICATION") {
      const task = context.assignment.taskSnapshot;
      await step.run("email-session-summary", () => sendMeetingAgentSummaryEmail({
        assignmentId: String(context.assignment._id),
        meetingId,
        eventId,
        internName: context.intern.name,
        internEmail: context.intern.email,
        taskTitle: task.title,
        taskDescription: task.fullDescription,
        requirements: task.requirements || [],
        acceptanceCriteria: task.acceptanceCriteria || [],
        expectedDeliverables: task.expectedDeliverables || [],
        dueDate: new Date(context.assignment.dueDate),
        meetingSummary: context.meeting.agentSummary,
        endedAt: new Date(context.meeting.agentEndedAt || Date.now()),
        timezone: context.meeting.timezone || process.env.DEFAULT_TIMEZONE || "UTC",
        nextReview: context.review ? { ...context.review, scheduledAt: new Date(context.review.scheduledAt) } : undefined,
      }));
    } else if (type !== "SESSION_ENDED" && ["NO_SHOW", "FAILED"].includes(context.meeting.agentStatus)) {
      const status = context.meeting.agentStatus as "NO_SHOW" | "FAILED";
      await step.run("email-intern-session-outcome", () => sendMeetingAgentFailureEmail({
        assignmentId: String(context.assignment._id),
        meetingId,
        eventId,
        recipient: context.intern.email,
        taskTitle: context.assignment.taskSnapshot.title,
        status,
      }));
      const adminEmail = process.env.ADMIN_EMAIL?.trim();
      if (adminEmail) {
        await step.run("notify-admin-session-outcome", () => sendMeetingAgentFailureEmail({
          assignmentId: String(context.assignment._id),
          meetingId,
          eventId,
          recipient: adminEmail,
          taskTitle: context.assignment.taskSnapshot.title,
          status,
        }));
      }
    }
    return { meetingId, status: context.meeting.agentStatus };
  },
);

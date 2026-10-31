import { randomUUID } from "node:crypto";
import { addDays } from "date-fns";
import type { Jsonify } from "inngest/types";
import { AutomationRun, Assignment, Intern, Meeting, TaskExplanation, User } from "@/lib/models";
import { ensureCalendarMeeting, ensureInternalMeeting } from "@/lib/automation/calendar";
import { sendAssignmentOnlyEmail } from "@/lib/automation/email-meetings";
import { autoScheduleMeetings } from "@/lib/automation/meeting-policy";
import { sendAssignmentAndSessionEmails, sendFirstReviewEmail, sendMeetingReminder } from "@/lib/automation/email-templates";
import { generateTaskExplanation, taskFingerprint, type TaskContext } from "@/lib/automation/explanation";
import { inngest } from "@/lib/inngest/client";

type WorkflowContext = {
  assignmentId: string;
  internId: string;
  internName: string;
  internEmail: string;
  taskId: string;
  task: TaskContext;
  dueDate: string;
};

function boundedNumber(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

async function setStep(
  assignmentId: string,
  name: string,
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED",
  lastError = "",
): Promise<void> {
  const timestamp = new Date();
  const set: Record<string, unknown> = {
    "steps.$.status": status,
    "steps.$.lastError": lastError.slice(0, 500),
  };
  if (status === "PROCESSING") {
    set["steps.$.startedAt"] = timestamp;
    await AutomationRun.updateOne({ assignmentId, "steps.name": name }, {
      $set: { ...set, "steps.$.completedAt": null },
      $inc: { "steps.$.attemptCount": 1 },
    });
  } else {
    if (status === "COMPLETED" || status === "FAILED") set["steps.$.completedAt"] = timestamp;
    await AutomationRun.updateOne({ assignmentId, "steps.name": name }, { $set: set });
  }
  if (!(await AutomationRun.exists({ assignmentId, "steps.name": name }))) {
    await AutomationRun.updateOne(
      { assignmentId },
      { $push: { steps: { name, status, attemptCount: status === "PROCESSING" ? 1 : 0, startedAt: status === "PROCESSING" ? timestamp : null, completedAt: status === "COMPLETED" || status === "FAILED" ? timestamp : null, lastError } } },
    );
  }
}

async function loadContext(assignmentId: string): Promise<WorkflowContext> {
  const assignment = await Assignment.findById(assignmentId).lean();
  if (!assignment || assignment.status === "COMPLETED") throw new Error("Assignment is missing or already completed.");
  const intern = await Intern.findOne({ _id: assignment.internId, status: "ACTIVE" }).lean();
  if (!intern) throw new Error("The assigned intern is no longer active.");
  const user = await User.findById(intern.userId).select("name email isActive").lean();
  if (!user?.isActive || !user.email) throw new Error("The assigned intern account is inactive or has no email address.");
  const task = assignment.taskSnapshot;
  if (!task) throw new Error("The assignment does not contain its required task snapshot.");
  return {
    assignmentId: String(assignment._id),
    internId: String(intern._id),
    internName: user.name,
    internEmail: user.email,
    taskId: String(assignment.taskId),
    task: {
      title: task.title,
      shortDescription: task.shortDescription,
      fullDescription: task.fullDescription,
      difficulty: task.difficulty,
      requiredSkills: task.requiredSkills || [],
      requirements: task.requirements || [],
      acceptanceCriteria: task.acceptanceCriteria || [],
      expectedDeliverables: task.expectedDeliverables || [],
    },
    dueDate: new Date(assignment.dueDate).toISOString(),
  };
}

async function createOrLoadExplanation(context: WorkflowContext) {
  const fingerprint = taskFingerprint(context.task);
  const existing = await TaskExplanation.findOne({ assignmentId: context.assignmentId, taskFingerprint: fingerprint }).lean();
  if (existing?.generationStatus === "COMPLETED") {
    await Assignment.updateOne({ _id: context.assignmentId }, { $set: { explanationStatus: "COMPLETED", explanationGeneratedAt: existing.generatedAt, explanationVersion: existing.version } });
    return { id: String(existing._id), fingerprint };
  }
  await Assignment.updateOne({ _id: context.assignmentId }, { $set: { explanationStatus: "PROCESSING" } });
  let generated: Awaited<ReturnType<typeof generateTaskExplanation>>;
  try {
    generated = await generateTaskExplanation(context.task);
  } catch (error) {
    await Assignment.updateOne({ _id: context.assignmentId }, { $set: { explanationStatus: "FAILED" } });
    throw error;
  }
  const version = await TaskExplanation.countDocuments({ assignmentId: context.assignmentId }) + 1;
  const explanation = await TaskExplanation.findOneAndUpdate(
    { assignmentId: context.assignmentId, taskFingerprint: fingerprint },
    {
      $set: { taskId: context.taskId, version, content: generated.content, modelIdentifier: generated.model, generationStatus: "COMPLETED", generatedAt: new Date() },
    },
    { upsert: true, new: true, runValidators: true },
  );
  await Assignment.updateOne({ _id: context.assignmentId }, { $set: { explanationStatus: "COMPLETED", explanationGeneratedAt: explanation.generatedAt, explanationVersion: version, explanationSessionUrl: `${process.env.APP_BASE_URL || process.env.NEXTAUTH_URL}/intern/tasks/${context.assignmentId}/mentor` } });
  return { id: String(explanation._id), fingerprint };
}

async function plannedMeeting(assignmentId: string, meetingType: "TASK_EXPLANATION" | "FIRST_REVIEW", date?: Date) {
  const existing = await Meeting.findOne({ assignmentId, meetingType });
  if (existing) {
    if (existing.status === "CANCELLED") throw new Error(`The ${meetingType} meeting was cancelled and cannot be recreated automatically.`);
    let scheduledAt = existing.status === "SCHEDULED" ? existing.scheduledAt : date || existing.scheduledAt;
    if (existing.status !== "SCHEDULED" && scheduledAt.getTime() <= Date.now() + 10 * 60_000) {
      scheduledAt = date && date.getTime() > Date.now() + 10 * 60_000
        ? date
        : new Date(Date.now() + 24 * 60 * 60 * 1000);
    }
    existing.scheduledAt = scheduledAt;
    if (existing.status !== "SCHEDULED") existing.status = "PENDING";
    await existing.save();
    return { id: String(existing._id), scheduledAt: new Date(existing.scheduledAt).toISOString() };
  }
  const scheduledAt = date || new Date(Date.now() + 24 * 60 * 60 * 1000);
  const durationMinutes = meetingType === "TASK_EXPLANATION"
    ? boundedNumber("EXPLANATION_DURATION_MINUTES", 30, 5, 480)
    : boundedNumber("FIRST_REVIEW_DURATION_MINUTES", 30, 5, 480);
  const meeting = await Meeting.findOneAndUpdate(
    { assignmentId, meetingType },
    {
      $setOnInsert: {
        assignmentId,
        meetingType,
        scheduledAt,
        durationMinutes,
        timezone: process.env.DEFAULT_TIMEZONE?.trim() || "UTC",
        status: "PENDING",
      },
    },
    { upsert: true, new: true, runValidators: true },
  );
  return { id: String(meeting._id), scheduledAt: new Date(meeting.scheduledAt).toISOString() };
}

async function ensureMeeting(context: WorkflowContext, meetingType: "TASK_EXPLANATION" | "FIRST_REVIEW", scheduledAt: string) {
  const durationMinutes = meetingType === "TASK_EXPLANATION"
    ? boundedNumber("EXPLANATION_DURATION_MINUTES", 30, 5, 480)
    : boundedNumber("FIRST_REVIEW_DURATION_MINUTES", 30, 5, 480);
  const meetingDetails = {
    assignmentId: context.assignmentId,
    internEmail: context.internEmail,
    taskTitle: context.task.title,
    meetingType,
    scheduledAt: new Date(scheduledAt),
    durationMinutes,
  };
  return process.env.MEETING_MODE?.trim().toLowerCase() === "internal"
    ? ensureInternalMeeting(meetingDetails)
    : ensureCalendarMeeting(meetingDetails);
}

async function scheduleReminder(assignmentId: string, meetingType: "TASK_EXPLANATION" | "FIRST_REVIEW", scheduledAt: string) {
  const meeting = await Meeting.findOne({ assignmentId, meetingType }).select("_id").lean();
  if (!meeting) throw new Error(`Cannot schedule reminder: ${meetingType} meeting is missing.`);
  await inngest.send({
    id: `${String(meeting._id)}:${new Date(scheduledAt).getTime()}:reminder`,
    name: "internflow/meeting.reminder",
    data: { assignmentId, meetingId: String(meeting._id), meetingType, scheduledAt },
  });
}

export const assignmentAutomation = inngest.createFunction(
  {
    id: "assignment-automation",
    retries: 3,
    triggers: [{ event: "internflow/assignment.created" }],
    onFailure: async ({ event, error }) => {
      const assignmentId = (event.data as { event?: { data?: { assignmentId?: string } } })?.event?.data?.assignmentId;
      if (!assignmentId) return;
      const message = error.message.slice(0, 500);
      await Promise.all([
        Assignment.updateOne({ _id: assignmentId }, { $set: { automationStatus: "FAILED", lastAutomationError: message } }),
        AutomationRun.updateOne({ assignmentId }, { $set: { status: "FAILED", lastError: message, completedAt: new Date() } }),
      ]);
    },
  },
  async ({ event, step }) => {
    const { assignmentId, workflowId, eventId } = event.data as { assignmentId: string; workflowId: string; eventId: string };
    const runTracked = async <T>(
      name: string,
      action: () => Promise<T>,
    ): Promise<Jsonify<Awaited<T extends void ? null : T>>> => step.run(name, async () => {
      await setStep(assignmentId, name, "PROCESSING");
      try {
        const result = await action();
        await setStep(assignmentId, name, "COMPLETED");
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Workflow step failed.";
        await setStep(assignmentId, name, "FAILED", message);
        throw error;
      }
    });
    await step.run("record-workflow-start", async () => {
      await Promise.all([
        AutomationRun.findOneAndUpdate(
          { assignmentId },
          { $set: { workflowId, eventId, status: "PROCESSING", startedAt: new Date(), completedAt: null, lastError: "" }, $inc: { attemptCount: 1 } },
          { upsert: true, new: true, runValidators: true },
        ),
        Assignment.updateOne({ _id: assignmentId }, { $set: { automationStatus: "PROCESSING", automationWorkflowId: workflowId, lastAutomationError: "" } }),
      ]);
      return true;
    });

    try {
      const context = await runTracked("load-assignment", () => loadContext(assignmentId));
      await runTracked("generate-explanation", () => createOrLoadExplanation(context));

      if (!autoScheduleMeetings()) {
        // Meetings are only created when an intern requests one and the admin approves it.
        await runTracked("send-assignment-email", () => sendAssignmentOnlyEmail({
          assignmentId,
          internName: context.internName,
          internEmail: context.internEmail,
          taskTitle: context.task.title,
          taskSummary: context.task.shortDescription,
          dueDate: new Date(context.dueDate),
          timezone: process.env.DEFAULT_TIMEZONE?.trim() || "UTC",
        }));
      } else {
        const explanationPlan = await runTracked("plan-explanation-session", () => plannedMeeting(assignmentId, "TASK_EXPLANATION"));
        const explanationMeeting = await runTracked("create-explanation-session", async () => {
          try {
            return await ensureMeeting(context, "TASK_EXPLANATION", explanationPlan.scheduledAt);
          } catch (error) {
            await Meeting.updateOne({ assignmentId, meetingType: "TASK_EXPLANATION" }, { $set: { status: "FAILED" } });
            throw error;
          }
        });

        const reviewPlan = await runTracked("plan-first-review", async () => {
          const scheduledAt = addDays(new Date(explanationPlan.scheduledAt), boundedNumber("FIRST_REVIEW_INTERVAL_DAYS", 3, 1, 30));
          await Assignment.updateOne({ _id: assignmentId }, { $set: { firstReviewScheduledAt: scheduledAt } });
          return plannedMeeting(assignmentId, "FIRST_REVIEW", scheduledAt);
        });
        const reviewMeeting = await runTracked("create-first-review", async () => {
          try {
            return await ensureMeeting(context, "FIRST_REVIEW", reviewPlan.scheduledAt);
          } catch (error) {
            await Meeting.updateOne({ assignmentId, meetingType: "FIRST_REVIEW" }, { $set: { status: "FAILED" } });
            throw error;
          }
        });

        const timezone = process.env.DEFAULT_TIMEZONE?.trim() || "UTC";
        const emailContext = {
          assignmentId,
          internName: context.internName,
          internEmail: context.internEmail,
          taskTitle: context.task.title,
          taskSummary: context.task.shortDescription,
          dueDate: new Date(context.dueDate),
          explanationDate: new Date(explanationPlan.scheduledAt),
          explanationMeetUrl: explanationMeeting.conferenceUrl,
          reviewDate: new Date(reviewPlan.scheduledAt),
          reviewMeetUrl: reviewMeeting.conferenceUrl,
          timezone,
        };

        await runTracked("send-assignment-emails", () => sendAssignmentAndSessionEmails(emailContext));
        await runTracked("send-first-review-invitation", () => sendFirstReviewEmail(emailContext));

        await runTracked("schedule-meeting-reminders", async () => {
          await Promise.all([
            new Date(explanationPlan.scheduledAt).getTime() > Date.now()
              ? scheduleReminder(assignmentId, "TASK_EXPLANATION", explanationPlan.scheduledAt)
              : Promise.resolve(),
            new Date(reviewPlan.scheduledAt).getTime() > Date.now()
              ? scheduleReminder(assignmentId, "FIRST_REVIEW", reviewPlan.scheduledAt)
              : Promise.resolve(),
          ]);
        });
      }

      await step.run("mark-workflow-complete", async () => {
        await Promise.all([
          Assignment.updateOne({ _id: assignmentId }, { $set: { automationStatus: "COMPLETED", lastAutomationError: "" } }),
          AutomationRun.updateOne({ assignmentId }, { $set: { status: "COMPLETED", completedAt: new Date(), lastError: "" } }),
        ]);
      });
      return { assignmentId, status: "COMPLETED" };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Automation failed.";
      await Promise.all([
        Assignment.updateOne({ _id: assignmentId }, { $set: { automationStatus: "FAILED", lastAutomationError: message } }),
        AutomationRun.updateOne({ assignmentId }, { $set: { status: "FAILED", lastError: message } }),
      ]);
      throw error;
    }
  },
);

export const meetingReminder = inngest.createFunction(
  {
    id: "meeting-reminder",
    retries: 2,
    triggers: [{ event: "internflow/meeting.reminder" }],
    cancelOn: [
      { event: "internflow/meeting.changed", if: "async.data.meetingId == event.data.meetingId" },
      { event: "internflow/assignment.completed", if: "async.data.assignmentId == event.data.assignmentId" },
    ],
  },
  async ({ event, step }) => {
    const { assignmentId, meetingId, meetingType, scheduledAt } = event.data as {
      assignmentId: string;
      meetingId: string;
      meetingType: "TASK_EXPLANATION" | "FIRST_REVIEW";
      scheduledAt: string;
    };
    const reminderHours = boundedNumber("MEETING_REMINDER_HOURS", 24, 1, 168);
    const reminderAt = new Date(new Date(scheduledAt).getTime() - reminderHours * 60 * 60 * 1000);
    if (reminderAt > new Date()) await step.sleepUntil("wait-until-reminder", reminderAt);
    const context = await step.run("load-reminder-context", async () => {
      const [assignment, meeting, intern] = await Promise.all([
        Assignment.findById(assignmentId).lean(),
        Meeting.findById(meetingId).lean(),
        Assignment.findById(assignmentId).then((record) => record ? Intern.findOne({ _id: record.internId, status: "ACTIVE" }).populate("userId", "name email isActive").lean() : null),
      ]);
      if (!assignment || assignment.status === "COMPLETED" || !meeting || meeting.status !== "SCHEDULED" || new Date(meeting.scheduledAt).getTime() !== new Date(scheduledAt).getTime()) return null;
      const user = intern?.userId as { name?: string; email?: string; isActive?: boolean } | null | undefined;
      if (!user?.isActive || !user.email || !assignment.taskSnapshot) return null;
      const explanation = await Meeting.findOne({ assignmentId, meetingType: "TASK_EXPLANATION", status: "SCHEDULED" }).lean();
      const review = await Meeting.findOne({ assignmentId, meetingType: "FIRST_REVIEW", status: "SCHEDULED" }).lean();
      const explanationUrl = explanation?.meetingProvider === "INTERNAL" ? explanation.meetingUrl : explanation?.conferenceUrl;
      const reviewUrl = review?.meetingProvider === "INTERNAL" ? review.meetingUrl : review?.conferenceUrl;
      if (!explanationUrl || !reviewUrl) return null;
      return {
        assignmentId,
        internName: user.name || "Intern",
        internEmail: user.email,
        taskTitle: assignment.taskSnapshot.title,
        taskSummary: assignment.taskSnapshot.shortDescription,
        dueDate: assignment.dueDate,
        explanationDate: explanation.scheduledAt,
        explanationMeetUrl: explanationUrl,
        reviewDate: review.scheduledAt,
        reviewMeetUrl: reviewUrl,
        timezone: meeting.timezone || process.env.DEFAULT_TIMEZONE || "UTC",
      };
    });
    if (!context) return { status: "SKIPPED_STALE_OR_CANCELLED" };
    await step.run("send-meeting-reminder", () => sendMeetingReminder(context, meetingType));
    return { status: "SENT" };
  },
);

export async function startAssignmentAutomation(assignmentId: string): Promise<void> {
  const workflowId = `assignment-${assignmentId}-${randomUUID()}`;
  const eventId = `assignment-created-${assignmentId}-${randomUUID()}`;
  await AutomationRun.findOneAndUpdate(
    { assignmentId },
    { $set: { workflowId, eventId, status: "PENDING", startedAt: null, completedAt: null, lastError: "", steps: [] } },
    { upsert: true, new: true, runValidators: true },
  );
  await Assignment.updateOne({ _id: assignmentId }, { $set: { automationStatus: "PENDING", automationWorkflowId: workflowId, lastAutomationError: "" } });
  await inngest.send({
    id: eventId,
    name: "internflow/assignment.created",
    data: { assignmentId, workflowId, eventId },
  });
}

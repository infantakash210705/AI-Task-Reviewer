import { addDays } from "date-fns";
import mongoose from "mongoose";
import { inngest } from "@/lib/inngest/client";
import { connectDB } from "@/lib/db";
import { Assignment, Intern, Meeting, Review, Submission, User } from "@/lib/models";
import { ensureCalendarMeeting } from "@/lib/automation/calendar";
import { autoScheduleMeetings } from "@/lib/automation/meeting-policy";
import { sendReviewFeedbackEmail, sendReviewProcessingFailureEmail } from "@/lib/automation/email-templates";
import { generateSubmissionReview } from "@/lib/automation/submission-review";
import { retrieveGitHubRepository, type RepositoryFile } from "@/lib/automation/github-repository";
import { processUploadedFileToEvidence, getGeminiInlineDataForFiles, type UploadedFileInfo } from "@/lib/automation/file-storage";
import type { TaskContext } from "@/lib/automation/explanation";

type ReviewEvent = { submissionId: string };
type ReviewContext = {
  submissionId: string;
  assignmentId: string;
  internId: string;
  internName: string;
  internEmail: string;
  task: TaskContext;
  taskVersion: number;
  taskTitle: string;
  submissionVersion: number;
  repositoryUrl?: string;
  uploadedFiles?: UploadedFileInfo[];
};

const intervalDays = (): number => {
  const value = Number(process.env.REVIEW_INTERVAL_DAYS);
  return Number.isInteger(value) && value >= 1 && value <= 30 ? value : 3;
};

function parseEvent(data: unknown): ReviewEvent {
  if (!data || typeof data !== "object" || !("submissionId" in data) || typeof data.submissionId !== "string" || !mongoose.isValidObjectId(data.submissionId)) {
    throw new Error("The submission review event is invalid.");
  }
  return { submissionId: data.submissionId };
}

function taskContext(snapshot: Record<string, unknown>): TaskContext {
  const strings = (value: unknown) => Array.isArray(value) ? value.map(String) : [];
  return {
    title: String(snapshot.title || ""),
    shortDescription: String(snapshot.shortDescription || ""),
    fullDescription: String(snapshot.fullDescription || ""),
    difficulty: String(snapshot.difficulty || ""),
    requiredSkills: strings(snapshot.requiredSkills),
    requirements: strings(snapshot.requirements),
    acceptanceCriteria: strings(snapshot.acceptanceCriteria),
    expectedDeliverables: strings(snapshot.expectedDeliverables),
  };
}

async function loadContext(submissionId: string): Promise<ReviewContext | null> {
  await connectDB();
  const submission = await Submission.findById(submissionId).lean();
  if (!submission) throw new Error("The submitted version could not be found.");
  const assignment = await Assignment.findById(submission.assignmentId).lean();
  if (!assignment || String(assignment.internId) !== String(submission.internId)) {
    throw new Error("The submission does not belong to the assigned intern.");
  }
  if (assignment.status === "COMPLETED" && !(await Review.exists({ submissionId, outcome: "PASS" }))) return null;
  const intern = await Intern.findOne({ _id: submission.internId, status: "ACTIVE" }).lean();
  if (!intern) throw new Error("The assigned intern is no longer active.");
  const user = await User.findById(intern.userId).select("name email isActive").lean();
  if (!user?.isActive || !user.email) throw new Error("The assigned intern account is inactive or has no email address.");
  const hasRepo = Boolean(submission.repositoryUrl);
  const hasFiles = Boolean(submission.uploadedFileReferences && submission.uploadedFileReferences.length > 0);
  if (!hasRepo && !hasFiles) {
    throw new Error("The submission has neither a GitHub repository nor uploaded files to review.");
  }
  if (!assignment.taskSnapshot) throw new Error("The original task requirements snapshot is missing.");

  return {
    submissionId: String(submission._id),
    assignmentId: String(assignment._id),
    internId: String(intern._id),
    internName: user.name || "Intern",
    internEmail: user.email,
    task: taskContext(assignment.taskSnapshot as unknown as Record<string, unknown>),
    taskVersion: Number(assignment.taskSnapshot.revision || 1),
    taskTitle: assignment.taskSnapshot.title,
    submissionVersion: submission.version,
    repositoryUrl: submission.repositoryUrl || "",
    uploadedFiles: (submission.uploadedFileReferences || []).map((f: any) => ({
      storageKey: f.storageKey,
      filename: f.filename,
      contentType: f.contentType,
      size: f.size,
    })),
  };
}

async function persistReview(
  context: ReviewContext,
  repository: { branch: string; commitSha: string } | undefined,
  generated: Awaited<ReturnType<typeof generateSubmissionReview>>,
) {
  const existing = await Review.findOne({ submissionId: context.submissionId, outcome: { $ne: "REVIEW_FAILED" } }).lean();
  if (existing) {
    const assignment = await Assignment.findById(context.assignmentId).select("currentSubmissionId status finalReviewId").lean();
    const currentSubmission = String(assignment?.currentSubmissionId) === context.submissionId;
    const completionEligible = existing.completionEligible === true
      && assignment?.status === "COMPLETED"
      && String(assignment.finalReviewId) === String(existing._id);
    if (existing.completionEligible !== completionEligible) {
      await Review.updateOne({ _id: existing._id }, { $set: { completionEligible } });
    }
    return { reviewId: String(existing._id), outcome: existing.outcome || "REVIEW_FAILED", completionEligible, currentSubmission };
  }

  const reviewVersion = (await Review.countDocuments({ submissionId: context.submissionId })) + 1;
  const currentAssignment = await Assignment.findById(context.assignmentId).select("currentSubmissionId status").lean();
  let isCurrentSubmission = String(currentAssignment?.currentSubmissionId) === context.submissionId;
  const isCompletionEligible = generated.verified.completionEligible && isCurrentSubmission;
  await Submission.updateOne(
    { _id: context.submissionId },
    { $set: { branch: repository?.branch || "main", commitSha: repository?.commitSha || "uploaded-files", analysisStatus: "COMPLETED", errorSummary: "" } },
  );
  const result = generated.verified.outcome;
  const legacyResult = result === "PASS" ? "APPROVED" : result === "REVISION_REQUIRED" ? "REVISION_REQUIRED" : "IN_REVIEW";
  const review = await Review.create({
    assignmentId: context.assignmentId,
    submissionId: context.submissionId,
    reviewVersion,
    reviewerType: "AI",
    modelIdentifier: generated.model,
    taskVersion: context.taskVersion,
    acceptanceCriteriaSnapshot: context.task.acceptanceCriteria,
    commitSha: repository?.commitSha || "uploaded-files",
    outcome: result,
    result: legacyResult,
    summary: generated.review.summary,
    findings: generated.verified.findings.map((finding) => `${finding.severity}: ${finding.title} — ${finding.explanation}`),
    structuredFindings: generated.verified.findings,
    missingFeatures: generated.review.missingFeatures,
    suggestedNextActions: generated.review.suggestedNextActions,
    requirementsAssessed: generated.verified.requirementsAssessed,
    evidenceReferences: generated.verified.findings.flatMap((finding) => finding.evidenceReferences),
    recommendations: generated.review.recommendations,
    completionEligible: isCompletionEligible,
    reviewedAt: new Date(),
    reviewLimitations: generated.review.reviewLimitations,
    notificationStatus: "QUEUED",
  });
  await Review.updateMany(
    { submissionId: context.submissionId, _id: { $ne: review._id }, outcome: "REVIEW_FAILED", supersededBy: null },
    { $set: { supersededBy: review._id } },
  );

  const reviewedAt = new Date();
  const isComplete = isCompletionEligible && result === "PASS";
  const assignmentSet: Record<string, unknown> = {
    latestReviewId: review._id,
    lastReviewAt: reviewedAt,
    lastReviewError: "",
  };
  if (isCurrentSubmission) {
    assignmentSet.nextReviewAt = isComplete ? null : result === "REVISION_REQUIRED" ? addDays(reviewedAt, intervalDays()) : null;
    assignmentSet.completionStatus = isComplete ? "COMPLETED" : result === "NEEDS_CLARIFICATION" ? "NEEDS_CLARIFICATION" : "IN_PROGRESS";
    assignmentSet.completionCriteriaVersion = isComplete ? context.taskVersion : null;
    assignmentSet.completionSummary = isComplete ? generated.review.summary : "";
    assignmentSet.finalReviewId = isComplete ? review._id : null;
    assignmentSet.finalSubmissionId = isComplete ? context.submissionId : null;
    assignmentSet.status = isComplete ? "COMPLETED" : result === "REVISION_REQUIRED" ? "REVISION_REQUIRED" : "IN_REVIEW";
    if (isComplete) assignmentSet.progress = 100;
    assignmentSet.completionDate = isComplete ? reviewedAt : null;
    assignmentSet.reviewCycleNumber = context.submissionVersion;
  }
  if (isCurrentSubmission) {
    const assignmentUpdate = await Assignment.updateOne(
      { _id: context.assignmentId, currentSubmissionId: context.submissionId, status: { $ne: "COMPLETED" } },
      { $set: assignmentSet },
    );
    isCurrentSubmission = assignmentUpdate.matchedCount > 0;
  }
  const completed = isComplete && isCurrentSubmission;
  if (review.completionEligible !== completed) {
    await Review.updateOne({ _id: review._id }, { $set: { completionEligible: completed } });
  }
  await Submission.updateOne(
    { _id: context.submissionId },
    { $set: { status: completed ? "APPROVED" : result === "REVISION_REQUIRED" ? "REVISION_REQUIRED" : "IN_REVIEW", processingStatus: "COMPLETED", analysisStatus: "COMPLETED", errorSummary: "" } },
  );
  return { reviewId: String(review._id), outcome: result, completionEligible: completed, currentSubmission: isCurrentSubmission };
}

async function persistClarificationReview(context: ReviewContext) {
  const existing = await Review.findOne({ submissionId: context.submissionId, outcome: "NEEDS_CLARIFICATION" }).lean();
  if (existing) return String(existing._id);
  const reviewVersion = (await Review.countDocuments({ submissionId: context.submissionId })) + 1;
  const review = await Review.create({
    assignmentId: context.assignmentId,
    submissionId: context.submissionId,
    reviewVersion,
    reviewerType: "SYSTEM",
    modelIdentifier: "",
    taskVersion: context.taskVersion,
    acceptanceCriteriaSnapshot: [],
    outcome: "NEEDS_CLARIFICATION",
    result: "IN_REVIEW",
    summary: "This task has no explicit acceptance criteria. An administrator must clarify the completion requirements before a fair automated review can proceed.",
    findings: [],
    missingFeatures: [],
    suggestedNextActions: ["Ask the administrator to clarify the task's completion requirements."],
    requirementsAssessed: [],
    recommendations: ["Ask the administrator to add clear acceptance criteria, then submit an updated version for review."],
    completionEligible: false,
    reviewedAt: new Date(),
    reviewLimitations: ["No source-code review was performed because the task has no explicit acceptance criteria."],
    notificationStatus: "QUEUED",
  });
  await Submission.updateOne({ _id: context.submissionId }, { $set: { processingStatus: "COMPLETED", analysisStatus: "NEEDS_CLARIFICATION", status: "IN_REVIEW", errorSummary: "" } });
  await Assignment.updateOne({ _id: context.assignmentId, currentSubmissionId: context.submissionId, status: { $ne: "COMPLETED" } }, {
    $set: { latestReviewId: review._id, status: "IN_REVIEW", completionStatus: "NEEDS_CLARIFICATION", nextReviewAt: null, lastReviewAt: review.reviewedAt, lastReviewError: "" },
    $inc: { reviewCycleNumber: 1 },
  });
  return String(review._id);
}

type NextReviewDetails = Awaited<ReturnType<typeof scheduleNextReview>>;

async function notifySavedReview(
  context: ReviewContext,
  review: {
    _id: unknown;
    outcome?: string;
    summary: string;
    structuredFindings?: Array<{
      blocksCompletion?: boolean;
      category?: string;
      severity?: string;
      title: string;
      explanation: string;
      recommendedFix?: string;
      evidenceReferences?: Array<{ filePath: string; lineStart: number; lineEnd: number }>;
    }>;
    requirementsAssessed?: Array<{
      criterion: string;
      status: string;
      explanation: string;
      evidenceReferences?: Array<{ filePath: string; lineStart: number; lineEnd: number }>;
    }>;
    missingFeatures?: string[];
    suggestedNextActions?: string[];
    recommendations?: string[];
    reviewLimitations?: string[];
    commitSha?: string;
    reviewedAt?: Date;
  },
  nextReview?: NextReviewDetails,
  projectCompleted = false,
) {
  const blockers = (review.structuredFindings || [])
    .filter((finding) => finding.blocksCompletion)
    .map((finding) => `${finding.title}: ${finding.explanation}`);
  await sendReviewFeedbackEmail({
    assignmentId: context.assignmentId,
    reviewId: String(review._id),
    submissionId: context.submissionId,
    internName: context.internName,
    internEmail: context.internEmail,
    taskTitle: context.taskTitle,
    submissionVersion: context.submissionVersion,
    commitSha: review.commitSha || "",
    reviewDate: review.reviewedAt || new Date(),
    outcome: review.outcome as "PASS" | "REVISION_REQUIRED" | "NEEDS_CLARIFICATION",
    projectCompleted,
    summary: review.summary,
    blockers,
    requirementsAssessed: review.requirementsAssessed || [],
    findings: review.structuredFindings || [],
    missingFeatures: review.missingFeatures || [],
    recommendations: review.suggestedNextActions?.length ? review.suggestedNextActions : review.recommendations || [],
    reviewLimitations: review.reviewLimitations || [],
    nextReview,
  });
  await Review.updateOne({ _id: review._id }, { $set: { notificationStatus: "SENT" } });
}

async function loadSavedReview(reviewId: string) {
  const review = await Review.findById(reviewId).lean();
  if (!review) throw new Error("The saved review could not be loaded for notification.");
  return review;
}

async function scheduleNextReview(context: ReviewContext, reviewId: string, scheduledAt: Date) {
  const timezone = process.env.DEFAULT_TIMEZONE?.trim() || "UTC";
  let meeting = await Meeting.findOne({ assignmentId: context.assignmentId, meetingType: "FIRST_REVIEW" });
  if (!meeting) {
    meeting = await Meeting.create({
      assignmentId: context.assignmentId,
      meetingType: "FIRST_REVIEW",
      scheduledAt,
      durationMinutes: 30,
      timezone,
      status: "PENDING",
    });
  } else {
    meeting.scheduledAt = scheduledAt;
    meeting.status = "PENDING";
    meeting.timezone = timezone;
    await meeting.save();
  }
  const details = await ensureCalendarMeeting({
    assignmentId: context.assignmentId,
    internEmail: context.internEmail,
    taskTitle: context.taskTitle,
    meetingType: "FIRST_REVIEW",
    scheduledAt,
    durationMinutes: meeting.durationMinutes,
  });
  await Promise.all([
    Assignment.updateOne({ _id: context.assignmentId }, { $set: { nextReviewAt: scheduledAt } }),
    inngest.send({
      id: `${String(meeting._id)}:${scheduledAt.getTime()}:changed:${reviewId}`,
      name: "internflow/meeting.changed",
      data: { meetingId: String(meeting._id), assignmentId: context.assignmentId },
    }),
  ]);
  await inngest.send({
    id: `${String(meeting._id)}:${scheduledAt.getTime()}:reminder`,
    name: "internflow/meeting.reminder",
    data: { assignmentId: context.assignmentId, meetingId: String(meeting._id), meetingType: "FIRST_REVIEW", scheduledAt: scheduledAt.toISOString() },
  });
  return { meetingId: String(meeting._id), scheduledAt: scheduledAt.toISOString(), timezone, meetUrl: details.conferenceUrl };
}

export const submissionReviewWorkflow = inngest.createFunction(
  {
    id: "submission-ai-review",
    retries: 2,
    triggers: [{ event: "internflow/submission.created" }],
    concurrency: { limit: 1, key: "event.data.submissionId" },
    onFailure: async ({ event }) => {
      const eventData = event.data as { event?: { data?: { submissionId?: string } } };
      const submissionId = eventData.event?.data?.submissionId;
      if (!submissionId || !mongoose.isValidObjectId(submissionId)) return;
      const message = "Automated review processing failed. An administrator can retry the review or verify provider configuration.";
      await connectDB();
      const submission = await Submission.findByIdAndUpdate(
        submissionId,
        { $set: { processingStatus: "FAILED", analysisStatus: "FAILED", errorSummary: message } },
        { new: true },
      ).lean();
      if (submission) {
        const completedReview = await Review.findOne({ submissionId, outcome: { $ne: "REVIEW_FAILED" } }).lean();
        if (completedReview) {
          await Review.updateOne({ _id: completedReview._id }, { $set: { notificationStatus: "FAILED" } });
          await Assignment.updateOne(
            { _id: submission.assignmentId, currentSubmissionId: submission._id },
            { $set: { lastReviewError: "Review notification failed. An administrator can retry the workflow." } },
          );
        } else {
          const reviewVersion = (await Review.countDocuments({ submissionId })) + 1;
          const failedReview = await Review.create({
            assignmentId: submission.assignmentId,
            submissionId,
            reviewVersion,
            reviewerType: "SYSTEM",
            outcome: "REVIEW_FAILED",
            result: "IN_REVIEW",
            summary: "The system could not complete the technical review. This is not a negative project assessment.",
            findings: [],
            recommendations: ["An administrator can retry this technical review."],
            completionEligible: false,
            reviewLimitations: ["Automated review processing failed. An administrator can retry the review."],
            notificationStatus: "QUEUED",
          });
          await Assignment.updateOne({ _id: submission.assignmentId, currentSubmissionId: submission._id }, {
            $set: { lastReviewError: message, latestReviewId: failedReview._id, completionStatus: "IN_PROGRESS" },
          });
          const intern = await Intern.findById(submission.internId).select("userId").lean();
          const user = intern ? await User.findById(intern.userId).select("name email isActive").lean() : null;
          const assignment = await Assignment.findById(submission.assignmentId).select("taskSnapshot").lean();
          if (user?.isActive && user.email && assignment?.taskSnapshot) {
            try {
              await sendReviewProcessingFailureEmail({
                assignmentId: String(submission.assignmentId),
                submissionId,
                internName: user.name || "Intern",
                internEmail: user.email,
                taskTitle: assignment.taskSnapshot.title,
              });
              await Review.updateOne({ _id: failedReview._id }, { $set: { notificationStatus: "SENT" } });
            } catch {
              await Review.updateOne({ _id: failedReview._id }, { $set: { notificationStatus: "FAILED" } });
            }
          }
        }
      }
    },
  },
  async ({ event, step }) => {
    const { submissionId } = parseEvent(event.data);
    const context = await step.run("load-submission-context", () => loadContext(submissionId));
    if (!context) return { submissionId, status: "SKIPPED_COMPLETED_ASSIGNMENT" };

    const savedReview = await step.run("load-existing-review", () => Review.findOne({ submissionId, outcome: { $ne: "REVIEW_FAILED" } }).lean());
    if (savedReview) {
      let nextReview: NextReviewDetails | undefined;
      const currentAssignment = await Assignment.findById(context.assignmentId).select("currentSubmissionId nextReviewAt status finalReviewId").lean();
      const isCurrentSubmission = String(currentAssignment?.currentSubmissionId) === context.submissionId;
      const projectCompleted = savedReview.completionEligible === true
        && currentAssignment?.status === "COMPLETED"
        && String(currentAssignment.finalReviewId) === String(savedReview._id);
      if (savedReview.completionEligible !== projectCompleted) {
        await Review.updateOne({ _id: savedReview._id }, { $set: { completionEligible: projectCompleted } });
      }
      await Submission.updateOne(
        { _id: context.submissionId },
        {
          $set: {
            processingStatus: "COMPLETED",
            analysisStatus: savedReview.outcome === "NEEDS_CLARIFICATION" ? "NEEDS_CLARIFICATION" : "COMPLETED",
            status: savedReview.outcome === "PASS" ? "APPROVED" : savedReview.outcome === "REVISION_REQUIRED" ? "REVISION_REQUIRED" : "IN_REVIEW",
            errorSummary: "",
          },
        },
      );
      if (autoScheduleMeetings() && savedReview.outcome === "REVISION_REQUIRED" && isCurrentSubmission) {
        const scheduledAt = currentAssignment?.nextReviewAt || addDays(new Date(savedReview.reviewedAt || Date.now()), intervalDays());
        nextReview = await step.run("schedule-confirmed-review-meeting", () => scheduleNextReview(context, String(savedReview._id), scheduledAt));
      }
      await step.run("send-review-feedback", () => notifySavedReview(context, savedReview, nextReview, projectCompleted));
      if (projectCompleted) {
        await step.run("cancel-routine-reminders", async () => {
          await inngest.send({
            id: `${context.assignmentId}:review-completed:${String(savedReview._id)}`,
            name: "internflow/assignment.completed",
            data: { assignmentId: context.assignmentId },
          });
        });
      }
      return { submissionId, reviewId: String(savedReview._id), outcome: savedReview.outcome };
    }

    if ((await Assignment.findById(context.assignmentId).select("status").lean())?.status === "COMPLETED") {
      return { submissionId, status: "SKIPPED_COMPLETED_ASSIGNMENT" };
    }

    const claim = await step.run("claim-submission-review", async () => {
      const result = await Submission.updateOne(
        { _id: submissionId, processingStatus: { $in: ["QUEUED", "FAILED"] } },
        { $set: { processingStatus: "PROCESSING", analysisStatus: "PROCESSING", errorSummary: "", status: "IN_REVIEW" } },
      );
      if (result.modifiedCount > 0) return true;
      const current = await Submission.findById(submissionId).select("processingStatus").lean();
      return current?.processingStatus === "COMPLETED" ? false : false;
    });
    if (!claim) return { submissionId, status: "ALREADY_CLAIMED_OR_COMPLETED" };

    try {
      if (context.task.acceptanceCriteria.length === 0) {
        const reviewId = await step.run("persist-needs-clarification-review", () => persistClarificationReview(context));
        const review = await step.run("load-clarification-review", () => loadSavedReview(reviewId));
        await step.run("notify-needs-clarification", () => notifySavedReview(context, review));
        return { submissionId, reviewId, outcome: "NEEDS_CLARIFICATION" };
      }

      const evidenceResult = await step.run("retrieve-submission-evidence", async () => {
        let repoDetails: { branch: string; commitSha: string } | undefined;
        const allFiles: RepositoryFile[] = [];

        // 1. If GitHub repository is provided, fetch repository files
        if (context.repositoryUrl) {
          try {
            const result = await retrieveGitHubRepository(context.repositoryUrl);
            repoDetails = { branch: result.branch, commitSha: result.commitSha };
            allFiles.push(...result.files);
            await Submission.updateOne({ _id: submissionId }, { $set: { branch: result.branch, commitSha: result.commitSha } });
          } catch (repoErr) {
            console.warn("[submission-workflow] git repository retrieve notice:", repoErr);
            if (!context.uploadedFiles || context.uploadedFiles.length === 0) throw repoErr;
          }
        }

        // 2. If uploaded files are provided (e.g. testing reports, PDFs, spreadsheets), parse and add to evidence
        if (context.uploadedFiles && context.uploadedFiles.length > 0) {
          for (const fileInfo of context.uploadedFiles) {
            try {
              const fileEvidence = await processUploadedFileToEvidence(fileInfo);
              allFiles.push(...fileEvidence);
            } catch (fileErr) {
              console.warn("[submission-workflow] error processing file evidence:", fileInfo.filename, fileErr);
            }
          }
        }

        if (allFiles.length === 0) {
          throw new Error("No readable files could be retrieved from the repository or uploaded attachments.");
        }

        const commitSha = repoDetails?.commitSha || "uploaded-files";
        return { repoDetails, commitSha, files: allFiles };
      });

      const generated = await step.run("generate-validated-ai-review", () => generateSubmissionReview({
        task: context.task,
        taskVersion: context.taskVersion,
        submissionVersion: context.submissionVersion,
        commitSha: evidenceResult.commitSha,
        files: evidenceResult.files,
      }));
      const persisted = await step.run("persist-immutable-review", () => persistReview(context, evidenceResult.repoDetails, generated));

      let nextReview: Awaited<ReturnType<typeof scheduleNextReview>> | undefined;
      if (autoScheduleMeetings() && persisted.outcome === "REVISION_REQUIRED" && persisted.currentSubmission) {
        const scheduledAt = addDays(new Date(), intervalDays());
        nextReview = await step.run("schedule-confirmed-review-meeting", () => scheduleNextReview(context, persisted.reviewId, scheduledAt));
      }

      await step.run("send-review-feedback", async () => {
        const review = await Review.findById(persisted.reviewId).lean();
        if (!review) throw new Error("The saved review could not be loaded for notification.");
        await notifySavedReview(context, review, nextReview, persisted.completionEligible);
      });

      if (persisted.completionEligible) {
        await step.run("cancel-routine-reminders", async () => {
          await inngest.send({
            id: `${context.assignmentId}:review-completed:${persisted.reviewId}`,
            name: "internflow/assignment.completed",
            data: { assignmentId: context.assignmentId },
          });
        });
      }
      return { submissionId, reviewId: persisted.reviewId, outcome: persisted.outcome, completionEligible: persisted.completionEligible };
    } catch (error) {
      const message = "Automated review processing failed. An administrator can retry the review or verify provider configuration.";
      await Promise.all([
        Submission.updateOne({ _id: submissionId }, { $set: { processingStatus: "FAILED", analysisStatus: "FAILED", errorSummary: message } }),
        Assignment.updateOne(
          { _id: context.assignmentId, currentSubmissionId: context.submissionId },
          { $set: { lastReviewError: message } },
        ),
      ]);
      throw error;
    }
  },
);

export async function startSubmissionReview(submissionId: string): Promise<void> {
  if (!mongoose.isValidObjectId(submissionId)) throw new Error("A valid submission is required to start review.");
  await inngest.send({
    id: `submission-review-${submissionId}`,
    name: "internflow/submission.created",
    data: { submissionId },
  });
}

export async function retrySubmissionReview(submissionId: string): Promise<void> {
  if (!mongoose.isValidObjectId(submissionId)) throw new Error("A valid submission is required to retry review.");
  const submission = await Submission.findOneAndUpdate(
    {
      _id: submissionId,
      $or: [
        { processingStatus: { $in: ["FAILED", "QUEUED"] } },
        { processingStatus: { $exists: false }, status: "SUBMITTED" },
      ],
    },
    { $set: { processingStatus: "QUEUED", analysisStatus: "PENDING", errorSummary: "" } },
    { new: true },
  );
  if (!submission) throw new Error("Only queued or failed submission reviews can be started.");
  await Assignment.updateOne(
    { _id: submission.assignmentId, currentSubmissionId: submission._id },
    { $set: { lastReviewError: "" } },
  );
  try {
    await inngest.send({
      id: `submission-review-${submissionId}-admin-${Date.now()}`,
      name: "internflow/submission.created",
      data: { submissionId },
    });
  } catch (error) {
    const message = "Automated review could not be queued. An administrator can try again.";
    await Promise.all([
      Submission.updateOne({ _id: submissionId }, { $set: { processingStatus: "FAILED", analysisStatus: "FAILED", errorSummary: message } }),
      Assignment.updateOne(
        { _id: submission.assignmentId, currentSubmissionId: submission._id },
        { $set: { lastReviewError: message } },
      ),
    ]);
    throw error;
  }
}

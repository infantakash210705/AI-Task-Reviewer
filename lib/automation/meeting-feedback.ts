import { connectDB } from "@/lib/db";
import { Assignment, Intern, Meeting, MeetingTurn, Submission, User } from "@/lib/models";
import { inngest } from "@/lib/inngest/client";
import { retrieveGitHubRepository } from "@/lib/automation/github-repository";
import { generateSubmissionReview, reviewCriteria, type SubmissionReview } from "@/lib/automation/submission-review";
import { generateMentorAnswer } from "@/lib/automation/mentor-ai";
import { sendMeetingFeedbackEmail, type MeetingFeedbackContent } from "@/lib/automation/email-meetings";
import type { TaskContext } from "@/lib/automation/explanation";

const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

/** Turns a structured code review into plain "good / needs work / next steps" lists. Pure and tested. */
export function buildFeedbackSections(review: SubmissionReview, task: TaskContext) {
  const criteria = new Map(reviewCriteria(task).map((item) => [item.criterionId, item.criterion]));
  const label = (id: string) => criteria.get(id) || id;
  const strengths = review.requirementsAssessed
    .filter((item) => item.status === "PASS")
    .map((item) => `${label(item.criterionId)}: ${item.explanation}`);
  const unmet = review.requirementsAssessed
    .filter((item) => item.status !== "PASS")
    .map((item) => `${label(item.criterionId)} (${item.status === "FAIL" ? "not met" : "couldn't confirm"}): ${item.explanation}`);
  const findings = [...review.findings]
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
    .filter((item) => item.severity !== "INFO")
    .slice(0, 6)
    .map((item) => `${item.title}: ${item.explanation}${item.recommendedFix ? ` Try this: ${item.recommendedFix}` : ""}`);
  const missing = review.missingFeatures.map((item) => `Missing: ${item}`);
  const nextSteps = [...review.suggestedNextActions, ...review.recommendations].filter((item, index, all) => all.indexOf(item) === index).slice(0, 6);
  return {
    strengths: strengths.slice(0, 6),
    improvements: [...unmet, ...findings, ...missing].slice(0, 10),
    nextSteps,
  };
}

async function recap(task: TaskContext, internName: string, transcript: string): Promise<string> {
  if (!transcript.trim()) return "The call was short and we didn't get to go through much. You can ask for another meeting any time.";
  try {
    const answer = await generateMentorAnswer({
      task,
      explanation: null,
      priorMessages: [],
      question: `(Write a short recap, three to four plain sentences, of the call that just ended, addressed to ${internName.split(/\s+/)[0] || "the intern"}. Mention what they were unsure about and what you advised. Do not invent anything that is not in this transcript.)\n\nTranscript:\n${transcript.slice(0, 6000)}`,
      mode: "chat",
      internName,
    });
    return answer.slice(0, 1500);
  } catch {
    return "We went through your questions about the task and the acceptance criteria.";
  }
}

export async function runMeetingFeedback(meetingId: string): Promise<"SENT" | "SKIPPED"> {
  await connectDB();
  const claimed = await Meeting.findOneAndUpdate(
    { _id: meetingId, meetingType: { $in: ["DOUBT_CLARIFICATION", "FIRST_REVIEW", "REVIEW", "TASK_EXPLANATION"] }, feedbackStatus: { $in: ["NONE", "FAILED"] } },
    { $set: { feedbackStatus: "PENDING", feedbackError: "" } },
    { new: true },
  ).lean();
  if (!claimed) return "SKIPPED";

  const assignment = await Assignment.findById(claimed.assignmentId).lean();
  const intern = assignment ? await Intern.findById(assignment.internId).select("userId").lean() : null;
  const user = intern ? await User.findById(intern.userId).select("name email isActive").lean() : null;
  if (!assignment?.taskSnapshot || !user?.isActive || !user.email) {
    await Meeting.updateOne({ _id: meetingId }, { $set: { feedbackStatus: "FAILED", feedbackError: "The intern or task is no longer available." } });
    return "SKIPPED";
  }
  const snapshot = assignment.taskSnapshot as Record<string, unknown>;
  const task: TaskContext = {
    title: String(snapshot.title || ""), shortDescription: String(snapshot.shortDescription || ""), fullDescription: String(snapshot.fullDescription || ""),
    difficulty: String(snapshot.difficulty || ""), requiredSkills: strings(snapshot.requiredSkills), requirements: strings(snapshot.requirements),
    acceptanceCriteria: strings(snapshot.acceptanceCriteria), expectedDeliverables: strings(snapshot.expectedDeliverables),
  };

  const turns = await MeetingTurn.find({ meetingId }).sort({ seq: 1 }).limit(200).lean();
  const transcript = turns.map((turn) => `${turn.speaker === "MENTOR" ? "Mentor" : "Intern"}: ${turn.text}`).join("\n");

  const submission = await Submission.findOne({ assignmentId: assignment._id, submissionType: "REPOSITORY_URL", repositoryUrl: { $exists: true, $ne: "" } }).sort({ submittedAt: -1 }).lean();
  let sections = { strengths: [] as string[], improvements: [] as string[], nextSteps: [] as string[] };
  let analysisNote = "";
  if (submission?.repositoryUrl && task.acceptanceCriteria.length > 0) {
    try {
      const repository = await retrieveGitHubRepository(submission.repositoryUrl);
      const generated = await generateSubmissionReview({ task, taskVersion: assignment.taskSnapshot.revision || 1, submissionVersion: submission.version, commitSha: repository.commitSha, files: repository.files });
      sections = buildFeedbackSections(generated.review, task);
      analysisNote = "This is based on reading your public repository as it stands today. Nothing was run, so treat it as guidance, not a final grade.";
    } catch {
      analysisNote = "We couldn't read your repository automatically this time, so the feedback below comes from our conversation. Check that the link is a public GitHub repository.";
    }
  } else if (submission?.repositoryUrl) {
    analysisNote = "This task has no acceptance criteria on file yet, so we couldn't check your repository against them.";
  }

  const content: MeetingFeedbackContent = {
    recapSentences: await recap(task, user.name, transcript),
    ...sections,
    repositoryUrl: submission?.repositoryUrl || "",
    analysisNote,
  };
  await sendMeetingFeedbackEmail({ meetingId, assignmentId: String(assignment._id), internName: user.name, internEmail: user.email, taskTitle: task.title, content });
  await Meeting.updateOne({ _id: meetingId }, { $set: { feedbackStatus: "SENT", feedbackSentAt: new Date(), feedbackError: "" } });
  return "SENT";
}

export const postMeetingFeedback = inngest.createFunction(
  {
    id: "post-meeting-feedback",
    retries: 3,
    triggers: [{ event: "internflow/meeting.ended" }],
    onFailure: async ({ event }) => {
      const meetingId = (event.data as { event?: { data?: { meetingId?: string } } }).event?.data?.meetingId;
      if (!meetingId) return;
      await connectDB();
      await Meeting.updateOne({ _id: meetingId, feedbackStatus: { $ne: "SENT" } }, { $set: { feedbackStatus: "FAILED", feedbackError: "Feedback email could not be sent. Check the Meetings page and retry." } });
    },
  },
  async ({ event, step }) => {
    const { meetingId } = event.data as { meetingId: string };
    const result = await step.run("analyse-and-send-feedback", () => runMeetingFeedback(meetingId));
    return { meetingId, result };
  },
);

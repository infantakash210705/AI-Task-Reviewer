import { escapeHtml, sendAutomationEmail } from "@/lib/automation/email";
import { confirmedMeetUrl } from "@/lib/automation/calendar";

type EmailContext = {
  assignmentId: string;
  internName: string;
  internEmail: string;
  taskTitle: string;
  taskSummary: string;
  dueDate: Date;
  explanationDate: Date;
  explanationMeetUrl: string;
  reviewDate: Date;
  reviewMeetUrl: string;
  timezone: string;
};

export function baseUrl(): string {
  const value = process.env.APP_BASE_URL?.trim() || process.env.NEXTAUTH_URL?.trim();
  if (!value) throw new Error("APP_BASE_URL is not configured.");
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("APP_BASE_URL must use HTTP or HTTPS.");
  return parsed.origin;
}

export function dateTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: timezone,
  }).format(date);
}

export function htmlEmail(title: string, body: string): string {
  return `<main style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#1c2940"><h1 style="font-size:22px">${escapeHtml(title)}</h1>${body}<p style="font-size:12px;color:#718096">Shortfundly InternFlow · Sign in to your account to view private assignment details.</p></main>`;
}

function sessionLinkLabel(value: string): string {
  try {
    const url = new URL(value);
    return url.pathname.includes("/intern/tasks/") && url.pathname.endsWith("/mentor")
      ? "Open in-panel mentor room"
      : "Join Google Meet";
  } catch {
    return "Open scheduled session";
  }
}

export async function sendAssignmentAndSessionEmails(context: EmailContext): Promise<void> {
  const origin = baseUrl();
  const taskUrl = `${origin}/intern/tasks/${encodeURIComponent(context.assignmentId)}`;
  const mentorUrl = `${taskUrl}/mentor`;
  const explanationTime = dateTime(context.explanationDate, context.timezone);
  const name = escapeHtml(context.internName);
  const title = escapeHtml(context.taskTitle);
  const summary = escapeHtml(context.taskSummary);
  const sessionLink = escapeHtml(context.explanationMeetUrl);
  const sessionLabel = sessionLinkLabel(context.explanationMeetUrl);
  const mentorLink = escapeHtml(mentorUrl);
  const assignmentLink = escapeHtml(taskUrl);
  const date = escapeHtml(explanationTime);
  const dueDate = escapeHtml(dateTime(context.dueDate, context.timezone));

  await sendAutomationEmail({
    assignmentId: context.assignmentId,
    recipient: context.internEmail,
    templateType: "TASK_ASSIGNMENT",
    idempotencyKey: `${context.assignmentId}:task-assignment:v1`,
    subject: `New assignment: ${context.taskTitle}`,
    text: `Hi ${context.internName},\n\nYou have been assigned ${context.taskTitle}.\n${context.taskSummary}\nDue: ${dateTime(context.dueDate, context.timezone)}\nExplanation session: ${explanationTime} (${context.timezone})\nSession: ${context.explanationMeetUrl}\nAssignment: ${taskUrl}\nMentor: ${mentorUrl}\nSign in to InternFlow to view your private assignment details.`,
    html: htmlEmail("You have a new assignment", `<p>Hi ${name},</p><p>You have been assigned <strong>${title}</strong>.</p><p>${summary}</p><ul><li>Due: ${dueDate}</li><li>Explanation session: ${date} (${escapeHtml(context.timezone)})</li></ul><p><a href="${assignmentLink}">Open assignment</a> · <a href="${mentorLink}">Open Mentor</a> · <a href="${sessionLink}">${sessionLabel}</a></p><p>Sign in to InternFlow to access your private task details.</p>`),
  });

  await sendAutomationEmail({
    assignmentId: context.assignmentId,
    recipient: context.internEmail,
    templateType: "EXPLANATION_SESSION_CONFIRMATION",
    idempotencyKey: `${context.assignmentId}:explanation-confirmation:v1`,
    subject: `Task explanation session confirmed: ${context.taskTitle}`,
    text: `Your explanation session for ${context.taskTitle} is confirmed for ${explanationTime} (${context.timezone}). Session: ${context.explanationMeetUrl}\nMentor: ${mentorUrl}`,
    html: htmlEmail("Explanation session confirmed", `<p>Your session for <strong>${title}</strong> is confirmed.</p><p>${date} (${escapeHtml(context.timezone)})</p><p><a href="${sessionLink}">${sessionLabel}</a> · <a href="${mentorLink}">Open Mentor</a></p>`),
  });
}

export async function sendFirstReviewEmail(context: EmailContext): Promise<void> {
  const origin = baseUrl();
  const assignmentUrl = `${origin}/intern/tasks/${encodeURIComponent(context.assignmentId)}`;
  const title = escapeHtml(context.taskTitle);
  const reviewTime = escapeHtml(dateTime(context.reviewDate, context.timezone));
  const meetUrl = escapeHtml(context.reviewMeetUrl);
  const reviewLinkLabel = sessionLinkLabel(context.reviewMeetUrl);
  const link = escapeHtml(assignmentUrl);
  await sendAutomationEmail({
    assignmentId: context.assignmentId,
    recipient: context.internEmail,
    templateType: "FIRST_REVIEW_INVITATION",
    idempotencyKey: `${context.assignmentId}:first-review:v1`,
    subject: `First review scheduled: ${context.taskTitle}`,
    text: `The first review for ${context.taskTitle} is scheduled for ${dateTime(context.reviewDate, context.timezone)} (${context.timezone}). Session: ${context.reviewMeetUrl}\nBefore the review, submit your repository or project link and a short progress description: ${assignmentUrl}`,
    html: htmlEmail("Your first review is scheduled", `<p>The first review for <strong>${title}</strong> is scheduled for ${reviewTime} (${escapeHtml(context.timezone)}).</p><p><a href="${meetUrl}">${reviewLinkLabel}</a></p><p>Before the session, submit your repository or project link and a short progress description on your <a href="${link}">assignment page</a>.</p>`),
  });
}

export async function sendMeetingReminder(context: EmailContext, meetingType: "TASK_EXPLANATION" | "FIRST_REVIEW"): Promise<void> {
  const origin = baseUrl();
  const assignmentUrl = `${origin}/intern/tasks/${encodeURIComponent(context.assignmentId)}`;
  const date = meetingType === "TASK_EXPLANATION" ? context.explanationDate : context.reviewDate;
  const meetUrl = meetingType === "TASK_EXPLANATION" ? context.explanationMeetUrl : context.reviewMeetUrl;
  const label = meetingType === "TASK_EXPLANATION" ? "task explanation" : "first review";
  const scheduled = escapeHtml(dateTime(date, context.timezone));
  const safeMeet = escapeHtml(meetUrl);
  const reminderLinkLabel = sessionLinkLabel(meetUrl);
  const safeAssignment = escapeHtml(assignmentUrl);
  await sendAutomationEmail({
    assignmentId: context.assignmentId,
    recipient: context.internEmail,
    templateType: `${meetingType}_REMINDER`,
    idempotencyKey: `${context.assignmentId}:${meetingType.toLowerCase()}:reminder:${date.toISOString()}`,
    subject: `Reminder: ${label} for ${context.taskTitle}`,
    text: `Reminder: your ${label} for ${context.taskTitle} is scheduled for ${dateTime(date, context.timezone)} (${context.timezone}). Session: ${meetUrl}\nAssignment: ${assignmentUrl}`,
    html: htmlEmail(`Reminder: your ${label} is coming up`, `<p><strong>${escapeHtml(context.taskTitle)}</strong> · ${scheduled} (${escapeHtml(context.timezone)})</p><p><a href="${safeMeet}">${reminderLinkLabel}</a> · <a href="${safeAssignment}">Open assignment</a></p>`),
  });
}

export async function sendMeetingUpdateEmail(context: EmailContext, meetingType: "TASK_EXPLANATION" | "FIRST_REVIEW"): Promise<void> {
  const origin = baseUrl();
  const assignmentUrl = `${origin}/intern/tasks/${encodeURIComponent(context.assignmentId)}`;
  const mentorUrl = `${assignmentUrl}/mentor`;
  const isExplanation = meetingType === "TASK_EXPLANATION";
  const meetingDate = isExplanation ? context.explanationDate : context.reviewDate;
  const meetUrl = isExplanation ? context.explanationMeetUrl : context.reviewMeetUrl;
  const label = isExplanation ? "explanation session" : "first review";
  const formattedDate = dateTime(meetingDate, context.timezone);
  const safeDate = escapeHtml(formattedDate);
  const safeTitle = escapeHtml(context.taskTitle);
  const safeMeetUrl = escapeHtml(meetUrl);
  const safeAssignmentUrl = escapeHtml(assignmentUrl);
  const safeMentorUrl = escapeHtml(mentorUrl);
  const updateLinkLabel = sessionLinkLabel(meetUrl);
  await sendAutomationEmail({
    assignmentId: context.assignmentId,
    recipient: context.internEmail,
    templateType: `${meetingType}_RESCHEDULED`,
    idempotencyKey: `${context.assignmentId}:${meetingType.toLowerCase()}:rescheduled:${meetingDate.toISOString()}`,
    subject: `Updated ${label}: ${context.taskTitle}`,
    text: `The ${label} for ${context.taskTitle} has been rescheduled to ${formattedDate} (${context.timezone}). Session: ${meetUrl}\nAssignment: ${assignmentUrl}${isExplanation ? `\nMentor: ${mentorUrl}` : ""}`,
    html: htmlEmail(`Your ${label} was updated`, `<p><strong>${safeTitle}</strong> is now scheduled for ${safeDate} (${escapeHtml(context.timezone)}).</p><p><a href="${safeMeetUrl}">${updateLinkLabel}</a> · <a href="${safeAssignmentUrl}">Open assignment</a>${isExplanation ? ` · <a href="${safeMentorUrl}">Open Mentor</a>` : ""}</p>`),
  });
}

export async function sendMeetingCancellationEmail(recipient: string, assignmentId: string, taskTitle: string, meetingType: "TASK_EXPLANATION" | "FIRST_REVIEW", scheduledAt: Date): Promise<void> {
  const origin = baseUrl();
  const assignmentUrl = `${origin}/intern/tasks/${encodeURIComponent(assignmentId)}`;
  const label = meetingType === "TASK_EXPLANATION" ? "explanation session" : "first review";
  await sendAutomationEmail({
    assignmentId,
    recipient,
    templateType: `${meetingType}_CANCELLED`,
    idempotencyKey: `${assignmentId}:${meetingType.toLowerCase()}:cancelled:${scheduledAt.toISOString()}`,
    subject: `Cancelled ${label}: ${taskTitle}`,
    text: `The ${label} for ${taskTitle} has been cancelled. Your administrator will provide an update. Assignment: ${assignmentUrl}`,
    html: htmlEmail(`Your ${label} was cancelled`, `<p>The ${escapeHtml(label)} for <strong>${escapeHtml(taskTitle)}</strong> has been cancelled. Your administrator will provide an update.</p><p><a href="${escapeHtml(assignmentUrl)}">Open assignment</a></p>`),
  });
}

export async function sendReviewFeedbackEmail(context: {
  assignmentId: string;
  reviewId: string;
  submissionId: string;
  internName: string;
  internEmail: string;
  taskTitle: string;
  submissionVersion: number;
  commitSha: string;
  reviewDate: Date;
  outcome: "PASS" | "REVISION_REQUIRED" | "NEEDS_CLARIFICATION";
  projectCompleted?: boolean;
  summary: string;
  blockers: string[];
  requirementsAssessed?: Array<{
    criterion: string;
    status: string;
    explanation: string;
    evidenceReferences?: Array<{ filePath: string; lineStart: number; lineEnd: number }>;
  }>;
  findings?: Array<{
    category?: string;
    severity?: string;
    title: string;
    explanation: string;
    recommendedFix?: string;
    evidenceReferences?: Array<{ filePath: string; lineStart: number; lineEnd: number }>;
  }>;
  missingFeatures: string[];
  recommendations: string[];
  reviewLimitations?: string[];
  nextReview?: { scheduledAt: string | Date; timezone: string; meetUrl: string };
}): Promise<void> {
  const origin = baseUrl();
  const assignmentUrl = `${origin}/intern/tasks/${encodeURIComponent(context.assignmentId)}`;
  const reviewUrl = `${assignmentUrl}/reviews/${encodeURIComponent(context.reviewId)}`;
  const title = escapeHtml(context.taskTitle);
  const outcomeLabel = context.outcome.replaceAll("_", " ");
  const projectCompleted = context.projectCompleted ?? context.outcome === "PASS";
  const summary = escapeHtml(context.summary);
  const bullets = (items: string[]) => items.slice(0, 8).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const assessments = context.requirementsAssessed || [];
  const findings = context.findings || [];
  const limitations = context.reviewLimitations || [];
  const assessmentText = assessments.map((item) => {
    const evidence = (item.evidenceReferences || [])
      .map((reference) => `${reference.filePath}:${reference.lineStart}-${reference.lineEnd}`)
      .join(", ");
    return `- [${item.status}] ${item.criterion}\n  ${item.explanation}${evidence ? `\n  Evidence: ${evidence}` : ""}`;
  }).join("\n");
  const assessmentHtml = assessments.length
    ? `<h2>Acceptance criteria and deliverables</h2><ul>${assessments.map((item) => {
      const evidence = (item.evidenceReferences || [])
        .map((reference) => `${reference.filePath}:${reference.lineStart}-${reference.lineEnd}`)
        .join(", ");
      return `<li><strong>${escapeHtml(item.status)} — ${escapeHtml(item.criterion)}</strong><br />${escapeHtml(item.explanation)}${evidence ? `<br /><span>Evidence: ${escapeHtml(evidence)}</span>` : ""}</li>`;
    }).join("")}</ul>`
    : "";
  const findingsText = findings.map((finding) => {
    const evidence = (finding.evidenceReferences || [])
      .map((reference) => `${reference.filePath}:${reference.lineStart}-${reference.lineEnd}`)
      .join(", ");
    return `- ${finding.severity || "Finding"}${finding.category ? ` · ${finding.category}` : ""}: ${finding.title}\n  ${finding.explanation}${finding.recommendedFix ? `\n  Recommended fix: ${finding.recommendedFix}` : ""}${evidence ? `\n  Evidence: ${evidence}` : ""}`;
  }).join("\n");
  const findingsHtml = findings.length
    ? `<h2>Detailed findings</h2><ul>${findings.map((finding) => {
      const evidence = (finding.evidenceReferences || [])
        .map((reference) => `${reference.filePath}:${reference.lineStart}-${reference.lineEnd}`)
        .join(", ");
      return `<li><strong>${escapeHtml(finding.severity || "Finding")}${finding.category ? ` · ${escapeHtml(finding.category)}` : ""}: ${escapeHtml(finding.title)}</strong><br />${escapeHtml(finding.explanation)}${finding.recommendedFix ? `<br /><strong>Recommended fix:</strong> ${escapeHtml(finding.recommendedFix)}` : ""}${evidence ? `<br /><span>Evidence: ${escapeHtml(evidence)}</span>` : ""}</li>`;
    }).join("")}</ul>`
    : "";
  const limitationsText = limitations.length
    ? `Review limitations:\n- ${limitations.join("\n- ")}`
    : "";
  const limitationsHtml = limitations.length
    ? `<h2>Review limitations</h2><ul>${bullets(limitations)}</ul>`
    : "";
  const reference = context.commitSha ? `commit ${context.commitSha.slice(0, 12)}` : `submission v${context.submissionVersion}`;
  const nextMeet = context.nextReview && confirmedMeetUrl(context.nextReview.meetUrl)
    ? {
      date: dateTime(context.nextReview.scheduledAt instanceof Date ? context.nextReview.scheduledAt : new Date(context.nextReview.scheduledAt), context.nextReview.timezone),
      timezone: context.nextReview.timezone,
      meetUrl: confirmedMeetUrl(context.nextReview.meetUrl)!,
    }
    : undefined;
  const nextReviewHtml = nextMeet
    ? `<h2>Next review</h2><p>${escapeHtml(nextMeet.date)} (${escapeHtml(nextMeet.timezone)})</p><p><a href="${escapeHtml(nextMeet.meetUrl)}">Join confirmed Google Meet</a> · <a href="${escapeHtml(assignmentUrl)}">Open assignment</a></p><p>Submit an updated repository version before the review.</p>`
    : "";
  const nextReviewText = nextMeet
    ? `\nNext review: ${nextMeet.date} (${nextMeet.timezone})\nConfirmed Google Meet: ${nextMeet.meetUrl}\nUpdate and submit your repository before the session.\n`
    : "";

  await sendAutomationEmail({
    assignmentId: context.assignmentId,
    recipient: context.internEmail,
    templateType: projectCompleted ? "PROJECT_COMPLETION" : "AI_REVIEW_FEEDBACK",
    idempotencyKey: `${context.assignmentId}:review-feedback:${context.reviewId}`,
    subject: `${outcomeLabel}: ${context.taskTitle}`,
    text: [
      `Hi ${context.internName},`,
      `Review for ${context.taskTitle} (${reference}) on ${dateTime(context.reviewDate, "UTC")}.`,
      `Outcome: ${outcomeLabel}.`,
      context.summary,
      context.blockers.length ? `Blocking issues:\n- ${context.blockers.join("\n- ")}` : "No blocking issues were found.",
      assessmentText ? `Acceptance criteria and deliverables:\n${assessmentText}` : "",
      findingsText ? `Detailed findings:\n${findingsText}` : "",
      context.missingFeatures.length ? `Missing features:\n- ${context.missingFeatures.join("\n- ")}` : "",
      context.recommendations.length ? `Recommended next steps:\n- ${context.recommendations.join("\n- ")}` : "",
      limitationsText,
      `Review details: ${reviewUrl}`,
      nextReviewText,
      projectCompleted ? `The project is marked complete. Assignment: ${assignmentUrl}` : context.outcome === "PASS" ? `This submission passed its criteria, but the assignment remains open because a newer version is awaiting review. Assignment: ${assignmentUrl}` : "",
    ].filter(Boolean).join("\n\n"),
    html: htmlEmail(
      projectCompleted ? "Project review complete" : "Your project review is ready",
      `<p>Hi ${escapeHtml(context.internName)},</p><p>Review for <strong>${title}</strong> (${escapeHtml(reference)}).</p><p><strong>Outcome:</strong> ${escapeHtml(outcomeLabel)}</p><p>${summary}</p>${context.blockers.length ? `<h2>Blocking issues</h2><ul>${bullets(context.blockers)}</ul>` : "<p>No blocking issues were found.</p>"}${assessmentHtml}${findingsHtml}${context.missingFeatures.length ? `<h2>Missing features</h2><ul>${bullets(context.missingFeatures)}</ul>` : ""}${context.recommendations.length ? `<h2>Recommended next steps</h2><ul>${bullets(context.recommendations)}</ul>` : ""}${limitationsHtml}<p><a href="${escapeHtml(reviewUrl)}">View authenticated review details</a></p>${nextReviewHtml}${projectCompleted ? `<p>The project is marked complete. <a href="${escapeHtml(assignmentUrl)}">Open assignment</a></p>` : context.outcome === "PASS" ? `<p>This submission passed its criteria, but the assignment remains open because a newer version is awaiting review. <a href="${escapeHtml(assignmentUrl)}">Open assignment</a></p>` : ""}`,
    ),
  });
}

export async function sendReviewProcessingFailureEmail(context: {
  assignmentId: string;
  submissionId: string;
  internName: string;
  internEmail: string;
  taskTitle: string;
}): Promise<void> {
  const origin = baseUrl();
  const assignmentUrl = `${origin}/intern/tasks/${encodeURIComponent(context.assignmentId)}`;
  await sendAutomationEmail({
    assignmentId: context.assignmentId,
    recipient: context.internEmail,
    templateType: "REVIEW_PROCESSING_FAILED",
    idempotencyKey: `${context.submissionId}:review-processing-failed`,
    subject: `Review processing needs attention: ${context.taskTitle}`,
    text: `Hi ${context.internName},\n\nWe could not finish processing your submission for ${context.taskTitle}. This is a technical issue, not a negative project review. The submission is saved. Please check the assignment page for retry guidance: ${assignmentUrl}`,
    html: htmlEmail("Your submission is saved", `<p>Hi ${escapeHtml(context.internName)},</p><p>We could not finish processing your submission for <strong>${escapeHtml(context.taskTitle)}</strong>. This is a technical issue, not a negative project review.</p><p>Your submission is saved. Please check the assignment page for retry guidance.</p><p><a href="${escapeHtml(assignmentUrl)}">Open assignment</a></p>`),
  });
}

export async function sendMeetingAgentPendingEmail(context: {
  assignmentId: string;
  meetingId: string;
  internName: string;
  internEmail: string;
  taskTitle: string;
  scheduledAt: Date;
  timezone: string;
  consentAt: Date;
}): Promise<void> {
  const origin = baseUrl();
  const assignmentUrl = `${origin}/intern/tasks/${encodeURIComponent(context.assignmentId)}`;
  const when = dateTime(context.scheduledAt, context.timezone);
  await sendAutomationEmail({
    assignmentId: context.assignmentId,
    recipient: context.internEmail,
    templateType: "AI_MEETING_AGENT_PENDING",
    idempotencyKey: `${context.meetingId}:agent-pending:${context.consentAt.toISOString()}`,
    subject: `mentor is not scheduled: ${context.taskTitle}`,
    text: `Hi ${context.internName},\n\nYour consent preference for the mentor was saved for the task explanation session scheduled at ${when} (${context.timezone}), but Recall is not configured and no bot has been scheduled. You can still use your Google Meet and task mentor page: ${assignmentUrl}\n\nRaw audio/video recording is disabled. If a Recall session is enabled, recognized question text and AI replies are saved in your task mentor history.`,
    html: htmlEmail(
      "mentor is not scheduled",
      `<p>Hi ${escapeHtml(context.internName)},</p><p>Your consent preference was saved for the task explanation session scheduled at ${escapeHtml(when)} (${escapeHtml(context.timezone)}), but Recall is not configured and no bot has been scheduled. Your Google Meet and task mentor page remain available.</p><p><a href="${escapeHtml(assignmentUrl)}">Open assignment</a></p><p>Raw audio/video recording is disabled. If a Recall session is enabled, recognized question text and AI replies are saved in your task mentor history.</p>`,
    ),
  });
}

export async function sendMeetingAgentSummaryEmail(context: {
  assignmentId: string;
  meetingId: string;
  eventId: string;
  internName: string;
  internEmail: string;
  taskTitle: string;
  taskDescription: string;
  requirements: string[];
  acceptanceCriteria: string[];
  expectedDeliverables: string[];
  dueDate: Date;
  meetingSummary: string;
  endedAt: Date;
  timezone: string;
  nextReview?: { scheduledAt: Date; timezone: string; meetUrl: string };
}): Promise<void> {
  const origin = baseUrl();
  const assignmentUrl = `${origin}/intern/tasks/${encodeURIComponent(context.assignmentId)}`;
  const safeTaskTitle = escapeHtml(context.taskTitle);
  const safeSummary = escapeHtml(context.meetingSummary || "No session summary was provided.");
  const dueDate = dateTime(context.dueDate, context.timezone);
  const bulletList = (items: string[]) => items.length
    ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "<p>None specified.</p>";
  const nextReviewText = context.nextReview
    ? `\nNext review: ${dateTime(context.nextReview.scheduledAt, context.nextReview.timezone)} (${context.nextReview.timezone})\nMeet: ${context.nextReview.meetUrl}`
    : "\nNo next review is scheduled yet; check your assignment page for updates.";
  const nextReviewHtml = context.nextReview
    ? `<h2>Next review</h2><p>${escapeHtml(dateTime(context.nextReview.scheduledAt, context.nextReview.timezone))} (${escapeHtml(context.nextReview.timezone)})</p><p><a href="${escapeHtml(context.nextReview.meetUrl)}">Join Google Meet</a></p>`
    : "<p>No next review is scheduled yet. Check your assignment page for updates.</p>";
  await sendAutomationEmail({
    assignmentId: context.assignmentId,
    recipient: context.internEmail,
    templateType: "AI_MEETING_AGENT_SESSION_SUMMARY",
    idempotencyKey: `${context.meetingId}:agent-summary:${context.eventId}`,
    subject: `mentor session summary: ${context.taskTitle}`,
    text: [
      `Hi ${context.internName},`,
      `Your mentor session for ${context.taskTitle} ended at ${dateTime(context.endedAt, context.timezone)} (${context.timezone}).`,
      `Session summary:\n${context.meetingSummary || "No session summary was provided."}`,
      `Task description:\n${context.taskDescription}`,
      `Requirements:\n${context.requirements.map((item) => `- ${item}`).join("\n") || "- None specified."}`,
      `Acceptance criteria:\n${context.acceptanceCriteria.map((item) => `- ${item}`).join("\n") || "- None specified."}`,
      `Expected deliverables:\n${context.expectedDeliverables.map((item) => `- ${item}`).join("\n") || "- None specified."}`,
      `Due date: ${dueDate} (${context.timezone})`,
      `Submission: Sign in and submit your repository URL and progress description on the assignment page: ${assignmentUrl}`,
      nextReviewText,
      "Raw audio/video recording is disabled. Recognized question text and AI replies are saved in the task mentor history.",
    ].join("\n\n"),
    html: htmlEmail(
      "Your mentor session summary",
      `<p>Hi ${escapeHtml(context.internName)},</p><p>Your mentor session for <strong>${safeTaskTitle}</strong> ended at ${escapeHtml(dateTime(context.endedAt, context.timezone))} (${escapeHtml(context.timezone)}).</p><h2>Session summary</h2><p>${safeSummary}</p><h2>Task description</h2><p>${escapeHtml(context.taskDescription)}</p><h2>Requirements</h2>${bulletList(context.requirements)}<h2>Acceptance criteria</h2>${bulletList(context.acceptanceCriteria)}<h2>Expected deliverables</h2>${bulletList(context.expectedDeliverables)}<p><strong>Due:</strong> ${escapeHtml(dueDate)} (${escapeHtml(context.timezone)})</p><p>Submit your repository URL and progress description from your <a href="${escapeHtml(assignmentUrl)}">assignment page</a>.</p>${nextReviewHtml}<p>Raw audio/video recording is disabled. Recognized question text and AI replies are saved in the task mentor history.</p>`,
    ),
  });
}

export async function sendMeetingAgentFailureEmail(context: {
  assignmentId: string;
  meetingId: string;
  eventId: string;
  recipient: string;
  taskTitle: string;
  status: "NO_SHOW" | "FAILED";
}): Promise<void> {
  const origin = baseUrl();
  const assignmentUrl = `${origin}/intern/tasks/${encodeURIComponent(context.assignmentId)}`;
  const explanation = context.status === "NO_SHOW"
    ? "The mentor could not confirm attendance for the scheduled session."
    : "The mentor session could not be completed because of a provider or connection problem.";
  await sendAutomationEmail({
    assignmentId: context.assignmentId,
    recipient: context.recipient,
    templateType: `AI_MEETING_AGENT_${context.status}`,
    idempotencyKey: `${context.meetingId}:agent-outcome:${context.eventId}:${context.recipient.toLowerCase()}`,
    subject: `mentor session update: ${context.taskTitle}`,
    text: `${explanation}\nNo audio, video, or transcript is stored by InternFlow. Your assignment remains available: ${assignmentUrl}`,
    html: htmlEmail(
      "mentor session update",
      `<p>${escapeHtml(explanation)}</p><p>No audio, video, or transcript is stored by InternFlow.</p><p><a href="${escapeHtml(assignmentUrl)}">Open assignment</a></p>`,
    ),
  });
}

export async function sendVoiceMentorFeedbackEmail(context: {
  assignmentId: string;
  sessionId: string;
  internName: string;
  internEmail: string;
  taskTitle: string;
  summary: string;
  requirements: string[];
  acceptanceCriteria: string[];
  deliverables: string[];
  dueDate: Date;
  timezone: string;
  nextReview?: { date: Date; timezone: string; url: string };
}): Promise<void> {
  const origin = baseUrl();
  const assignmentUrl = `${origin}/intern/tasks/${encodeURIComponent(context.assignmentId)}`;
  const mentorUrl = `${assignmentUrl}/mentor`;
  const items = (values: string[]) => values.length
    ? values.map((value) => `- ${value}`).join("\n")
    : "- None specified.";
  const htmlItems = (values: string[]) => values.length
    ? `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`
    : "<p>None specified.</p>";
  const nextReviewText = context.nextReview
    ? `\nNext review: ${dateTime(context.nextReview.date, context.nextReview.timezone)} (${context.nextReview.timezone})\nMeeting: ${context.nextReview.url}`
    : "\nNo next review is scheduled yet. Open your assignment page for updates.";
  const nextReviewHtml = context.nextReview
    ? `<h2>Next review</h2><p>${escapeHtml(dateTime(context.nextReview.date, context.nextReview.timezone))} (${escapeHtml(context.nextReview.timezone)})</p><p><a href="${escapeHtml(context.nextReview.url)}">Open scheduled session</a></p>`
    : "<p>No next review is scheduled yet. Open your assignment page for updates.</p>";
  await sendAutomationEmail({
    assignmentId: context.assignmentId,
    recipient: context.internEmail,
    templateType: "LOCAL_VOICE_MENTOR_FEEDBACK",
    idempotencyKey: `${context.sessionId}:voice-mentor-feedback`,
    subject: `Your mentor session feedback: ${context.taskTitle}`,
    text: [
      `Hi ${context.internName},`,
      `Your mentor session for ${context.taskTitle} has ended.`,
      `Session feedback:\n${context.summary || "No questions were recorded during this session."}`,
      `Task requirements:\n${items(context.requirements)}`,
      `Acceptance criteria:\n${items(context.acceptanceCriteria)}`,
      `Expected deliverables:\n${items(context.deliverables)}`,
      `Due date: ${dateTime(context.dueDate, context.timezone)} (${context.timezone})`,
      `Submission instructions: sign in and submit your repository URL and progress description here: ${assignmentUrl}`,
      nextReviewText,
      `Continue asking the mentor: ${mentorUrl}`,
      "Your session was led by Shortfundly's virtual mentor. We keep the text of the conversation, not audio or video.",
    ].join("\n\n"),
    html: htmlEmail(
      "Your mentor session feedback",
      `<p>Hi ${escapeHtml(context.internName)},</p><p>Your mentor session for <strong>${escapeHtml(context.taskTitle)}</strong> has ended.</p><h2>Session feedback</h2><p>${escapeHtml(context.summary || "No questions were recorded during this session.")}</p><h2>Task requirements</h2>${htmlItems(context.requirements)}<h2>Acceptance criteria</h2>${htmlItems(context.acceptanceCriteria)}<h2>Expected deliverables</h2>${htmlItems(context.deliverables)}<p><strong>Due date:</strong> ${escapeHtml(dateTime(context.dueDate, context.timezone))} (${escapeHtml(context.timezone)})</p><p>Submit your repository URL and progress description from your <a href="${escapeHtml(assignmentUrl)}">assignment page</a>.</p>${nextReviewHtml}<p><a href="${escapeHtml(mentorUrl)}">Continue with the mentor</a></p><p>Your session was led by Shortfundly's virtual mentor. We keep the text of the conversation, not audio or video.</p>`,
    ),
  });
}

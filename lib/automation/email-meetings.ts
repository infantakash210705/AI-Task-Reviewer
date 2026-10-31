import { escapeHtml, sendAutomationEmail } from "@/lib/automation/email";
import { baseUrl, dateTime, htmlEmail } from "@/lib/automation/email-templates";

const DISCLOSURE = "Your session will be led by Shortfundly's virtual mentor. Your speech is turned into text during the call so the mentor can reply. We keep the text, not audio or video.";

export async function sendMeetingRequestAdminEmail(context: {
  requestId: string; assignmentId: string; internName: string; taskTitle: string; topic: string; proposedTimes: Date[]; timezone: string;
}): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  if (!adminEmail) return;
  const url = `${baseUrl()}/admin/meetings`;
  const times = context.proposedTimes.length ? context.proposedTimes.map((time) => dateTime(time, context.timezone)).join("; ") : "No preferred time given";
  await sendAutomationEmail({
    assignmentId: context.assignmentId,
    recipient: adminEmail,
    templateType: "MEETING_REQUEST_ADMIN",
    idempotencyKey: `${context.requestId}:request:admin`,
    subject: `Meeting request from ${context.internName}: ${context.taskTitle}`,
    text: `${context.internName} asked for a clarification meeting about "${context.taskTitle}".\n\nTopic: ${context.topic}\nPreferred times: ${times}\n\nReview it here: ${url}`,
    html: htmlEmail("New clarification meeting request", `<p><strong>${escapeHtml(context.internName)}</strong> asked for a meeting about <strong>${escapeHtml(context.taskTitle)}</strong>.</p><p><strong>Topic:</strong> ${escapeHtml(context.topic)}</p><p><strong>Preferred times:</strong> ${escapeHtml(times)}</p><p><a href="${escapeHtml(url)}">Approve or decline</a></p>`),
  });
}

export async function sendMeetingApprovedEmail(context: {
  requestId: string; assignmentId: string; internName: string; internEmail: string; taskTitle: string;
  scheduledAt: Date; durationMinutes: number; timezone: string; meetUrl: string; adminNote?: string;
}): Promise<void> {
  const when = dateTime(context.scheduledAt, context.timezone);
  const first = context.internName.split(/\s+/)[0] || "there";
  const note = context.adminNote ? `\n\nNote from your admin: ${context.adminNote}` : "";
  await sendAutomationEmail({
    assignmentId: context.assignmentId,
    recipient: context.internEmail,
    templateType: "MEETING_REQUEST_APPROVED",
    idempotencyKey: `${context.requestId}:approved:${context.scheduledAt.getTime()}`,
    subject: `Your meeting is confirmed: ${context.taskTitle}`,
    text: `Hi ${first},\n\nYour clarification meeting for "${context.taskTitle}" is confirmed.\n\nWhen: ${when} (${context.timezone}), ${context.durationMinutes} minutes\nGoogle Meet: ${context.meetUrl}${note}\n\nHave your questions ready and your repository link handy. The mentor may ask you to walk through your work.\n\n${DISCLOSURE}`,
    html: htmlEmail("Your meeting is confirmed", `<p>Hi ${escapeHtml(first)},</p><p>Your clarification meeting for <strong>${escapeHtml(context.taskTitle)}</strong> is confirmed.</p><p><strong>When:</strong> ${escapeHtml(when)} (${escapeHtml(context.timezone)}), ${context.durationMinutes} minutes<br/><a href="${escapeHtml(context.meetUrl)}">Join Google Meet</a></p>${context.adminNote ? `<p><strong>Note from your admin:</strong> ${escapeHtml(context.adminNote)}</p>` : ""}<p>Have your questions ready and your repository link handy. The mentor may ask you to walk through your work.</p><p style="font-size:13px;color:#4a5568">${escapeHtml(DISCLOSURE)}</p>`),
  });
}

export async function sendMeetingDeclinedEmail(context: {
  requestId: string; assignmentId: string; internName: string; internEmail: string; taskTitle: string; adminNote: string;
}): Promise<void> {
  const first = context.internName.split(/\s+/)[0] || "there";
  const url = `${baseUrl()}/intern/tasks/${encodeURIComponent(context.assignmentId)}`;
  const reason = context.adminNote || "Your admin could not schedule this one right now.";
  await sendAutomationEmail({
    assignmentId: context.assignmentId,
    recipient: context.internEmail,
    templateType: "MEETING_REQUEST_DECLINED",
    idempotencyKey: `${context.requestId}:declined`,
    subject: `About your meeting request: ${context.taskTitle}`,
    text: `Hi ${first},\n\nYour meeting request for "${context.taskTitle}" was not approved.\n\nNote from your admin: ${reason}\n\nYou can keep working, ask your mentor in chat, or send a new request: ${url}`,
    html: htmlEmail("About your meeting request", `<p>Hi ${escapeHtml(first)},</p><p>Your meeting request for <strong>${escapeHtml(context.taskTitle)}</strong> was not approved.</p><p><strong>Note from your admin:</strong> ${escapeHtml(reason)}</p><p>You can keep working, ask your mentor in chat, or <a href="${escapeHtml(url)}">send a new request</a>.</p>`),
  });
}

export async function sendAssignmentOnlyEmail(context: {
  assignmentId: string; internName: string; internEmail: string; taskTitle: string; taskSummary: string; dueDate: Date; timezone: string;
}): Promise<void> {
  const origin = baseUrl();
  const taskUrl = `${origin}/intern/tasks/${encodeURIComponent(context.assignmentId)}`;
  const first = context.internName.split(/\s+/)[0] || "there";
  const due = dateTime(context.dueDate, context.timezone);
  await sendAutomationEmail({
    assignmentId: context.assignmentId,
    recipient: context.internEmail,
    templateType: "ASSIGNMENT_CREATED",
    idempotencyKey: `${context.assignmentId}:assignment-created`,
    subject: `New task for you: ${context.taskTitle}`,
    text: `Hi ${first},\n\nYou have a new task: ${context.taskTitle}\n${context.taskSummary}\n\nDue: ${due} (${context.timezone})\n\nOpen it here: ${taskUrl}\n\nYour mentor walkthrough is on the task page, and you can ask for a clarification meeting any time you're stuck. When you're ready, submit your GitHub repository link there.`,
    html: htmlEmail("You have a new task", `<p>Hi ${escapeHtml(first)},</p><p><strong>${escapeHtml(context.taskTitle)}</strong></p><p>${escapeHtml(context.taskSummary)}</p><p><strong>Due:</strong> ${escapeHtml(due)} (${escapeHtml(context.timezone)})</p><p><a href="${escapeHtml(taskUrl)}">Open your task</a></p><p>Your mentor walkthrough is on the task page, and you can ask for a clarification meeting any time you're stuck. When you're ready, submit your GitHub repository link there.</p>`),
  });
}

export type MeetingFeedbackContent = {
  recapSentences: string;
  strengths: string[];
  improvements: string[];
  nextSteps: string[];
  repositoryUrl: string;
  analysisNote: string;
};

export async function sendMeetingFeedbackEmail(context: {
  meetingId: string; assignmentId: string; internName: string; internEmail: string; taskTitle: string; content: MeetingFeedbackContent;
}): Promise<void> {
  const taskUrl = `${baseUrl()}/intern/tasks/${encodeURIComponent(context.assignmentId)}`;
  const first = context.internName.split(/\s+/)[0] || "there";
  const { content } = context;
  const textList = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
  const htmlList = (items: string[]) => `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  const section = (title: string, items: string[], empty: string) => ({
    text: `${title}\n${items.length ? textList(items) : empty}`,
    html: `<h2 style="font-size:17px">${escapeHtml(title)}</h2>${items.length ? htmlList(items) : `<p>${escapeHtml(empty)}</p>`}`,
  });
  const good = section("What's going well", content.strengths, "Nothing specific to call out yet. Send your repository and we'll look again.");
  const fix = section("What needs to change", content.improvements, "Nothing blocking came up. Nice work.");
  const next = section("Your next steps", content.nextSteps, "Keep going and submit when you're ready.");
  await sendAutomationEmail({
    assignmentId: context.assignmentId,
    recipient: context.internEmail,
    templateType: "MEETING_FEEDBACK",
    idempotencyKey: `${context.meetingId}:meeting-feedback`,
    subject: `Feedback from your meeting: ${context.taskTitle}`,
    text: [
      `Hi ${first},`,
      `Thanks for joining the call about "${context.taskTitle}". Here's a quick recap and feedback.`,
      `What we covered\n${content.recapSentences}`,
      content.repositoryUrl ? `Repository reviewed: ${content.repositoryUrl}` : "No repository link was on file, so this feedback comes from our conversation only.",
      content.analysisNote,
      good.text, fix.text, next.text,
      `Submit an updated version here: ${taskUrl}`,
    ].filter(Boolean).join("\n\n"),
    html: htmlEmail("Feedback from your meeting", [
      `<p>Hi ${escapeHtml(first)},</p><p>Thanks for joining the call about <strong>${escapeHtml(context.taskTitle)}</strong>. Here's a quick recap and feedback.</p>`,
      `<h2 style="font-size:17px">What we covered</h2><p>${escapeHtml(content.recapSentences)}</p>`,
      content.repositoryUrl ? `<p><strong>Repository reviewed:</strong> <a href="${escapeHtml(content.repositoryUrl)}">${escapeHtml(content.repositoryUrl)}</a></p>` : "<p>No repository link was on file, so this feedback comes from our conversation only.</p>",
      content.analysisNote ? `<p style="color:#4a5568">${escapeHtml(content.analysisNote)}</p>` : "",
      good.html, fix.html, next.html,
      `<p><a href="${escapeHtml(taskUrl)}">Submit an updated version</a></p>`,
    ].join("")),
  });
}

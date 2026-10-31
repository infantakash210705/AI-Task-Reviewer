import { serve } from "inngest/next";
import { assignmentAutomation, meetingReminder } from "@/lib/automation/assignment-workflow";
import { submissionReviewWorkflow } from "@/lib/automation/submission-workflow";
import { notifyMeetingAgentOutcome, scheduleMeetingAgent } from "@/lib/automation/meeting-agent-workflow";
import { postMeetingFeedback } from "@/lib/automation/meeting-feedback";
import { inngest } from "@/lib/inngest/client";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [assignmentAutomation, meetingReminder, submissionReviewWorkflow, scheduleMeetingAgent, notifyMeetingAgentOutcome, postMeetingFeedback],
});

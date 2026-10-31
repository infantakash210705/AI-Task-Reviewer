import { meetingAgentConfiguration } from "@/lib/automation/meeting-agent-provider";
import {
  recallStatusWebhookSchema,
  transitionMeetingAgentEvent,
  verifyRecallWebhookSignature,
} from "@/lib/automation/meeting-agent-lifecycle";
import { connectDB } from "@/lib/db";
import { after } from "next/server";
import { jsonError } from "@/lib/http";
import { openMeeting } from "@/lib/automation/meeting-conversation";
import { Meeting, MeetingTurn } from "@/lib/models";
import { inngest } from "@/lib/inngest/client";

const maximumBodyBytes = 32 * 1024;

async function readBoundedBody(request: Request): Promise<string | null> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBodyBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBodyBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function recallEventType(code: string, agentStarted: boolean) {
  switch (code) {
    case "joining_call":
    case "in_waiting_room":
      return "SESSION_CONNECTING" as const;
    case "in_call_not_recording":
    case "in_call_recording":
    case "recording_permission_allowed":
      return "SESSION_JOINED" as const;
    case "call_ended":
      return "SESSION_ENDED" as const;
    case "done":
      return agentStarted ? "SESSION_ENDED" as const : "SESSION_NO_SHOW" as const;
    case "fatal":
    case "recording_permission_denied":
      return "SESSION_FAILED" as const;
    default:
      return null;
  }
}

async function savedSessionSummary(meetingId: string): Promise<string> {
  const turns = await MeetingTurn.find({ meetingId }).sort({ seq: -1 }).limit(12).lean();
  return turns.reverse().map((turn) => `${turn.speaker === "MENTOR" ? "Mentor" : "Intern"}: ${turn.text}`).join("\n").slice(0, 3900);
}

export async function POST(request: Request) {
  const configuration = meetingAgentConfiguration();
  if (configuration.provider !== "RECALL") return jsonError("Recall meeting-agent webhooks are not enabled.", 404);
  const secret = process.env.MEETING_AGENT_WEBHOOK_SECRET?.trim() || "";

  let rawBody: string | null;
  try {
    rawBody = await readBoundedBody(request);
  } catch {
    return jsonError("Webhook request body could not be read.", 400);
  }
  if (rawBody === null) return jsonError("Webhook payload is too large.", 413);
  const webhookId = request.headers.get("webhook-id") || request.headers.get("svix-id");
  const webhookTimestamp = request.headers.get("webhook-timestamp") || request.headers.get("svix-timestamp");
  const webhookSignature = request.headers.get("webhook-signature") || request.headers.get("svix-signature");
  if (!verifyRecallWebhookSignature(rawBody, {
    id: webhookId,
    timestamp: webhookTimestamp,
    signature: webhookSignature,
  }, secret)) {
    console.warn("[meeting-agent] rejected Recall webhook with invalid signature");
    return jsonError("Webhook signature is invalid or expired.", 401);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonError("Webhook payload is invalid.", 400);
  }
  const parsed = recallStatusWebhookSchema.safeParse(body);
  if (!parsed.success) return jsonError("Recall status webhook payload is invalid.", 400);
  const event = parsed.data;
  const meetingId = event.data.bot.metadata.internflow_meeting_id;
  const meetingObjectIdPattern = /^[a-f\d]{24}$/i;
  if (!meetingId || !meetingObjectIdPattern.test(meetingId)) {
    return Response.json({ accepted: false, reason: "Meeting metadata is not an InternFlow session." }, { status: 202 });
  }

  try {
    await connectDB();
    const meeting = await Meeting.findOne({
      _id: meetingId,
      meetingType: { $in: ["TASK_EXPLANATION", "DOUBT_CLARIFICATION", "FIRST_REVIEW", "REVIEW"] },
      agentProvider: "RECALL",
      agentProviderSessionId: event.data.bot.id,
    }).lean();
    if (!meeting) return jsonError("Meeting not found.", 404);
    const eventId = webhookId || `${event.data.bot.id}:${event.event}:${event.data.data.updated_at}`;
    const duplicate = (meeting.agentEventIds || []).includes(eventId);
    const type = recallEventType(event.data.data.code, Boolean(meeting.agentStartedAt));
    if (!type) {
      console.info("[meeting-agent] ignored Recall status", { meetingId, status: event.data.data.code });
      return Response.json({ accepted: true, ignored: true });
    }
    const normalized = {
      eventId: eventId.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 160),
      meetingId,
      providerSessionId: event.data.bot.id,
      type,
      occurredAt: event.data.data.updated_at,
      ...(type === "SESSION_ENDED" && meeting.agentSummary ? { summary: meeting.agentSummary } : {}),
    };
    const transition = transitionMeetingAgentEvent({
      status: meeting.agentStatus,
      consentStatus: meeting.agentConsentStatus,
      scheduledAt: meeting.scheduledAt,
      durationMinutes: meeting.durationMinutes,
      startedAt: meeting.agentStartedAt,
      providerSessionId: meeting.agentProviderSessionId,
    }, normalized);
    let updated = null;
    if (transition && !duplicate) {
      const changes: Record<string, unknown> = {
        agentStatus: transition.status,
        agentLastError: event.data.data.code === "recording_permission_denied"
          ? "The meeting host did not allow the mentor to transcribe the call. Ask the host to allow it and reschedule."
          : transition.error || "",
        agentRecordingEnabled: false,
      };
      if (transition.startedAt) changes.agentStartedAt = transition.startedAt;
      if (transition.endedAt) changes.agentEndedAt = transition.endedAt;
      if (type === "SESSION_ENDED") changes.agentSummary = await savedSessionSummary(meetingId);
      updated = await Meeting.findOneAndUpdate(
        {
          _id: meeting._id,
          agentConsentStatus: "GRANTED",
          agentStatus: meeting.agentStatus,
          agentProviderSessionId: event.data.bot.id,
          agentEventIds: { $ne: eventId },
        },
        {
          $set: changes,
          $push: { agentEventIds: { $each: [eventId], $slice: -100 } },
        },
        { new: true },
      ).lean();
    }

    if (!updated && !duplicate) {
      console.info("[meeting-agent] ignored Recall lifecycle event", { meetingId, type });
      return Response.json({ accepted: false, status: "IGNORED" }, { status: 202 });
    }
    if (type === "SESSION_JOINED" && !duplicate) {
      after(async () => { await openMeeting(meetingId); });
    }
    if (type === "SESSION_ENDED" && !duplicate) {
      await inngest.send({
        id: `${meetingId}:ended:feedback`,
        name: "internflow/meeting.ended",
        data: { meetingId },
      });
    }
    if (["SESSION_ENDED", "SESSION_NO_SHOW", "SESSION_FAILED"].includes(type)) {
      await inngest.send({
        id: `${meetingId}:${eventId}:terminal`,
        name: "internflow/meeting-agent.terminal",
        data: { meetingId, eventId: normalized.eventId, type },
      });
    }
    console.info("[meeting-agent] accepted Recall lifecycle event", { meetingId, type, duplicate });
    return Response.json({ accepted: true, duplicate });
  } catch {
    console.error("[meeting-agent] Recall webhook processing failed", { meetingId, type: event.data.data.code });
    return jsonError("Webhook processing is temporarily unavailable.", 503);
  }
}

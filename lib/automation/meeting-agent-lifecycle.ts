import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const recallStatusWebhookSchema = z.object({
  event: z.string().trim().min(1).max(100),
  data: z.object({
    data: z.object({
      code: z.string().trim().min(1).max(100),
      sub_code: z.string().nullable().optional(),
      updated_at: z.iso.datetime({ offset: true }),
    }).passthrough(),
    bot: z.object({
      id: z.string().uuid(),
      metadata: z.record(z.string(), z.string()),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

export type RecallStatusWebhook = z.infer<typeof recallStatusWebhookSchema>;

export const meetingAgentWebhookSchema = z.object({
  eventId: z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/),
  meetingId: z.string().trim().min(1).max(64).regex(/^[a-f\d]{24}$/i),
  providerSessionId: z.string().trim().min(1).max(160),
  type: z.enum(["SESSION_CONNECTING", "SESSION_JOINED", "SESSION_ENDED", "SESSION_NO_SHOW", "SESSION_FAILED"]),
  occurredAt: z.iso.datetime({ offset: true }),
  summary: z.string().trim().max(4000).optional(),
}).strict().superRefine((event, context) => {
  if (event.type !== "SESSION_ENDED" && event.summary !== undefined) {
    context.addIssue({ code: "custom", path: ["summary"], message: "A summary is accepted only for an ended session." });
  }
});

export type MeetingAgentWebhookEvent = z.infer<typeof meetingAgentWebhookSchema>;

export type MeetingAgentTransitionState = {
  status: string;
  consentStatus: string;
  scheduledAt: Date | string;
  durationMinutes: number;
  startedAt?: Date | string | null;
  providerSessionId?: string;
};

const priorStatuses: Record<MeetingAgentWebhookEvent["type"], string[]> = {
  SESSION_CONNECTING: ["SCHEDULED"],
  SESSION_JOINED: ["SCHEDULED", "CONNECTING"],
  SESSION_ENDED: ["IN_MEETING"],
  SESSION_NO_SHOW: ["SCHEDULED", "CONNECTING"],
  SESSION_FAILED: ["SCHEDULED", "CONNECTING", "IN_MEETING"],
};

export function transitionMeetingAgentEvent(
  meeting: MeetingAgentTransitionState,
  event: MeetingAgentWebhookEvent,
): { status: string; startedAt?: Date; endedAt?: Date; summary?: string; error?: string } | null {
  if (
    meeting.consentStatus !== "GRANTED"
    || !priorStatuses[event.type].includes(meeting.status)
    || (meeting.providerSessionId && meeting.providerSessionId !== event.providerSessionId)
  ) return null;

  const occurredAt = new Date(event.occurredAt);
  const scheduledAt = new Date(meeting.scheduledAt);
  const elapsed = occurredAt.getTime() - scheduledAt.getTime();
  const meetingWindowMs = (meeting.durationMinutes + 15) * 60_000;

  if (event.type === "SESSION_CONNECTING" || event.type === "SESSION_JOINED") {
    if (elapsed < 0 || elapsed > meetingWindowMs) return null;
  } else if (event.type === "SESSION_NO_SHOW") {
    if (elapsed < 10 * 60_000 || elapsed > (meeting.durationMinutes + 60) * 60_000) return null;
  } else if (event.type === "SESSION_ENDED" || event.type === "SESSION_FAILED") {
    if (elapsed < 0 || elapsed > Math.max(meetingWindowMs, 2 * 60 * 60_000)) return null;
  }

  switch (event.type) {
    case "SESSION_CONNECTING":
      return { status: "CONNECTING" };
    case "SESSION_JOINED":
      return { status: "IN_MEETING", startedAt: occurredAt };
    case "SESSION_ENDED":
      return { status: "COMPLETED", endedAt: occurredAt, summary: event.summary || "" };
    case "SESSION_NO_SHOW":
      return { status: "NO_SHOW", endedAt: occurredAt };
    case "SESSION_FAILED":
      return { status: "FAILED", endedAt: occurredAt, error: "The meeting-agent provider reported a session failure." };
  }
}

export function verifyRecallWebhookSignature(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!secret.startsWith("whsec_") || !id || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > 300) return false;
  let key: Buffer;
  try {
    key = Buffer.from(secret.slice("whsec_".length), "base64");
  } catch {
    return false;
  }
  if (!key.length) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();
  for (const value of signature.split(" ")) {
    const [version, encoded] = value.split(",");
    if (version !== "v1" || !encoded) continue;
    let received: Buffer;
    try {
      received = Buffer.from(encoded, "base64");
    } catch {
      continue;
    }
    if (received.length === expected.length && timingSafeEqual(received, expected)) return true;
  }
  return false;
}

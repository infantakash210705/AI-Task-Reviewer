import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  meetingAgentWebhookSchema,
  recallStatusWebhookSchema,
  transitionMeetingAgentEvent,
  verifyRecallWebhookSignature,
} from "@/lib/automation/meeting-agent-lifecycle";
import { getMeetingAgentProvider, meetingAgentConfiguration, verifyRealtimeToken } from "@/lib/automation/meeting-agent-provider";

const scheduledAt = new Date("2026-11-01T10:00:00.000Z");
const apiKey = "test-recall-api-key";
const pageSecret = "a-test-page-secret-that-is-at-least-32-characters-long";
const webhookKey = Buffer.from("test-recall-webhook-key").toString("base64");

function readyEnvironment() {
  return {
    MEETING_AGENT_PROVIDER: "RECALL",
    RECALL_API_KEY: apiKey,
    RECALL_API_BASE_URL: "https://us-east-1.recall.ai",
    MEETING_AGENT_PUBLIC_BASE_URL: "https://mentor.example.test",
    MEETING_AGENT_WEBHOOK_SECRET: `whsec_${webhookKey}`,
    MEETING_AGENT_PAGE_SECRET: pageSecret,
    MEETING_AGENT_RECORDING_ENABLED: "false",
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function event(type: "SESSION_CONNECTING" | "SESSION_JOINED" | "SESSION_ENDED" | "SESSION_NO_SHOW" | "SESSION_FAILED", occurredAt: string) {
  return meetingAgentWebhookSchema.parse({
    eventId: "event-1",
    meetingId: "507f1f77bcf86cd799439011",
    providerSessionId: "provider-session-1",
    type,
    occurredAt,
    ...(type === "SESSION_ENDED" ? { summary: "Reviewed acceptance criteria." } : {}),
  });
}

describe("Recall meeting agent", () => {
  it("keeps the provider disabled by default and marks complete configuration ready", () => {
    expect(meetingAgentConfiguration({}).integrationStatus).toBe("DISABLED");
    expect(meetingAgentConfiguration(readyEnvironment())).toMatchObject({
      provider: "RECALL",
      missingCredentials: [],
      recordingEnabled: false,
      integrationStatus: "READY",
    });
  });

  it("creates a named bot with live transcript only and a signed realtime webhook", async () => {
    vi.stubEnv("MEETING_AGENT_PROVIDER", "RECALL");
    vi.stubEnv("RECALL_API_KEY", apiKey);
    vi.stubEnv("RECALL_API_BASE_URL", "https://us-east-1.recall.ai");
    vi.stubEnv("MEETING_AGENT_PUBLIC_BASE_URL", "https://mentor.example.test");
    vi.stubEnv("MEETING_AGENT_WEBHOOK_SECRET", `whsec_${webhookKey}`);
    vi.stubEnv("MEETING_AGENT_PAGE_SECRET", pageSecret);
    vi.stubEnv("MEETING_AGENT_RECORDING_ENABLED", "false");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ results: [] }))
      .mockResolvedValueOnce(Response.json({ id: "123e4567-e89b-12d3-a456-426614174000" }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = getMeetingAgentProvider();
    const result = await provider.scheduleSession({
      meetingId: "507f1f77bcf86cd799439011",
      assignmentId: "507f1f77bcf86cd799439012",
      idempotencyKey: "507f1f77bcf86cd799439011:consent",
      meetingUrl: "https://meet.google.com/example",
      scheduledAt,
      durationMinutes: 30,
      botName: "Arjun | Shortfundly Virtual Mentor",
      taskContext: {
        title: "Task",
        description: "Description",
        requirements: [],
        acceptanceCriteria: [],
        expectedDeliverables: [],
        dueDate: "2026-11-02T00:00:00.000Z",
      },
    });

    expect(result).toEqual({ status: "SCHEDULED", providerSessionId: "123e4567-e89b-12d3-a456-426614174000" });
    const createRequest = fetchMock.mock.calls[1];
    expect(String(createRequest[0])).toBe("https://us-east-1.recall.ai/api/v1/bot/");
    expect(createRequest[1]).toMatchObject({
      method: "POST",
      headers: { Authorization: `Token ${apiKey}` },
    });
    const payload = JSON.parse(String(createRequest[1]?.body));
    expect(payload).toMatchObject({
      meeting_url: "https://meet.google.com/example",
      bot_name: "Arjun | Shortfundly Virtual Mentor",
      join_at: scheduledAt.toISOString(),
    });
    expect(payload.output_media).toBeUndefined();
    expect(payload.recording_config.transcript.provider.recallai_streaming).toBeDefined();
    const endpoint = payload.recording_config.realtime_endpoints[0];
    expect(endpoint.events).toEqual(["transcript.data"]);
    const hook = new URL(endpoint.url);
    expect(hook.origin + hook.pathname).toBe("https://mentor.example.test/api/webhooks/meeting-agent/realtime");
    expect(verifyRealtimeToken("507f1f77bcf86cd799439011", hook.searchParams.get("t") || "", { MEETING_AGENT_PAGE_SECRET: pageSecret })).toBe(true);
    expect(verifyRealtimeToken("507f1f77bcf86cd799439012", hook.searchParams.get("t") || "", { MEETING_AGENT_PAGE_SECRET: pageSecret })).toBe(false);
  });

  it("omits join_at when scheduled time is immediate so the bot joins immediately", async () => {
    vi.stubEnv("MEETING_AGENT_PROVIDER", "RECALL");
    vi.stubEnv("RECALL_API_KEY", apiKey);
    vi.stubEnv("RECALL_API_BASE_URL", "https://us-east-1.recall.ai");
    vi.stubEnv("MEETING_AGENT_PUBLIC_BASE_URL", "https://mentor.example.test");
    vi.stubEnv("MEETING_AGENT_WEBHOOK_SECRET", `whsec_${webhookKey}`);
    vi.stubEnv("MEETING_AGENT_PAGE_SECRET", pageSecret);
    vi.stubEnv("MEETING_AGENT_RECORDING_ENABLED", "false");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ results: [] }))
      .mockResolvedValueOnce(Response.json({ id: "123e4567-e89b-12d3-a456-426614174000" }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = getMeetingAgentProvider();
    const result = await provider.scheduleSession({
      meetingId: "507f1f77bcf86cd799439011",
      assignmentId: "507f1f77bcf86cd799439012",
      idempotencyKey: "507f1f77bcf86cd799439011:immediate",
      meetingUrl: "https://meet.google.com/example",
      scheduledAt: new Date(),
      durationMinutes: 30,
      botName: "Arjun | Shortfundly Virtual Mentor",
      taskContext: {
        title: "Task",
        description: "Description",
        requirements: [],
        acceptanceCriteria: [],
        expectedDeliverables: [],
        dueDate: "2026-11-02T00:00:00.000Z",
      },
    });

    expect(result).toEqual({ status: "SCHEDULED", providerSessionId: "123e4567-e89b-12d3-a456-426614174000" });
    const createRequest = fetchMock.mock.calls[1];
    const payload = JSON.parse(String(createRequest[1]?.body));
    expect(payload.join_at).toBeUndefined();
    expect(payload.meeting_url).toBe("https://meet.google.com/example");
  });

  it("rejects incomplete settings and prevents recording from being enabled", () => {
    expect(meetingAgentConfiguration({
      MEETING_AGENT_PROVIDER: "RECALL",
      MEETING_AGENT_RECORDING_ENABLED: "true",
    }).missingCredentials).toEqual(expect.arrayContaining([
      "RECALL_API_KEY",
      "RECALL_API_BASE_URL",
      "MEETING_AGENT_PUBLIC_BASE_URL (public HTTPS URL)",
      "MEETING_AGENT_WEBHOOK_SECRET (Recall webhook verification secret)",
      "MEETING_AGENT_PAGE_SECRET (at least 32 random characters)",
      "MEETING_AGENT_RECORDING_ENABLED must remain false; meeting media recording is disabled",
    ]));
    expect(meetingAgentConfiguration({
      ...readyEnvironment(),
      RECALL_API_KEY: "<provider-api-key>",
      MEETING_AGENT_PUBLIC_BASE_URL: "http://localhost:3000",
    }).integrationStatus).toBe("PENDING_INTEGRATION");
  });

  it("verifies Recall webhook signatures over the exact raw body and rejects stale signatures", () => {
    const rawBody = '{"event":"bot.done"}';
    const id = "msg_123";
    const timestamp = "1793527200";
    const secret = `whsec_${webhookKey}`;
    const signature = `v1,${createHmac("sha256", Buffer.from(webhookKey, "base64"))
      .update(`${id}.${timestamp}.${rawBody}`)
      .digest("base64")}`;
    const headers = { id, timestamp, signature };
    expect(verifyRecallWebhookSignature(rawBody, headers, secret, Number(timestamp))).toBe(true);
    expect(verifyRecallWebhookSignature(`${rawBody} `, headers, secret, Number(timestamp))).toBe(false);
    expect(verifyRecallWebhookSignature(rawBody, headers, "wrong-secret", Number(timestamp))).toBe(false);
    expect(verifyRecallWebhookSignature(rawBody, headers, secret, Number(timestamp) + 301)).toBe(false);
  });

  it("accepts Recall status shapes without allowing status events to carry arbitrary transcripts into lifecycle logic", () => {
    expect(recallStatusWebhookSchema.safeParse({
      event: "bot.status_change",
      data: {
        data: { code: "in_call_not_recording", updated_at: "2026-11-01T10:00:00.000Z" },
        bot: {
          id: "123e4567-e89b-12d3-a456-426614174000",
          metadata: { internflow_meeting_id: "507f1f77bcf86cd799439011" },
        },
      },
    }).success).toBe(true);
    expect(meetingAgentWebhookSchema.safeParse({
      eventId: "event-1",
      meetingId: "507f1f77bcf86cd799439011",
      providerSessionId: "provider-session-1",
      type: "SESSION_ENDED",
      occurredAt: "2026-11-01T10:30:00.000Z",
      transcript: "private meeting transcript",
    }).success).toBe(false);
  });

  it("requires consent and scheduled-time eligibility for connection events", () => {
    const meeting = {
      status: "SCHEDULED",
      consentStatus: "GRANTED",
      scheduledAt,
      durationMinutes: 30,
      providerSessionId: "provider-session-1",
    };
    expect(transitionMeetingAgentEvent(meeting, event("SESSION_CONNECTING", "2026-11-01T09:59:00.000Z"))).toBeNull();
    expect(transitionMeetingAgentEvent({ ...meeting, consentStatus: "REVOKED" }, event("SESSION_CONNECTING", "2026-11-01T10:00:00.000Z"))).toBeNull();
    expect(transitionMeetingAgentEvent(meeting, event("SESSION_CONNECTING", "2026-11-01T10:00:00.000Z"))).toEqual({ status: "CONNECTING" });
  });

  it("allows only valid forward lifecycle transitions and no-show timeout", () => {
    const meeting = {
      status: "CONNECTING",
      consentStatus: "GRANTED",
      scheduledAt,
      durationMinutes: 30,
      providerSessionId: "provider-session-1",
    };
    expect(transitionMeetingAgentEvent(meeting, event("SESSION_JOINED", "2026-11-01T10:02:00.000Z"))).toMatchObject({
      status: "IN_MEETING",
      startedAt: new Date("2026-11-01T10:02:00.000Z"),
    });
    expect(transitionMeetingAgentEvent(meeting, event("SESSION_ENDED", "2026-11-01T10:20:00.000Z"))).toBeNull();
    expect(transitionMeetingAgentEvent(
      { ...meeting, status: "SCHEDULED" },
      event("SESSION_NO_SHOW", "2026-11-01T10:05:00.000Z"),
    )).toBeNull();
    expect(transitionMeetingAgentEvent(
      { ...meeting, status: "SCHEDULED" },
      event("SESSION_NO_SHOW", "2026-11-01T10:10:00.000Z"),
    )).toMatchObject({ status: "NO_SHOW" });
    expect(transitionMeetingAgentEvent(
      { ...meeting, status: "SCHEDULED" },
      event("SESSION_NO_SHOW", "2026-11-01T12:00:00.000Z"),
    )).toBeNull();
    const endEvent = event("SESSION_ENDED", "2026-11-01T10:30:00.000Z");
    expect(transitionMeetingAgentEvent(
      { ...meeting, status: "IN_MEETING" },
      endEvent,
    )).toMatchObject({ status: "COMPLETED", summary: "Reviewed acceptance criteria." });
    expect(transitionMeetingAgentEvent(
      { ...meeting, status: "COMPLETED" },
      endEvent,
    )).toBeNull();
  });
});

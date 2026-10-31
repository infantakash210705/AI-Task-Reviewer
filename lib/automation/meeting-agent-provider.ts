import { createHmac, timingSafeEqual } from "node:crypto";
import { mentorLanguage } from "@/lib/automation/mentor-persona";
import { synthesizeSpeech } from "@/lib/automation/tts";

export const MEETING_AGENT_CONSENT_POLICY_VERSION = "2026-10-recall-live-transcript-v3";

export type MeetingAgentProviderStatus = "DISABLED" | "PENDING_INTEGRATION" | "READY";

export type MeetingAgentConfiguration = {
  provider: "DISABLED" | "RECALL";
  missingCredentials: string[];
  recordingEnabled: false;
  integrationStatus: MeetingAgentProviderStatus;
};

export type MeetingAgentSessionRequest = {
  meetingId: string;
  assignmentId: string;
  idempotencyKey: string;
  meetingUrl: string;
  scheduledAt: Date;
  durationMinutes: number;
  botName: string;
  taskContext: {
    title: string;
    description: string;
    requirements: string[];
    acceptanceCriteria: string[];
    expectedDeliverables: string[];
    dueDate: string;
  };
};

export type MeetingAgentScheduleResult =
  | { status: "SCHEDULED"; providerSessionId: string }
  | { status: "PENDING_INTEGRATION"; reason: string };

/** Plays an MP3 clip into the call as the bot's voice. */
export async function sendBotAudio(providerSessionId: string, mp3: Buffer): Promise<void> {
  if (!/^[a-f\d-]{36}$/i.test(providerSessionId)) throw new Error("Recall bot identifier is invalid.");
  const response = await recallRequest(`/api/v1/bot/${encodeURIComponent(providerSessionId)}/output_audio/`, {
    method: "POST",
    body: JSON.stringify({ kind: "mp3", b64_data: mp3.toString("base64") }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error(`[Recall] sendBotAudio failed: status=${response.status}, text=${errorText}`);
    throw safeProviderError(response.status);
  }
}

export interface MeetingAgentProvider {
  readonly name: "DISABLED" | "RECALL";
  readonly status: MeetingAgentProviderStatus;
  scheduleSession(request: MeetingAgentSessionRequest): Promise<MeetingAgentScheduleResult>;
  cancelSession(providerSessionId: string): Promise<void>;
  leaveSession(providerSessionId: string): Promise<void>;
}

export class MeetingAgentIntegrationPendingError extends Error {
  constructor() {
    super("The meeting-agent provider is not configured for a live session.");
    this.name = "MeetingAgentIntegrationPendingError";
  }
}

function publicBaseUrl(environment: Record<string, string | undefined>): string | null {
  const value = environment.MEETING_AGENT_PUBLIC_BASE_URL?.trim();
  if (!value || value.startsWith("<")) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function apiBaseUrl(environment: Record<string, string | undefined>): string | null {
  const value = environment.RECALL_API_BASE_URL?.trim();
  if (!value || value.startsWith("<")) return null;
  try {
    const parsed = new URL(value);
    const allowedHosts = new Set([
      "api.recall.ai",
      "us-east-1.recall.ai",
      "us-west-2.recall.ai",
      "eu-central-1.recall.ai",
      "ap-northeast-1.recall.ai",
    ]);
    if (parsed.protocol !== "https:" || !allowedHosts.has(parsed.hostname) || parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function meetingAgentConfiguration(environment: Record<string, string | undefined> = process.env): MeetingAgentConfiguration {
  const configuredProvider = environment.MEETING_AGENT_PROVIDER?.trim().toUpperCase() || "DISABLED";
  const provider = configuredProvider === "RECALL" ? "RECALL" : "DISABLED";
  const missingCredentials: string[] = [];
  if (configuredProvider !== "DISABLED" && configuredProvider !== "RECALL") {
    missingCredentials.push("MEETING_AGENT_PROVIDER must be DISABLED or RECALL");
  }
  if (provider === "RECALL") {
    const apiKey = environment.RECALL_API_KEY?.trim() || "";
    const webhookSecret = environment.MEETING_AGENT_WEBHOOK_SECRET?.trim() || "";
    const pageSecret = environment.MEETING_AGENT_PAGE_SECRET?.trim() || "";
    if (!apiKey || apiKey.startsWith("<")) missingCredentials.push("RECALL_API_KEY");
    if (!apiBaseUrl(environment)) missingCredentials.push("RECALL_API_BASE_URL");
    if (!publicBaseUrl(environment)) missingCredentials.push("MEETING_AGENT_PUBLIC_BASE_URL (public HTTPS URL)");
    if (!webhookSecret.startsWith("whsec_")) missingCredentials.push("MEETING_AGENT_WEBHOOK_SECRET (Recall webhook verification secret)");
    if (pageSecret.length < 32 || pageSecret.startsWith("<")) missingCredentials.push("MEETING_AGENT_PAGE_SECRET (at least 32 random characters)");
  }
  if (environment.MEETING_AGENT_RECORDING_ENABLED?.trim().toLowerCase() === "true") {
    missingCredentials.push("MEETING_AGENT_RECORDING_ENABLED must remain false; meeting media recording is disabled");
  }
  const integrationStatus = provider === "DISABLED"
    ? "DISABLED"
    : missingCredentials.length ? "PENDING_INTEGRATION" : "READY";
  return { provider, missingCredentials, recordingEnabled: false, integrationStatus };
}

/** Recall transcription language. Override with RECALL_TRANSCRIPT_LANGUAGE if your Recall plan uses different codes. */
export function transcriptLanguage(): string {
  const override = process.env.RECALL_TRANSCRIPT_LANGUAGE?.trim();
  if (override && /^[A-Za-z_-]{2,12}$/.test(override)) return override;
  return { en: "en_us", ta: "ta", hi: "hi" }[mentorLanguage()];
}

/** Signs the realtime-transcript webhook URL for one meeting so only Recall (which holds the URL) can post to it. */
export function realtimeToken(meetingId: string, secret: string): string {
  return createHmac("sha256", secret).update(`realtime:${meetingId}`).digest("hex");
}

export function verifyRealtimeToken(meetingId: string, token: string, environment: Record<string, string | undefined> = process.env): boolean {
  const secret = environment.MEETING_AGENT_PAGE_SECRET?.trim() || "";
  if (secret.length < 32 || secret.startsWith("<") || !/^[a-f\d]{64}$/i.test(token)) return false;
  const expected = Buffer.from(realtimeToken(meetingId, secret), "hex");
  const actual = Buffer.from(token, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function realtimeWebhookUrl(meetingId: string, environment: Record<string, string | undefined> = process.env): string | null {
  const base = publicBaseUrl(environment);
  const secret = environment.MEETING_AGENT_PAGE_SECRET?.trim();
  if (!base || !secret) return null;
  const url = new URL("/api/webhooks/meeting-agent/realtime", base);
  url.searchParams.set("m", meetingId);
  url.searchParams.set("t", realtimeToken(meetingId, secret));
  return url.toString();
}

function safeProviderError(responseStatus: number): Error {
  if (responseStatus === 401 || responseStatus === 403) {
    return new Error("Recall.ai rejected the server credentials. Confirm the API key and Recall region.");
  }
  if (responseStatus === 429 || responseStatus === 507 || responseStatus >= 500) {
    return new Error("Recall.ai is temporarily unable to schedule the mentor bot. Retry from the admin workflow.");
  }
  return new Error("Recall.ai could not complete the request. Check the meeting URL and provider configuration.");
}

async function recallRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const configuration = meetingAgentConfiguration();
  if (configuration.integrationStatus !== "READY") {
    throw new MeetingAgentIntegrationPendingError();
  }
  const baseUrl = apiBaseUrl(process.env);
  const apiKey = process.env.RECALL_API_KEY?.trim();
  if (!baseUrl || !apiKey) throw new MeetingAgentIntegrationPendingError();
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: {
      Authorization: `Token ${apiKey}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: init.signal || AbortSignal.timeout(15_000),
  });
  return response;
}

async function findExistingBot(meetingId: string): Promise<string | null> {
  const query = new URLSearchParams({ "metadata__internflow_meeting_id": meetingId });
  const response = await recallRequest(`/api/v1/bot/?${query.toString()}`);
  if (!response.ok) throw safeProviderError(response.status);
  const result: unknown = await response.json();
  const bots = Array.isArray(result)
    ? result
    : typeof result === "object" && result !== null && "results" in result && Array.isArray(result.results)
      ? result.results
      : null;
  if (!bots) throw new Error("Recall.ai returned an unexpected bot-list response.");
  const match = bots.find((bot) => typeof bot === "object" && bot !== null
    && "id" in bot && typeof bot.id === "string"
    && "metadata" in bot && typeof bot.metadata === "object" && bot.metadata !== null
    && "internflow_meeting_id" in bot.metadata && bot.metadata.internflow_meeting_id === meetingId
    && "status" in bot && typeof bot.status === "object" && bot.status !== null
    && "code" in bot.status && !["done", "fatal", "call_ended", "deleted"].includes(String(bot.status.code)));
  return match && "id" in match && typeof match.id === "string" ? match.id : null;
}

const recallProvider: MeetingAgentProvider = {
  name: "RECALL",
  status: "READY",
  async scheduleSession(request): Promise<MeetingAgentScheduleResult> {
    const configuration = meetingAgentConfiguration();
    if (configuration.integrationStatus !== "READY") {
      return { status: "PENDING_INTEGRATION", reason: "Recall credentials or public deployment URLs are incomplete." };
    }
    const now = Date.now();
    const isImmediate = request.scheduledAt.getTime() <= now + 5 * 60_000;
    if (!isImmediate && request.scheduledAt.getTime() < now + 10 * 60_000) {
      throw new Error("Recall bots must be scheduled at least 10 minutes before the meeting start, or set to join immediately.");
    }
    // Check for an existing non-terminal bot created for this meeting to prevent duplicate bots
    const existingId = await findExistingBot(request.meetingId);
    if (existingId) {
      console.info("[Recall] reusing existing active bot for meeting", { meetingId: request.meetingId, botId: existingId });
      return { status: "SCHEDULED", providerSessionId: existingId };
    }

    const webhookUrl = realtimeWebhookUrl(request.meetingId);
    if (!webhookUrl) throw new MeetingAgentIntegrationPendingError();

    // Prepare initial greeting audio to activate the bot's virtual microphone in Recall.ai
    let greetingB64: string;
    try {
      const mentorFirstName = request.botName.split("|")[0].trim();
      const introAudio = await synthesizeSpeech(
        `Hello! I am ${mentorFirstName} from Shortfundly. My microphone is turned on and I am ready to review your work. Where would you like to begin?`
      );
      greetingB64 = introAudio.toString("base64");
    } catch {
      // Small valid silent MP3 frame so automatic_audio_output is always sent to initialize the virtual mic device
      greetingB64 = "//tQxA==";
    }

    const response = await recallRequest("/api/v1/bot/", {
      method: "POST",
      body: JSON.stringify({
        meeting_url: request.meetingUrl,
        bot_name: request.botName,
        ...(isImmediate ? {} : { join_at: request.scheduledAt.toISOString() }),
        metadata: {
          internflow_meeting_id: request.meetingId,
          internflow_assignment_id: request.assignmentId,
          internflow_idempotency_key: request.idempotencyKey,
        },
        // automatic_audio_output un-mutes the bot upon entering the call and plays the intro
        automatic_audio_output: {
          in_call_recording: {
            data: {
              kind: "mp3",
              b64_data: greetingB64,
            },
          },
        },
        // Live text transcript only. InternFlow never requests or stores audio/video recordings.
        recording_config: {
          transcript: { provider: { recallai_streaming: { mode: "prioritize_low_latency", language_code: transcriptLanguage() } } },
          realtime_endpoints: [{ type: "webhook", url: webhookUrl, events: ["transcript.data"] }],
        },
        automatic_leave: {
          waiting_room_timeout: 600,
          noone_joined_timeout: 600,
          everyone_left_timeout: 60,
        },
      }),
    });
    if (!response.ok) throw safeProviderError(response.status);
    const created: unknown = await response.json();
    if (!created || typeof created !== "object" || !("id" in created)
      || typeof created.id !== "string" || !/^[a-f\d-]{36}$/i.test(created.id)) {
      throw new Error("Recall.ai returned an invalid bot identifier.");
    }
    return { status: "SCHEDULED", providerSessionId: created.id };
  },
  async cancelSession(providerSessionId): Promise<void> {
    if (!/^[a-f\d-]{36}$/i.test(providerSessionId)) throw new Error("Recall bot identifier is invalid.");
    const response = await recallRequest(`/api/v1/bot/${encodeURIComponent(providerSessionId)}/`, { method: "DELETE" });
    if (response.status === 204 || response.status === 404) return;
    throw safeProviderError(response.status);
  },
  async leaveSession(providerSessionId): Promise<void> {
    if (!/^[a-f\d-]{36}$/i.test(providerSessionId)) throw new Error("Recall bot identifier is invalid.");
    const response = await recallRequest(`/api/v1/bot/${encodeURIComponent(providerSessionId)}/leave_call/`, { method: "POST" });
    if (response.ok || response.status === 404 || response.status === 409) return;
    throw safeProviderError(response.status);
  },
};

const disabledProvider: MeetingAgentProvider = {
  name: "DISABLED",
  status: "DISABLED",
  async scheduleSession(): Promise<MeetingAgentScheduleResult> {
    return { status: "PENDING_INTEGRATION", reason: "No meeting-agent provider is enabled." };
  },
  async cancelSession(): Promise<void> {
    throw new MeetingAgentIntegrationPendingError();
  },
  async leaveSession(): Promise<void> {
    throw new MeetingAgentIntegrationPendingError();
  },
};

export function getMeetingAgentProvider(environment: Record<string, string | undefined> = process.env): MeetingAgentProvider {
  const configuration = meetingAgentConfiguration(environment);
  return configuration.provider === "RECALL" && configuration.integrationStatus === "READY"
    ? recallProvider
    : disabledProvider;
}

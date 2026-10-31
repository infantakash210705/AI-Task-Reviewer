import { after } from "next/server";
import { jsonError } from "@/lib/http";
import { meetingAgentConfiguration, verifyRealtimeToken } from "@/lib/automation/meeting-agent-provider";
import { parseTranscriptEvent } from "@/lib/automation/meeting-transcript";
import { recordTranscriptChunk, respondAfterPause } from "@/lib/automation/meeting-conversation";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY_BYTES = 64 * 1024;

/**
 * Recall posts live transcript chunks here (transcript.data). The URL carries an HMAC token for one meeting.
 * We answer 200 immediately and let the mentor reply in the background so Recall's delivery is never held up.
 */
export async function POST(request: Request) {
  if (meetingAgentConfiguration().provider !== "RECALL") return jsonError("Not enabled.", 404);
  const url = new URL(request.url);
  const meetingId = url.searchParams.get("m") || "";
  const token = url.searchParams.get("t") || "";

  console.info("[realtime-webhook] received POST", { meetingId: meetingId || "(missing)", hasToken: Boolean(token) });

  if (!/^[a-f\d]{24}$/i.test(meetingId) || !verifyRealtimeToken(meetingId, token)) {
    console.warn("[realtime-webhook] rejected: bad meetingId or token", { meetingId });
    return jsonError("Not authorized.", 401);
  }

  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return jsonError("Payload is too large.", 413);

  let body: unknown;
  let raw: string;
  try {
    raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return jsonError("Payload is too large.", 413);
    body = JSON.parse(raw);
  } catch {
    return jsonError("Invalid payload.", 400);
  }

  const chunk = parseTranscriptEvent(body, meetingId);
  if (!chunk || chunk.meetingId !== meetingId) {
    console.info("[realtime-webhook] non-transcript event or meetingId mismatch", {
      event: typeof body === "object" && body !== null && "event" in body ? String((body as Record<string, unknown>).event) : "unknown",
      chunkMeetingId: chunk?.meetingId,
      expectedMeetingId: meetingId,
    });
    return Response.json({ accepted: false }, { status: 202 });
  }

  console.info("[realtime-webhook] transcript chunk", { meetingId, speaker: chunk.speakerName, textLen: chunk.text.length, text: chunk.text.slice(0, 80) });

  try {
    const seq = await recordTranscriptChunk(chunk);
    if (seq !== null) {
      console.info("[realtime-webhook] queuing mentor reply", { meetingId, seq });
      after(async () => { await respondAfterPause(meetingId, seq); });
    } else {
      console.info("[realtime-webhook] chunk not recorded (bot speaker or meeting inactive)", { meetingId });
    }
    return Response.json({ accepted: seq !== null });
  } catch (err) {
    console.error("[meeting-agent] transcript chunk could not be saved", { meetingId, error: err instanceof Error ? err.message : String(err) });
    return jsonError("Temporarily unavailable.", 503);
  }
}

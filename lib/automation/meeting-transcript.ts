/** Pure helpers for Recall realtime transcript webhooks. */

export type TranscriptChunk = {
  botId: string;
  meetingId: string;
  speakerName: string;
  text: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Extracts a finished transcript chunk from a Recall `transcript.data` webhook body, or null if it is not one. */
export function parseTranscriptEvent(body: unknown, fallbackMeetingId?: string): TranscriptChunk | null {
  const root = asRecord(body);
  if (!root || root.event !== "transcript.data") return null;
  const outer = asRecord(root.data);
  const inner = asRecord(outer?.data);
  const bot = asRecord(outer?.bot);
  if (!inner || !bot || typeof bot.id !== "string") return null;
  const metadata = asRecord(bot.metadata);
  const meetingId = (typeof metadata?.internflow_meeting_id === "string" && metadata.internflow_meeting_id)
    || fallbackMeetingId
    || "";
  
  let rawText = typeof inner.text === "string" ? inner.text : "";
  if (!rawText && Array.isArray(inner.words)) {
    rawText = inner.words
      .map((word) => (asRecord(word) && typeof asRecord(word)!.text === "string" ? String(asRecord(word)!.text) : ""))
      .join(" ");
  }

  const text = rawText
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!text) return null;

  const participant = asRecord(inner.participant) || asRecord(outer?.participant);
  const speakerName = typeof participant?.name === "string"
    ? participant.name.trim().slice(0, 120)
    : typeof inner.speaker === "string"
      ? inner.speaker.trim().slice(0, 120)
      : "";
  return { botId: bot.id, meetingId, speakerName, text: text.slice(0, 2000) };
}

const BACKCHANNEL = /^(ok|okay|k|yes|yeah|yep|ya|yup|no|nope|hmm+|um+|uh+|ah+|oh|right|sure|fine|good|cool|thanks|thank you)[.!? ]*$/i;
const GREETING = /^(hello|hi|hey|good morning|good afternoon|good evening)[.!? ]*$/i;

/** True for tiny filler utterances the mentor should not answer with a full reply. */
export function isBackchannel(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.includes("?")) return false;
  if (GREETING.test(trimmed)) return false;
  return BACKCHANNEL.test(trimmed) || (trimmed.split(/\s+/).length < 2 && trimmed.length < 4);
}

export function isBotSpeaker(speakerName: string, botName: string): boolean {
  const speaker = speakerName.trim().toLowerCase();
  const bot = botName.trim().toLowerCase();
  return Boolean(speaker) && Boolean(bot) && (speaker === bot || (speaker.includes("shortfundly") && speaker.includes("mentor")));
}

/** Rough MP3 playback length at 48 kbps, used to avoid talking over the mentor's own audio. */
export function estimateMp3Seconds(bytes: number): number {
  return Math.max(1, Math.ceil((bytes * 8) / 48_000));
}

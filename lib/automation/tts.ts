import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { mentorLanguage, toSpokenText, type MentorLanguage } from "@/lib/automation/mentor-persona";

/**
 * Free neural text-to-speech using Microsoft Edge "Read Aloud" voices through the
 * msedge-tts package. No API key or billing needed. Note this is an unofficial
 * endpoint: keep TTS_PROVIDER=browser as an automatic fallback in the intern panel.
 */

const DEFAULT_VOICES: Record<MentorLanguage, string> = {
  en: "en-IN-PrabhatNeural",
  ta: "ta-IN-ValluvarNeural",
  hi: "hi-IN-MadhurNeural",
};

export class TtsError extends Error {
  constructor(message: string, readonly statusCode = 503) {
    super(message);
    this.name = "TtsError";
  }
}

export function ttsEnabled(): boolean {
  return (process.env.TTS_PROVIDER?.trim().toLowerCase() || "edge") === "edge";
}

export function voiceFor(language: MentorLanguage = mentorLanguage()): string {
  const override = process.env[`MENTOR_VOICE_${language.toUpperCase()}`]?.trim() || (language === "en" ? process.env.MENTOR_VOICE?.trim() : "");
  if (override && /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z]+Neural$/.test(override)) return override;
  return DEFAULT_VOICES[language];
}

export function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c] as string));
}

/** Returns an MP3 buffer (24 kHz, mono) for the given text. */
export async function synthesizeSpeech(rawText: string, language: MentorLanguage = mentorLanguage()): Promise<Buffer> {
  if (!ttsEnabled()) throw new TtsError("Server voice is turned off.", 503);
  const text = toSpokenText(rawText, 700);
  if (!text) throw new TtsError("There is nothing to say.", 400);
  const tts = new MsEdgeTTS({ connectionTimeoutMs: 10_000, synthesisTimeoutMs: 30_000 });
  try {
    await tts.setMetadata(voiceFor(language), OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(escapeXml(text), { rate: "-4%" });
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      audioStream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      audioStream.on("error", (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      audioStream.on("end", () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      audioStream.on("close", () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });
    });
    const audio = Buffer.concat(chunks);
    if (audio.length < 200) throw new TtsError("The voice service returned no audio.");
    return audio;
  } catch (error) {
    if (error instanceof TtsError) throw error;
    console.error("[tts] synthesizeSpeech failed:", error instanceof Error ? `${error.name}: ${error.message}\n${error.stack}` : String(error));
    throw new TtsError(`The voice service is unavailable right now. (${error instanceof Error ? error.message : "unknown error"})`);
  } finally {
    try { tts.close(); } catch { /* ignore */ }
  }
}

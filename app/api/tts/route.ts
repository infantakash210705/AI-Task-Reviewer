import { z } from "zod";
import { apiUser } from "@/lib/authz";
import { jsonError } from "@/lib/http";
import { mentorLanguage } from "@/lib/automation/mentor-persona";
import { synthesizeSpeech, TtsError, ttsEnabled } from "@/lib/automation/tts";

export const runtime = "nodejs";

const input = z.object({ text: z.string().trim().min(1).max(900) }).strict();
const hits = new Map<string, number[]>();

function limited(userId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) || []).filter((time) => now - time < 60_000);
  recent.push(now);
  hits.set(userId, recent);
  return recent.length > 30;
}

export async function GET() {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  return Response.json({ enabled: ttsEnabled() });
}

export async function POST(request: Request) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (!ttsEnabled()) return jsonError("Server voice is turned off.", 503);
  if (limited(String(auth.user._id))) return jsonError("Too many voice requests. Wait a moment.", 429);
  try {
    const { text } = input.parse(await request.json());
    const audio = await synthesizeSpeech(text, mentorLanguage());
    return new Response(new Uint8Array(audio), {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof TtsError) return jsonError(error.message, error.statusCode);
    if (error instanceof z.ZodError) return jsonError("Invalid voice request.", 400);
    return jsonError("The voice service is unavailable right now.", 503);
  }
}

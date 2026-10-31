"use client";

import { useRef, useState } from "react";

type SpeechResult = ArrayLike<{ transcript: string }> & { isFinal: boolean };
type SpeechRecognitionEventLike = { results: ArrayLike<SpeechResult> };
type SpeechRecognitionErrorLike = { error: string };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

type MentorMessage = { role: "USER" | "ASSISTANT"; content: string };

async function readApiResponse(response: Response, fallback: string): Promise<Record<string, unknown>> {
  const responseText = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(responseText);
  } catch {
    throw new Error(`${fallback} (HTTP ${response.status}). Please try again.`);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(fallback);
  }
  const result = body as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof result.error === "string" ? result.error : `${fallback} (HTTP ${response.status}).`);
  }
  return result;
}

export function VoiceMentorRoom({
  assignmentId,
  onMessage,
}: {
  assignmentId: string;
  onMessage: (message: MentorMessage) => void;
}) {
  const [consentChecked, setConsentChecked] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [status, setStatus] = useState<"IDLE" | "STARTING" | "LISTENING" | "THINKING" | "ENDING" | "EMAIL_FAILED" | "ENDED">("IDLE");
  const [error, setError] = useState("");
  const [nextMeeting, setNextMeeting] = useState<{ scheduledAt: string; timezone: string; url: string; reminderScheduled?: boolean } | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const shouldListenRef = useRef(false);
  const processingRef = useRef(false);
  const sessionIdRef = useRef("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function askMentor(message: string) {
    const normalized = message.trim();
    if (!normalized || !sessionIdRef.current || processingRef.current) return;
    processingRef.current = true;
    setStatus("THINKING");
    setError("");
    try {
      const response = await fetch(`/api/intern/assignments/${encodeURIComponent(assignmentId)}/mentor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: normalized, sessionId: sessionIdRef.current }),
      });
      const body = await readApiResponse(response, "Your mentor could not answer just now.");
      const answer = String(body.answer || "");
      onMessage({ role: "USER", content: normalized });
      onMessage({ role: "ASSISTANT", content: answer });
      await speak(answer);
    } catch (askError) {
      setError(askError instanceof Error ? askError.message : "Your mentor could not answer just now.");
      processingRef.current = false;
      if (shouldListenRef.current) startListening();
    }
  }

  function resumeListening() {
    processingRef.current = false;
    if (shouldListenRef.current) startListening();
  }

  function speakWithBrowser(answer: string) {
    if (!("speechSynthesis" in window) || !answer) return resumeListening();
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(answer);
    utterance.rate = 0.97;
    utterance.onend = resumeListening;
    utterance.onerror = resumeListening;
    window.speechSynthesis.speak(utterance);
  }

  async function speak(answer: string) {
    if (!answer) return resumeListening();
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: answer }),
      });
      if (!response.ok) return speakWithBrowser(answer);
      const url = URL.createObjectURL(await response.blob());
      const audio = new Audio(url);
      audioRef.current = audio;
      const done = () => { URL.revokeObjectURL(url); resumeListening(); };
      audio.onended = done;
      audio.onerror = done;
      await audio.play();
    } catch {
      speakWithBrowser(answer);
    }
  }

  function startListening() {
    if (!shouldListenRef.current || processingRef.current) return;
    const browserWindow = window as SpeechRecognitionWindow;
    const Constructor = browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition;
    if (!Constructor) {
      setError("Speech recognition is unavailable in this browser. Use the text question box instead.");
      setStatus("IDLE");
      return;
    }
    try {
      const recognition = recognitionRef.current || new Constructor();
      recognitionRef.current = recognition;
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-US";
      recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
          .filter((result) => result.isFinal)
          .map((result) => result[0]?.transcript || "")
          .join(" ")
          .trim();
        if (transcript) void askMentor(transcript);
      };
      recognition.onerror = (event) => {
        setError(event.error === "not-allowed"
          ? "Microphone permission was denied. Allow microphone access or use the text question box."
          : "Speech recognition stopped unexpectedly. Try the microphone again or use text.");
          setStatus("LISTENING");
        shouldListenRef.current = false;
      };
      recognition.onend = () => {
        if (shouldListenRef.current && !processingRef.current) {
          window.setTimeout(startListening, 250);
        }
      };
      recognition.start();
      setStatus("LISTENING");
    } catch {
      setError("Could not start microphone recognition. Check browser microphone permissions.");
      setStatus("LISTENING");
      shouldListenRef.current = false;
    }
  }

  async function startSession() {
    if (!consentChecked || status !== "IDLE") return;
    const browserWindow = window as SpeechRecognitionWindow;
    if (!browserWindow.SpeechRecognition && !browserWindow.webkitSpeechRecognition) {
      setError("Speech recognition is unavailable in this browser. Use Edge or Chrome, or continue with the text question box.");
      return;
    }
    setStatus("STARTING");
    setError("");
    try {
      const response = await fetch(`/api/intern/assignments/${encodeURIComponent(assignmentId)}/mentor/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "START", consent: true }),
      });
      const body = await readApiResponse(response, "The voice session could not be started.");
      if (typeof body.sessionId !== "string" || !body.sessionId) {
        throw new Error("The server did not return a valid voice session. Refresh and try again.");
      }
      sessionIdRef.current = body.sessionId;
      setSessionId(body.sessionId);
      shouldListenRef.current = true;
      startListening();
    } catch (startError) {
      setStatus("IDLE");
      setError(startError instanceof Error ? startError.message : "The voice session could not be started.");
    }
  }

  async function endSession() {
    if (!sessionIdRef.current || status === "ENDING") return;
    setStatus("ENDING");
    shouldListenRef.current = false;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    audioRef.current?.pause();
    processingRef.current = false;
    try {
      const response = await fetch(`/api/intern/assignments/${encodeURIComponent(assignmentId)}/mentor/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "END", sessionId }),
      });
      const body = await readApiResponse(response, "The session ended, but feedback could not be delivered.");
      setNextMeeting((body.nextMeeting as typeof nextMeeting) || null);
      setStatus("ENDED");
    } catch (endError) {
      setStatus("EMAIL_FAILED");
      setError(endError instanceof Error ? endError.message : "The feedback email could not be sent. Finish again to retry.");
    }
  }

  const active = ["LISTENING", "THINKING", "ENDING"].includes(status);
  return <section className="card" style={{ marginBottom: 16 }}>
    <div className="card-header">
      <div><div className="card-title">Voice session with your mentor</div><div className="subtle">Talk through your task out loud</div></div>
      <span className="badge">{status.replaceAll("_", " ")}</span>
    </div>
    <div className="card-body">
      <p className="subtle">Your session is led by Shortfundly&apos;s virtual mentor, and the voice you hear is generated. Your browser converts your speech to text, and that text is saved in your task history. We do not record or store audio or video.</p>
      {status === "IDLE" && <>
        <label style={{ display: "flex", gap: 9, alignItems: "flex-start", margin: "12px 0" }}>
          <input
            type="checkbox"
            checked={consentChecked}
            onChange={(event) => setConsentChecked(event.target.checked)}
            aria-label="Consent to speech-to-text for this session"
          />
          <span className="subtle">I agree to my browser turning my speech into text for this session, and to that text being used by the mentor.</span>
        </label>
        <button className="button button-primary" type="button" disabled={!consentChecked} onClick={() => void startSession()}>Start voice session</button>
      </>}
      {active && <div className="placeholder-row" style={{ marginTop: 12 }}>
        <span className="subtle">{status === "LISTENING" ? "Listening for your question…" : status === "THINKING" ? "Your mentor is thinking…" : "Ending session and sending feedback…"}</span>
        {status !== "ENDING" && <button className="button" type="button" onClick={() => void endSession()}>Finish session</button>}
      </div>}
      {status === "STARTING" && <p className="subtle" role="status">Starting the voice session…</p>}
      {status === "ENDED" && <div role="status">
        <p className="subtle">Session complete. Feedback email sent. The next review is scheduled.</p>
        {nextMeeting && <p><strong>Next review:</strong> {new Date(nextMeeting.scheduledAt).toLocaleString("en", { timeZone: nextMeeting.timezone, dateStyle: "full", timeStyle: "short" })} · {nextMeeting.timezone} · <a href={nextMeeting.url}>Open session</a></p>}
        {nextMeeting?.reminderScheduled === false && <p className="setup-note">The review is scheduled, but its automatic reminder could not be queued. Contact an administrator.</p>}
      </div>}
      {status === "EMAIL_FAILED" && <button className="button button-primary" type="button" onClick={() => void endSession()}>Retry feedback email</button>}
      {error && <p className="setup-note" role="alert">{error}</p>}
    </div>
  </section>;
}

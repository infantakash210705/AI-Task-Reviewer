"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { VoiceMentorRoom } from "@/components/voice-mentor-room";

type Explanation = {
  overview: string;
  problemStatement: string;
  whyItMatters: string;
  functionalRequirements: string[];
  technicalRequirements: string[];
  expectedDeliverables: string[];
  implementationGuidance: string[];
  suggestedApproach: string[];
  toolsAndTechnologies: string[];
  acceptanceCriteria: string[];
  commonMistakes: string[];
  clarificationQuestions: string[];
};

type Message = { role: "USER" | "ASSISTANT"; content: string };

export function MentorChat({ assignmentId, title }: { assignmentId: string; title: string }) {
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState("PROCESSING");
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(`/api/intern/assignments/${encodeURIComponent(assignmentId)}/mentor`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load your mentor.");
      setStatus(body.status);
      setExplanation(body.explanation);
      setMessages(body.messages || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load your mentor.");
    }
  }, [assignmentId]);

  useEffect(() => { void load(); }, [load]);

  async function retrySetup() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/intern/assignments/${encodeURIComponent(assignmentId)}/mentor/regenerate`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not retry task setup.");
      setStatus("PROCESSING");
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "Could not retry task setup.");
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = question.trim();
    if (!message || loading) return;
    setLoading(true);
    setError("");
    setMessages((current) => [...current, { role: "USER", content: message }]);
    setQuestion("");
    try {
      const response = await fetch(`/api/intern/assignments/${encodeURIComponent(assignmentId)}/mentor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The mentor could not answer. Try again.");
      setMessages((current) => [...current, { role: "ASSISTANT", content: body.answer }]);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "The mentor could not answer. Try again.");
      setMessages((current) => current.filter((item, index) => !(item.role === "USER" && index === current.length - 1 && item.content === message)));
      setQuestion(message);
    } finally {
      setLoading(false);
    }
  }

  function list(titleText: string, values: string[], required: boolean) {
    if (!values.length) return null;
    return <section className="mentor-section" key={titleText}>
      <h3>{titleText} <span className="badge">{required ? "From task brief" : "Suggestion"}</span></h3>
      <ul>{values.map((value, index) => <li key={`${titleText}-${index}`}>{value}</li>)}</ul>
    </section>;
  }

  return <div className="mentor-layout">
    <div style={{ gridColumn: "1 / -1" }}>
      <VoiceMentorRoom
        assignmentId={assignmentId}
        onMessage={(message) => setMessages((current) => [...current, message])}
      />
    </div>
    <section className="card">
      <div className="card-header"><div><div className="card-title">Task mentor</div><div className="subtle">{title}</div></div><span className="badge">{status.replaceAll("_", " ")}</span></div>
      {explanation ? <div className="card-body">
        <section className="mentor-section"><h3>Overview</h3><p>{explanation.overview}</p></section>
        <section className="mentor-section"><h3>Problem statement</h3><p>{explanation.problemStatement}</p></section>
        <section className="mentor-section"><h3>Why this matters</h3><p>{explanation.whyItMatters}</p></section>
        {list("Functional requirements", explanation.functionalRequirements, true)}
        {list("Technical requirements", explanation.technicalRequirements, true)}
        {list("Expected deliverables", explanation.expectedDeliverables, true)}
        {list("Acceptance criteria", explanation.acceptanceCriteria, true)}
        {list("Implementation guidance", explanation.implementationGuidance, false)}
        {list("Suggested approach", explanation.suggestedApproach, false)}
        {list("Tools and technologies", explanation.toolsAndTechnologies, false)}
        {list("Common mistakes to avoid", explanation.commonMistakes, false)}
        {list("Questions to clarify", explanation.clarificationQuestions, false)}
      </div> : <div className="card-body">
        <p className="subtle">{status === "FAILED" ? "The prepared explanation could not be generated yet. You can still ask questions using the saved task brief." : "Your prepared explanation is not ready yet. You can still ask questions using the saved task brief."}</p>
        {status === "FAILED" && <button className="button button-primary" type="button" disabled={loading} onClick={() => void retrySetup()}>{loading ? "Retrying…" : "Retry task setup"}</button>}
        <button className="button" type="button" onClick={() => void load()}>Refresh status</button>
      </div>}
    </section>
    <section className="card mentor-chat">
      <div className="card-header"><div className="card-title">Ask about this task</div></div>
      <div className="mentor-messages" aria-live="polite">
        {messages.length ? messages.map((message, index) => <div className={`mentor-message ${message.role === "USER" ? "mentor-message-user" : ""}`} key={`${index}-${message.role}`}><strong>{message.role === "USER" ? "You" : "Mentor"}</strong><p>{message.content}</p></div>) : <p className="subtle">Ask a question about this task, its requirements, or how to approach the work.</p>}
        {loading && <p className="subtle" role="status">The mentor is preparing a response…</p>}
      </div>
      {error && <div className="setup-note" role="alert">{error}</div>}
      <form onSubmit={submit} className="mentor-form">
        <label htmlFor="mentor-question">Your question</label>
        <textarea id="mentor-question" className="input" rows={3} maxLength={2000} value={question} onChange={(event) => setQuestion(event.target.value)} disabled={loading} placeholder="Ask for help with a requirement or implementation step" />
        <button className="button button-primary" type="submit" disabled={loading || !question.trim()}>{loading ? "Sending…" : "Ask mentor"}</button>
      </form>
      <p className="subtle mentor-disclaimer">This is Shortfundly&apos;s virtual mentor. Recommendations are suggestions; the task brief remains the source of required criteria.</p>
    </section>
  </div>;
}

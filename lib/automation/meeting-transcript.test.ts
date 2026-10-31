import { describe, expect, it } from "vitest";
import { estimateMp3Seconds, isBackchannel, isBotSpeaker, parseTranscriptEvent } from "@/lib/automation/meeting-transcript";

const event = (words: string[], name = "Priya") => ({
  event: "transcript.data",
  data: { data: { words: words.map((text) => ({ text })), participant: { id: 1, name } }, bot: { id: "123e4567-e89b-12d3-a456-426614174000", metadata: { internflow_meeting_id: "507f1f77bcf86cd799439011" } } },
});

describe("meeting transcript helpers", () => {
  it("parses a Recall transcript.data event", () => {
    expect(parseTranscriptEvent(event(["How", "do", "I", "paginate", "?"]))).toMatchObject({ text: "How do I paginate?", speakerName: "Priya", meetingId: "507f1f77bcf86cd799439011" });
  });
  it("ignores other events and empty text", () => {
    expect(parseTranscriptEvent({ event: "bot.status_change" })).toBeNull();
    expect(parseTranscriptEvent(event([]))).toBeNull();
    expect(parseTranscriptEvent("nope")).toBeNull();
  });
  it("skips filler but answers questions and greetings", () => {
    expect(isBackchannel("okay")).toBe(true);
    expect(isBackchannel("hmm.")).toBe(true);
    expect(isBackchannel("okay?")).toBe(false);
    expect(isBackchannel("hello")).toBe(false);
    expect(isBackchannel("hi")).toBe(false);
    expect(isBackchannel("good morning")).toBe(false);
    expect(isBackchannel("I don't understand the pagination part")).toBe(false);
  });
  it("recognises its own bot as a speaker", () => {
    expect(isBotSpeaker("Arjun | Shortfundly Virtual Mentor", "Arjun | Shortfundly Virtual Mentor")).toBe(true);
    expect(isBotSpeaker("Priya", "Arjun | Shortfundly Virtual Mentor")).toBe(false);
  });
  it("estimates audio length", () => {
    expect(estimateMp3Seconds(60_000)).toBe(10);
  });
});

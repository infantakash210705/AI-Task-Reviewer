import { describe, expect, it } from "vitest";
import { buildMentorSystemPrompt, identityReply, isIdentityQuestion, mentorLanguage, toSpokenText } from "@/lib/automation/mentor-persona";

describe("mentor persona", () => {
  it("detects sincere identity questions", () => {
    for (const q of ["are you an AI?", "Are you a bot", "am I talking to a real person?", "is this an AI?", "are you human", "who am I talking to?"]) {
      expect(isIdentityQuestion(q), q).toBe(true);
    }
    for (const q of ["How do I build the route?", "Can you explain the human readable title requirement?", "what is an AI model in the task?"]) {
      expect(isIdentityQuestion(q), q).toBe(false);
    }
  });
  it("never claims to be human in any language", () => {
    for (const language of ["en", "ta", "hi"] as const) {
      expect(identityReply(language)).toMatch(/AI/);
    }
  });
  it("defaults to English and supports Tamil and Hindi", () => {
    expect(mentorLanguage(undefined)).toBe("en");
    expect(mentorLanguage("ta")).toBe("ta");
    expect(mentorLanguage("HI")).toBe("hi");
    expect(mentorLanguage("fr")).toBe("en");
  });
  it("cleans markdown for speech", () => {
    const out = toSpokenText("## Plan\n1. Do **this**\n2. Then `that`\n\nSee [docs](https://x.y) e.g. now");
    expect(out).not.toMatch(/[#*`\[\]]/);
    expect(out).toContain("for example");
  });
  it("prompt forbids markdown and keeps the task scope and honesty rule", () => {
    const prompt = buildMentorSystemPrompt({ taskJson: "{}", explanationJson: "{}", mode: "spoken", language: "en", internName: "Priya Raman" });
    expect(prompt).toContain("Priya");
    expect(prompt).toContain("not personal questions");
    expect(prompt).toContain("Never claim to be a human");
    expect(prompt).toContain("two to four short sentences");
  });
});

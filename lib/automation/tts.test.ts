import { describe, expect, it } from "vitest";
import { escapeXml, voiceFor } from "@/lib/automation/tts";

describe("tts helpers", () => {
  it("escapes SSML-significant characters", () => {
    expect(escapeXml(`a < b & "c"`)).toBe("a &lt; b &amp; &quot;c&quot;");
  });
  it("picks a neural voice per language", () => {
    expect(voiceFor("en")).toMatch(/^en-IN-.*Neural$/);
    expect(voiceFor("ta")).toMatch(/^ta-IN-/);
    expect(voiceFor("hi")).toMatch(/^hi-IN-/);
  });
});

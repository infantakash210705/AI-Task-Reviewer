import { afterEach, describe, expect, it } from "vitest";
import { confirmedMeetUrl } from "@/lib/automation/calendar";
import { escapeHtml, sendEmail } from "@/lib/automation/email";
import { geminiModel, resolveGeminiModel, taskExplanationSchema, taskFingerprint, type TaskContext } from "@/lib/automation/explanation";

const smtpEnvironmentKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"];
const previousSmtpEnvironment = new Map<string, string | undefined>();
const previousGeminiModel = process.env.GEMINI_MODEL;

afterEach(() => {
  for (const key of smtpEnvironmentKeys) {
    const value = previousSmtpEnvironment.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  previousSmtpEnvironment.clear();
  if (previousGeminiModel === undefined) delete process.env.GEMINI_MODEL;
  else process.env.GEMINI_MODEL = previousGeminiModel;
});

const task: TaskContext = {
  title: "Create an inventory page",
  shortDescription: "Display inventory items.",
  fullDescription: "Build an inventory page with search.",
  difficulty: "BEGINNER",
  requiredSkills: ["React"],
  requirements: ["Search by item name"],
  acceptanceCriteria: ["Search results update"],
  expectedDeliverables: ["A responsive page"],
};

describe("automation helpers", () => {
  it("maps the retired Gemini default model to the current model consistently", () => {
    expect(resolveGeminiModel("gemini-2.5-flash")).toBe("gemini-3.8-flash");
    expect(resolveGeminiModel("custom-model")).toBe("custom-model");
    process.env.GEMINI_MODEL = "gemini-2.5-flash";
    expect(geminiModel()).toBe("gemini-3.8-flash");
  });

  it("accepts complete mentor content and rejects incomplete model output", () => {
    const content = {
      overview: "Build a searchable inventory page.",
      problemStatement: "Users need to find inventory.",
      whyItMatters: "Faster lookup.",
      functionalRequirements: ["Search items"],
      technicalRequirements: [],
      expectedDeliverables: ["A page"],
      implementationGuidance: ["Keep the layout responsive"],
      suggestedApproach: [],
      toolsAndTechnologies: [],
      acceptanceCriteria: ["Search results update"],
      commonMistakes: [],
      clarificationQuestions: [],
    };
    expect(taskExplanationSchema.safeParse(content).success).toBe(true);
    expect(taskExplanationSchema.safeParse({ ...content, overview: "" }).success).toBe(false);
  });

  it("fingerprints the exact task snapshot deterministically", () => {
    expect(taskFingerprint(task)).toBe(taskFingerprint({ ...task }));
    expect(taskFingerprint(task)).not.toBe(taskFingerprint({ ...task, title: "Different task" }));
  });

  it("escapes email template HTML", () => {
    expect(escapeHtml("&<>\"'")).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("returns a safe configuration error when SMTP credentials are missing", async () => {
    for (const key of smtpEnvironmentKeys) {
      previousSmtpEnvironment.set(key, process.env[key]);
      delete process.env[key];
    }

    const result = await sendEmail({
      to: "admin@example.com",
      subject: "SMTP test",
      text: "Test message",
      html: "<p>Test message</p>",
    });

    expect(result).toEqual({ success: false, error: "SMTP_USER is not configured." });
  });

  it("rejects invalid recipient addresses without attempting SMTP", async () => {
    const result = await sendEmail({
      to: "not-an-email",
      subject: "SMTP test",
      text: "Test message",
      html: "<p>Test message</p>",
    });

    expect(result).toEqual({ success: false, error: "The recipient or email content is invalid." });
  });

  it("accepts confirmed Google Meet URLs only on the exact HTTPS host", () => {
    expect(confirmedMeetUrl("https://meet.google.com/abc-defg-hij")).toBe("https://meet.google.com/abc-defg-hij");
    expect(confirmedMeetUrl("http://meet.google.com/abc-defg-hij")).toBeUndefined();
    expect(confirmedMeetUrl("https://meet.google.com.attacker.example/abc-defg-hij")).toBeUndefined();
    expect(confirmedMeetUrl("https://meet.google.com/")).toBeUndefined();
    expect(confirmedMeetUrl("meet.google.com/abc-defg-hij")).toBe("https://meet.google.com/abc-defg-hij");
    expect(confirmedMeetUrl("https://meet.google.com/abc-defg-hij?authuser=0")).toBe("https://meet.google.com/abc-defg-hij");
  });
});

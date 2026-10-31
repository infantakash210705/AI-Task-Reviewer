import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendAutomationEmail } = vi.hoisted(() => ({ sendAutomationEmail: vi.fn() }));

vi.mock("@/lib/automation/email", () => ({
  escapeHtml: (value: string) => value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] || character),
  sendAutomationEmail,
}));

vi.mock("@/lib/automation/calendar", () => ({
  confirmedMeetUrl: (value: string) => value.startsWith("https://meet.google.com/") ? value : undefined,
}));

import { sendReviewFeedbackEmail } from "@/lib/automation/email-templates";

describe("AI review feedback email", () => {
  beforeEach(() => {
    sendAutomationEmail.mockReset();
    process.env.APP_BASE_URL = "http://localhost:3000";
  });

  it("sends detailed criterion results, findings, fixes, and evidence to the intern", async () => {
    await sendReviewFeedbackEmail({
      assignmentId: "assignment-1",
      reviewId: "review-1",
      submissionId: "submission-1",
      internName: "Intern",
      internEmail: "intern@example.com",
      taskTitle: "Task",
      submissionVersion: 2,
      commitSha: "abc123",
      reviewDate: new Date("2026-10-23T00:00:00Z"),
      outcome: "REVISION_REQUIRED",
      summary: "The submission needs a small change.",
      blockers: ["A blocking issue"],
      requirementsAssessed: [{
        criterion: "Escape user-provided text",
        status: "FAIL",
        explanation: "The current output includes unescaped markup.",
        evidenceReferences: [{ filePath: "src/page.tsx", lineStart: 10, lineEnd: 12 }],
      }],
      findings: [{
        severity: "HIGH",
        category: "SECURITY",
        title: "Unescaped output",
        explanation: "User content is inserted as markup.",
        recommendedFix: "Escape the value before rendering.",
        evidenceReferences: [{ filePath: "src/page.tsx", lineStart: 10, lineEnd: 12 }],
      }],
      missingFeatures: ["Safe rendering"],
      recommendations: ["Add an output-escaping test."],
      reviewLimitations: ["Tests were not run."],
    });

    expect(sendAutomationEmail).toHaveBeenCalledOnce();
    const email = sendAutomationEmail.mock.calls[0][0];
    expect(email.recipient).toBe("intern@example.com");
    expect(email.templateType).toBe("AI_REVIEW_FEEDBACK");
    expect(email.text).toContain("[FAIL] Escape user-provided text");
    expect(email.text).toContain("src/page.tsx:10-12");
    expect(email.text).toContain("Recommended fix: Escape the value before rendering.");
    expect(email.text).toContain("Review limitations:");
    expect(email.html).toContain("Recommended fix:");
    expect(email.html).toContain("src/page.tsx:10-12");
  });

  it("HTML-escapes AI-generated content in the feedback email", async () => {
    await sendReviewFeedbackEmail({
      assignmentId: "assignment-1",
      reviewId: "review-2",
      submissionId: "submission-1",
      internName: "Intern",
      internEmail: "intern@example.com",
      taskTitle: "Task",
      submissionVersion: 1,
      commitSha: "",
      reviewDate: new Date("2026-10-23T00:00:00Z"),
      outcome: "NEEDS_CLARIFICATION",
      summary: "<script>alert(1)</script>",
      blockers: [],
      missingFeatures: [],
      recommendations: [],
    });

    expect(sendAutomationEmail.mock.calls[0][0].html).toContain("&lt;script&gt;");
    expect(sendAutomationEmail.mock.calls[0][0].html).not.toContain("<script>");
  });
});

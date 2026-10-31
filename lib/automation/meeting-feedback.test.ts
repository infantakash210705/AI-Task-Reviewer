import { describe, expect, it } from "vitest";
import { buildFeedbackSections } from "@/lib/automation/meeting-feedback";
import type { SubmissionReview } from "@/lib/automation/submission-review";

const task = { title: "T", shortDescription: "", fullDescription: "", difficulty: "BEGINNER", requiredSkills: [], requirements: [], acceptanceCriteria: ["Title is visible", "Email is validated"], expectedDeliverables: [] };

describe("meeting feedback sections", () => {
  it("splits a review into strengths, problems and next steps", () => {
    const review = {
      summary: "s", proposedOutcome: "REVISION_REQUIRED",
      requirementsAssessed: [
        { criterionId: "AC1", status: "PASS", explanation: "Heading renders.", evidenceReferences: [] },
        { criterionId: "AC2", status: "FAIL", explanation: "No validation found.", evidenceReferences: [] },
      ],
      findings: [
        { findingId: "F1", category: "BUG", severity: "LOW", title: "Typo", explanation: "x", relatedCriterionId: "", recommendedFix: "", blocksCompletion: false, evidenceReferences: [] },
        { findingId: "F2", category: "BUG", severity: "HIGH", title: "Crash on empty", explanation: "Throws.", relatedCriterionId: "", recommendedFix: "Guard it", blocksCompletion: true, evidenceReferences: [] },
      ],
      missingFeatures: ["Error state"], recommendations: ["Add tests"], suggestedNextActions: ["Add tests", "Fix validation"], reviewLimitations: [],
    } as SubmissionReview;
    const out = buildFeedbackSections(review, task);
    expect(out.strengths[0]).toContain("Heading renders.");
    expect(out.improvements[0]).toContain("not met");
    expect(out.improvements.findIndex((i) => i.startsWith("Crash"))).toBeLessThan(out.improvements.findIndex((i) => i.startsWith("Typo")));
    expect(out.improvements).toContain("Missing: Error state");
    expect(out.nextSteps).toEqual(["Add tests", "Fix validation"]);
  });
});

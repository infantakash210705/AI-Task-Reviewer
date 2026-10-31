import { describe, expect, it } from "vitest";
import { parseGitHubRepositoryUrl } from "@/lib/automation/github-repository";
import {
  reviewCriteria,
  validateReviewEvidence,
  type SubmissionReview,
} from "@/lib/automation/submission-review";
import type { TaskContext } from "@/lib/automation/explanation";

const task: TaskContext = {
  title: "Build a catalog",
  shortDescription: "Display items.",
  fullDescription: "Build a searchable catalog.",
  difficulty: "BEGINNER",
  requiredSkills: [],
  requirements: [],
  acceptanceCriteria: ["Users can search items."],
  expectedDeliverables: ["A responsive catalog page."],
};

function makeReview(status: "PASS" | "FAIL" = "PASS", reviewedTask: TaskContext = task): SubmissionReview {
  return {
    summary: "The submission was reviewed.",
    proposedOutcome: "PASS",
    requirementsAssessed: reviewCriteria(reviewedTask).map((criterion) => ({
      criterionId: criterion.criterionId,
      status: criterion.kind === "DELIVERABLE" ? status : "PASS",
      explanation: "The repository evidence supports this result.",
      evidenceReferences: [{ filePath: "src/catalog.ts", lineStart: 1, lineEnd: 2 }],
    })),
    findings: [],
    missingFeatures: [],
    recommendations: [],
    suggestedNextActions: [],
    reviewLimitations: [],
  };
}

describe("automated submission review validation", () => {
  it("parses only canonical HTTPS GitHub repository URLs", () => {
    expect(parseGitHubRepositoryUrl("https://github.com/acme/catalog.git")).toEqual({
      owner: "acme",
      repository: "catalog",
      canonicalUrl: "https://github.com/acme/catalog",
    });
    expect(() => parseGitHubRepositoryUrl("https://github.com.attacker.example/acme/catalog")).toThrow();
    expect(() => parseGitHubRepositoryUrl("https://github.com/acme/catalog/issues")).toThrow();
  });

  it("requires exact criterion coverage and blocks completion when any deliverable fails", () => {
    const verified = validateReviewEvidence(makeReview("FAIL"), [
      { path: "src/catalog.ts", content: "export function search() {\n  return [];\n}" },
    ], reviewCriteria(task));

    expect(verified.outcome).toBe("REVISION_REQUIRED");
    expect(verified.completionEligible).toBe(false);
    expect(verified.requirementsAssessed[1].criterion).toBe(task.expectedDeliverables[0]);
    expect(verified.requirementsAssessed[0].evidenceReferences[0].excerpt).toBe("export function search() {\n  return [];");
  });

  it("rejects missing criterion assessments and evidence outside the pinned source snapshot", () => {
    const review = makeReview();
    review.requirementsAssessed.pop();
    expect(() => validateReviewEvidence(review, [], reviewCriteria(task))).toThrow(/each assigned/);

    const invalidEvidence = makeReview();
    invalidEvidence.requirementsAssessed[0].evidenceReferences[0].lineEnd = 99;
    expect(() => validateReviewEvidence(invalidEvidence, [
      { path: "src/catalog.ts", content: "only one line" },
    ], reviewCriteria(task))).toThrow(/outside the retrieved/);
  });

  it("does not permit completion when the task has no acceptance criteria", () => {
    const noCriteria = { ...task, acceptanceCriteria: [], expectedDeliverables: ["A catalog page."] };
    const result = validateReviewEvidence(makeReview("PASS", noCriteria), [
      { path: "src/catalog.ts", content: "line one\nline two" },
    ], reviewCriteria(noCriteria));

    expect(result.outcome).toBe("NEEDS_CLARIFICATION");
    expect(result.completionEligible).toBe(false);
  });
});

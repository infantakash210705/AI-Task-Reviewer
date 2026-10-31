import { describe, expect, it } from "vitest";
import { assignmentInput, submissionInput, taskInput } from "@/lib/validation";

describe("Phase 1 request validation", () => {
  it("requires a valid task brief and bounds its duration", () => {
    const valid = taskInput.safeParse({
      title: "Build a task tracker", shortDescription: "A concise task", fullDescription: "Description",
      category: "Engineering", difficulty: "BEGINNER", estimatedDuration: 10, status: "DRAFT",
    });
    expect(valid.success).toBe(true);
    expect(taskInput.safeParse({
      title: "x", shortDescription: "x", fullDescription: "x", category: "x",
      difficulty: "BEGINNER", estimatedDuration: 0,
    }).success).toBe(false);
  });

  it("rejects invalid object IDs in assignment creation", () => {
    expect(assignmentInput.safeParse({ internId: "invalid", taskId: "also-invalid", dueDate: "2026-12-01" }).success).toBe(false);
  });

  it("requires HTTPS submission URLs for the selected submission type", () => {
    expect(submissionInput.safeParse({ assignmentId: "507f1f77bcf86cd799439011", submissionType: "REPOSITORY_URL", repositoryUrl: "http://example.com" }).success).toBe(false);
    expect(submissionInput.safeParse({ assignmentId: "507f1f77bcf86cd799439011", submissionType: "PROJECT_URL", projectUrl: "https://example.com" }).success).toBe(true);
    expect(submissionInput.safeParse({ assignmentId: "507f1f77bcf86cd799439011", submissionType: "REPOSITORY_URL", repositoryUrl: "https://github.com.attacker.example/owner/repo" }).success).toBe(false);
    expect(submissionInput.safeParse({ assignmentId: "507f1f77bcf86cd799439011", submissionType: "REPOSITORY_URL", repositoryUrl: "https://github.com/owner/repo" }).success).toBe(true);
  });
});

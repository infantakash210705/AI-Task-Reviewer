import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
const list = z.array(z.string().trim().min(1).max(500)).max(30).default([]);

export const taskInput = z.object({
  title: text(160),
  shortDescription: text(300),
  fullDescription: text(10000),
  category: text(80),
  difficulty: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]),
  requiredSkills: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  requirements: list,
  acceptanceCriteria: list,
  expectedDeliverables: list,
  estimatedDuration: z.coerce.number().int().min(1).max(365),
  status: z.enum(["DRAFT", "ACTIVE"]).default("DRAFT"),
});

export const internInput = z.object({
  userId: z.string().regex(/^[a-f\d]{24}$/i),
  internCode: text(32).regex(/^[A-Za-z0-9-]+$/),
  department: text(100),
  internshipTitle: text(120),
  startDate: z.coerce.date(),
  expectedEndDate: z.coerce.date(),
  phone: z.string().trim().max(30).optional().default(""),
}).refine((value) => value.expectedEndDate >= value.startDate, { path: ["expectedEndDate"], message: "End date must be on or after the start date." });

export const assignmentInput = z.object({
  internId: z.string().regex(/^[a-f\d]{24}$/i),
  taskId: z.string().regex(/^[a-f\d]{24}$/i),
  dueDate: z.coerce.date(),
});

export const progressInput = z.object({
  progress: z.coerce.number().int().min(0).max(99),
});

const safeHttpsUrl = z.string().trim().url().max(2048).refine((value) => new URL(value).protocol === "https:", "Use a valid HTTPS URL.");
const githubRepositoryUrl = safeHttpsUrl.refine((value) => {
  const url = new URL(value);
  const parts = url.pathname.split("/").filter(Boolean);
  const repository = parts[1]?.replace(/\.git$/i, "");
  return url.hostname === "github.com" && !url.username && !url.password && !url.port && !url.search && !url.hash
    && parts.length === 2
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(parts[0])
    && /^[A-Za-z0-9_.-]{1,100}$/.test(repository || "")
    && repository !== "." && repository !== "..";
}, "Use a GitHub repository URL in the format https://github.com/owner/repository.");
export const uploadedFileReferenceSchema = z.object({
  storageKey: z.string().trim().min(1).max(500),
  filename: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1).max(120),
  size: z.number().int().min(1).max(25 * 1024 * 1024),
});

export const submissionInput = z.object({
  assignmentId: z.string().regex(/^[a-f\d]{24}$/i),
  submissionType: z.enum(["REPOSITORY_URL", "PROJECT_URL", "FILE_UPLOAD", "COMBINED"]).default("REPOSITORY_URL"),
  repositoryUrl: githubRepositoryUrl.optional(),
  projectUrl: safeHttpsUrl.optional(),
  uploadedFileReferences: z.array(uploadedFileReferenceSchema).max(10).optional().default([]),
  description: z.string().trim().max(3000).default(""),
}).superRefine((value, ctx) => {
  const hasRepo = Boolean(value.repositoryUrl);
  const hasFiles = Boolean(value.uploadedFileReferences && value.uploadedFileReferences.length > 0);

  if (value.submissionType === "REPOSITORY_URL" && !hasRepo) {
    ctx.addIssue({ code: "custom", path: ["repositoryUrl"], message: "Repository URL is required." });
  } else if (value.submissionType === "PROJECT_URL" && !value.projectUrl) {
    ctx.addIssue({ code: "custom", path: ["projectUrl"], message: "Project URL is required." });
  } else if (value.submissionType === "FILE_UPLOAD" && !hasFiles) {
    ctx.addIssue({ code: "custom", path: ["uploadedFileReferences"], message: "At least one uploaded file is required." });
  } else if (value.submissionType === "COMBINED" && !hasRepo && !hasFiles) {
    ctx.addIssue({ code: "custom", path: ["repositoryUrl"], message: "Provide either a repository URL, uploaded files, or both." });
  } else if (!hasRepo && !hasFiles && !value.projectUrl) {
    ctx.addIssue({ code: "custom", path: ["repositoryUrl"], message: "Provide a repository URL, uploaded files, or both." });
  }
});

export const reviewInput = z.object({
  assignmentId: z.string().regex(/^[a-f\d]{24}$/i),
  submissionId: z.string().regex(/^[a-f\d]{24}$/i),
  summary: text(2000),
  findings: list,
  recommendations: list,
  result: z.enum(["APPROVED", "REVISION_REQUIRED", "IN_REVIEW"]),
});

export const assignmentStatusInput = z.object({
  status: z.enum(["ASSIGNED", "IN_PROGRESS", "SUBMITTED", "IN_REVIEW", "REVISION_REQUIRED", "COMPLETED"]),
});

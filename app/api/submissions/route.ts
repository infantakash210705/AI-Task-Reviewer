import { apiUser } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { Assignment, Intern, Submission } from "@/lib/models";
import { handleApiError, jsonError } from "@/lib/http";
import { submissionInput } from "@/lib/validation";
import { startSubmissionReview } from "@/lib/automation/submission-workflow";
import { fetchPublicGitHubRepositoryMetadata, GitHubRepositoryError } from "@/lib/automation/github-repository";

export async function GET(request: Request) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit")) || 20));
    const filter: Record<string, unknown> = {};
    if (auth.user.role === "INTERN") {
      const intern = await Intern.findOne({ userId: auth.user._id, status: { $ne: "INACTIVE" } }).select("_id").lean();
      if (!intern) return Response.json({ items: [], page, limit, total: 0, pages: 0 });
      filter.internId = intern._id;
    } else if (searchParams.get("assignmentId")) filter.assignmentId = searchParams.get("assignmentId");
    const [items, total] = await Promise.all([
      Submission.find(filter).populate({ path: "assignmentId", select: "status dueDate", populate: { path: "taskId", select: "title" } })
        .populate({ path: "internId", populate: { path: "userId", select: "name email" } })
        .sort({ submittedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Submission.countDocuments(filter),
    ]);
    return Response.json({ items, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (error) { return handleApiError(error, "submissions.list"); }
}

export async function POST(request: Request) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "INTERN") return jsonError("Intern access required.", 403);
  try {
    await connectDB();
    const input = submissionInput.parse(await request.json());
    const intern = await Intern.findOne({ userId: auth.user._id, status: "ACTIVE" }).select("_id").lean();
    if (!intern) return jsonError("An active intern profile is required before submitting work.", 403);
    const assignment = await Assignment.findOne({ _id: input.assignmentId, internId: intern._id });
    if (!assignment) return jsonError("Assignment not found.", 404);
    if (assignment.status === "COMPLETED") return jsonError("Completed assignments cannot accept new submissions.", 409);
    const hasRepo = Boolean(input.repositoryUrl);
    const hasFiles = Boolean(input.uploadedFileReferences && input.uploadedFileReferences.length > 0);
    if (!hasRepo && !hasFiles) {
      return jsonError("Submit a GitHub repository URL, upload report files, or provide both.", 400);
    }

    const recentSubmissionCount = await Submission.countDocuments({
      internId: intern._id,
      submittedAt: { $gte: new Date(Date.now() - 10 * 60_000) },
    });
    if (recentSubmissionCount >= 5) return jsonError("Submission review is rate limited. Please wait before submitting another version.", 429);

    let repository = undefined;
    if (hasRepo && input.repositoryUrl) {
      repository = await fetchPublicGitHubRepositoryMetadata(input.repositoryUrl);
    }

    const resolvedSubmissionType = hasRepo && hasFiles ? "FILE_UPLOAD" : hasFiles ? "FILE_UPLOAD" : "REPOSITORY_URL";
    const version = (await Submission.findOne({ assignmentId: assignment._id }).sort({ version: -1 }).select("version").lean())?.version || 0;
    const submission = await Submission.create({
      assignmentId: assignment._id,
      internId: intern._id,
      submissionType: resolvedSubmissionType,
      ...(repository ? {
        repositoryUrl: repository.repositoryUrl,
        repositoryMetadata: repository,
      } : {}),
      uploadedFileReferences: input.uploadedFileReferences || [],
      version: version + 1,
      description: input.description,
      status: "SUBMITTED",
      processingStatus: "QUEUED",
      analysisStatus: "PENDING",
    });
    assignment.currentSubmissionId = submission._id;
    assignment.status = "SUBMITTED";
    assignment.completionStatus = "IN_PROGRESS";
    assignment.lastReviewError = "";
    await assignment.save();
    try {
      await startSubmissionReview(String(submission._id));
      return Response.json({ item: submission, processingStatus: "QUEUED" }, { status: 202 });
    } catch {
      const message = "Automated review could not be queued. An administrator can retry the submission.";
      await Promise.all([
        Submission.updateOne({ _id: submission._id }, { $set: { processingStatus: "FAILED", errorSummary: message } }),
        Assignment.updateOne({ _id: assignment._id, currentSubmissionId: submission._id }, { $set: { lastReviewError: message } }),
      ]);
      return Response.json({ item: submission, processingStatus: "FAILED", message: "Submission saved, but automated review could not be queued. Contact an administrator for a retry." }, { status: 202 });
    }
  } catch (error) {
    if (error instanceof GitHubRepositoryError) return jsonError(error.message, error.statusCode);
    return handleApiError(error, "submissions.create");
  }
}

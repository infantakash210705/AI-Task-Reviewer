import { apiUser } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { Assignment, Intern, Review, Submission } from "@/lib/models";
import { handleApiError, jsonError } from "@/lib/http";
import { reviewInput } from "@/lib/validation";

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
      filter.assignmentId = { $in: await Assignment.distinct("_id", { internId: intern._id }) };
    }
    if (searchParams.get("assignmentId") && auth.user.role === "ADMIN") filter.assignmentId = searchParams.get("assignmentId");
    const [items, total] = await Promise.all([
      Review.find(filter).populate("submissionId", "version submittedAt status").populate({ path: "assignmentId", select: "status", populate: { path: "taskId", select: "title" } })
        .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Review.countDocuments(filter),
    ]);
    return Response.json({ items, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (error) { return handleApiError(error, "reviews.list"); }
}

export async function POST(request: Request) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "ADMIN") return jsonError("Administrator access required.", 403);
  try {
    await connectDB();
    const input = reviewInput.parse(await request.json());
    if (input.result === "APPROVED") return jsonError("Human review records cannot complete an assignment without criterion-level completion evidence.", 409);
    const submission = await Submission.findOne({ _id: input.submissionId, assignmentId: input.assignmentId });
    if (!submission) return jsonError("Submission does not belong to this assignment.", 400);
    const assignment = await Assignment.findById(input.assignmentId);
    if (!assignment) return jsonError("Assignment not found.", 404);
    if (["COMPLETED", "ASSIGNED", "REVISION_REQUIRED"].includes(assignment.status)) return jsonError("A review can only be added to a submitted or in-review assignment.", 409);
    const isCurrentSubmission = !assignment.currentSubmissionId || String(assignment.currentSubmissionId) === String(submission._id);
    const review = await Review.create({ ...input, reviewerType: "HUMAN" });
    submission.status = input.result;
    await submission.save();
    if (isCurrentSubmission) {
      if (input.result === "REVISION_REQUIRED") {
        assignment.status = "REVISION_REQUIRED";
      } else if (assignment.status === "SUBMITTED") {
        assignment.status = "IN_REVIEW";
      }
      assignment.latestReviewId = review._id;
      assignment.lastReviewAt = new Date();
      await assignment.save();
    }
    return Response.json({ item: review }, { status: 201 });
  } catch (error) { return handleApiError(error, "reviews.create"); }
}

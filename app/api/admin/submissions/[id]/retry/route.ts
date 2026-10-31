import mongoose from "mongoose";
import { apiUser } from "@/lib/authz";
import { retrySubmissionReview } from "@/lib/automation/submission-workflow";
import { connectDB } from "@/lib/db";
import { handleApiError, jsonError } from "@/lib/http";
import { Submission } from "@/lib/models";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "ADMIN") return jsonError("Administrator access required.", 403);
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return jsonError("Submission not found.", 404);
  try {
    await connectDB();
    const exists = await Submission.exists({ _id: id });
    if (!exists) return jsonError("Submission not found.", 404);
    await retrySubmissionReview(id);
    return Response.json({ status: "QUEUED" }, { status: 202 });
  } catch (error) {
    return handleApiError(error, "submissions.retry");
  }
}

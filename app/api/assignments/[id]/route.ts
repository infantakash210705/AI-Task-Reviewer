import mongoose from "mongoose";
import { apiUser } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { Assignment, Intern } from "@/lib/models";
import { handleApiError, jsonError } from "@/lib/http";
import { assignmentStatusInput } from "@/lib/validation";

const allowed: Record<string, string[]> = {
  ASSIGNED: ["IN_PROGRESS"],
  IN_PROGRESS: ["SUBMITTED"],
  SUBMITTED: ["IN_REVIEW", "REVISION_REQUIRED"],
  IN_REVIEW: ["REVISION_REQUIRED"],
  REVISION_REQUIRED: ["IN_PROGRESS", "SUBMITTED"],
  COMPLETED: [],
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (!mongoose.isValidObjectId(id)) return jsonError("Assignment not found.", 404);
  try {
    await connectDB();
    const assignment = await Assignment.findById(id).populate("taskId").populate({ path: "internId", populate: { path: "userId", select: "name email" } }).lean();
    if (!assignment) return jsonError("Assignment not found.", 404);
    if (auth.user.role !== "ADMIN") {
      const intern = await Intern.findOne({ userId: auth.user._id, status: { $ne: "INACTIVE" } }).select("_id").lean();
      if (!intern || String(assignment.internId?._id) !== String(intern._id)) return jsonError("Assignment not found.", 404);
    }
    return Response.json({ item: assignment });
  } catch (error) { return handleApiError(error, "assignments.get"); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "ADMIN") return jsonError("Administrator access required.", 403);
  if (!mongoose.isValidObjectId(id)) return jsonError("Assignment not found.", 404);
  try {
    await connectDB();
    const { status } = assignmentStatusInput.parse(await request.json());
    if (status === "COMPLETED") return jsonError("Assignments are completed only after a review verifies every required acceptance criterion.", 409);
    const assignment = await Assignment.findById(id);
    if (!assignment) return jsonError("Assignment not found.", 404);
    if (!allowed[assignment.status]?.includes(status)) return jsonError(`Cannot change status from ${assignment.status} to ${status}.`, 409);
    assignment.status = status;
    if (status === "IN_PROGRESS" && assignment.progress === 0) assignment.progress = 1;
    await assignment.save();
    return Response.json({ item: assignment });
  } catch (error) { return handleApiError(error, "assignments.update"); }
}

import mongoose from "mongoose";
import { apiUser } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { Assignment, Intern } from "@/lib/models";
import { handleApiError, jsonError } from "@/lib/http";
import { progressInput } from "@/lib/validation";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "INTERN") return jsonError("Intern access required.", 403);
  if (!mongoose.isValidObjectId(id)) return jsonError("Assignment not found.", 404);
  try {
    await connectDB();
    const { progress } = progressInput.parse(await request.json());
    const intern = await Intern.findOne({ userId: auth.user._id, status: { $ne: "INACTIVE" } }).select("_id").lean();
    if (!intern) return jsonError("Complete your intern profile before updating progress.", 403);
    const assignment = await Assignment.findOne({ _id: id, internId: intern._id });
    if (!assignment) return jsonError("Assignment not found.", 404);
    if (assignment.status === "COMPLETED") return jsonError("Completed assignments cannot be changed.", 409);
    assignment.progress = progress;
    if (progress > 0 && assignment.status === "ASSIGNED") assignment.status = "IN_PROGRESS";
    await assignment.save();
    return Response.json({ item: assignment });
  } catch (error) { return handleApiError(error, "assignments.progress"); }
}

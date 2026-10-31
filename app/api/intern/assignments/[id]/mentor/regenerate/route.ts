import mongoose from "mongoose";
import { apiUser } from "@/lib/authz";
import { startAssignmentAutomation } from "@/lib/automation/assignment-workflow";
import { connectDB } from "@/lib/db";
import { Assignment, AutomationRun, Intern } from "@/lib/models";
import { handleApiError, jsonError } from "@/lib/http";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "INTERN") return jsonError("Intern access required.", 403);
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return jsonError("Assignment not found.", 404);
  try {
    await connectDB();
    const intern = await Intern.findOne({ userId: auth.user._id, status: "ACTIVE" }).select("_id").lean();
    const assignment = intern ? await Assignment.findOne({ _id: id, internId: intern._id }) : null;
    if (!assignment) return jsonError("Assignment not found.", 404);
    if (assignment.status === "COMPLETED") return jsonError("Completed assignments cannot be restarted.", 409);
    if (assignment.automationStatus !== "FAILED" && assignment.explanationStatus !== "FAILED") {
      return jsonError("Task setup can only be retried after an automation failure.", 409);
    }
    try {
      await startAssignmentAutomation(id);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Could not queue a task setup retry.";
      await Promise.all([
        Assignment.updateOne({ _id: id }, { $set: { automationStatus: "FAILED", lastAutomationError: message } }),
        AutomationRun.updateOne({ assignmentId: id }, { $set: { status: "FAILED", lastError: message, completedAt: new Date() } }),
      ]);
      return jsonError("The setup retry could not be queued. Please try again later.", 503);
    }
    return Response.json({ status: "PENDING" }, { status: 202 });
  } catch (error) {
    return handleApiError(error, "mentor.retry");
  }
}

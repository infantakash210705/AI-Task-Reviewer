import { apiUser } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { Assignment, AutomationRun, Intern, Task } from "@/lib/models";
import { handleApiError, jsonError } from "@/lib/http";
import { assignmentInput } from "@/lib/validation";
import { startAssignmentAutomation } from "@/lib/automation/assignment-workflow";

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
    } else {
      if (searchParams.get("internId")) filter.internId = searchParams.get("internId");
      if (["ASSIGNED", "IN_PROGRESS", "SUBMITTED", "IN_REVIEW", "REVISION_REQUIRED", "COMPLETED"].includes(searchParams.get("status") || "")) filter.status = searchParams.get("status");
    }
    if (searchParams.get("taskId")) filter.taskId = searchParams.get("taskId");
    const [items, total] = await Promise.all([
      Assignment.find(filter).populate({ path: "taskId", select: "title shortDescription category difficulty requirements acceptanceCriteria expectedDeliverables" })
        .populate({ path: "internId", populate: { path: "userId", select: "name email image" } })
        .sort({ dueDate: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      Assignment.countDocuments(filter),
    ]);
    return Response.json({ items, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (error) { return handleApiError(error, "assignments.list"); }
}

export async function POST(request: Request) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "ADMIN") return jsonError("Administrator access required.", 403);
  try {
    await connectDB();
    const input = assignmentInput.parse(await request.json());
    const [intern, task] = await Promise.all([
      Intern.findOne({ _id: input.internId, status: "ACTIVE" }).select("_id"),
      Task.findOne({ _id: input.taskId, status: "ACTIVE" }),
    ]);
    if (!intern) return jsonError("Select an active intern.", 400);
    if (!task) return jsonError("Select an active task.", 400);
    const duplicate = await Assignment.exists({ internId: intern._id, taskId: task._id, status: { $ne: "COMPLETED" } });
    if (duplicate) return jsonError("This intern already has an open assignment for the selected task.", 409);
    const assignment = await Assignment.create({
      ...input, internId: intern._id, taskId: task._id, assignedBy: auth.user._id,
      taskSnapshot: {
        title: task.title, shortDescription: task.shortDescription, fullDescription: task.fullDescription,
        category: task.category, difficulty: task.difficulty, requiredSkills: task.requiredSkills,
        requirements: task.requirements, acceptanceCriteria: task.acceptanceCriteria,
        expectedDeliverables: task.expectedDeliverables, estimatedDuration: task.estimatedDuration,
        revision: task.revision || 1,
      },
    });
    try {
      await startAssignmentAutomation(String(assignment._id));
    } catch (automationError) {
      const message = automationError instanceof Error ? automationError.message.slice(0, 500) : "Could not start assignment automation.";
      await Promise.all([
        Assignment.updateOne({ _id: assignment._id }, { $set: { automationStatus: "FAILED", lastAutomationError: message } }),
        AutomationRun.updateOne({ assignmentId: assignment._id }, { $set: { status: "FAILED", lastError: message, completedAt: new Date() } }),
      ]);
      console.error("[assignments.create] assignment saved but automation could not be queued.", automationError);
      return Response.json({ item: assignment, automationStatus: "FAILED", automationMessage: "Assignment saved, but its automated setup could not be queued. An administrator can retry it." }, { status: 201 });
    }
    return Response.json({ item: assignment, automationStatus: "PENDING" }, { status: 201 });
  } catch (error) { return handleApiError(error, "assignments.create"); }
}

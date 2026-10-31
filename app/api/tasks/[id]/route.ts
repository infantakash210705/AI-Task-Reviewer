import { apiUser } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { Task } from "@/lib/models";
import { handleApiError, jsonError } from "@/lib/http";
import { taskInput } from "@/lib/validation";
import mongoose from "mongoose";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (!mongoose.isValidObjectId(id)) return jsonError("Task not found.", 404);
  try {
    await connectDB();
    const task = await Task.findById(id).lean();
    if (!task || (auth.user.role !== "ADMIN" && task.status !== "ACTIVE")) return jsonError("Task not found.", 404);
    return Response.json({ item: task });
  } catch (error) { return handleApiError(error, "tasks.get"); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "ADMIN") return jsonError("Administrator access required.", 403);
  if (!mongoose.isValidObjectId(id)) return jsonError("Task not found.", 404);
  try {
    await connectDB();
    const raw = await request.json() as Record<string, unknown>;
    const existing = await Task.findById(id);
    if (!existing) return jsonError("Task not found.", 404);
    if (raw.status === "ARCHIVED" && Object.keys(raw).length === 1) {
      existing.status = "ARCHIVED";
      await existing.save();
      return Response.json({ item: existing });
    }
    const parsed = taskInput.parse(raw);
    existing.set(parsed);
    existing.revision = (existing.revision || 1) + 1;
    await existing.save();
    return Response.json({ item: existing });
  } catch (error) { return handleApiError(error, "tasks.update"); }
}

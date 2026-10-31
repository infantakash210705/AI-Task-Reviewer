import mongoose from "mongoose";
import { apiUser } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { handleApiError, jsonError } from "@/lib/http";
import { Meeting } from "@/lib/models";
import { inngest } from "@/lib/inngest/client";

/** Re-runs the post-meeting repository analysis and feedback email for a meeting whose feedback failed. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "ADMIN") return jsonError("Administrator access required.", 403);
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return jsonError("Meeting not found.", 404);
  try {
    await connectDB();
    const meeting = await Meeting.findOne({ _id: id, meetingType: "DOUBT_CLARIFICATION", agentStatus: "COMPLETED" }).select("feedbackStatus").lean();
    if (!meeting) return jsonError("Feedback can only be sent for a completed clarification meeting.", 404);
    if (meeting.feedbackStatus === "SENT") return jsonError("Feedback was already sent for this meeting.", 409);
    await Meeting.updateOne({ _id: id }, { $set: { feedbackStatus: "FAILED" } });
    await inngest.send({ id: `${id}:feedback-retry:${Date.now()}`, name: "internflow/meeting.ended", data: { meetingId: id } });
    return Response.json({ status: "QUEUED" }, { status: 202 });
  } catch (error) {
    return handleApiError(error, "admin.meeting.feedback-retry");
  }
}

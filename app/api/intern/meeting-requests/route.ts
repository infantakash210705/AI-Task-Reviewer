import mongoose from "mongoose";
import { z } from "zod";
import { apiUser } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { handleApiError, jsonError } from "@/lib/http";
import { Assignment, Intern, MeetingRequest, User } from "@/lib/models";
import { MEETING_AGENT_CONSENT_POLICY_VERSION } from "@/lib/automation/meeting-agent-provider";
import { sendMeetingRequestAdminEmail } from "@/lib/automation/email-meetings";

const createInput = z.object({
  assignmentId: z.string().regex(/^[a-f\d]{24}$/i),
  topic: z.string().trim().min(10, "Tell us a little more about what you need help with.").max(1500),
  proposedTimes: z.array(z.coerce.date()).max(3).default([]),
  consent: z.literal(true, { message: "Please accept the session notice to continue." }),
}).strict();

export async function GET(request: Request) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "INTERN") return jsonError("Intern access required.", 403);
  try {
    await connectDB();
    const assignmentId = new URL(request.url).searchParams.get("assignmentId");
    const filter: Record<string, unknown> = { userId: auth.user._id };
    if (assignmentId) {
      if (!mongoose.isValidObjectId(assignmentId)) return jsonError("Assignment not found.", 404);
      filter.assignmentId = assignmentId;
    }
    const items = await MeetingRequest.find(filter).sort({ createdAt: -1 }).limit(30).lean();
    return Response.json({ items: JSON.parse(JSON.stringify(items)) });
  } catch (error) {
    return handleApiError(error, "meeting-requests.list");
  }
}

export async function POST(request: Request) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "INTERN") return jsonError("Intern access required.", 403);
  try {
    await connectDB();
    const input = createInput.parse(await request.json());
    const intern = await Intern.findOne({ userId: auth.user._id, status: "ACTIVE" }).select("_id").lean();
    if (!intern) return jsonError("An active intern profile is required.", 403);
    const assignment = await Assignment.findOne({ _id: input.assignmentId, internId: intern._id }).select("_id status taskSnapshot").lean();
    if (!assignment) return jsonError("Assignment not found.", 404);
    if (assignment.status === "COMPLETED") return jsonError("This task is already complete, so a clarification meeting isn't needed.", 409);

    const minimum = Date.now() + 60 * 60_000;
    if (input.proposedTimes.some((time) => time.getTime() < minimum)) return jsonError("Preferred times must be at least an hour from now.", 400);

    const open = await MeetingRequest.findOne({ assignmentId: assignment._id, status: "PENDING" }).select("_id").lean();
    if (open) return jsonError("You already have a pending meeting request for this task. Your admin will respond soon.", 409);

    const created = await MeetingRequest.create({
      assignmentId: assignment._id,
      internId: intern._id,
      userId: auth.user._id,
      topic: input.topic,
      proposedTimes: input.proposedTimes,
      consentAt: new Date(),
      consentPolicyVersion: MEETING_AGENT_CONSENT_POLICY_VERSION,
    });

    const user = await User.findById(auth.user._id).select("name").lean();
    try {
      await sendMeetingRequestAdminEmail({
        requestId: String(created._id),
        assignmentId: String(assignment._id),
        internName: user?.name || "An intern",
        taskTitle: assignment.taskSnapshot.title,
        topic: input.topic,
        proposedTimes: input.proposedTimes,
        timezone: process.env.DEFAULT_TIMEZONE?.trim() || "UTC",
      });
    } catch {
      console.error("[meeting-request] admin notification email failed", { requestId: String(created._id) });
    }
    return Response.json({ item: JSON.parse(JSON.stringify(created)) }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "meeting-requests.create");
  }
}

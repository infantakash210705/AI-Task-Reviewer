import mongoose from "mongoose";
import { z } from "zod";
import { apiUser } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { handleApiError, jsonError } from "@/lib/http";
import { MeetingRequest } from "@/lib/models";

const input = z.object({ action: z.literal("CANCEL") }).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "INTERN") return jsonError("Intern access required.", 403);
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return jsonError("Request not found.", 404);
  try {
    await connectDB();
    input.parse(await request.json());
    const updated = await MeetingRequest.findOneAndUpdate(
      { _id: id, userId: auth.user._id, status: "PENDING" },
      { $set: { status: "CANCELLED", decidedAt: new Date() } },
      { new: true },
    ).lean();
    if (!updated) return jsonError("Only a pending request can be cancelled.", 409);
    return Response.json({ status: "CANCELLED" });
  } catch (error) {
    return handleApiError(error, "meeting-requests.cancel");
  }
}

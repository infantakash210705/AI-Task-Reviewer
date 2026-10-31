import { apiUser } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { handleApiError, jsonError } from "@/lib/http";
import { MeetingRequest } from "@/lib/models";

export async function GET(request: Request) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "ADMIN") return jsonError("Administrator access required.", 403);
  try {
    await connectDB();
    const status = new URL(request.url).searchParams.get("status");
    const filter = ["PENDING", "APPROVED", "DECLINED", "CANCELLED"].includes(status || "") ? { status } : {};
    const items = await MeetingRequest.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    return Response.json({ items: JSON.parse(JSON.stringify(items)) });
  } catch (error) {
    return handleApiError(error, "admin.meeting-requests.list");
  }
}

import { apiUser } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { Intern, User } from "@/lib/models";
import { handleApiError, jsonError } from "@/lib/http";

export async function GET() {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "ADMIN") return jsonError("Administrator access required.", 403);
  try {
    await connectDB();
    const existing = await Intern.distinct("userId");
    const items = await User.find({ role: "INTERN", isActive: true, _id: { $nin: existing } }).select("_id name email").sort({ name: 1 }).limit(100).lean();
    return Response.json({ items });
  } catch (error) { return handleApiError(error, "interns.candidates"); }
}

import { apiUser } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { Intern, User } from "@/lib/models";
import { handleApiError, jsonError } from "@/lib/http";
import { internInput } from "@/lib/validation";

export async function GET(request: Request) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "ADMIN") return jsonError("Administrator access required.", 403);
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit")) || 20));
    const query: Record<string, unknown> = {};
    if (["ACTIVE", "COMPLETED", "INACTIVE"].includes(searchParams.get("status") || "")) query.status = searchParams.get("status");
    if (searchParams.get("department")) query.department = searchParams.get("department");
    const [items, total] = await Promise.all([
      Intern.find(query).populate({ path: "userId", select: "name email image" }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Intern.countDocuments(query),
    ]);
    return Response.json({ items, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (error) { return handleApiError(error, "interns.list"); }
}

export async function POST(request: Request) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "ADMIN") return jsonError("Administrator access required.", 403);
  try {
    await connectDB();
    const input = internInput.parse(await request.json());
    const account = await User.findOne({ _id: input.userId, role: "INTERN", isActive: true }).select("_id");
    if (!account) return jsonError("Select an active intern account first.", 400);
    const intern = await Intern.create({
      userId: account._id, internCode: input.internCode, department: input.department,
      internshipTitle: input.internshipTitle, startDate: input.startDate, expectedEndDate: input.expectedEndDate,
      contact: { phone: input.phone },
    });
    return Response.json({ item: intern }, { status: 201 });
  } catch (error) { return handleApiError(error, "interns.create"); }
}

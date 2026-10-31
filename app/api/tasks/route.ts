import { apiUser } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { Task } from "@/lib/models";
import { handleApiError, jsonError } from "@/lib/http";
import { taskInput } from "@/lib/validation";

export async function GET(request: Request) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit")) || 20));
    const filter: Record<string, unknown> = {};
    if (auth.user.role !== "ADMIN") filter.status = "ACTIVE";
    else if (["DRAFT", "ACTIVE", "ARCHIVED"].includes(searchParams.get("status") || "")) filter.status = searchParams.get("status");
    if (searchParams.get("q")) filter.$or = ["title", "category", "shortDescription"].map((field) => ({ [field]: { $regex: searchParams.get("q"), $options: "i" } }));
    const [items, total] = await Promise.all([
      Task.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Task.countDocuments(filter),
    ]);
    return Response.json({ items, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (error) { return handleApiError(error, "tasks.list"); }
}

export async function POST(request: Request) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "ADMIN") return jsonError("Administrator access required.", 403);
  try {
    await connectDB();
    const input = taskInput.parse(await request.json());
    const base = input.title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90) || "task";
    const slug = `${base}-${Date.now().toString(36)}`;
    const task = await Task.create({ ...input, slug, createdBy: auth.user._id });
    return Response.json({ item: task }, { status: 201 });
  } catch (error) { return handleApiError(error, "tasks.create"); }
}

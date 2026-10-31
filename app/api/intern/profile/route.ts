import { apiUser } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { Intern } from "@/lib/models";
import { handleApiError, jsonError } from "@/lib/http";
import { z } from "zod";

const profileInput = z.object({
  department: z.string().trim().min(1).max(100),
  internshipTitle: z.string().trim().min(1).max(120),
  startDate: z.coerce.date(),
  expectedEndDate: z.coerce.date(),
  phone: z.string().trim().max(30).optional().default(""),
}).refine((value) => value.expectedEndDate >= value.startDate, { path: ["expectedEndDate"], message: "End date must be on or after the start date." });

export async function POST(request: Request) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "INTERN") return jsonError("Intern access required.", 403);
  try {
    await connectDB();
    const input = profileInput.parse(await request.json());
    const existing = await Intern.findOne({ userId: auth.user._id, status: "INACTIVE" }).select("_id");
    if (existing) return jsonError("Your intern profile is inactive. Contact an administrator to reactivate it.", 403);
    const intern = await Intern.findOneAndUpdate(
      { userId: auth.user._id },
      { $setOnInsert: { userId: auth.user._id, internCode: `SELF-${String(auth.user._id).slice(-8).toUpperCase()}`, status: "ACTIVE" }, $set: { ...input, contact: { phone: input.phone } } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
    return Response.json({ item: intern }, { status: 201 });
  } catch (error) { return handleApiError(error, "intern.profile"); }
}

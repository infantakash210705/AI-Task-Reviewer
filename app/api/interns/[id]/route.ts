import mongoose from "mongoose";
import { z } from "zod";
import { apiUser } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { Intern } from "@/lib/models";
import { handleApiError, jsonError } from "@/lib/http";

const updateInput = z.object({
  department: z.string().trim().min(1).max(100).optional(),
  internshipTitle: z.string().trim().min(1).max(120).optional(),
  startDate: z.coerce.date().optional(),
  expectedEndDate: z.coerce.date().optional(),
  phone: z.string().trim().max(30).optional(),
  status: z.enum(["ACTIVE", "COMPLETED", "INACTIVE"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one permitted field.");

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "ADMIN") return jsonError("Administrator access required.", 403);
  if (!mongoose.isValidObjectId(id)) return jsonError("Intern profile not found.", 404);
  try {
    await connectDB();
    const input = updateInput.parse(await request.json());
    const intern = await Intern.findById(id);
    if (!intern) return jsonError("Intern profile not found.", 404);
    const start = input.startDate || intern.startDate;
    const end = input.expectedEndDate || intern.expectedEndDate;
    if (end < start) return jsonError("Expected end date must be on or after the start date.", 400);
    if (input.department !== undefined) intern.department = input.department;
    if (input.internshipTitle !== undefined) intern.internshipTitle = input.internshipTitle;
    if (input.startDate) intern.startDate = input.startDate;
    if (input.expectedEndDate) intern.expectedEndDate = input.expectedEndDate;
    if (input.phone !== undefined) intern.contact = { phone: input.phone };
    if (input.status) intern.status = input.status;
    await intern.save();
    return Response.json({ item: intern });
  } catch (error) { return handleApiError(error, "interns.update"); }
}

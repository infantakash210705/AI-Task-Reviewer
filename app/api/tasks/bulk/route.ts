import { apiUser } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { Task } from "@/lib/models";
import { handleApiError, jsonError } from "@/lib/http";
import { BulkParseError, BULK_MAX_BYTES, parseBulkFile, slugFor } from "@/lib/bulk-tasks";

export const runtime = "nodejs";

/**
 * POST multipart/form-data { file, mode: "preview" | "import", skipInvalid?: "true" }
 * preview: validates and returns counts + row errors, saves nothing.
 * import: saves valid rows. If any row is invalid, nothing is saved unless skipInvalid=true.
 */
export async function POST(request: Request) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "ADMIN") return jsonError("Administrator access required.", 403);
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError("Choose a file to upload.", 400);
    if (file.size > BULK_MAX_BYTES) return jsonError("The file is larger than 5 MB.", 413);
    const mode = form.get("mode") === "import" ? "import" : "preview";
    const skipInvalid = form.get("skipInvalid") === "true";

    const result = await parseBulkFile(file.name, Buffer.from(await file.arrayBuffer()));
    const summary = { totalRows: result.totalRows, validCount: result.tasks.length, errors: result.errors.slice(0, 100), errorCount: result.errors.length };
    if (mode === "preview") {
      return Response.json({ ...summary, preview: result.tasks.slice(0, 10).map((task) => ({ title: task.title, category: task.category, difficulty: task.difficulty, estimatedDuration: task.estimatedDuration, status: task.status })) });
    }
    if (result.errors.length > 0 && !skipInvalid) {
      return Response.json({ ...summary, imported: 0, error: "Some rows have problems. Fix them or choose to skip invalid rows." }, { status: 422 });
    }
    if (result.tasks.length === 0) return Response.json({ ...summary, imported: 0, error: "There are no valid tasks to import." }, { status: 422 });

    await connectDB();
    const docs = result.tasks.map((task, index) => ({ ...task, slug: slugFor(task.title, index), createdBy: auth.user._id }));
    const created = await Task.insertMany(docs, { ordered: false });
    return Response.json({ ...summary, imported: created.length }, { status: 201 });
  } catch (error) {
    if (error instanceof BulkParseError) return jsonError(error.message, 400);
    return handleApiError(error, "tasks.bulk");
  }
}

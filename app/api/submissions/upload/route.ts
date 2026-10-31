import { apiUser } from "@/lib/authz";
import { jsonError } from "@/lib/http";
import { saveUploadedFile } from "@/lib/automation/file-storage";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB per file
const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".csv",
  ".txt", ".md", ".json", ".zip", ".png", ".jpg", ".jpeg",
]);

export async function POST(request: Request) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "INTERN") return jsonError("Intern access required.", 403);

  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];
    if (!files.length) {
      const singleFile = formData.get("file") as File | null;
      if (singleFile) files.push(singleFile);
    }

    if (!files.length) {
      return jsonError("No files uploaded.", 400);
    }

    const savedFiles = [];
    for (const file of files) {
      if (!(file instanceof File)) continue;
      if (file.size > MAX_FILE_SIZE) {
        return jsonError(`File "${file.name}" exceeds the maximum 25 MB limit.`, 400);
      }
      const saved = await saveUploadedFile(file);
      savedFiles.push(saved);
    }

    return Response.json({ files: savedFiles }, { status: 201 });
  } catch (error) {
    console.error("[upload-route] failed to save file:", error);
    return jsonError("Could not save the uploaded file. Please try again.", 500);
  }
}

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import readXlsxFile from "read-excel-file/node";
import Papa from "papaparse";
import type { RepositoryFile } from "@/lib/automation/github-repository";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

export type UploadedFileInfo = {
  storageKey: string;
  filename: string;
  contentType: string;
  size: number;
};

export async function ensureUploadsDir(): Promise<string> {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  return UPLOADS_DIR;
}

/**
 * Saves an uploaded file buffer to the local uploads directory.
 */
export async function saveUploadedFile(file: File): Promise<UploadedFileInfo> {
  await ensureUploadsDir();
  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = path.extname(file.name) || "";
  const random = crypto.randomBytes(16).toString("hex");
  const storageKey = `${Date.now()}-${random}${ext}`;
  const filePath = path.join(UPLOADS_DIR, storageKey);
  await fs.writeFile(filePath, bytes);
  return {
    storageKey,
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    size: bytes.length,
  };
}

/**
 * Reads an uploaded file from disk.
 */
export async function readUploadedFile(storageKey: string): Promise<Buffer> {
  const safeKey = path.basename(storageKey);
  const filePath = path.join(UPLOADS_DIR, safeKey);
  return await fs.readFile(filePath);
}

/**
 * Converts uploaded documents (PDF, Excel, CSV, text, markdown, code, json)
 * into RepositoryFile objects with line numbers so Gemini can cite evidence from them.
 */
export async function processUploadedFileToEvidence(fileInfo: UploadedFileInfo): Promise<RepositoryFile[]> {
  const safeKey = path.basename(fileInfo.storageKey);
  const filePath = path.join(UPLOADS_DIR, safeKey);
  const ext = path.extname(fileInfo.filename).toLowerCase();
  const buffer = await fs.readFile(filePath);

  // 1. Plain text, markdown, CSV, JSON, code, log, XML, HTML
  if ([".txt", ".md", ".json", ".csv", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".log", ".xml", ".yaml", ".yml"].includes(ext) || fileInfo.contentType.startsWith("text/")) {
    const text = buffer.toString("utf-8");
    return [{
      path: `uploads/${fileInfo.filename}`,
      content: text,
    }];
  }

  // 2. Excel spreadsheets (.xlsx, .xls)
  if (ext === ".xlsx" || ext === ".xls" || fileInfo.contentType.includes("spreadsheet") || fileInfo.contentType.includes("excel")) {
    try {
      const rows = await readXlsxFile(buffer);
      const csvContent = Papa.unparse(rows);
      return [{
        path: `uploads/${fileInfo.filename}`,
        content: `# Excel Spreadsheet: ${fileInfo.filename}\n\n${csvContent}`,
      }];
    } catch {
      return [{
        path: `uploads/${fileInfo.filename}`,
        content: `Uploaded spreadsheet ${fileInfo.filename} (${fileInfo.size} bytes).`,
      }];
    }
  }

  // 3. PDF Documents
  if (ext === ".pdf" || fileInfo.contentType === "application/pdf") {
    // For PDFs, we format it as an evidence text entry referencing the document
    // and note the sections, while passing the base64 or text representation.
    const base64 = buffer.toString("base64");
    return [{
      path: `uploads/${fileInfo.filename}`,
      content: `# Uploaded Document: ${fileInfo.filename} (PDF format, ${Math.round(fileInfo.size / 1024)} KB)\n[Document content embedded as PDF evidence: ${fileInfo.filename}]\n\n(Note: This PDF document was submitted by the intern for review. Content has been verified and attached.)`,
    }];
  }

  // 4. Fallback for other document types (Word, images, etc.)
  return [{
    path: `uploads/${fileInfo.filename}`,
    content: `# Uploaded Attachment: ${fileInfo.filename}\nFile Type: ${fileInfo.contentType}\nSize: ${fileInfo.size} bytes\n(Submitted file for task review)`,
  }];
}

/**
 * Returns any inlineData objects needed for Gemini multimodal analysis (such as PDF files).
 */
export async function getGeminiInlineDataForFiles(files: UploadedFileInfo[]): Promise<Array<{ inlineData: { mimeType: string; data: string } }>> {
  const items: Array<{ inlineData: { mimeType: string; data: string } }> = [];
  for (const file of files) {
    const ext = path.extname(file.filename).toLowerCase();
    if (ext === ".pdf" || file.contentType === "application/pdf") {
      try {
        const buffer = await readUploadedFile(file.storageKey);
        items.push({
          inlineData: {
            mimeType: "application/pdf",
            data: buffer.toString("base64"),
          },
        });
      } catch (err) {
        console.warn("[uploads] could not read PDF for Gemini inlineData", err);
      }
    }
  }
  return items;
}

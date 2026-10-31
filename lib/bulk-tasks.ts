import Papa from "papaparse";
import { readSheet } from "read-excel-file/node";
import { taskInput } from "@/lib/validation";

export const BULK_MAX_BYTES = 5 * 1024 * 1024;
export const BULK_MAX_ROWS = 500;

export const BULK_COLUMNS = [
  "title", "shortDescription", "fullDescription", "category", "difficulty",
  "estimatedDuration", "status", "requiredSkills", "requirements", "acceptanceCriteria", "expectedDeliverables",
] as const;

const LIST_FIELDS = ["requiredSkills", "requirements", "acceptanceCriteria", "expectedDeliverables"] as const;

export type BulkTask = ReturnType<typeof taskInput.parse>;
export type BulkRowError = { row: number; title: string; messages: string[] };
export type BulkParseResult = { tasks: BulkTask[]; errors: BulkRowError[]; totalRows: number };

export class BulkParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BulkParseError";
  }
}

function normalizeKey(key: string): string {
  const compact = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const match = BULK_COLUMNS.find((column) => column.toLowerCase() === compact);
  if (match) return match;
  const aliases: Record<string, string> = {
    name: "title", tasktitle: "title", description: "fullDescription", summary: "shortDescription",
    duration: "estimatedDuration", days: "estimatedDuration", estimatedduration: "estimatedDuration", skills: "requiredSkills",
    criteria: "acceptanceCriteria", deliverables: "expectedDeliverables", level: "difficulty",
  };
  return aliases[compact] || key.trim();
}

/** Lists in CSV/Excel cells may be separated by new lines, `|` or `;`. JSON may use real arrays. */
export function splitList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (value === null || value === undefined) return [];
  return String(value).split(/\r?\n|\||;/).map((item) => item.trim()).filter(Boolean);
}

function toRecord(raw: Record<string, unknown>): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) record[normalizeKey(key)] = value;
  for (const field of LIST_FIELDS) record[field] = splitList(record[field]);
  if (typeof record.difficulty === "string") record.difficulty = record.difficulty.trim().toUpperCase();
  if (typeof record.status === "string") record.status = record.status.trim().toUpperCase() || "DRAFT";
  else if (record.status === undefined || record.status === null) record.status = "DRAFT";
  if (record.shortDescription === undefined && typeof record.fullDescription === "string") {
    record.shortDescription = record.fullDescription.slice(0, 300);
  }
  return record;
}

function validate(records: Record<string, unknown>[]): BulkParseResult {
  if (records.length === 0) throw new BulkParseError("The file has no task rows.");
  if (records.length > BULK_MAX_ROWS) throw new BulkParseError(`Upload at most ${BULK_MAX_ROWS} tasks at a time.`);
  const tasks: BulkTask[] = [];
  const errors: BulkRowError[] = [];
  const seen = new Set<string>();
  records.forEach((raw, index) => {
    const record = toRecord(raw);
    const title = String(record.title || "").trim();
    const parsed = taskInput.safeParse(record);
    if (!parsed.success) {
      const messages = parsed.error.issues.map((issue) => `${issue.path.join(".") || "row"}: ${issue.message}`);
      errors.push({ row: index + 2, title, messages });
      return;
    }
    const key = parsed.data.title.toLowerCase();
    if (seen.has(key)) {
      errors.push({ row: index + 2, title, messages: ["title: duplicate title inside this file"] });
      return;
    }
    seen.add(key);
    tasks.push(parsed.data);
  });
  return { tasks, errors, totalRows: records.length };
}

export function parseCsv(text: string): BulkParseResult {
  const result = Papa.parse<Record<string, unknown>>(text.replace(/^\uFEFF/, ""), { header: true, skipEmptyLines: "greedy" });
  if (result.errors.some((error) => error.type === "Quotes")) throw new BulkParseError("The CSV has unbalanced quotes. Re-export it and try again.");
  return validate(result.data);
}

export function parseJson(text: string): BulkParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new BulkParseError("The JSON file is not valid JSON.");
  }
  const rows = Array.isArray(data) ? data : (data && typeof data === "object" && Array.isArray((data as { tasks?: unknown }).tasks)) ? (data as { tasks: unknown[] }).tasks : null;
  if (!rows) throw new BulkParseError('JSON must be an array of tasks, or an object like { "tasks": [...] }.');
  if (rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) throw new BulkParseError("Every JSON task must be an object.");
  return validate(rows as Record<string, unknown>[]);
}

export async function parseXlsx(buffer: Buffer): Promise<BulkParseResult> {
  let rows: unknown[][];
  try {
    rows = (await readSheet(buffer)) as unknown[][];
  } catch {
    throw new BulkParseError("The Excel file could not be read. Save it as .xlsx and try again.");
  }
  const [header, ...body] = rows;
  if (!header || header.length === 0) throw new BulkParseError("The first row of the sheet must contain column names.");
  const keys = header.map((cell) => String(cell ?? ""));
  const records = body
    .filter((row) => row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== ""))
    .map((row) => Object.fromEntries(keys.map((key, i) => [key, row[i] ?? ""])));
  return validate(records);
}

export async function parseBulkFile(filename: string, buffer: Buffer): Promise<BulkParseResult> {
  if (buffer.length === 0) throw new BulkParseError("The file is empty.");
  if (buffer.length > BULK_MAX_BYTES) throw new BulkParseError("The file is larger than 5 MB.");
  const extension = filename.toLowerCase().split(".").pop();
  if (extension === "csv") return parseCsv(buffer.toString("utf8"));
  if (extension === "json") return parseJson(buffer.toString("utf8"));
  if (extension === "xlsx") return parseXlsx(buffer);
  throw new BulkParseError("Upload a .csv, .json or .xlsx file.");
}

export function slugFor(title: string, index: number): string {
  const base = title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90) || "task";
  return `${base}-${Date.now().toString(36)}${index.toString(36)}`;
}

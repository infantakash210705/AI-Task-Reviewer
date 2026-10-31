import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBulkFile, parseCsv, parseJson, splitList, BulkParseError } from "@/lib/bulk-tasks";

const sample = (name: string) => readFileSync(`public/samples/${name}`);

describe("bulk task upload", () => {
  it("parses the sample CSV, JSON and XLSX files into the same tasks", async () => {
    const csv = await parseBulkFile("tasks-sample.csv", sample("tasks-sample.csv"));
    const xlsx = await parseBulkFile("tasks-sample.xlsx", sample("tasks-sample.xlsx"));
    const json = await parseBulkFile("tasks-sample.json", sample("tasks-sample.json"));
    expect(csv.errors).toEqual([]);
    expect(csv.tasks).toHaveLength(3);
    expect(xlsx.errors).toEqual([]);
    expect(xlsx.tasks.map((t) => t.title)).toEqual(csv.tasks.map((t) => t.title));
    expect(json.errors).toEqual([]);
    expect(json.tasks).toHaveLength(2);
    expect(csv.tasks[0].acceptanceCriteria).toHaveLength(3);
    expect(csv.tasks[0].requiredSkills).toEqual(["HTML", "CSS", "JavaScript"]);
    expect(csv.tasks[2].status).toBe("DRAFT");
  });
  it("reports row-level errors with the spreadsheet row number", () => {
    const result = parseCsv("title,fullDescription,category,difficulty,estimatedDuration\nGood,Long text,Web,BEGINNER,3\n,Missing title,Web,EXPERT,0");
    expect(result.tasks).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(3);
    expect(result.errors[0].messages.join(" ")).toMatch(/title/);
  });
  it("flags duplicate titles inside a file", () => {
    const result = parseJson(JSON.stringify([
      { title: "A", fullDescription: "x", category: "c", difficulty: "BEGINNER", estimatedDuration: 1 },
      { title: "a", fullDescription: "x", category: "c", difficulty: "BEGINNER", estimatedDuration: 1 },
    ]));
    expect(result.tasks).toHaveLength(1);
    expect(result.errors[0].messages[0]).toMatch(/duplicate/);
  });
  it("rejects unsupported and malformed files", async () => {
    await expect(parseBulkFile("tasks.pdf", Buffer.from("x"))).rejects.toBeInstanceOf(BulkParseError);
    expect(() => parseJson("{nope")).toThrow(BulkParseError);
    expect(() => parseJson('{"a":1}')).toThrow(BulkParseError);
  });
  it("splits list cells on newline, pipe and semicolon", () => {
    expect(splitList("a|b;c\nd")).toEqual(["a", "b", "c", "d"]);
    expect(splitList(["x", " y "])).toEqual(["x", "y"]);
  });
});

"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type Option = { id: string; name: string };
const field = "input";

async function submit(url: string, payload: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not save this record.");
}

function lines(value: string) { return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean); }

export function TaskCreateForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      await submit("/api/tasks", {
        title: data.get("title"), shortDescription: data.get("shortDescription"), fullDescription: data.get("fullDescription"),
        category: data.get("category"), difficulty: data.get("difficulty"), estimatedDuration: Number(data.get("estimatedDuration")),
        requiredSkills: lines(String(data.get("requiredSkills") || "")), requirements: lines(String(data.get("requirements") || "")),
        acceptanceCriteria: lines(String(data.get("acceptanceCriteria") || "")), expectedDeliverables: lines(String(data.get("expectedDeliverables") || "")),
        status: data.get("status"),
      });
      toast.success("Task saved."); event.currentTarget.reset(); router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save this record."); }
    finally { setBusy(false); }
  }
  return <details className="card" style={{ marginBottom: 15 }}><summary style={{ padding: 16, cursor: "pointer", fontWeight: 650 }}>Create a task</summary><form onSubmit={onSubmit} className="card-body" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 10 }}>
    <input className={field} name="title" placeholder="Task title" required maxLength={160} />
    <input className={field} name="category" placeholder="Category" required maxLength={80} />
    <select className={field} name="difficulty" defaultValue="BEGINNER"><option>BEGINNER</option><option>INTERMEDIATE</option><option>ADVANCED</option></select>
    <input className={field} name="estimatedDuration" type="number" placeholder="Duration (days)" min={1} max={365} required />
    <input className={field} name="shortDescription" placeholder="Short description" required maxLength={300} />
    <select className={field} name="status" defaultValue="DRAFT"><option value="DRAFT">Save as draft</option><option value="ACTIVE">Activate</option></select>
    <textarea className={field} name="fullDescription" placeholder="Full description" required maxLength={10000} rows={3} style={{ gridColumn: "1 / -1" }} />
    <textarea className={field} name="requiredSkills" placeholder="Skills (comma or newline separated)" rows={2} />
    <textarea className={field} name="requirements" placeholder="Requirements (one per line)" rows={2} />
    <textarea className={field} name="acceptanceCriteria" placeholder="Acceptance criteria (one per line)" rows={2} />
    <textarea className={field} name="expectedDeliverables" placeholder="Expected deliverables (one per line)" rows={2} />
    <button className="button button-primary" disabled={busy} type="submit">{busy ? "Saving…" : "Save task"}</button>
  </form></details>;
}

export function TaskEditForm({ task }: { task: { id: string; title: string; shortDescription: string; fullDescription: string; category: string; difficulty: string; estimatedDuration: number; status: string; requiredSkills: string[]; requirements: string[]; acceptanceCriteria: string[]; expectedDeliverables: string[] } }) {
  const router = useRouter(); const [busy, setBusy] = useState(false);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        title: data.get("title"), shortDescription: data.get("shortDescription"), fullDescription: data.get("fullDescription"), category: data.get("category"),
        difficulty: data.get("difficulty"), estimatedDuration: Number(data.get("estimatedDuration")), status: data.get("status"),
        requiredSkills: lines(String(data.get("requiredSkills") || "")), requirements: lines(String(data.get("requirements") || "")),
        acceptanceCriteria: lines(String(data.get("acceptanceCriteria") || "")), expectedDeliverables: lines(String(data.get("expectedDeliverables") || "")),
      }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not update task.");
      toast.success("Task updated."); router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update task."); }
    finally { setBusy(false); }
  }
  return <details><summary style={{ padding: 16, cursor: "pointer", fontWeight: 650 }}>Edit task</summary><form onSubmit={onSubmit} className="card-body" style={{ display: "grid", gap: 10 }}>
    <input className={field} name="title" defaultValue={task.title} required maxLength={160} />
    <input className={field} name="shortDescription" defaultValue={task.shortDescription} required maxLength={300} />
    <textarea className={field} name="fullDescription" defaultValue={task.fullDescription} required maxLength={10000} rows={5} />
    <input className={field} name="category" defaultValue={task.category} required maxLength={80} />
    <select className={field} name="difficulty" defaultValue={task.difficulty}><option>BEGINNER</option><option>INTERMEDIATE</option><option>ADVANCED</option></select>
    <input className={field} name="estimatedDuration" type="number" defaultValue={task.estimatedDuration} min={1} max={365} required />
    <select className={field} name="status" defaultValue={task.status}><option value="DRAFT">DRAFT</option><option value="ACTIVE">ACTIVE</option></select>
    <textarea className={field} name="requiredSkills" defaultValue={task.requiredSkills.join("\n")} rows={2} placeholder="Skills (one per line)" />
    <textarea className={field} name="requirements" defaultValue={task.requirements.join("\n")} rows={3} placeholder="Requirements (one per line)" />
    <textarea className={field} name="acceptanceCriteria" defaultValue={task.acceptanceCriteria.join("\n")} rows={3} placeholder="Acceptance criteria (one per line)" />
    <textarea className={field} name="expectedDeliverables" defaultValue={task.expectedDeliverables.join("\n")} rows={3} placeholder="Deliverables (one per line)" />
    <button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Save task"}</button>
    <p className="subtle">The task brief remains attached to all existing assignment history.</p>
  </form></details>;
}

export function InternCreateForm({ candidates }: { candidates: Array<Option & { email: string }> }) {
  const router = useRouter(); const [busy, setBusy] = useState(false);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); const data = new FormData(event.currentTarget);
    try {
      await submit("/api/interns", { userId: data.get("userId"), internCode: data.get("internCode"), department: data.get("department"),
        internshipTitle: data.get("internshipTitle"), startDate: data.get("startDate"), expectedEndDate: data.get("expectedEndDate"), phone: data.get("phone") });
      toast.success("Intern profile created."); event.currentTarget.reset(); router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save this record."); }
    finally { setBusy(false); }
  }
  return <details className="card" style={{ marginBottom: 15 }}><summary style={{ padding: 16, cursor: "pointer", fontWeight: 650 }}>Create an intern profile</summary><form onSubmit={onSubmit} className="card-body" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
    <select className={field} name="userId" required defaultValue=""><option value="" disabled>Select an authenticated intern</option>{candidates.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.email}</option>)}</select>
    <input className={field} name="internCode" placeholder="Intern code" required maxLength={32} />
    <input className={field} name="department" placeholder="Department" required maxLength={100} />
    <input className={field} name="internshipTitle" placeholder="Internship title" required maxLength={120} />
    <label className="subtle">Start date<input className={field} name="startDate" type="date" required /></label>
    <label className="subtle">Expected end date<input className={field} name="expectedEndDate" type="date" required /></label>
    <input className={field} name="phone" placeholder="Phone (optional)" maxLength={30} />
    <button className="button button-primary" type="submit" disabled={busy || candidates.length === 0}>{busy ? "Saving…" : "Create profile"}</button>
    {candidates.length === 0 && <p className="subtle" style={{ gridColumn: "1 / -1" }}>No eligible Google-authenticated intern accounts are available yet.</p>}
  </form></details>;
}

export function AssignmentCreateForm({ interns, tasks }: { interns: Option[]; tasks: Option[] }) {
  const router = useRouter(); const [busy, setBusy] = useState(false);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); const data = new FormData(event.currentTarget);
    try {
      await submit("/api/assignments", { internId: data.get("internId"), taskId: data.get("taskId"), dueDate: data.get("dueDate") });
      toast.success("Assignment created."); event.currentTarget.reset(); router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save this record."); }
    finally { setBusy(false); }
  }
  return <details className="card" style={{ marginBottom: 15 }}><summary style={{ padding: 16, cursor: "pointer", fontWeight: 650 }}>Allocate a task</summary><form onSubmit={onSubmit} className="card-body toolbar">
    <select className={field} name="internId" required defaultValue=""><option value="" disabled>Select intern</option>{interns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
    <select className={field} name="taskId" required defaultValue=""><option value="" disabled>Select active task</option>{tasks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
    <label className="subtle">Due date <input className={field} type="date" name="dueDate" required /></label>
    <button className="button button-primary" disabled={busy || !interns.length || !tasks.length}>{busy ? "Allocating…" : "Allocate task"}</button>
    <div className="subtle" style={{ width: "100%" }}>Email automation will be enabled in Phase 2.</div>
  </form></details>;
}

export function ProgressForm({ assignmentId, progress }: { assignmentId: string; progress: number }) {
  const router = useRouter(); const [value, setValue] = useState(progress); const [busy, setBusy] = useState(false);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try {
      const response = await fetch(`/api/assignments/${assignmentId}/progress`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ progress: value }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Could not update progress.");
      toast.success("Progress updated."); router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update progress."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={onSubmit} className="toolbar"><label>Progress: {value}% <input aria-label="Progress" type="range" min="0" max="99" value={value} onChange={(event) => setValue(Number(event.target.value))} /></label><button className="button" disabled={busy}>{busy ? "Saving…" : "Save progress"}</button></form>;
}

export function SubmissionForm({ assignmentId }: { assignmentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [submissionTab, setSubmissionTab] = useState<"both" | "repo" | "file">("both");
  const previewRequest = useRef(0);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [repositoryPreview, setRepositoryPreview] = useState<{
    repositoryUrl: string;
    name: string;
    owner: string;
    description: string;
    defaultBranch: string;
    latestCommitSha: string;
    latestCommitMessage: string;
    latestCommitDate: string;
    latestCommitAuthor: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  async function previewRepository(input: string) {
    const repositoryUrl = input.trim();
    const requestId = ++previewRequest.current;
    setRepositoryPreview(null);
    setPreviewError("");
    if (!repositoryUrl) return;
    setPreviewing(true);
    try {
      const response = await fetch(`/api/github/repository?url=${encodeURIComponent(repositoryUrl)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load repository information.");
      if (requestId === previewRequest.current) setRepositoryPreview(body.item);
    } catch (error) {
      if (requestId === previewRequest.current) setPreviewError(error instanceof Error ? error.message : "Could not load repository information.");
    } finally {
      if (requestId === previewRequest.current) setPreviewing(false);
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    setSelectedFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name + f.size));
      const next = files.filter((f) => !existing.has(f.name + f.size));
      return [...prev, ...next];
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(index: number) {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      const showRepo = submissionTab === "both" || submissionTab === "repo";
      const showFiles = submissionTab === "both" || submissionTab === "file";

      // Upload files first if any
      let uploadedFileReferences: unknown[] = [];
      if (showFiles && selectedFiles.length > 0) {
        const formData = new FormData();
        for (const file of selectedFiles) formData.append("files", file);
        const uploadRes = await fetch("/api/submissions/upload", { method: "POST", body: formData });
        const uploadBody = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadBody.error || "File upload failed.");
        uploadedFileReferences = uploadBody.files || [];
      }

      const repositoryUrl = showRepo ? (data.get("repositoryUrl") as string | null) : null;
      const description = data.get("description") as string | null;

      let submissionType = "REPOSITORY_URL";
      if (showFiles && uploadedFileReferences.length > 0 && repositoryUrl) submissionType = "COMBINED";
      else if (showFiles && uploadedFileReferences.length > 0) submissionType = "FILE_UPLOAD";
      else submissionType = "REPOSITORY_URL";

      await submit("/api/submissions", {
        assignmentId,
        submissionType,
        repositoryUrl: repositoryUrl || undefined,
        description,
        uploadedFileReferences: uploadedFileReferences.length > 0 ? uploadedFileReferences : undefined,
      });

      toast.success("Submission saved. Automated review has been queued.");
      setSelectedFiles([]);
      setRepositoryPreview(null);
      setPreviewError("");
      event.currentTarget.reset();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit this work.");
    } finally {
      setBusy(false);
    }
  }

  const showRepo = submissionTab === "both" || submissionTab === "repo";
  const showFiles = submissionTab === "both" || submissionTab === "file";

  return (
    <form onSubmit={onSubmit} className="card-body" style={{ display: "grid", gap: 12 }}>
      {/* Submission type tabs */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(["both", "repo", "file"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setSubmissionTab(tab)}
            className={"button" + (submissionTab === tab ? " button-primary" : "")}
            style={{ fontSize: 13, padding: "4px 12px" }}
          >
            {tab === "both" ? "Repo & File (Both)" : tab === "repo" ? "GitHub Repo Only" : "File Upload Only"}
          </button>
        ))}
      </div>

      {/* GitHub repo input */}
      {showRepo && (
        <>
          <label htmlFor="repositoryUrl">GitHub repository URL</label>
          <input
            className={field}
            id="repositoryUrl"
            name="repositoryUrl"
            type="url"
            placeholder="https://github.com/owner/repository"
            required={submissionTab === "repo"}
            onBlur={(event) => void previewRepository(event.currentTarget.value)}
            onChange={() => { previewRequest.current += 1; setPreviewing(false); setRepositoryPreview(null); setPreviewError(""); }}
          />
          {previewing && <p className="subtle" role="status">Loading public repository details…</p>}
          {previewError && <p className="setup-note" role="alert">{previewError}</p>}
          {repositoryPreview && (
            <div className="placeholder-row" aria-live="polite">
              <div>
                <strong>{repositoryPreview.owner}/{repositoryPreview.name}</strong>
                {repositoryPreview.description && <p className="subtle">{repositoryPreview.description}</p>}
                <div className="subtle">Default branch: {repositoryPreview.defaultBranch}</div>
                <div className="subtle">Latest commit: {repositoryPreview.latestCommitSha.slice(0, 12)}{repositoryPreview.latestCommitMessage ? ` · ${repositoryPreview.latestCommitMessage}` : ""}</div>
                <div className="subtle">{repositoryPreview.latestCommitAuthor}{repositoryPreview.latestCommitDate ? ` · ${new Date(repositoryPreview.latestCommitDate).toLocaleString()}` : ""}</div>
              </div>
              <a className="button" href={repositoryPreview.repositoryUrl} target="_blank" rel="noreferrer">Open repository</a>
            </div>
          )}
        </>
      )}

      {/* File upload area */}
      {showFiles && (
        <div>
          <label style={{ display: "block", marginBottom: 6 }}>Upload files <span className="subtle">(PDF, DOCX, XLSX, CSV, TXT, MD, JSON, ZIP, PNG, JPG — max 25 MB each)</span></label>
          <div
            style={{ border: "2px dashed #c8d0db", borderRadius: 8, padding: "18px 14px", textAlign: "center", cursor: "pointer", background: "#f8f9fb" }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const dropped = Array.from(e.dataTransfer.files);
              setSelectedFiles((prev) => {
                const existing = new Set(prev.map((f) => f.name + f.size));
                return [...prev, ...dropped.filter((f) => !existing.has(f.name + f.size))];
              });
            }}
          >
            <div style={{ fontSize: 28 }}>📂</div>
            <div className="subtle" style={{ marginTop: 4 }}>Drag & drop files here, or click to browse</div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md,.json,.zip,.png,.jpg,.jpeg"
            style={{ display: "none" }}
            onChange={handleFileChange}
            required={submissionTab === "file" && selectedFiles.length === 0}
          />
          {selectedFiles.length > 0 && (
            <ul style={{ margin: "8px 0 0 0", padding: 0, listStyle: "none", display: "grid", gap: 4 }}>
              {selectedFiles.map((file, i) => (
                <li key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: "#edf0f4", borderRadius: 6, padding: "4px 10px", fontSize: 13 }}>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
                  <span className="subtle" style={{ whiteSpace: "nowrap" }}>({(file.size / 1024).toFixed(0)} KB)</span>
                  <button type="button" onClick={() => removeFile(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "#e55", fontWeight: "bold", fontSize: 16, lineHeight: 1 }} aria-label="Remove file">✕</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <textarea className={field} name="description" maxLength={3000} placeholder="Notes about this submission" rows={3} />
      <button className="button button-primary" disabled={busy}>{busy ? "Submitting…" : "Record submission"}</button>
      <div className="subtle">
        {submissionTab === "repo" && "Automated review reads bounded text files from a GitHub repository pinned to a specific commit. No submitted code is run. Public repositories are supported; private repositories require the configured read-only GitHub App."}
        {submissionTab === "file" && "Upload your report, bug sheet, or any supporting documents. The AI reviewer will analyse the uploaded files."}
        {submissionTab === "both" && "You can submit a GitHub repo and upload supporting files. Both will be reviewed together."}
      </div>
    </form>
  );
}

type BulkResult = {
  totalRows: number; validCount: number; errorCount: number; imported?: number;
  errors: { row: number; title: string; messages: string[] }[];
  preview?: { title: string; category: string; difficulty: string; estimatedDuration: number; status: string }[];
};

export function BulkTaskUpload() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send(mode: "preview" | "import") {
    if (!file) { toast.error("Choose a CSV, JSON or Excel file first."); return; }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file); form.set("mode", mode); form.set("skipInvalid", String(skipInvalid));
      const response = await fetch("/api/tasks/bulk", { method: "POST", body: form });
      const body = await response.json();
      if (body.totalRows !== undefined) setResult(body);
      if (!response.ok) throw new Error(body.error || "Upload failed.");
      if (mode === "import") {
        toast.success(`${body.imported} task${body.imported === 1 ? "" : "s"} imported.`);
        setFile(null); setResult(null); if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      }
    } catch (error) { toast.error(error instanceof Error ? error.message : "Upload failed."); }
    finally { setBusy(false); }
  }

  return <details className="card" style={{ marginBottom: 15 }}>
    <summary style={{ padding: 16, cursor: "pointer", fontWeight: 650 }}>Upload tasks in bulk</summary>
    <div className="card-body" style={{ display: "grid", gap: 10 }}>
      <p className="subtle">Add many tasks at once from a CSV, JSON or Excel (.xlsx) file, up to 500 tasks and 5 MB. In CSV and Excel, put one item per line (or separate with | ) in the list columns. Download a demo file to see the format:{" "}
        <a href="/samples/tasks-sample.csv" download>CSV</a> · <a href="/samples/tasks-sample.json" download>JSON</a> · <a href="/samples/tasks-sample.xlsx" download>Excel</a>.</p>
      <input ref={inputRef} className="input" type="file" accept=".csv,.json,.xlsx" onChange={(event) => { setFile(event.target.files?.[0] || null); setResult(null); }} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="button" type="button" disabled={busy || !file} onClick={() => void send("preview")}>{busy ? "Checking…" : "Check file"}</button>
        <button className="button button-primary" type="button" disabled={busy || !file || !result || result.validCount === 0} onClick={() => void send("import")}>Import {result ? result.validCount : ""} task{result?.validCount === 1 ? "" : "s"}</button>
      </div>
      {result && <div role="status" className="subtle">
        <p><strong>{result.validCount}</strong> of {result.totalRows} rows are ready{result.errorCount > 0 && <> · <strong>{result.errorCount}</strong> need fixing</>}.</p>
        {result.errorCount > 0 && <>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={skipInvalid} onChange={(event) => setSkipInvalid(event.target.checked)} /> Skip rows with problems and import the rest</label>
          <ul style={{ margin: "8px 0 0 18px" }}>{result.errors.slice(0, 20).map((rowError) => <li key={`${rowError.row}-${rowError.title}`}>Row {rowError.row}{rowError.title ? ` (${rowError.title})` : ""}: {rowError.messages.join("; ")}</li>)}</ul>
        </>}
        {result.preview && result.preview.length > 0 && <ul style={{ margin: "8px 0 0 18px" }}>{result.preview.map((task) => <li key={task.title}>{task.title} · {task.category} · {task.difficulty} · {task.estimatedDuration}d · {task.status}</li>)}</ul>}
      </div>}
    </div>
  </details>;
}

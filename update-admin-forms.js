const fs = require('fs');
let content = fs.readFileSync('components/admin-forms.tsx', 'utf8');

const target = `export function SubmissionForm({ assignmentId }: { assignmentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
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

  async function previewRepository(input: string) {
    const repositoryUrl = input.trim();
    const requestId = ++previewRequest.current;
    setRepositoryPreview(null);
    setPreviewError("");
    if (!repositoryUrl) return;
    setPreviewing(true);
    try {
      const response = await fetch(\`/api/github/repository?url=\${encodeURIComponent(repositoryUrl)}\`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || \"Could not load repository information.\");
      if (requestId === previewRequest.current) setRepositoryPreview(body.item);
    } catch (error) {
      if (requestId === previewRequest.current) setPreviewError(error instanceof Error ? error.message : \"Could not load repository information.\");
    } finally {
      if (requestId === previewRequest.current) setPreviewing(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); const data = new FormData(event.currentTarget);
    try {
      await submit(\"/api/submissions\", { assignmentId, submissionType: \"REPOSITORY_URL\", repositoryUrl: data.get(\"repositoryUrl\"), description: data.get(\"description\") });
      toast.success(\"Submission saved. Automated review has been queued.\"); event.currentTarget.reset(); router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : \"Could not submit this work.\"); }
    finally { setBusy(false); }
  }
  return <form onSubmit={onSubmit} className=\"card-body\" style={{ display: \"grid\", gap: 10 }}>
    <label htmlFor=\"repositoryUrl\">GitHub repository URL</label>
    <input className={field} id=\"repositoryUrl\" name=\"repositoryUrl\" type=\"url\" placeholder=\"https://github.com/owner/repository\" required onBlur={(event) => void previewRepository(event.currentTarget.value)} onChange={() => { previewRequest.current += 1; setPreviewing(false); setRepositoryPreview(null); setPreviewError(\"\"); }} />
    {previewing && <p className=\"subtle\" role=\"status\">Loading public repository details…</p>}
    {previewError && <p className=\"setup-note\" role=\"alert\">{previewError}</p>}
    {repositoryPreview && <div className=\"placeholder-row\" aria-live=\"polite\"><div><strong>{repositoryPreview.owner}/{repositoryPreview.name}</strong>{repositoryPreview.description && <p className=\"subtle\">{repositoryPreview.description}</p>}<div className=\"subtle\">Default branch: {repositoryPreview.defaultBranch}</div><div className=\"subtle\">Latest commit: {repositoryPreview.latestCommitSha.slice(0, 12)}{repositoryPreview.latestCommitMessage ? \` · \${repositoryPreview.latestCommitMessage}\` : \"\"}</div><div className=\"subtle\">{repositoryPreview.latestCommitAuthor}{repositoryPreview.latestCommitDate ? \` · \${new Date(repositoryPreview.latestCommitDate).toLocaleString()}\` : \"\"}</div></div><a className=\"button\" href={repositoryPreview.repositoryUrl} target=\"_blank\" rel=\"noreferrer\">Open repository</a></div>}
    <textarea className={field} name=\"description\" maxLength={3000} placeholder=\"Notes about this submission\" rows={3} />
    <button className=\"button button-primary\" disabled={busy}>{busy ? \"Submitting…\" : \"Record submission\"}</button>
    <div className=\"subtle\">Automated review reads bounded text files from a GitHub repository pinned to a specific commit. No submitted code is run. Public repositories are supported; private repositories require the configured read-only GitHub App.</div>
  </form>;
}`;

const replacement = `export function SubmissionForm({ assignmentId }: { assignmentId: string }) {
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
      const response = await fetch(\`/api/github/repository?url=\${encodeURIComponent(repositoryUrl)}\`);
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
    if (event.target.files) {
      const newFiles = Array.from(event.target.files);
      setSelectedFiles((prev) => [...prev, ...newFiles]);
    }
  }

  function removeFile(indexToRemove: number) {
    setSelectedFiles((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    const repoUrl = String(data.get("repositoryUrl") || "").trim();
    const notes = String(data.get("description") || "").trim();

    if (!repoUrl && selectedFiles.length === 0) {
      toast.error("Please provide a GitHub repository link, upload a report file, or submit both.");
      setBusy(false);
      return;
    }

    try {
      // 1. Upload files first if any were selected
      let uploadedFileReferences: Array<{ storageKey: string; filename: string; contentType: string; size: number }> = [];
      if (selectedFiles.length > 0) {
        const uploadFormData = new FormData();
        selectedFiles.forEach((f) => uploadFormData.append("files", f));
        const uploadRes = await fetch("/api/submissions/upload", {
          method: "POST",
          body: uploadFormData,
        });
        const uploadBody = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadBody.error || "Failed to upload attachments.");
        uploadedFileReferences = uploadBody.files || [];
      }

      // 2. Determine submission type
      const hasRepo = Boolean(repoUrl);
      const hasFiles = uploadedFileReferences.length > 0;
      const submissionType = hasRepo && hasFiles ? "COMBINED" : hasFiles ? "FILE_UPLOAD" : "REPOSITORY_URL";

      // 3. Create the submission
      await submit("/api/submissions", {
        assignmentId,
        submissionType,
        repositoryUrl: hasRepo ? repoUrl : undefined,
        uploadedFileReferences,
        description: notes,
      });

      toast.success("Submission saved successfully! Automated AI review has been queued.");
      event.currentTarget.reset();
      setSelectedFiles([]);
      setRepositoryPreview(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit this work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card-body" style={{ display: "grid", gap: 14 }}>
      {/* Tabs to select what to submit */}
      <div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, borderBottom: "1px solid #e2e8f0", paddingBottom: 8 }}>
          <button
            type="button"
            className={\`button \${submissionTab === "both" ? "button-primary" : ""}\`}
            style={{ padding: "5px 12px", fontSize: 13 }}
            onClick={() => setSubmissionTab("both")}
          >
            Repo &amp; File Upload (Both)
          </button>
          <button
            type="button"
            className={\`button \${submissionTab === "file" ? "button-primary" : ""}\`}
            style={{ padding: "5px 12px", fontSize: 13 }}
            onClick={() => setSubmissionTab("file")}
          >
            File Upload Only
          </button>
          <button
            type="button"
            className={\`button \${submissionTab === "repo" ? "button-primary" : ""}\`}
            style={{ padding: "5px 12px", fontSize: 13 }}
            onClick={() => setSubmissionTab("repo")}
          >
            GitHub Repo Only
          </button>
        </div>
        <p className="subtle" style={{ margin: "4px 0 10px 0", fontSize: 13 }}>
          {submissionTab === "both"
            ? "Submit both your GitHub repository and test report files (PDF, DOCX, XLSX, etc.) together for a combined review."
            : submissionTab === "file"
            ? "Upload test reports, bug sheets, or deliverable documents directly without requiring a GitHub repository."
            : "Submit a GitHub repository link for code and implementation review."}
        </p>
      </div>

      {/* GitHub Repository input */}
      {(submissionTab === "both" || submissionTab === "repo") && (
        <div style={{ display: "grid", gap: 6 }}>
          <label htmlFor="repositoryUrl" style={{ fontWeight: 600 }}>
            GitHub repository URL {submissionTab === "both" && <span className="subtle" style={{ fontWeight: 400 }}>(optional if files attached)</span>}
          </label>
          <input
            className={field}
            id="repositoryUrl"
            name="repositoryUrl"
            type="url"
            placeholder="https://github.com/owner/repository"
            required={submissionTab === "repo"}
            onBlur={(event) => void previewRepository(event.currentTarget.value)}
            onChange={() => {
              previewRequest.current += 1;
              setPreviewing(false);
              setRepositoryPreview(null);
              setPreviewError("");
            }}
          />
          {previewing && <p className="subtle" role="status">Loading public repository details…</p>}
          {previewError && <p className="setup-note" role="alert">{previewError}</p>}
          {repositoryPreview && (
            <div className="placeholder-row" aria-live="polite">
              <div>
                <strong>{repositoryPreview.owner}/{repositoryPreview.name}</strong>
                {repositoryPreview.description && <p className="subtle">{repositoryPreview.description}</p>}
                <div className="subtle">Default branch: {repositoryPreview.defaultBranch}</div>
                <div className="subtle">Latest commit: {repositoryPreview.latestCommitSha.slice(0, 12)}{repositoryPreview.latestCommitMessage ? \` · \${repositoryPreview.latestCommitMessage}\` : ""}</div>
                <div className="subtle">{repositoryPreview.latestCommitAuthor}{repositoryPreview.latestCommitDate ? \` · \${new Date(repositoryPreview.latestCommitDate).toLocaleString()}\` : ""}</div>
              </div>
              <a className="button" href={repositoryPreview.repositoryUrl} target="_blank" rel="noreferrer">Open repository</a>
            </div>
          )}
        </div>
      )}

      {/* File Upload input */}
      {(submissionTab === "both" || submissionTab === "file") && (
        <div style={{ display: "grid", gap: 6 }}>
          <label style={{ fontWeight: 600 }}>
            Upload Task Deliverables &amp; Reports {submissionTab === "both" && <span className="subtle" style={{ fontWeight: 400 }}>(optional if repo provided)</span>}
          </label>
          <div
            style={{
              border: "2px dashed #cbd5e1",
              borderRadius: 8,
              padding: "16px",
              textAlign: "center",
              backgroundColor: "#f8fafc",
              cursor: "pointer",
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md,.json,.zip,.png,.jpg,.jpeg"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
            <div style={{ fontSize: 24, marginBottom: 4 }}>📄</div>
            <p style={{ margin: "0 0 4px 0", fontWeight: 500 }}>Click to browse or drag &amp; drop files</p>
            <p className="subtle" style={{ margin: 0, fontSize: 12 }}>
              Supports PDF bug reports, Excel test matrices, Word docs, CSV, JSON, images, and Markdown (up to 25 MB per file)
            </p>
          </div>

          {/* List of selected files with remove buttons */}
          {selectedFiles.length > 0 && (
            <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
              {selectedFiles.map((f, idx) => (
                <div
                  key={\`\${f.name}-\${idx}\`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "6px 12px",
                    background: "#edf2f7",
                    borderRadius: 6,
                    fontSize: 13,
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    📎 <strong>{f.name}</strong> <span className="subtle">({(f.size / 1024).toFixed(1)} KB)</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#e53e3e",
                      cursor: "pointer",
                      fontSize: 14,
                      fontWeight: 600,
                      padding: "2px 6px",
                    }}
                    title="Remove file"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Notes / description */}
      <div style={{ display: "grid", gap: 6 }}>
        <label htmlFor="description" style={{ fontWeight: 600 }}>Notes about this submission</label>
        <textarea
          className={field}
          id="description"
          name="description"
          maxLength={3000}
          placeholder="Describe your testing findings, steps to reproduce, or any specific areas for the reviewer to check..."
          rows={3}
        />
      </div>

      <button className="button button-primary" disabled={busy} type="submit">
        {busy ? "Submitting for review…" : "Record submission"}
      </button>

      <div className="subtle" style={{ fontSize: 12 }}>
        Automated review analyzes your code and uploaded report documents against the task acceptance criteria and expected deliverables.
      </div>
    </form>
  );
}`;

const normalized = content.replace(/\r\n/g, '\n');
if (normalized.includes(target)) {
  fs.writeFileSync('components/admin-forms.tsx', normalized.replace(target, replacement));
  console.log('Successfully updated components/admin-forms.tsx');
} else {
  console.error('Target not found in components/admin-forms.tsx');
  process.exit(1);
}

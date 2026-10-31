import { createSign } from "node:crypto";

export type RepositoryFile = {
  path: string;
  content: string;
};

export type RepositorySnapshot = {
  repositoryUrl: string;
  owner: string;
  repository: string;
  branch: string;
  commitSha: string;
  files: RepositoryFile[];
};

export type PublicGitHubRepositoryMetadata = {
  repositoryUrl: string;
  name: string;
  owner: string;
  description: string;
  defaultBranch: string;
  latestCommitSha: string;
  latestCommitMessage: string;
  latestCommitDate: string;
  latestCommitAuthor: string;
};

type GitHubRepository = {
  name?: string;
  owner?: { login?: string };
  description?: string | null;
  private?: boolean;
  default_branch?: string;
};
type GitHubCommit = {
  sha?: string;
  commit?: {
    message?: string;
    author?: { name?: string; date?: string } | null;
  };
  author?: { login?: string } | null;
};
type GitHubTreeEntry = { path?: string; type?: string; mode?: string; sha?: string; size?: number };
type GitHubTree = { truncated?: boolean; tree?: GitHubTreeEntry[] };
type GitHubBlob = { encoding?: string; content?: string; size?: number };

const API_ORIGIN = "https://api.github.com";
const API_VERSION = "2022-11-28";
const MAX_REPOSITORY_FILES = 40;
const MAX_FILE_BYTES = 24_000;
const MAX_TOTAL_BYTES = 300_000;
const allowedExtensions = new Set([
  ".c", ".cc", ".cpp", ".cs", ".css", ".go", ".h", ".hpp", ".html", ".java", ".js",
  ".jsx", ".md", ".php", ".py", ".rb", ".rs", ".scss", ".sql", ".ts", ".tsx", ".txt",
  ".xml", ".yaml", ".yml", ".toml",
]);
const importantFiles = new Set([
  "readme", "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock",
  "pyproject.toml", "requirements.txt", "pom.xml", "build.gradle", "build.gradle.kts",
  "go.mod", "cargo.toml", "dockerfile",
]);
const ignoredSegments = new Set([
  ".git", ".next", ".turbo", "build", "coverage", "dist", "node_modules", "out", "target", "vendor",
]);

let installationToken: { token: string; expiresAt: number } | undefined;

export class GitHubRepositoryError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "GitHubRepositoryError";
  }
}

export function parseGitHubRepositoryUrl(value: string): { owner: string; repository: string; canonicalUrl: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GitHubRepositoryError("Enter a valid GitHub repository URL.", 400);
  }
  if (
    url.protocol !== "https:"
    || url.hostname !== "github.com"
    || url.username
    || url.password
    || url.port
    || url.search
    || url.hash
  ) {
    throw new GitHubRepositoryError("Only HTTPS repository links hosted on github.com are supported.", 400);
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(parts[0]) || !/^[A-Za-z0-9_.-]{1,100}$/.test(parts[1])) {
    throw new GitHubRepositoryError("Use a repository URL in the format https://github.com/owner/repository.", 400);
  }
  const repository = parts[1].replace(/\.git$/i, "");
  if (!repository || repository === "." || repository === "..") {
    throw new GitHubRepositoryError("The GitHub repository name is invalid.", 400);
  }
  return {
    owner: parts[0],
    repository,
    canonicalUrl: `https://github.com/${parts[0]}/${repository}`,
  };
}

async function publicGitHubGet<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "Shortfundly-InternFlow",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GitHubRepositoryError("GitHub could not be reached. Please try again.", 502);
  }

  if (response.status === 404) {
    throw new GitHubRepositoryError("Repository not found or private. Only public GitHub repositories can be submitted.", 404);
  }
  if (response.status === 403 || response.status === 429) {
    throw new GitHubRepositoryError("GitHub API rate limit reached. Please wait and try again.", 429);
  }
  if (response.status === 409) {
    throw new GitHubRepositoryError("GitHub does not have a latest commit available for this repository yet.", 409);
  }
  if (!response.ok) {
    throw new GitHubRepositoryError(`GitHub could not provide repository information (HTTP ${response.status}).`, 502);
  }
  try {
    return await response.json() as T;
  } catch {
    throw new GitHubRepositoryError("GitHub returned an invalid repository response. Please try again.", 502);
  }
}

export async function fetchPublicGitHubRepositoryMetadata(value: string): Promise<PublicGitHubRepositoryMetadata> {
  const parsed = parseGitHubRepositoryUrl(value);
  const repositoryPath = `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}`;
  const repository = await publicGitHubGet<GitHubRepository>(repositoryPath);
  if (repository.private !== false) {
    throw new GitHubRepositoryError("Only public GitHub repositories can be submitted.", 403);
  }
  const defaultBranch = repository.default_branch;
  if (!defaultBranch) {
    throw new GitHubRepositoryError("GitHub did not provide a default branch for this repository.", 502);
  }
  let latestCommit: GitHubCommit | undefined;
  try {
    latestCommit = await publicGitHubGet<GitHubCommit>(
      `${repositoryPath}/commits/${encodeURIComponent(defaultBranch)}`,
    );
  } catch (error) {
    if (!(error instanceof GitHubRepositoryError) || error.statusCode !== 409) throw error;
  }
  if (latestCommit && (!latestCommit.sha || !/^[a-f0-9]{40}$/i.test(latestCommit.sha))) {
    throw new GitHubRepositoryError("GitHub did not provide valid latest commit information.", 502);
  }
  return {
    repositoryUrl: parsed.canonicalUrl,
    name: repository.name || parsed.repository,
    owner: repository.owner?.login || parsed.owner,
    description: repository.description || "",
    defaultBranch,
    latestCommitSha: latestCommit?.sha || "",
    latestCommitMessage: latestCommit?.commit?.message?.split(/\r?\n/, 1)[0]?.slice(0, 500) || "",
    latestCommitDate: latestCommit?.commit?.author?.date || "",
    latestCommitAuthor: latestCommit?.commit?.author?.name || latestCommit?.author?.login || "",
  };
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function appJwt(): string {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const key = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!appId || !key) throw new Error("Private GitHub repository access is not configured.");
  const now = Math.floor(Date.now() / 1000);
  const payload = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(JSON.stringify({ iat: now - 30, exp: now + 8 * 60, iss: appId }))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(payload);
  return `${payload}.${signer.sign(key, "base64url")}`;
}

async function githubToken(): Promise<string | undefined> {
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID?.trim();

  // Public repository access works without GitHub App authentication.
  // Only attempt App authentication when an installation ID is configured.
  if (!installationId) return undefined;
  if (installationToken && installationToken.expiresAt > Date.now() + 60_000) return installationToken.token;

  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${appJwt()}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("Could not obtain authorized GitHub repository access.");
  }
  if (!response.ok) throw new Error("GitHub App authorization failed. Verify the app installation and read-only Contents permission.");
  const tokenResponse = await response.json() as { token?: string; expires_at?: string };
  if (!tokenResponse.token) throw new Error("GitHub did not issue a repository access token.");
  installationToken = { token: tokenResponse.token, expiresAt: Date.parse(tokenResponse.expires_at || "") || Date.now() + 50 * 60_000 };
  return installationToken.token;
}

async function githubGet<T>(path: string, token?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Shortfundly-InternFlow",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("GitHub could not be reached. Please retry the repository review later.");
  }
  if (response.status === 404) throw new Error("Repository not found or not accessible. Make it public or grant the installed GitHub App read-only Contents access.");
  if (response.status === 403 || response.status === 429) throw new Error("GitHub API rate limit or permission limit reached. Retry later or check the GitHub App installation.");
  if (!response.ok) throw new Error(`GitHub returned an unavailable response (${response.status}). Please retry later.`);
  return response.json() as Promise<T>;
}

function isRelevantFile(entry: GitHubTreeEntry): boolean {
  if (entry.type !== "blob" || entry.mode !== "100644" || !entry.path || !entry.sha) return false;
  const segments = entry.path.split("/");
  if (segments.some((segment) => ignoredSegments.has(segment.toLowerCase()))) return false;
  const basename = segments[segments.length - 1].toLowerCase();
  const dot = basename.lastIndexOf(".");
  return importantFiles.has(basename) || (dot >= 0 && allowedExtensions.has(basename.slice(dot)));
}

function decodeBlob(blob: GitHubBlob): string | undefined {
  if (blob.encoding !== "base64" || !blob.content) return undefined;
  const buffer = Buffer.from(blob.content.replace(/\s/g, ""), "base64");
  if (!buffer.length || buffer.length > MAX_FILE_BYTES || buffer.includes(0)) return undefined;
  const content = buffer.toString("utf8");
  if (content.includes("\uFFFD")) return undefined;
  return content;
}

export async function retrieveGitHubRepository(repositoryUrl: string): Promise<RepositorySnapshot> {
  const parsed = parseGitHubRepositoryUrl(repositoryUrl);
  const token = await githubToken();
  const repositoryPath = `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}`;
  const metadata = await githubGet<GitHubRepository>(repositoryPath, token);
  const branch = metadata.default_branch;
  if (!branch) throw new Error("GitHub did not provide a default branch for this repository.");
  const commit = await githubGet<GitHubCommit>(`${repositoryPath}/commits/${encodeURIComponent(branch)}`, token);
  if (!commit.sha || !/^[a-f0-9]{40}$/i.test(commit.sha)) throw new Error("GitHub did not return a valid commit for the default branch.");
  const tree = await githubGet<GitHubTree>(`${repositoryPath}/git/trees/${commit.sha}?recursive=1`, token);
  if (tree.truncated) throw new Error("This repository is too large to review safely. Reduce its size or ask an administrator for guidance.");

  const selected = (tree.tree || [])
    .filter(isRelevantFile)
    .sort((left, right) => {
      const leftImportant = importantFiles.has(left.path?.split("/").pop()?.toLowerCase() || "") ? 0 : 1;
      const rightImportant = importantFiles.has(right.path?.split("/").pop()?.toLowerCase() || "") ? 0 : 1;
      return leftImportant - rightImportant || (left.path || "").localeCompare(right.path || "");
    })
    .slice(0, MAX_REPOSITORY_FILES);

  const files: RepositoryFile[] = [];
  let totalBytes = 0;
  for (const entry of selected) {
    const size = entry.size || 0;
    if (size <= 0 || size > MAX_FILE_BYTES || totalBytes + size > MAX_TOTAL_BYTES) continue;
    const blob = await githubGet<GitHubBlob>(`${repositoryPath}/git/blobs/${entry.sha}`, token);
    const content = decodeBlob(blob);
    if (!content) continue;
    const actualBytes = Buffer.byteLength(content, "utf8");
    if (actualBytes > MAX_FILE_BYTES || totalBytes + actualBytes > MAX_TOTAL_BYTES) continue;
    files.push({ path: entry.path || "", content });
    totalBytes += actualBytes;
  }

  if (!files.length) throw new Error("No supported text source files could be retrieved. Add source files or a README and submit again.");
  return {
    repositoryUrl: parsed.canonicalUrl,
    owner: parsed.owner,
    repository: parsed.repository,
    branch,
    commitSha: commit.sha,
    files,
  };
}

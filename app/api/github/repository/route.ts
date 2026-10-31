import { apiUser } from "@/lib/authz";
import { fetchPublicGitHubRepositoryMetadata, GitHubRepositoryError } from "@/lib/automation/github-repository";
import { jsonError } from "@/lib/http";

export async function GET(request: Request) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (!["ADMIN", "INTERN"].includes(auth.user.role)) return jsonError("Access denied.", 403);

  const repositoryUrl = new URL(request.url).searchParams.get("url");
  if (!repositoryUrl) return jsonError("A GitHub repository URL is required.", 400);

  try {
    const repository = await fetchPublicGitHubRepositoryMetadata(repositoryUrl);
    return Response.json({ item: repository });
  } catch (error) {
    if (error instanceof GitHubRepositoryError) return jsonError(error.message, error.statusCode);
    console.error("GitHub repository metadata lookup failed.");
    return jsonError("Could not load public GitHub repository information. Please try again.", 502);
  }
}

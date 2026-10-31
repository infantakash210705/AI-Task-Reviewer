import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPublicGitHubRepositoryMetadata } from "@/lib/automation/github-repository";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("public GitHub repository metadata", () => {
  it("fetches public repository metadata and latest commit without credentials", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        name: "catalog",
        owner: { login: "acme" },
        description: "A public catalog app",
        private: false,
        default_branch: "main",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sha: "a".repeat(40),
        commit: {
          message: "Add catalog",
          author: { name: "A Developer", date: "2026-10-20T10:00:00Z" },
        },
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPublicGitHubRepositoryMetadata("https://github.com/acme/catalog");

    expect(result).toEqual({
      repositoryUrl: "https://github.com/acme/catalog",
      name: "catalog",
      owner: "acme",
      description: "A public catalog app",
      defaultBranch: "main",
      latestCommitSha: "a".repeat(40),
      latestCommitMessage: "Add catalog",
      latestCommitDate: "2026-10-20T10:00:00Z",
      latestCommitAuthor: "A Developer",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, options] of fetchMock.mock.calls) {
      const headers = (options as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
      expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
    }
  });

  it("rejects malformed GitHub URLs without making an API request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchPublicGitHubRepositoryMetadata("https://github.com.attacker.example/acme/catalog"))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handles missing or private repositories with a safe explanation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));

    await expect(fetchPublicGitHubRepositoryMetadata("https://github.com/acme/private-repo"))
      .rejects.toMatchObject({
        name: "GitHubRepositoryError",
        statusCode: 404,
        message: expect.stringContaining("not found or private"),
      });
  });

  it("rejects a repository marked private by GitHub", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      private: true,
      default_branch: "main",
    }), { status: 200 })));

    await expect(fetchPublicGitHubRepositoryMetadata("https://github.com/acme/private-repo"))
      .rejects.toMatchObject({ statusCode: 403, message: "Only public GitHub repositories can be submitted." });
  });

  it("returns repository details when no latest commit exists yet", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        name: "empty-repo",
        owner: { login: "acme" },
        description: null,
        private: false,
        default_branch: "main",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 409 })));

    const result = await fetchPublicGitHubRepositoryMetadata("https://github.com/acme/empty-repo");

    expect(result.defaultBranch).toBe("main");
    expect(result.latestCommitSha).toBe("");
    expect(result.latestCommitMessage).toBe("");
  });

  it("reports GitHub rate limits separately from other API failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 403 })));

    await expect(fetchPublicGitHubRepositoryMetadata("https://github.com/acme/catalog"))
      .rejects.toMatchObject({ statusCode: 429, message: expect.stringContaining("rate limit") });
  });
});

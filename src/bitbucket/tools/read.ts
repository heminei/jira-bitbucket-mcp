import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsonResult, truncate } from "../../shared/format.js";
import type { BitbucketClient } from "../bitbucket-client.js";
import { prSchema, repoSchema, summarizePullRequest } from "../common.js";

export function registerReadTools(server: McpServer, client: BitbucketClient): void {
    server.registerTool(
        "bitbucket_myself",
        {
            title: "Bitbucket: verify connection",
            description: "Verify the configured token by reading the current user's recent repositories.",
            inputSchema: {},
        },
        async () => {
            const recent = await client.request<{ values?: Record<string, unknown>[] }>("/profile/recent/repos", {
                query: { limit: 5 },
            });

            return jsonResult({
                baseUrl: client.baseUrl,
                readOnlyMode: client.readOnly,
                mergeEnabled: client.allowMerge,
                recentRepos: (recent.values ?? []).map((repo) => ({
                    slug: repo.slug ?? null,
                    name: repo.name ?? null,
                    project: (repo.project as Record<string, unknown> | undefined)?.key ?? null,
                })),
            });
        },
    );

    server.registerTool(
        "bitbucket_list_repos",
        {
            title: "Bitbucket: list repositories",
            description: "List repositories, optionally scoped to a project key.",
            inputSchema: {
                project: z.string().trim().optional().describe("Project key. Falls back to BITBUCKET_DEFAULT_PROJECT."),
                search: z.string().trim().optional().describe("Filter on repository name or slug."),
                limit: z.number().int().min(1).max(200).optional().describe("Defaults to 50."),
            },
        },
        async ({ project, search, limit }) => {
            const path = project ? `/projects/${encodeURIComponent(project)}/repos` : "/repos";
            const response = await client.request<{ values?: Record<string, unknown>[]; size?: number }>(path, {
                query: { limit: limit ?? 50, name: search },
            });

            return jsonResult({
                total: response.size ?? 0,
                repos: (response.values ?? []).map((repo) => ({
                    project: (repo.project as Record<string, unknown> | undefined)?.key ?? null,
                    slug: repo.slug ?? null,
                    name: repo.name ?? null,
                    state: repo.state ?? null,
                    public: repo.public ?? false,
                })),
            });
        },
    );

    server.registerTool(
        "bitbucket_list_pull_requests",
        {
            title: "Bitbucket: list pull requests",
            description: "List pull requests for a repository, filtered by state, branch or role.",
            inputSchema: {
                ...repoSchema,
                state: z.enum(["OPEN", "MERGED", "DECLINED", "ALL"]).optional().describe("Defaults to OPEN."),
                direction: z.enum(["INCOMING", "OUTGOING"]).optional().describe("Relative to the `at` branch."),
                at: z.string().trim().optional().describe('Branch ref to filter on, e.g. "refs/heads/master".'),
                limit: z.number().int().min(1).max(100).optional().describe("Defaults to 25."),
                start: z.number().int().min(0).optional().describe("Pagination offset."),
            },
        },
        async ({ project, repo, state, direction, at, limit, start }) => {
            const response = await client.request<{
                values?: Record<string, unknown>[];
                size?: number;
                isLastPage?: boolean;
                nextPageStart?: number;
            }>(`${client.repoPath(project, repo)}/pull-requests`, {
                query: { state: state ?? "OPEN", direction, at, limit: limit ?? 25, start: start ?? 0 },
            });

            return jsonResult({
                size: response.size ?? 0,
                isLastPage: response.isLastPage ?? true,
                nextPageStart: response.nextPageStart ?? null,
                pullRequests: (response.values ?? []).map((pr) => summarizePullRequest(pr, client)),
            });
        },
    );

    server.registerTool(
        "bitbucket_get_pull_request",
        {
            title: "Bitbucket: get pull request",
            description: "Fetch a single pull request, optionally with its changed files and comments.",
            inputSchema: {
                ...prSchema,
                includeChanges: z.boolean().optional().describe("Append the list of changed files."),
                includeComments: z.boolean().optional().describe("Append the review comments."),
                raw: z.boolean().optional().describe("Return the untouched Bitbucket payload."),
            },
        },
        async ({ project, repo, pullRequestId, includeChanges, includeComments, raw }) => {
            const base = `${client.repoPath(project, repo)}/pull-requests/${pullRequestId}`;
            const pr = await client.request<Record<string, unknown>>(base);

            if (raw) {
                return jsonResult(pr);
            }

            const result: Record<string, unknown> = summarizePullRequest(pr, client);

            if (includeChanges) {
                const changes = await client.request<{ values?: Record<string, unknown>[] }>(`${base}/changes`, {
                    query: { limit: 200 },
                });
                result.changes = (changes.values ?? []).map((change) => ({
                    path: (change.path as Record<string, unknown> | undefined)?.toString ?? null,
                    type: change.type ?? null,
                    linesAdded: (change as { linesAdded?: number }).linesAdded ?? null,
                    linesRemoved: (change as { linesRemoved?: number }).linesRemoved ?? null,
                }));
            }

            if (includeComments) {
                const activities = await client.request<{ values?: Record<string, unknown>[] }>(`${base}/activities`, {
                    query: { limit: 100 },
                });
                result.comments = (activities.values ?? [])
                    .filter((activity) => activity.action === "COMMENTED")
                    .map((activity) => {
                        const comment = (activity.comment ?? {}) as Record<string, unknown>;
                        return {
                            id: comment.id ?? null,
                            author: (comment.author as Record<string, unknown> | undefined)?.displayName ?? null,
                            createdDate: comment.createdDate ?? null,
                            text: truncate(comment.text, client.maxTextLength),
                        };
                    });
            }

            return jsonResult(result);
        },
    );

    server.registerTool(
        "bitbucket_get_pull_request_diff",
        {
            title: "Bitbucket: get pull request diff",
            description: "Return the unified diff of a pull request, optionally limited to a single file path.",
            inputSchema: {
                ...prSchema,
                path: z.string().trim().optional().describe("Restrict the diff to this file path."),
                contextLines: z.number().int().min(0).max(50).optional().describe("Context lines around each hunk. Defaults to 3."),
            },
        },
        async ({ project, repo, pullRequestId, path, contextLines }) => {
            const suffix = path ? `/${path.split("/").map(encodeURIComponent).join("/")}` : "";
            const diff = await client.request<string>(
                `${client.repoPath(project, repo)}/pull-requests/${pullRequestId}/diff${suffix}`,
                {
                    query: { contextLines: contextLines ?? 3 },
                    headers: { Accept: "text/plain" },
                },
            );

            return jsonResult({ pullRequestId, path: path ?? null, diff: truncate(diff, client.maxTextLength) });
        },
    );

    server.registerTool(
        "bitbucket_list_branches",
        {
            title: "Bitbucket: list branches",
            description: "List branches in a repository, optionally filtered by a substring.",
            inputSchema: {
                ...repoSchema,
                search: z.string().trim().optional().describe("Filter text applied to branch names."),
                limit: z.number().int().min(1).max(100).optional().describe("Defaults to 25."),
            },
        },
        async ({ project, repo, search, limit }) => {
            const response = await client.request<{ values?: Record<string, unknown>[]; size?: number }>(
                `${client.repoPath(project, repo)}/branches`,
                { query: { filterText: search, limit: limit ?? 25, details: true } },
            );

            return jsonResult({
                size: response.size ?? 0,
                branches: (response.values ?? []).map((branch) => ({
                    id: branch.id ?? null,
                    displayId: branch.displayId ?? null,
                    latestCommit: branch.latestCommit ?? null,
                    isDefault: branch.isDefault ?? false,
                })),
            });
        },
    );

    server.registerTool(
        "bitbucket_list_commits",
        {
            title: "Bitbucket: list commits",
            description: "List commits on a branch or between two refs.",
            inputSchema: {
                ...repoSchema,
                until: z.string().trim().optional().describe("Ref to list commits from, e.g. a branch name or commit id."),
                since: z.string().trim().optional().describe("Exclude commits reachable from this ref."),
                path: z.string().trim().optional().describe("Only commits touching this path."),
                limit: z.number().int().min(1).max(100).optional().describe("Defaults to 25."),
            },
        },
        async ({ project, repo, until, since, path, limit }) => {
            const response = await client.request<{ values?: Record<string, unknown>[] }>(
                `${client.repoPath(project, repo)}/commits`,
                { query: { until, since, path, limit: limit ?? 25 } },
            );

            return jsonResult({
                commits: (response.values ?? []).map((commit) => ({
                    id: commit.id ?? null,
                    displayId: commit.displayId ?? null,
                    author: (commit.author as Record<string, unknown> | undefined)?.name ?? null,
                    authorTimestamp: commit.authorTimestamp ?? null,
                    message: truncate(commit.message, 500),
                })),
            });
        },
    );

    server.registerTool(
        "bitbucket_get_file",
        {
            title: "Bitbucket: read file",
            description: "Read a file's contents at a given ref.",
            inputSchema: {
                ...repoSchema,
                path: z.string().trim().min(1).describe("Repository-relative file path."),
                at: z.string().trim().optional().describe("Branch, tag or commit id. Defaults to the default branch."),
            },
        },
        async ({ project, repo, path, at }) => {
            const encodedPath = path.split("/").map(encodeURIComponent).join("/");
            const content = await client.request<string>(`${client.repoPath(project, repo)}/raw/${encodedPath}`, {
                query: { at },
                headers: { Accept: "text/plain" },
            });

            return jsonResult({ path, at: at ?? null, content: truncate(content, client.maxTextLength) });
        },
    );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsonResult, truncate } from "../../shared/format.js";
import type { BitbucketClient } from "../bitbucket-client.js";
import { encodePath, prSchema, repoSchema, summarizeChange, summarizeComment, summarizePullRequest } from "../common.js";

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
                result.changes = (changes.values ?? []).map(summarizeChange);
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

    server.registerTool(
        "bitbucket_list_pull_request_comments",
        {
            title: "Bitbucket: list pull request comments",
            description:
                "List the comments on a pull request, including inline anchors (file and line), review state and nested replies.",
            inputSchema: {
                ...prSchema,
                limit: z.number().int().min(1).max(100).optional().describe("Activities to scan. Defaults to 50."),
                start: z.number().int().min(0).optional().describe("Pagination offset."),
            },
        },
        async ({ project, repo, pullRequestId, limit, start }) => {
            const response = await client.request<{
                values?: Record<string, unknown>[];
                isLastPage?: boolean;
                nextPageStart?: number;
            }>(`${client.repoPath(project, repo)}/pull-requests/${pullRequestId}/activities`, {
                query: { limit: limit ?? 50, start: start ?? 0 },
            });

            return jsonResult({
                pullRequestId,
                isLastPage: response.isLastPage ?? true,
                nextPageStart: response.nextPageStart ?? null,
                comments: (response.values ?? [])
                    .filter((activity) => activity.action === "COMMENTED" && activity.comment)
                    .map((activity) =>
                        summarizeComment(
                            activity.comment as Record<string, unknown>,
                            client,
                            activity.commentAnchor as Record<string, unknown> | undefined,
                        ),
                    ),
            });
        },
    );

    server.registerTool(
        "bitbucket_list_pull_request_changes",
        {
            title: "Bitbucket: list pull request changes",
            description: "List the files changed by a pull request with the change type (ADD, MODIFY, DELETE, MOVE).",
            inputSchema: {
                ...prSchema,
                limit: z.number().int().min(1).max(500).optional().describe("Defaults to 100."),
                start: z.number().int().min(0).optional().describe("Pagination offset."),
            },
        },
        async ({ project, repo, pullRequestId, limit, start }) => {
            const response = await client.request<{
                values?: Record<string, unknown>[];
                size?: number;
                isLastPage?: boolean;
                nextPageStart?: number;
            }>(`${client.repoPath(project, repo)}/pull-requests/${pullRequestId}/changes`, {
                query: { limit: limit ?? 100, start: start ?? 0 },
            });

            return jsonResult({
                pullRequestId,
                size: response.size ?? 0,
                isLastPage: response.isLastPage ?? true,
                nextPageStart: response.nextPageStart ?? null,
                changes: (response.values ?? []).map(summarizeChange),
            });
        },
    );

    server.registerTool(
        "bitbucket_get_build_status",
        {
            title: "Bitbucket: get build status",
            description:
                "Return CI build statuses for a commit, or for the latest commit of a pull request's source branch.",
            inputSchema: {
                ...repoSchema,
                commitId: z.string().trim().regex(/^[0-9a-fA-F]{7,40}$/, "Expected a commit hash").optional().describe("Full or abbreviated commit hash."),
                pullRequestId: z.number().int().min(1).optional().describe("Use this pull request's latest source commit instead of commitId."),
            },
        },
        async ({ project, repo, commitId, pullRequestId }) => {
            let commit = commitId;
            if (!commit) {
                if (pullRequestId === undefined) {
                    throw new Error("Provide either commitId or pullRequestId.");
                }
                const pr = await client.request<{ fromRef?: { latestCommit?: string } }>(
                    `${client.repoPath(project, repo)}/pull-requests/${pullRequestId}`,
                );
                commit = pr.fromRef?.latestCommit;
                if (!commit) {
                    throw new Error(`Could not determine the source commit of PR #${pullRequestId}.`);
                }
            }

            // Build statuses live under their own REST root, not /rest/api/1.0.
            const response = await client.request<{ values?: Record<string, unknown>[] }>(
                `/commits/${encodeURIComponent(commit)}`,
                { apiPrefix: "/rest/build-status/1.0", query: { limit: 100 } },
            );

            const statuses = (response.values ?? []).map((status) => ({
                state: status.state ?? null,
                key: status.key ?? null,
                name: status.name ?? null,
                url: status.url ?? null,
                description: truncate(status.description, 500),
                dateAdded: status.dateAdded ?? null,
            }));
            const count = (state: string) => statuses.filter((status) => status.state === state).length;

            return jsonResult({
                commit,
                successful: count("SUCCESSFUL"),
                failed: count("FAILED"),
                inProgress: count("INPROGRESS"),
                statuses,
            });
        },
    );

    server.registerTool(
        "bitbucket_browse_files",
        {
            title: "Bitbucket: browse files",
            description:
                "List a directory's entries, or every file path under it when recursive is true. Use bitbucket_get_file to read a file.",
            inputSchema: {
                ...repoSchema,
                path: z.string().trim().optional().describe("Repository-relative directory. Defaults to the repository root."),
                at: z.string().trim().optional().describe("Branch, tag or commit id. Defaults to the default branch."),
                recursive: z.boolean().optional().describe("Return a flat list of all file paths below path."),
                limit: z.number().int().min(1).max(1000).optional().describe("Defaults to 100."),
                start: z.number().int().min(0).optional().describe("Pagination offset."),
            },
        },
        async ({ project, repo, path, at, recursive, limit, start }) => {
            const suffix = path ? `/${encodePath(path)}` : "";
            const query = { at, limit: limit ?? 100, start: start ?? 0 };

            if (recursive) {
                const response = await client.request<{
                    values?: string[];
                    isLastPage?: boolean;
                    nextPageStart?: number;
                }>(`${client.repoPath(project, repo)}/files${suffix}`, { query });

                return jsonResult({
                    path: path ?? "",
                    isLastPage: response.isLastPage ?? true,
                    nextPageStart: response.nextPageStart ?? null,
                    files: response.values ?? [],
                });
            }

            const response = await client.request<{
                children?: {
                    values?: Record<string, unknown>[];
                    isLastPage?: boolean;
                    nextPageStart?: number;
                };
                lines?: unknown;
            }>(`${client.repoPath(project, repo)}/browse${suffix}`, { query });

            if (!response.children) {
                throw new Error(`${path ?? ""} is a file, not a directory. Use bitbucket_get_file to read it.`);
            }

            return jsonResult({
                path: path ?? "",
                isLastPage: response.children.isLastPage ?? true,
                nextPageStart: response.children.nextPageStart ?? null,
                entries: (response.children.values ?? []).map((entry) => ({
                    name: (entry.path as Record<string, unknown> | undefined)?.name ?? null,
                    type: entry.type ?? null,
                    size: entry.size ?? null,
                })),
            });
        },
    );

    server.registerTool(
        "bitbucket_search_code",
        {
            title: "Bitbucket: search code",
            description:
                "Search file contents across repositories. Requires the Bitbucket Data Center built-in code search; " +
                "unlike other tools, project and repo are not defaulted from the environment.",
            inputSchema: {
                query: z.string().trim().min(1).describe("Search terms."),
                project: z.string().trim().optional().describe("Restrict to this project key."),
                repo: z.string().trim().optional().describe("Restrict to this repository slug."),
                path: z.string().trim().optional().describe("Restrict to paths matching this text."),
                limit: z.number().int().min(1).max(100).optional().describe("Maximum files to return. Defaults to 25."),
            },
        },
        async ({ query, project, repo, path, limit }) => {
            const terms = [query];
            if (project) {
                terms.push(`project:${project}`);
            }
            if (repo) {
                terms.push(`repo:${repo}`);
            }
            if (path) {
                terms.push(`path:${path}`);
            }

            const response = await client.request<{
                code?: { values?: Record<string, unknown>[]; count?: number; isLastPage?: boolean };
            }>("/search", {
                apiPrefix: "/rest/search/latest",
                method: "POST",
                body: {
                    query: terms.join(" "),
                    entities: { code: {} },
                    limits: { primary: limit ?? 25, secondary: 5 },
                },
            });

            const stripMarkup = (text: unknown) => String(text ?? "").replace(/<\/?[^>]+>/g, "");
            const results = (response.code?.values ?? []).map((hit) => {
                const repository = (hit.repository ?? {}) as Record<string, unknown>;
                const file = hit.file as { path?: unknown; toString?: unknown } | string | undefined;
                const filePath = typeof file === "string" ? file : (file?.path ?? file?.toString ?? null);
                const contexts = (Array.isArray(hit.hitContexts) ? hit.hitContexts.flat() : []) as Record<string, unknown>[];

                return {
                    project: (repository.project as Record<string, unknown> | undefined)?.key ?? null,
                    repo: repository.slug ?? null,
                    file: filePath,
                    hitCount: hit.hitCount ?? null,
                    matches: contexts.slice(0, 5).map((context) => ({
                        line: context.line ?? null,
                        text: truncate(stripMarkup(context.text), 300),
                    })),
                };
            });

            return jsonResult({ total: response.code?.count ?? results.length, results });
        },
    );
}

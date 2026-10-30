import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsonResult, textResult } from "../../shared/format.js";
import type { BitbucketClient } from "../bitbucket-client.js";
import { assertWritable, prSchema, repoSchema, summarizePullRequest } from "../common.js";

/** Bitbucket rejects concurrent edits unless the caller supplies the current entity version. */
async function currentVersion(client: BitbucketClient, base: string, entity = "pull request"): Promise<number> {
    const current = await client.request<{ version?: number }>(base);
    if (typeof current.version !== "number") {
        throw new Error(`Could not read the ${entity} version required for this operation.`);
    }
    return current.version;
}

export function registerWriteTools(server: McpServer, client: BitbucketClient): void {
    server.registerTool(
        "bitbucket_create_pull_request",
        {
            title: "Bitbucket: create pull request",
            description: "Open a pull request between two branches in the same repository.",
            inputSchema: {
                ...repoSchema,
                title: z.string().trim().min(1).describe("Pull request title."),
                fromBranch: z.string().trim().min(1).describe('Source branch, e.g. "feature/PROJ-123" or a full refs/heads/ ref.'),
                toBranch: z.string().trim().min(1).describe('Target branch, e.g. "master".'),
                description: z.string().optional().describe("Pull request description in Markdown."),
                reviewers: z.array(z.string().trim()).optional().describe("Bitbucket usernames (slugs) to add as reviewers."),
            },
        },
        async ({ project, repo, title, fromBranch, toBranch, description, reviewers }) => {
            assertWritable(client);

            const resolved = client.resolveRepo(project, repo);
            const toRef = (branch: string) => ({
                id: branch.startsWith("refs/") ? branch : `refs/heads/${branch}`,
                repository: { slug: resolved.repo, project: { key: resolved.project } },
            });

            const created = await client.request<Record<string, unknown>>(`${client.repoPath(project, repo)}/pull-requests`, {
                method: "POST",
                body: {
                    title,
                    description,
                    fromRef: toRef(fromBranch),
                    toRef: toRef(toBranch),
                    reviewers: (reviewers ?? []).map((name) => ({ user: { name } })),
                },
            });

            return jsonResult(summarizePullRequest(created, client));
        },
    );

    server.registerTool(
        "bitbucket_update_pull_request",
        {
            title: "Bitbucket: update pull request",
            description: "Update the title, description or target branch of an open pull request.",
            inputSchema: {
                ...prSchema,
                title: z.string().trim().optional(),
                description: z.string().optional().describe("Replaces the whole description."),
                toBranch: z.string().trim().optional().describe("Retarget the pull request at this branch."),
            },
        },
        async ({ project, repo, pullRequestId, title, description, toBranch }) => {
            assertWritable(client);

            if (title === undefined && description === undefined && toBranch === undefined) {
                throw new Error("Nothing to update: provide a title, description or toBranch.");
            }

            const base = `${client.repoPath(project, repo)}/pull-requests/${pullRequestId}`;
            const body: Record<string, unknown> = { version: await currentVersion(client, base) };
            if (title !== undefined) {
                body.title = title;
            }
            if (description !== undefined) {
                body.description = description;
            }
            if (toBranch !== undefined) {
                body.toRef = { id: toBranch.startsWith("refs/") ? toBranch : `refs/heads/${toBranch}` };
            }

            const updated = await client.request<Record<string, unknown>>(base, { method: "PUT", body });

            return jsonResult(summarizePullRequest(updated, client));
        },
    );

    server.registerTool(
        "bitbucket_add_pull_request_comment",
        {
            title: "Bitbucket: comment on pull request",
            description: "Add a general comment, an inline comment anchored to a file and line, or a reply to an existing comment.",
            inputSchema: {
                ...prSchema,
                text: z.string().trim().min(1).describe("Comment body in Markdown."),
                parentId: z.number().int().min(1).optional().describe("Id of the comment to reply to."),
                path: z.string().trim().optional().describe("File path for an inline comment."),
                line: z.number().int().min(1).optional().describe("Line number for an inline comment. Requires path."),
                lineType: z.enum(["ADDED", "REMOVED", "CONTEXT"]).optional().describe("Diff line type. Defaults to CONTEXT."),
            },
        },
        async ({ project, repo, pullRequestId, text, parentId, path, line, lineType }) => {
            assertWritable(client);

            if (line !== undefined && !path) {
                throw new Error("path is required when line is provided.");
            }

            const body: Record<string, unknown> = { text };
            if (parentId !== undefined) {
                body.parent = { id: parentId };
            }
            if (path) {
                body.anchor = {
                    path,
                    line,
                    lineType: line === undefined ? undefined : (lineType ?? "CONTEXT"),
                    fileType: "TO",
                    diffType: "EFFECTIVE",
                };
            }

            const comment = await client.request<{ id?: number }>(
                `${client.repoPath(project, repo)}/pull-requests/${pullRequestId}/comments`,
                { method: "POST", body },
            );

            return textResult(`Added comment ${comment.id ?? ""} to PR #${pullRequestId}.`.trim());
        },
    );

    server.registerTool(
        "bitbucket_update_pull_request_comment",
        {
            title: "Bitbucket: edit pull request comment",
            description: "Edit a comment's text, mark it resolved or reopen it, or change its severity (NORMAL comment vs BLOCKER task).",
            inputSchema: {
                ...prSchema,
                commentId: z.number().int().min(1).describe("Comment id."),
                text: z.string().trim().min(1).optional().describe("New comment text in Markdown."),
                state: z.enum(["OPEN", "RESOLVED"]).optional().describe("Resolve or reopen the comment."),
                severity: z.enum(["NORMAL", "BLOCKER"]).optional().describe("BLOCKER turns the comment into a task."),
            },
        },
        async ({ project, repo, pullRequestId, commentId, text, state, severity }) => {
            assertWritable(client);

            if (text === undefined && state === undefined && severity === undefined) {
                throw new Error("Nothing to update: provide text, state or severity.");
            }

            const path = `${client.repoPath(project, repo)}/pull-requests/${pullRequestId}/comments/${commentId}`;
            const body: Record<string, unknown> = { version: await currentVersion(client, path, "comment") };
            if (text !== undefined) {
                body.text = text;
            }
            if (state !== undefined) {
                body.state = state;
            }
            if (severity !== undefined) {
                body.severity = severity;
            }

            await client.request(path, { method: "PUT", body });

            return textResult(`Updated comment ${commentId} on PR #${pullRequestId}.`);
        },
    );

    server.registerTool(
        "bitbucket_review_pull_request",
        {
            title: "Bitbucket: set review status",
            description: "Set your review status on a pull request: approved, needs work, or unapproved.",
            inputSchema: {
                ...prSchema,
                status: z.enum(["APPROVED", "NEEDS_WORK", "UNAPPROVED"]).describe("Your review status."),
            },
        },
        async ({ project, repo, pullRequestId, status }) => {
            assertWritable(client);

            await client.request(`${client.repoPath(project, repo)}/pull-requests/${pullRequestId}/participants/me`, {
                method: "PUT",
                body: { status },
            });

            return textResult(`Set review status of PR #${pullRequestId} to ${status}.`);
        },
    );

    if (client.allowDelete) {
        server.registerTool(
            "bitbucket_delete_pull_request_comment",
            {
                title: "Bitbucket: delete pull request comment",
                description:
                    "Permanently delete a pull request comment (only your own, unless you are an admin). Requires BITBUCKET_ALLOW_DELETE=1.",
                inputSchema: {
                    ...prSchema,
                    commentId: z.number().int().min(1).describe("Comment id."),
                    confirm: z.literal(true).describe("Must be true to acknowledge that the deletion is irreversible."),
                },
            },
            async ({ project, repo, pullRequestId, commentId }) => {
                assertWritable(client);

                if (!client.allowDelete) {
                    throw new Error("Deleting comments is disabled; start the server with BITBUCKET_ALLOW_DELETE=1 to enable it.");
                }

                const path = `${client.repoPath(project, repo)}/pull-requests/${pullRequestId}/comments/${commentId}`;
                await client.request(path, {
                    method: "DELETE",
                    query: { version: await currentVersion(client, path, "comment") },
                });

                return textResult(`Deleted comment ${commentId} on PR #${pullRequestId}.`);
            },
        );
    }

    if (!client.allowMerge) {
        return;
    }

    server.registerTool(
        "bitbucket_merge_pull_request",
        {
            title: "Bitbucket: merge pull request",
            description: "Merge an open pull request. Requires BITBUCKET_ALLOW_MERGE=1.",
            inputSchema: {
                ...prSchema,
                confirm: z.literal(true).describe("Must be true to acknowledge that the merge affects a shared branch."),
                message: z.string().trim().optional().describe("Custom merge commit message."),
            },
        },
        async ({ project, repo, pullRequestId, message }) => {
            assertWritable(client);

            const base = `${client.repoPath(project, repo)}/pull-requests/${pullRequestId}`;
            const merged = await client.request<Record<string, unknown>>(`${base}/merge`, {
                method: "POST",
                query: { version: await currentVersion(client, base) },
                body: message ? { message } : {},
            });

            return jsonResult(summarizePullRequest(merged, client));
        },
    );

    server.registerTool(
        "bitbucket_decline_pull_request",
        {
            title: "Bitbucket: decline pull request",
            description: "Decline an open pull request. Requires BITBUCKET_ALLOW_MERGE=1.",
            inputSchema: {
                ...prSchema,
                confirm: z.literal(true).describe("Must be true to acknowledge the pull request will be closed."),
            },
        },
        async ({ project, repo, pullRequestId }) => {
            assertWritable(client);

            const base = `${client.repoPath(project, repo)}/pull-requests/${pullRequestId}`;
            await client.request(`${base}/decline`, {
                method: "POST",
                query: { version: await currentVersion(client, base) },
            });

            return textResult(`Declined PR #${pullRequestId}.`);
        },
    );
}

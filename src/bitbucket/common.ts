import { z } from "zod";
import { truncate } from "../shared/format.js";
import type { BitbucketClient } from "./bitbucket-client.js";

export const repoSchema = {
    project: z.string().trim().optional().describe("Project key. Falls back to BITBUCKET_DEFAULT_PROJECT."),
    repo: z.string().trim().optional().describe("Repository slug. Falls back to BITBUCKET_DEFAULT_REPO."),
};

export const prSchema = {
    ...repoSchema,
    pullRequestId: z.number().int().min(1).describe("Pull request id."),
};

/** Second line of defence: write tools are not registered in read-only mode either. */
export function assertWritable(client: BitbucketClient): void {
    if (client.readOnly) {
        throw new Error(
            "This Bitbucket MCP server runs in read-only mode (BITBUCKET_READ_ONLY is enabled); write operations are blocked.",
        );
    }
}

function refName(value: unknown): string | null {
    if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        if (typeof record.displayId === "string") {
            return record.displayId;
        }
        if (typeof record.id === "string") {
            return record.id;
        }
    }
    return null;
}

/** Trimmed projection so large pull request payloads do not flood the model context. */
export function summarizePullRequest(pr: Record<string, unknown>, client: BitbucketClient): Record<string, unknown> {
    const author = (pr.author as Record<string, unknown> | undefined)?.user as Record<string, unknown> | undefined;
    const reviewers = Array.isArray(pr.reviewers) ? (pr.reviewers as Record<string, unknown>[]) : [];

    return {
        id: pr.id ?? null,
        version: pr.version ?? null,
        title: pr.title ?? null,
        state: pr.state ?? null,
        open: pr.open ?? null,
        fromRef: refName(pr.fromRef),
        toRef: refName(pr.toRef),
        author: author?.displayName ?? null,
        reviewers: reviewers.map((reviewer) => ({
            name: (reviewer.user as Record<string, unknown> | undefined)?.displayName ?? null,
            approved: reviewer.approved ?? false,
            status: reviewer.status ?? null,
        })),
        createdDate: pr.createdDate ?? null,
        updatedDate: pr.updatedDate ?? null,
        url: (pr.links as { self?: { href?: string }[] } | undefined)?.self?.[0]?.href ?? null,
        description: truncate(pr.description, client.maxTextLength),
    };
}

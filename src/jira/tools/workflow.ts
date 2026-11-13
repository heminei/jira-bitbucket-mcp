import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { assertWritable, issueKeySchema as issueKey } from "../common.js";
import { textResult } from "../../shared/format.js";
import type { JiraClient } from "../jira-client.js";

interface Transition {
    id?: string;
    name?: string;
}

export function registerWorkflowTools(server: McpServer, client: JiraClient): void {
    server.registerTool(
        "jira_transition_issue",
        {
            title: "Jira: transition issue",
            description:
                "Move an issue through its workflow. Provide either the transition id or its name; use jira_get_transitions to discover valid options.",
            inputSchema: {
                issueKey,
                transitionId: z.string().trim().optional().describe("Transition id as returned by jira_get_transitions."),
                transitionName: z.string().trim().optional().describe('Transition name, e.g. "Done". Matched case-insensitively.'),
                comment: z.string().trim().optional().describe("Comment to add as part of the transition."),
                fields: z
                    .record(z.string(), z.unknown())
                    .optional()
                    .describe("Fields required by the transition screen, keyed by field id."),
            },
        },
        async ({ issueKey: key, transitionId, transitionName, comment, fields }) => {
            assertWritable(client);

            if (!transitionId && !transitionName) {
                throw new Error("Provide either transitionId or transitionName.");
            }

            let resolvedId = transitionId;
            if (!resolvedId) {
                const available = await client.request<{ transitions?: Transition[] }>(
                    `/issue/${encodeURIComponent(key)}/transitions`,
                );
                const needle = transitionName!.toLowerCase();
                const match = (available.transitions ?? []).find((transition) => transition.name?.toLowerCase() === needle);
                if (!match?.id) {
                    const names = (available.transitions ?? []).map((transition) => transition.name).join(", ");
                    throw new Error(`Transition "${transitionName}" is not available on ${key}. Available: ${names || "none"}.`);
                }
                resolvedId = match.id;
            }

            const payload: Record<string, unknown> = { transition: { id: resolvedId } };
            if (fields && Object.keys(fields).length > 0) {
                payload.fields = fields;
            }
            if (comment) {
                payload.update = { comment: [{ add: { body: comment } }] };
            }

            await client.request(`/issue/${encodeURIComponent(key)}/transitions`, { method: "POST", body: payload });

            return textResult(`Transitioned ${key} using transition ${transitionName ?? resolvedId}.`);
        },
    );

    server.registerTool(
        "jira_assign_issue",
        {
            title: "Jira: assign issue",
            description: "Assign an issue to a Jira Server username, or unassign it by omitting the username.",
            inputSchema: {
                issueKey,
                username: z
                    .string()
                    .trim()
                    .optional()
                    .describe("Jira Server username (not an email or Cloud accountId). Omit to unassign."),
            },
        },
        async ({ issueKey: key, username }) => {
            assertWritable(client);

            // Jira Server/DC expects the username in `name`; `null` clears the assignee.
            await client.request(`/issue/${encodeURIComponent(key)}/assignee`, {
                method: "PUT",
                body: { name: username ?? null },
            });

            return textResult(username ? `Assigned ${key} to ${username}.` : `Unassigned ${key}.`);
        },
    );

    server.registerTool(
        "jira_add_worklog",
        {
            title: "Jira: log work",
            description: "Add a worklog entry to an issue.",
            inputSchema: {
                issueKey,
                timeSpent: z.string().trim().min(1).describe('Time spent in Jira format, e.g. "3h 30m".'),
                comment: z.string().trim().optional().describe("Worklog comment."),
                started: z
                    .string()
                    .trim()
                    .optional()
                    .describe('Start timestamp in Jira format "yyyy-MM-dd\'T\'HH:mm:ss.SSSZ". Defaults to now.'),
            },
        },
        async ({ issueKey: key, timeSpent, comment, started }) => {
            assertWritable(client);

            const payload: Record<string, unknown> = { timeSpent };
            if (comment) {
                payload.comment = comment;
            }
            if (started) {
                payload.started = started;
            }

            const worklog = await client.request<{ id?: string }>(`/issue/${encodeURIComponent(key)}/worklog`, {
                method: "POST",
                body: payload,
            });

            return textResult(`Logged ${timeSpent} on ${key} (worklog ${worklog.id ?? "created"}).`);
        },
    );
}

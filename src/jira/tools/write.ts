import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { assertWritable, commentIdSchema as commentId, issueKeySchema as issueKey } from "../common.js";
import { jsonResult, textResult } from "../../shared/format.js";
import type { JiraClient } from "../jira-client.js";

const extraFields = z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Additional raw Jira fields keyed by field id, e.g. {"customfield_10001": "value"}.');

export function registerWriteTools(server: McpServer, client: JiraClient): void {
    server.registerTool(
        "jira_create_issue",
        {
            title: "Jira: create issue",
            description:
                "Create a new issue. Call jira_get_create_meta first to confirm the issue type name and any required fields.",
            inputSchema: {
                projectKey: z.string().trim().optional().describe("Project key. Falls back to JIRA_DEFAULT_PROJECT."),
                issueType: z.string().trim().min(1).describe('Issue type name, e.g. "Task" or "Bug".'),
                summary: z.string().trim().min(1).describe("Issue summary / title."),
                description: z.string().optional().describe("Issue description in Jira wiki markup."),
                priority: z.string().trim().optional().describe("Priority name, e.g. \"High\"."),
                labels: z.array(z.string().trim()).optional(),
                components: z.array(z.string().trim()).optional().describe("Component names."),
                assignee: z.string().trim().optional().describe("Jira Server username of the assignee."),
                parentKey: issueKey.optional().describe("Parent issue key when creating a sub-task."),
                fields: extraFields,
            },
        },
        async ({ projectKey, issueType, summary, description, priority, labels, components, assignee, parentKey, fields }) => {
            assertWritable(client);

            const project = projectKey ?? client.defaultProject;
            if (!project) {
                throw new Error("No project key provided and JIRA_DEFAULT_PROJECT is not set.");
            }

            const payload: Record<string, unknown> = {
                project: { key: project },
                issuetype: { name: issueType },
                summary,
                ...(fields ?? {}),
            };
            if (description !== undefined) {
                payload.description = description;
            }
            if (priority) {
                payload.priority = { name: priority };
            }
            if (labels) {
                payload.labels = labels;
            }
            if (components) {
                payload.components = components.map((componentName) => ({ name: componentName }));
            }
            if (assignee) {
                payload.assignee = { name: assignee };
            }
            if (parentKey) {
                payload.parent = { key: parentKey };
            }

            const created = await client.request<{ key?: string; id?: string }>("/issue", {
                method: "POST",
                body: { fields: payload },
            });

            return jsonResult({ key: created.key ?? null, id: created.id ?? null });
        },
    );

    server.registerTool(
        "jira_update_issue",
        {
            title: "Jira: update issue",
            description: "Update fields on an existing issue. Only the provided fields are changed.",
            inputSchema: {
                issueKey,
                summary: z.string().trim().optional(),
                description: z.string().optional().describe("Replaces the whole description."),
                priority: z.string().trim().optional().describe("Priority name."),
                labels: z.array(z.string().trim()).optional().describe("Replaces the whole label list."),
                components: z.array(z.string().trim()).optional().describe("Replaces the whole component list."),
                dueDate: z.string().trim().optional().describe("Due date in YYYY-MM-DD format."),
                fields: extraFields,
                notifyUsers: z.boolean().optional().describe("Send Jira notifications for this change. Defaults to false."),
            },
        },
        async ({ issueKey: key, summary, description, priority, labels, components, dueDate, fields, notifyUsers }) => {
            assertWritable(client);

            const payload: Record<string, unknown> = { ...(fields ?? {}) };
            if (summary !== undefined) {
                payload.summary = summary;
            }
            if (description !== undefined) {
                payload.description = description;
            }
            if (priority !== undefined) {
                payload.priority = { name: priority };
            }
            if (labels !== undefined) {
                payload.labels = labels;
            }
            if (components !== undefined) {
                payload.components = components.map((componentName) => ({ name: componentName }));
            }
            if (dueDate !== undefined) {
                payload.duedate = dueDate;
            }

            if (Object.keys(payload).length === 0) {
                throw new Error("Nothing to update: provide at least one field.");
            }

            await client.request(`/issue/${encodeURIComponent(key)}`, {
                method: "PUT",
                query: { notifyUsers: notifyUsers ?? false },
                body: { fields: payload },
            });

            return textResult(`Updated ${key}: ${Object.keys(payload).join(", ")}.`);
        },
    );

    server.registerTool(
        "jira_add_comment",
        {
            title: "Jira: add comment",
            description: "Add a comment to an issue, optionally restricted to a project role or group.",
            inputSchema: {
                issueKey,
                body: z.string().trim().min(1).describe("Comment body in Jira wiki markup."),
                visibilityType: z.enum(["role", "group"]).optional().describe("Restrict the comment visibility."),
                visibilityValue: z.string().trim().optional().describe("Role or group name required when visibilityType is set."),
            },
        },
        async ({ issueKey: key, body, visibilityType, visibilityValue }) => {
            assertWritable(client);

            if (visibilityType && !visibilityValue) {
                throw new Error("visibilityValue is required when visibilityType is provided.");
            }

            const payload: Record<string, unknown> = { body };
            if (visibilityType && visibilityValue) {
                payload.visibility = { type: visibilityType, value: visibilityValue };
            }

            const comment = await client.request<{ id?: string }>(`/issue/${encodeURIComponent(key)}/comment`, {
                method: "POST",
                body: payload,
            });

            return textResult(`Added comment ${comment.id ?? ""} to ${key}.`.trim());
        },
    );

    server.registerTool(
        "jira_update_comment",
        {
            title: "Jira: edit comment",
            description: "Replace the body of an existing comment.",
            inputSchema: {
                issueKey,
                commentId,
                body: z.string().trim().min(1).describe("New comment body in Jira wiki markup."),
            },
        },
        async ({ issueKey: key, commentId: id, body }) => {
            assertWritable(client);

            await client.request(`/issue/${encodeURIComponent(key)}/comment/${encodeURIComponent(id)}`, {
                method: "PUT",
                body: { body },
            });

            return textResult(`Updated comment ${id} on ${key}.`);
        },
    );

    server.registerTool(
        "jira_link_issues",
        {
            title: "Jira: link issues",
            description:
                'Create a link between two issues. Use jira_list_link_types for valid type names. ' +
                'For "Blocks", the outward issue blocks the inward issue.',
            inputSchema: {
                type: z.string().trim().min(1).describe('Link type name, e.g. "Blocks" or "Relates".'),
                outwardIssue: issueKey.describe('Issue that gets the outward description, e.g. the one that "blocks".'),
                inwardIssue: issueKey.describe('Issue that gets the inward description, e.g. the one that "is blocked by".'),
                comment: z.string().trim().optional().describe("Comment to add with the link."),
            },
        },
        async ({ type, outwardIssue, inwardIssue, comment }) => {
            assertWritable(client);

            const payload: Record<string, unknown> = {
                type: { name: type },
                outwardIssue: { key: outwardIssue },
                inwardIssue: { key: inwardIssue },
            };
            if (comment) {
                payload.comment = { body: comment };
            }

            await client.request("/issueLink", { method: "POST", body: payload });

            return textResult(`Linked ${outwardIssue} -> ${inwardIssue} (${type}).`);
        },
    );

    server.registerTool(
        "jira_add_watcher",
        {
            title: "Jira: add watcher",
            description: "Add a user to an issue's watchers.",
            inputSchema: {
                issueKey,
                username: z.string().trim().min(1).describe("Jira Server username of the user to add."),
            },
        },
        async ({ issueKey: key, username }) => {
            assertWritable(client);

            await client.request(`/issue/${encodeURIComponent(key)}/watchers`, { method: "POST", body: username });

            return textResult(`Added ${username} as a watcher of ${key}.`);
        },
    );

    server.registerTool(
        "jira_remove_watcher",
        {
            title: "Jira: remove watcher",
            description: "Remove a user from an issue's watchers.",
            inputSchema: {
                issueKey,
                username: z.string().trim().min(1).describe("Jira Server username of the user to remove."),
            },
        },
        async ({ issueKey: key, username }) => {
            assertWritable(client);

            await client.request(`/issue/${encodeURIComponent(key)}/watchers`, {
                method: "DELETE",
                query: { username },
            });

            return textResult(`Removed ${username} from the watchers of ${key}.`);
        },
    );

    if (!client.allowDelete) {
        return;
    }

    server.registerTool(
        "jira_delete_comment",
        {
            title: "Jira: delete comment",
            description: "Permanently delete a comment. This cannot be undone. Requires JIRA_ALLOW_DELETE=1.",
            inputSchema: {
                issueKey,
                commentId,
                confirm: z.literal(true).describe("Must be true to acknowledge that the deletion is irreversible."),
            },
        },
        async ({ issueKey: key, commentId: id }) => {
            assertWritable(client);

            if (!client.allowDelete) {
                throw new Error("Deleting comments is disabled; start the server with JIRA_ALLOW_DELETE=1 to enable it.");
            }

            await client.request(`/issue/${encodeURIComponent(key)}/comment/${encodeURIComponent(id)}`, {
                method: "DELETE",
            });

            return textResult(`Deleted comment ${id} on ${key}.`);
        },
    );

    server.registerTool(
        "jira_delete_issue",
        {
            title: "Jira: delete issue",
            description:
                "Permanently delete an issue. This cannot be undone; prefer closing the issue instead. Requires JIRA_ALLOW_DELETE=1.",
            inputSchema: {
                issueKey,
                confirm: z.literal(true).describe("Must be true to acknowledge that the deletion is irreversible."),
                deleteSubtasks: z.boolean().optional().describe("Also delete the issue's sub-tasks. Defaults to false."),
            },
        },
        async ({ issueKey: key, deleteSubtasks }) => {
            assertWritable(client);

            if (!client.allowDelete) {
                throw new Error("Deleting issues is disabled; start the server with JIRA_ALLOW_DELETE=1 to enable it.");
            }

            await client.request(`/issue/${encodeURIComponent(key)}`, {
                method: "DELETE",
                query: { deleteSubtasks: deleteSubtasks ?? false },
            });

            return textResult(`Deleted ${key}.`);
        },
    );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { issueKeySchema as issueKey } from "../common.js";
import { jsonResult, truncate } from "../../shared/format.js";
import { summarizeIssue } from "../issue.js";
import type { JiraClient } from "../jira-client.js";

export function registerReadTools(server: McpServer, client: JiraClient): void {
    server.registerTool(
        "jira_myself",
        {
            title: "Jira: current user",
            description:
                "Return the Jira account the configured personal access token belongs to. Use it to verify connectivity.",
            inputSchema: {},
        },
        async () => {
            const user = await client.request<Record<string, unknown>>("/myself");
            return jsonResult({
                name: user.name ?? null,
                displayName: user.displayName ?? null,
                emailAddress: user.emailAddress ?? null,
                active: user.active ?? null,
                timeZone: user.timeZone ?? null,
                readOnlyMode: client.readOnly,
                defaultProject: client.defaultProject,
            });
        },
    );

    server.registerTool(
        "jira_search",
        {
            title: "Jira: search issues (JQL)",
            description:
                "Run a JQL query and return matching issues. Results are trimmed to the most useful fields unless raw is true.",
            inputSchema: {
                jql: z
                    .string()
                    .trim()
                    .min(1)
                    .describe('JQL query, e.g. "project = PROJ AND status = Open ORDER BY created DESC"'),
                startAt: z.number().int().min(0).optional().describe("Zero-based pagination offset."),
                maxResults: z
                    .number()
                    .int()
                    .min(1)
                    .max(100)
                    .optional()
                    .describe("Page size, capped at 100. Defaults to 25."),
                fields: z
                    .array(z.string())
                    .optional()
                    .describe("Explicit Jira field names to fetch. Defaults to a standard set."),
                raw: z
                    .boolean()
                    .optional()
                    .describe("Return the untouched Jira payload instead of the trimmed projection."),
            },
        },
        async ({ jql, startAt, maxResults, fields, raw }) => {
            const response = await client.request<{
                startAt?: number;
                maxResults?: number;
                total?: number;
                issues?: Record<string, unknown>[];
            }>("/search", {
                method: "POST",
                body: {
                    jql,
                    startAt: startAt ?? 0,
                    maxResults: Math.min(maxResults ?? 25, 100),
                    fields: fields ?? [
                        "summary",
                        "status",
                        "issuetype",
                        "priority",
                        "resolution",
                        "project",
                        "assignee",
                        "reporter",
                        "labels",
                        "created",
                        "updated",
                    ],
                },
            });

            if (raw) {
                return jsonResult(response);
            }

            return jsonResult({
                startAt: response.startAt ?? 0,
                maxResults: response.maxResults ?? 0,
                total: response.total ?? 0,
                issues: (response.issues ?? []).map((issue) => summarizeIssue(issue, client)),
            });
        },
    );

    server.registerTool(
        "jira_get_issue",
        {
            title: "Jira: get issue",
            description: "Fetch a single issue by key, optionally including its comments.",
            inputSchema: {
                issueKey,
                fields: z
                    .array(z.string())
                    .optional()
                    .describe("Explicit Jira field names to fetch. Defaults to all fields."),
                includeComments: z.boolean().optional().describe("Append the most recent comments to the response."),
                raw: z
                    .boolean()
                    .optional()
                    .describe("Return the untouched Jira payload instead of the trimmed projection."),
            },
        },
        async ({ issueKey: key, fields, includeComments, raw }) => {
            const issue = await client.request<Record<string, unknown>>(`/issue/${encodeURIComponent(key)}`, {
                query: { fields },
            });

            if (raw) {
                return jsonResult(issue);
            }

            const result: Record<string, unknown> = summarizeIssue(issue, client);

            if (includeComments) {
                const comments = await client.request<{ comments?: Record<string, unknown>[]; total?: number }>(
                    `/issue/${encodeURIComponent(key)}/comment`,
                    { query: { maxResults: 50, orderBy: "-created" } },
                );
                result.commentTotal = comments.total ?? 0;
                result.comments = (comments.comments ?? []).map((comment) => ({
                    id: comment.id ?? null,
                    author: (comment.author as Record<string, unknown> | undefined)?.displayName ?? null,
                    created: comment.created ?? null,
                    updated: comment.updated ?? null,
                    body: truncate(comment.body, client.maxTextLength),
                }));
            }

            return jsonResult(result);
        },
    );

    server.registerTool(
        "jira_list_projects",
        {
            title: "Jira: list projects",
            description:
                "List the projects visible to the configured user, optionally filtered by a case-insensitive substring.",
            inputSchema: {
                search: z.string().trim().optional().describe("Filter on project key or name."),
                limit: z
                    .number()
                    .int()
                    .min(1)
                    .max(200)
                    .optional()
                    .describe("Maximum projects to return. Defaults to 50."),
            },
        },
        async ({ search, limit }) => {
            const projects = await client.request<Record<string, unknown>[]>("/project");
            const needle = search?.toLowerCase();
            const filtered = projects
                .filter((project) => {
                    if (!needle) {
                        return true;
                    }
                    const key = String(project.key ?? "").toLowerCase();
                    const projectName = String(project.name ?? "").toLowerCase();
                    return key.includes(needle) || projectName.includes(needle);
                })
                .slice(0, limit ?? 50)
                .map((project) => ({
                    key: project.key ?? null,
                    id: project.id ?? null,
                    name: project.name ?? null,
                    projectTypeKey: project.projectTypeKey ?? null,
                    lead: (project.lead as Record<string, unknown> | undefined)?.displayName ?? null,
                }));

            return jsonResult({ total: projects.length, returned: filtered.length, projects: filtered });
        },
    );

    server.registerTool(
        "jira_get_transitions",
        {
            title: "Jira: list issue transitions",
            description: "List the workflow transitions currently available on an issue, including required fields.",
            inputSchema: { issueKey },
        },
        async ({ issueKey: key }) => {
            const response = await client.request<{ transitions?: Record<string, unknown>[] }>(
                `/issue/${encodeURIComponent(key)}/transitions`,
                { query: { expand: "transitions.fields" } },
            );

            return jsonResult({
                issueKey: key,
                transitions: (response.transitions ?? []).map((transition) => ({
                    id: transition.id ?? null,
                    name: transition.name ?? null,
                    to: (transition.to as Record<string, unknown> | undefined)?.name ?? null,
                    requiredFields: Object.entries((transition.fields ?? {}) as Record<string, { required?: boolean }>)
                        .filter(([, field]) => field?.required)
                        .map(([fieldId]) => fieldId),
                })),
            });
        },
    );

    server.registerTool(
        "jira_get_create_meta",
        {
            title: "Jira: issue creation metadata",
            description:
                "Return the issue types and creatable fields for a project. Use it before jira_create_issue to learn which fields are required.",
            inputSchema: {
                projectKey: z.string().trim().optional().describe("Project key. Falls back to JIRA_DEFAULT_PROJECT."),
                issueTypeName: z.string().trim().optional().describe("Restrict the metadata to a single issue type."),
            },
        },
        async ({ projectKey, issueTypeName }) => {
            const project = projectKey ?? client.defaultProject;
            if (!project) {
                throw new Error("No project key provided and JIRA_DEFAULT_PROJECT is not set.");
            }

            const response = await client.request<{ projects?: Record<string, unknown>[] }>("/issue/createmeta", {
                query: {
                    projectKeys: project,
                    issuetypeNames: issueTypeName,
                    expand: "projects.issuetypes.fields",
                },
            });

            const projects = (response.projects ?? []).map((entry) => ({
                key: entry.key ?? null,
                name: entry.name ?? null,
                issueTypes: ((entry.issuetypes ?? []) as Record<string, unknown>[]).map((issueType) => {
                    const typeFields = (issueType.fields ?? {}) as Record<
                        string,
                        { name?: string; required?: boolean }
                    >;
                    return {
                        id: issueType.id ?? null,
                        name: issueType.name ?? null,
                        subtask: issueType.subtask ?? false,
                        requiredFields: Object.entries(typeFields)
                            .filter(([, field]) => field?.required)
                            .map(([fieldId, field]) => ({ id: fieldId, name: field.name ?? fieldId })),
                        optionalFields: Object.entries(typeFields)
                            .filter(([, field]) => !field?.required)
                            .map(([fieldId]) => fieldId),
                    };
                }),
            }));

            return jsonResult({ projects });
        },
    );

    server.registerTool(
        "jira_list_fields",
        {
            title: "Jira: list fields",
            description:
                "List Jira field definitions, useful for resolving custom field ids such as customfield_10001.",
            inputSchema: {
                search: z.string().trim().optional().describe("Filter on field id or name."),
            },
        },
        async ({ search }) => {
            const fields = await client.request<Record<string, unknown>[]>("/field");
            const needle = search?.toLowerCase();
            const filtered = fields
                .filter((field) => {
                    if (!needle) {
                        return true;
                    }
                    return (
                        String(field.id ?? "")
                            .toLowerCase()
                            .includes(needle) ||
                        String(field.name ?? "")
                            .toLowerCase()
                            .includes(needle)
                    );
                })
                .map((field) => ({
                    id: field.id ?? null,
                    name: field.name ?? null,
                    custom: field.custom ?? false,
                    searchable: field.searchable ?? false,
                }));

            return jsonResult({ total: filtered.length, fields: filtered });
        },
    );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsonResult } from "../../shared/format.js";
import { summarizeIssue } from "../issue.js";
import type { JiraClient } from "../jira-client.js";

// Jira Software (Agile) lives under its own REST root, separate from /rest/api/2.
const AGILE = "/rest/agile/1.0";

export function registerAgileTools(server: McpServer, client: JiraClient): void {
    server.registerTool(
        "jira_list_boards",
        {
            title: "Jira: list boards",
            description: "List Jira Software boards, optionally filtered by name, type or project. Requires Jira Software.",
            inputSchema: {
                name: z.string().trim().optional().describe("Filter on board name."),
                type: z.enum(["scrum", "kanban"]).optional().describe("Board type."),
                projectKeyOrId: z.string().trim().optional().describe("Only boards that show this project."),
                startAt: z.number().int().min(0).optional().describe("Zero-based pagination offset."),
                maxResults: z.number().int().min(1).max(100).optional().describe("Page size. Defaults to 50."),
            },
        },
        async ({ name, type, projectKeyOrId, startAt, maxResults }) => {
            const response = await client.request<{
                values?: Record<string, unknown>[];
                total?: number;
                isLast?: boolean;
            }>("/board", {
                apiPrefix: AGILE,
                query: { name, type, projectKeyOrId, startAt: startAt ?? 0, maxResults: maxResults ?? 50 },
            });

            return jsonResult({
                total: response.total ?? null,
                isLast: response.isLast ?? true,
                boards: (response.values ?? []).map((board) => ({
                    id: board.id ?? null,
                    name: board.name ?? null,
                    type: board.type ?? null,
                    project: (board.location as Record<string, unknown> | undefined)?.projectKey ?? null,
                })),
            });
        },
    );

    server.registerTool(
        "jira_list_sprints",
        {
            title: "Jira: list sprints",
            description: "List the sprints of a scrum board. Requires Jira Software.",
            inputSchema: {
                boardId: z.number().int().min(1).describe("Board id from jira_list_boards."),
                state: z
                    .array(z.enum(["future", "active", "closed"]))
                    .optional()
                    .describe("Sprint states to include. Defaults to all."),
                startAt: z.number().int().min(0).optional().describe("Zero-based pagination offset."),
                maxResults: z.number().int().min(1).max(100).optional().describe("Page size. Defaults to 50."),
            },
        },
        async ({ boardId, state, startAt, maxResults }) => {
            const response = await client.request<{ values?: Record<string, unknown>[]; isLast?: boolean }>(
                `/board/${boardId}/sprint`,
                {
                    apiPrefix: AGILE,
                    query: { state, startAt: startAt ?? 0, maxResults: maxResults ?? 50 },
                },
            );

            return jsonResult({
                isLast: response.isLast ?? true,
                sprints: (response.values ?? []).map((sprint) => ({
                    id: sprint.id ?? null,
                    name: sprint.name ?? null,
                    state: sprint.state ?? null,
                    startDate: sprint.startDate ?? null,
                    endDate: sprint.endDate ?? null,
                    completeDate: sprint.completeDate ?? null,
                    goal: sprint.goal ?? null,
                })),
            });
        },
    );

    server.registerTool(
        "jira_get_sprint_issues",
        {
            title: "Jira: sprint issues",
            description: "List the issues in a sprint, optionally narrowed by a JQL filter. Requires Jira Software.",
            inputSchema: {
                sprintId: z.number().int().min(1).describe("Sprint id from jira_list_sprints."),
                jql: z.string().trim().optional().describe('Extra JQL filter, e.g. "assignee = currentUser()".'),
                startAt: z.number().int().min(0).optional().describe("Zero-based pagination offset."),
                maxResults: z.number().int().min(1).max(100).optional().describe("Page size. Defaults to 50."),
            },
        },
        async ({ sprintId, jql, startAt, maxResults }) => {
            const response = await client.request<{
                startAt?: number;
                total?: number;
                issues?: Record<string, unknown>[];
            }>(`/sprint/${sprintId}/issue`, {
                apiPrefix: AGILE,
                query: { jql, startAt: startAt ?? 0, maxResults: maxResults ?? 50 },
            });

            return jsonResult({
                startAt: response.startAt ?? 0,
                total: response.total ?? 0,
                issues: (response.issues ?? []).map((issue) => summarizeIssue(issue, client)),
            });
        },
    );
}

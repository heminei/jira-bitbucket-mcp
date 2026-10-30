import { z } from "zod";
import type { JiraClient } from "./jira-client.js";

export const issueKeySchema = z
    .string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/, "Expected an issue key such as PROJ-1234");

export const commentIdSchema = z
    .string()
    .trim()
    .regex(/^\d+$/, "Expected a numeric comment id")
    .describe("Comment id.");

export const attachmentIdSchema = z
    .string()
    .trim()
    .regex(/^\d+$/, "Expected a numeric attachment id")
    .describe("Attachment id as returned by jira_list_attachments.");

/** Second line of defence: write tools are not registered in read-only mode either. */
export function assertWritable(client: JiraClient): void {
    if (client.readOnly) {
        throw new Error("This Jira MCP server runs in read-only mode (JIRA_READ_ONLY is enabled); write operations are blocked.");
    }
}

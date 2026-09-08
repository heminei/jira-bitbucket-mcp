import { z } from "zod";
import type { JiraClient } from "./jira-client.js";

export const issueKeySchema = z
    .string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/, "Expected an issue key such as PROJ-1234");

/** Second line of defence: write tools are not registered in read-only mode either. */
export function assertWritable(client: JiraClient): void {
    if (client.readOnly) {
        throw new Error("This Jira MCP server runs in read-only mode (JIRA_READ_ONLY is enabled); write operations are blocked.");
    }
}

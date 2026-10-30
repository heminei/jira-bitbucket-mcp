import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { normalizeBaseUrl, parseBoolean, parseInteger, requireEnv } from "../shared/env.js";

export interface JiraConfig {
    baseUrl: string;
    pat: string;
    readOnly: boolean;
    allowDelete: boolean;
    defaultProject: string | null;
    timeoutMs: number;
    maxTextLength: number;
    attachmentsDir: string;
    /** 0 means unlimited. */
    maxAttachmentBytes: number;
}

export function loadConfig(): JiraConfig {
    return {
        baseUrl: normalizeBaseUrl(requireEnv("JIRA_BASE_URL"), "JIRA_BASE_URL"),
        pat: requireEnv("JIRA_PAT"),
        readOnly: parseBoolean(process.env.JIRA_READ_ONLY, false),
        // Jira deletion is permanent, so it stays off unless explicitly enabled.
        allowDelete: parseBoolean(process.env.JIRA_ALLOW_DELETE, false),
        defaultProject: process.env.JIRA_DEFAULT_PROJECT?.trim() || null,
        timeoutMs: parseInteger(process.env.JIRA_TIMEOUT_MS, 30000),
        maxTextLength: parseInteger(process.env.JIRA_MAX_TEXT_LENGTH, 4000),
        attachmentsDir: resolve(
            process.env.JIRA_ATTACHMENTS_DIR?.trim() || join(tmpdir(), "jira-bitbucket-mcp", "attachments"),
        ),
        maxAttachmentBytes: parseInteger(process.env.JIRA_MAX_ATTACHMENT_BYTES, 0),
    };
}

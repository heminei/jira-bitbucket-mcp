import { pickName, truncate } from "../shared/format.js";
import type { JiraClient } from "./jira-client.js";

interface RawIssue {
    key?: string;
    id?: string;
    self?: string;
    fields?: Record<string, unknown>;
    renderedFields?: Record<string, unknown>;
}

/** Trimmed projection so large Jira payloads do not flood the model context. */
export function summarizeIssue(issue: RawIssue, client: JiraClient): Record<string, unknown> {
    const fields = issue.fields ?? {};
    return {
        key: issue.key ?? null,
        id: issue.id ?? null,
        summary: fields.summary ?? null,
        status: pickName(fields.status),
        issueType: pickName(fields.issuetype),
        priority: pickName(fields.priority),
        resolution: pickName(fields.resolution),
        project: pickName(fields.project),
        assignee: pickName(fields.assignee),
        reporter: pickName(fields.reporter),
        labels: Array.isArray(fields.labels) ? fields.labels : [],
        components: Array.isArray(fields.components) ? fields.components.map(pickName).filter(Boolean) : [],
        fixVersions: Array.isArray(fields.fixVersions) ? fields.fixVersions.map(pickName).filter(Boolean) : [],
        created: fields.created ?? null,
        updated: fields.updated ?? null,
        duedate: fields.duedate ?? null,
        description: truncate(fields.description, client.maxTextLength),
    };
}

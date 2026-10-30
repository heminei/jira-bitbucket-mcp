import { pickName, truncate } from "../shared/format.js";
import type { JiraClient } from "./jira-client.js";

interface RawIssue {
    key?: string;
    id?: string;
    self?: string;
    fields?: Record<string, unknown>;
    renderedFields?: Record<string, unknown>;
}

/** Trimmed projection of a Jira attachment record. */
export function summarizeAttachment(attachment: Record<string, unknown>): Record<string, unknown> {
    return {
        id: attachment.id ?? null,
        filename: attachment.filename ?? null,
        size: attachment.size ?? null,
        mimeType: attachment.mimeType ?? null,
        created: attachment.created ?? null,
        author: pickName(attachment.author),
    };
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
        ...(Array.isArray(fields.attachment)
            ? { attachments: fields.attachment.map((item) => summarizeAttachment(item as Record<string, unknown>)) }
            : {}),
        ...(Array.isArray(fields.issuelinks)
            ? { links: fields.issuelinks.map((item) => summarizeLink(item as Record<string, unknown>)) }
            : {}),
    };
}

/** Flattens an issue link into the direction-aware relation as seen from the owning issue. */
function summarizeLink(link: Record<string, unknown>): Record<string, unknown> {
    const type = (link.type ?? {}) as Record<string, unknown>;
    const outward = link.outwardIssue as Record<string, unknown> | undefined;
    const other = outward ?? (link.inwardIssue as Record<string, unknown> | undefined);
    const otherFields = (other?.fields ?? {}) as Record<string, unknown>;
    return {
        id: link.id ?? null,
        relation: outward ? (type.outward ?? null) : (type.inward ?? null),
        key: other?.key ?? null,
        summary: otherFields.summary ?? null,
        status: pickName(otherFields.status),
    };
}

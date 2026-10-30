import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { assertWritable, attachmentIdSchema as attachmentId, issueKeySchema as issueKey } from "../common.js";
import { imageResult, jsonResult, textResult, truncate } from "../../shared/format.js";
import { summarizeAttachment } from "../issue.js";
import type { JiraClient } from "../jira-client.js";

/** Larger files are saved to disk instead of being inlined into the model context. */
const INLINE_LIMIT_BYTES = 1024 * 1024;
const TEXT_MIME = /^text\/|\/(json|xml|yaml|x-yaml|javascript)$|\+(json|xml)$/;
const IMAGE_MIME = /^image\/(png|jpeg|gif|webp)$/;

function safeFileName(name: string): string {
    const cleaned = basename(name.replace(/\\/g, "/")).replace(/[\u0000-\u001f]/g, "_");
    return cleaned === "" || cleaned === "." || cleaned === ".." ? "attachment" : cleaned;
}

function isInside(root: string, target: string): boolean {
    const rel = relative(root, target);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

interface AttachmentMeta {
    id?: string;
    filename?: string;
    size?: number;
    mimeType?: string;
    content?: string;
}

export function registerAttachmentTools(server: McpServer, client: JiraClient): void {
    server.registerTool(
        "jira_list_attachments",
        {
            title: "Jira: list attachments",
            description: "List the files attached to an issue (id, filename, size, MIME type, author).",
            inputSchema: { issueKey },
        },
        async ({ issueKey: key }) => {
            const issue = await client.request<{ fields?: { attachment?: Record<string, unknown>[] } }>(
                `/issue/${encodeURIComponent(key)}`,
                { query: { fields: ["attachment"] } },
            );
            const attachments = (issue.fields?.attachment ?? []).map(summarizeAttachment);
            return jsonResult({ issueKey: key, total: attachments.length, attachments });
        },
    );

    server.registerTool(
        "jira_get_attachment",
        {
            title: "Jira: download attachment",
            description:
                "Download an attachment. With saveTo it is written under the attachments directory and the path is returned. " +
                "Without saveTo, small text files and images (PNG, JPEG, GIF, WebP) are returned inline; anything else is saved " +
                "automatically and the path is returned.",
            inputSchema: {
                attachmentId,
                saveTo: z
                    .string()
                    .trim()
                    .optional()
                    .describe("File name (no directories) to save as inside the attachments directory."),
            },
        },
        async ({ attachmentId: id, saveTo }) => {
            if (saveTo && safeFileName(saveTo) !== saveTo) {
                throw new Error("saveTo must be a plain file name without directories.");
            }

            const meta = await client.request<AttachmentMeta>(`/attachment/${encodeURIComponent(id)}`);
            if (!meta.content) {
                throw new Error(`Attachment ${id} has no downloadable content URL.`);
            }

            const maxBytes = client.maxAttachmentBytes;
            if (maxBytes > 0 && typeof meta.size === "number" && meta.size > maxBytes) {
                throw new Error(`Attachment ${id} is ${meta.size} bytes, above JIRA_MAX_ATTACHMENT_BYTES (${maxBytes}).`);
            }

            const download = await client.download(meta.content, { maxBytes, timeoutMs: Math.max(client.timeoutMs, 120000) });
            const mimeType = meta.mimeType || download.contentType;
            const filename = safeFileName(meta.filename ?? `attachment-${id}`);
            const info = { id, filename, mimeType, size: download.data.byteLength };

            const inlineEligible =
                !saveTo && download.data.byteLength <= INLINE_LIMIT_BYTES && (TEXT_MIME.test(mimeType) || IMAGE_MIME.test(mimeType));

            if (inlineEligible) {
                if (IMAGE_MIME.test(mimeType)) {
                    return imageResult(info, download.data, mimeType);
                }
                return jsonResult({ ...info, content: truncate(download.data.toString("utf8"), client.maxTextLength) });
            }

            await mkdir(client.attachmentsDir, { recursive: true });
            const target = join(await realpath(client.attachmentsDir), saveTo || `${id}-${filename}`);
            await writeFile(target, download.data);

            return jsonResult({ ...info, savedTo: target });
        },
    );

    if (client.readOnly) {
        return;
    }

    server.registerTool(
        "jira_add_attachment",
        {
            title: "Jira: add attachment",
            description:
                "Upload a local file to an issue. The file must be inside the attachments directory (JIRA_ATTACHMENTS_DIR); " +
                "relative paths are resolved against it.",
            inputSchema: {
                issueKey,
                filePath: z.string().trim().min(1).describe("Path of the file to upload, inside the attachments directory."),
                fileName: z.string().trim().optional().describe("Name to give the attachment. Defaults to the file's own name."),
            },
        },
        async ({ issueKey: key, filePath, fileName }) => {
            assertWritable(client);

            await mkdir(client.attachmentsDir, { recursive: true });
            const root = await realpath(client.attachmentsDir);
            let source: string;
            try {
                source = await realpath(resolve(root, filePath));
            } catch {
                throw new Error(`File not found inside the attachments directory: ${filePath}`);
            }
            if (!isInside(root, source)) {
                throw new Error("filePath must be inside the attachments directory (JIRA_ATTACHMENTS_DIR).");
            }

            const form = new FormData();
            form.append("file", new Blob([await readFile(source)]), safeFileName(fileName || basename(source)));

            const created = await client.request<Record<string, unknown>[]>(`/issue/${encodeURIComponent(key)}/attachments`, {
                method: "POST",
                headers: { "X-Atlassian-Token": "no-check" },
                formData: form,
                timeoutMs: Math.max(client.timeoutMs, 120000),
            });

            return jsonResult({ issueKey: key, attachments: created.map(summarizeAttachment) });
        },
    );

    if (!client.allowDelete) {
        return;
    }

    server.registerTool(
        "jira_delete_attachment",
        {
            title: "Jira: delete attachment",
            description: "Permanently delete an attachment. This cannot be undone. Requires JIRA_ALLOW_DELETE=1.",
            inputSchema: {
                attachmentId,
                confirm: z.literal(true).describe("Must be true to acknowledge that the deletion is irreversible."),
            },
        },
        async ({ attachmentId: id }) => {
            assertWritable(client);

            if (!client.allowDelete) {
                throw new Error("Deleting attachments is disabled; start the server with JIRA_ALLOW_DELETE=1 to enable it.");
            }

            await client.request(`/attachment/${encodeURIComponent(id)}`, { method: "DELETE" });

            return textResult(`Deleted attachment ${id}.`);
        },
    );
}

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function jsonResult(value: unknown): CallToolResult {
    return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function textResult(text: string): CallToolResult {
    return { content: [{ type: "text", text }] };
}

export function imageResult(metadata: unknown, data: Buffer, mimeType: string): CallToolResult {
    return {
        content: [
            { type: "text", text: JSON.stringify(metadata, null, 2) },
            { type: "image", data: data.toString("base64"), mimeType },
        ],
    };
}

export function truncate(value: unknown, limit: number): string | null {
    if (typeof value !== "string" || value === "") {
        return null;
    }
    return value.length > limit ? `${value.slice(0, limit)}\n… [truncated ${value.length - limit} chars]` : value;
}

export function pickName(value: unknown): string | null {
    if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        const candidate = record.displayName ?? record.name ?? record.value;
        if (typeof candidate === "string") {
            return candidate;
        }
    }
    return null;
}

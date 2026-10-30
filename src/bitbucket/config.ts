import { normalizeBaseUrl, parseBoolean, parseInteger, requireEnv } from "../shared/env.js";

export interface BitbucketConfig {
    baseUrl: string;
    token: string;
    readOnly: boolean;
    allowMerge: boolean;
    allowDelete: boolean;
    defaultProject: string | null;
    defaultRepo: string | null;
    timeoutMs: number;
    maxTextLength: number;
}

export function loadConfig(): BitbucketConfig {
    return {
        baseUrl: normalizeBaseUrl(requireEnv("BITBUCKET_BASE_URL"), "BITBUCKET_BASE_URL"),
        token: requireEnv("BITBUCKET_TOKEN"),
        readOnly: parseBoolean(process.env.BITBUCKET_READ_ONLY, false),
        // Merging and declining are hard to undo, so they stay off unless explicitly enabled.
        allowMerge: parseBoolean(process.env.BITBUCKET_ALLOW_MERGE, false),
        allowDelete: parseBoolean(process.env.BITBUCKET_ALLOW_DELETE, false),
        defaultProject: process.env.BITBUCKET_DEFAULT_PROJECT?.trim() || null,
        defaultRepo: process.env.BITBUCKET_DEFAULT_REPO?.trim() || null,
        timeoutMs: parseInteger(process.env.BITBUCKET_TIMEOUT_MS, 30000),
        maxTextLength: parseInteger(process.env.BITBUCKET_MAX_TEXT_LENGTH, 20000),
    };
}

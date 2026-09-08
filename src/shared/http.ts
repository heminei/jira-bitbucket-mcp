export class ApiError extends Error {
    public readonly status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = "ApiError";
        this.status = status;
    }
}

export interface RequestOptions {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    query?: Record<string, string | number | boolean | string[] | undefined>;
    body?: unknown;
    headers?: Record<string, string>;
}

export interface ApiClientOptions {
    baseUrl: string;
    token: string;
    timeoutMs: number;
    /** Path segment inserted between the base URL and the tool-supplied path, e.g. "/rest/api/2". */
    apiPrefix: string;
}

/** Collects human-readable messages from both Jira and Bitbucket Server error envelopes. */
function extractMessages(payload: unknown): string[] {
    if (!payload || typeof payload !== "object") {
        return [];
    }

    const data = payload as { errorMessages?: unknown; errors?: unknown; message?: unknown };
    const parts: string[] = [];

    if (Array.isArray(data.errorMessages)) {
        parts.push(...data.errorMessages.map((item) => String(item)));
    }

    if (Array.isArray(data.errors)) {
        for (const entry of data.errors) {
            if (entry && typeof entry === "object") {
                const record = entry as Record<string, unknown>;
                const message = record.message ?? record.exceptionName;
                if (message !== undefined) {
                    parts.push(String(message));
                    continue;
                }
            }
            parts.push(String(entry));
        }
    } else if (data.errors && typeof data.errors === "object") {
        for (const [field, detail] of Object.entries(data.errors as Record<string, unknown>)) {
            parts.push(`${field}: ${String(detail)}`);
        }
    }

    if (typeof data.message === "string") {
        parts.push(data.message);
    }

    return parts;
}

export class ApiClient {
    protected readonly options: ApiClientOptions;

    constructor(options: ApiClientOptions) {
        this.options = options;
    }

    get baseUrl(): string {
        return this.options.baseUrl;
    }

    buildUrl(path: string, query?: RequestOptions["query"]): URL {
        const url = new URL(`${this.options.baseUrl}${this.options.apiPrefix}${path}`);
        for (const [key, value] of Object.entries(query ?? {})) {
            if (value === undefined) {
                continue;
            }
            if (Array.isArray(value)) {
                if (value.length > 0) {
                    url.searchParams.set(key, value.join(","));
                }
                continue;
            }
            url.searchParams.set(key, String(value));
        }
        return url;
    }

    async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
        const url = this.buildUrl(path, options.query);
        const method = options.method ?? "GET";

        const headers: Record<string, string> = {
            Authorization: `Bearer ${this.options.token}`,
            Accept: "application/json",
            ...options.headers,
        };
        if (options.body !== undefined) {
            headers["Content-Type"] = "application/json";
        }

        let response: Response;
        try {
            response = await fetch(url, {
                method,
                headers,
                body: options.body === undefined ? undefined : JSON.stringify(options.body),
                signal: AbortSignal.timeout(this.options.timeoutMs),
            });
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new ApiError(`Request to ${method} ${url.pathname} failed: ${this.redact(reason)}`, 0);
        }

        const rawText = await response.text();
        const isJson = (response.headers.get("content-type") ?? "").includes("json");
        let payload: unknown = null;
        if (rawText && isJson) {
            try {
                payload = JSON.parse(rawText);
            } catch {
                payload = null;
            }
        }

        if (!response.ok) {
            const messages = extractMessages(payload);
            const detail = messages.length > 0 ? messages.join("; ") : rawText.trim().slice(0, 500);
            throw new ApiError(
                this.redact(detail ? `Request failed with ${response.status}: ${detail}` : `Request failed with ${response.status}.`),
                response.status,
            );
        }

        return (isJson ? payload : rawText) as T;
    }

    /** Guards against a leaked token in error strings echoed back by proxies. */
    redact(value: string): string {
        return value.split(this.options.token).join("***");
    }
}

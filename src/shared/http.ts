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
    /** Multipart payload; takes precedence over body and lets fetch set the Content-Type boundary. */
    formData?: FormData;
    headers?: Record<string, string>;
    /** Overrides the client-wide timeout, e.g. for large uploads. */
    timeoutMs?: number;
    /** Targets a different REST root than the client default, e.g. "/rest/agile/1.0". */
    apiPrefix?: string;
}

export interface DownloadOptions {
    /** Abort once this many bytes are received. 0 or undefined means no limit. */
    maxBytes?: number;
    timeoutMs?: number;
}

export interface DownloadResult {
    data: Buffer;
    contentType: string;
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

    get timeoutMs(): number {
        return this.options.timeoutMs;
    }

    buildUrl(path: string, query?: RequestOptions["query"], apiPrefix: string = this.options.apiPrefix): URL {
        const url = new URL(`${this.options.baseUrl}${apiPrefix}${path}`);
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
        const url = this.buildUrl(path, options.query, options.apiPrefix);
        const method = options.method ?? "GET";

        const headers: Record<string, string> = {
            Authorization: `Bearer ${this.options.token}`,
            Accept: "application/json",
            ...options.headers,
        };
        let body: FormData | string | undefined;
        if (options.formData) {
            body = options.formData;
        } else if (options.body !== undefined) {
            headers["Content-Type"] = "application/json";
            body = JSON.stringify(options.body);
        }

        const response = await this.send(url, method, headers, body, options.timeoutMs ?? this.options.timeoutMs);

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
            throw this.failure(response.status, rawText, payload);
        }

        return (isJson ? payload : rawText) as T;
    }

    /** Downloads a binary resource; absolute URLs must share the configured origin so the token is never sent elsewhere. */
    async download(target: string, options: DownloadOptions = {}): Promise<DownloadResult> {
        const url = new URL(target, `${this.options.baseUrl}/`);
        if (url.origin !== new URL(this.options.baseUrl).origin) {
            throw new ApiError("Refusing to download from a different origin than the configured base URL.", 0);
        }

        const response = await this.send(
            url,
            "GET",
            { Authorization: `Bearer ${this.options.token}`, Accept: "*/*" },
            undefined,
            options.timeoutMs ?? this.options.timeoutMs,
        );

        if (!response.ok) {
            throw this.failure(response.status, await response.text(), null);
        }

        const maxBytes = options.maxBytes ?? 0;
        const declared = Number(response.headers.get("content-length") ?? "");
        if (maxBytes > 0 && Number.isFinite(declared) && declared > maxBytes) {
            await response.body?.cancel();
            throw new ApiError(`File is ${declared} bytes, which exceeds the ${maxBytes} byte limit.`, 0);
        }

        const chunks: Uint8Array[] = [];
        let received = 0;
        if (response.body) {
            const reader = response.body.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                received += value.byteLength;
                if (maxBytes > 0 && received > maxBytes) {
                    await reader.cancel();
                    throw new ApiError(`File exceeds the ${maxBytes} byte limit.`, 0);
                }
                chunks.push(value);
            }
        }

        return {
            data: Buffer.concat(chunks),
            contentType: (response.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim(),
        };
    }

    private async send(
        url: URL,
        method: string,
        headers: Record<string, string>,
        body: FormData | string | undefined,
        timeoutMs: number,
    ): Promise<Response> {
        try {
            return await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new ApiError(`Request to ${method} ${url.pathname} failed: ${this.redact(reason)}`, 0);
        }
    }

    private failure(status: number, rawText: string, payload: unknown): ApiError {
        const messages = extractMessages(payload);
        const detail = messages.length > 0 ? messages.join("; ") : rawText.trim().slice(0, 500);
        return new ApiError(
            this.redact(detail ? `Request failed with ${status}: ${detail}` : `Request failed with ${status}.`),
            status,
        );
    }

    /** Guards against a leaked token in error strings echoed back by proxies. */
    redact(value: string): string {
        return value.split(this.options.token).join("***");
    }
}

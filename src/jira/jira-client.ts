import { ApiClient } from "../shared/http.js";
import type { JiraConfig } from "./config.js";

export class JiraClient extends ApiClient {
    private readonly config: JiraConfig;

    constructor(config: JiraConfig) {
        super({ baseUrl: config.baseUrl, token: config.pat, timeoutMs: config.timeoutMs, apiPrefix: "/rest/api/2" });
        this.config = config;
    }

    get readOnly(): boolean {
        return this.config.readOnly;
    }

    get allowDelete(): boolean {
        return this.config.allowDelete;
    }

    get defaultProject(): string | null {
        return this.config.defaultProject;
    }

    get maxTextLength(): number {
        return this.config.maxTextLength;
    }
}

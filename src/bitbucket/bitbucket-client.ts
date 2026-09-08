import { ApiClient } from "../shared/http.js";
import type { BitbucketConfig } from "./config.js";

export class BitbucketClient extends ApiClient {
    private readonly config: BitbucketConfig;

    constructor(config: BitbucketConfig) {
        super({
            baseUrl: config.baseUrl,
            token: config.token,
            timeoutMs: config.timeoutMs,
            apiPrefix: "/rest/api/1.0",
        });
        this.config = config;
    }

    get readOnly(): boolean {
        return this.config.readOnly;
    }

    get allowMerge(): boolean {
        return this.config.allowMerge;
    }

    get maxTextLength(): number {
        return this.config.maxTextLength;
    }

    /** Resolves the project/repo pair, falling back to the configured defaults. */
    resolveRepo(project?: string, repo?: string): { project: string; repo: string } {
        const resolvedProject = project ?? this.config.defaultProject;
        const resolvedRepo = repo ?? this.config.defaultRepo;
        if (!resolvedProject) {
            throw new Error("No project key provided and BITBUCKET_DEFAULT_PROJECT is not set.");
        }
        if (!resolvedRepo) {
            throw new Error("No repository slug provided and BITBUCKET_DEFAULT_REPO is not set.");
        }
        return { project: resolvedProject, repo: resolvedRepo };
    }

    repoPath(project?: string, repo?: string): string {
        const resolved = this.resolveRepo(project, repo);
        return `/projects/${encodeURIComponent(resolved.project)}/repos/${encodeURIComponent(resolved.repo)}`;
    }
}

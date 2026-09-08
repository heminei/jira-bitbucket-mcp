#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BitbucketClient } from "./bitbucket-client.js";
import { loadConfig } from "./config.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";

async function main(): Promise<void> {
    const config = loadConfig();
    const client = new BitbucketClient(config);

    const server = new McpServer(
        { name: "bitbucket-server", version: "1.0.0" },
        {
            instructions:
                "Tools for a self-hosted Bitbucket Server / Data Center instance (REST API 1.0). " +
                "Repositories are addressed by project key + repository slug; both fall back to " +
                "BITBUCKET_DEFAULT_PROJECT and BITBUCKET_DEFAULT_REPO. Pull requests are identified by numeric id. " +
                "Usernames are Bitbucket Server user slugs, not emails.",
        },
    );

    registerReadTools(server, client);
    if (!config.readOnly) {
        registerWriteTools(server, client);
    }

    await server.connect(new StdioServerTransport());
    // stdout carries the MCP protocol, so diagnostics must go to stderr.
    console.error(`bitbucket-server MCP ready for ${config.baseUrl}${config.readOnly ? " (read-only)" : ""}`);
}

main().catch((error: unknown) => {
    console.error(`bitbucket-server MCP failed to start: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});

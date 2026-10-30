#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { JiraClient } from "./jira-client.js";
import { registerAgileTools } from "./tools/agile.js";
import { registerAttachmentTools } from "./tools/attachments.js";
import { registerReadTools } from "./tools/read.js";
import { registerWorkflowTools } from "./tools/workflow.js";
import { registerWriteTools } from "./tools/write.js";

async function main(): Promise<void> {
    const config = loadConfig();
    const client = new JiraClient(config);

    const server = new McpServer(
        { name: "jira-server", version: "1.1.0" },
        {
            instructions:
                "Tools for a self-hosted Jira Server / Data Center instance (REST API v2). " +
                "Issue keys look like PROJ-1234. Use jira_get_create_meta before creating issues and " +
                "jira_get_transitions before transitioning them. Usernames are Jira Server usernames, not emails.",
        },
    );

    registerReadTools(server, client);
    registerAttachmentTools(server, client);
    registerAgileTools(server, client);
    if (!config.readOnly) {
        registerWriteTools(server, client);
        registerWorkflowTools(server, client);
    }

    await server.connect(new StdioServerTransport());
    // stdout carries the MCP protocol, so diagnostics must go to stderr.
    console.error(`jira-server MCP ready for ${config.baseUrl}${config.readOnly ? " (read-only)" : ""}`);
}

main().catch((error: unknown) => {
    console.error(`jira-server MCP failed to start: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});

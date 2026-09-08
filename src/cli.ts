#!/usr/bin/env node
const target = process.argv[2];

switch (target) {
    case "jira":
        await import("./jira/index.js");
        break;
    case "bitbucket":
        await import("./bitbucket/index.js");
        break;
    default:
        console.error(
            target
                ? `Unknown server "${target}". Usage: jira-bitbucket-mcp <jira|bitbucket>`
                : "Usage: jira-bitbucket-mcp <jira|bitbucket>",
        );
        process.exit(1);
}

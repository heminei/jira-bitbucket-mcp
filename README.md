# jira-bitbucket-mcp

[![npm version](https://img.shields.io/npm/v/jira-bitbucket-mcp.svg)](https://www.npmjs.com/package/jira-bitbucket-mcp)
[![license](https://img.shields.io/npm/l/jira-bitbucket-mcp.svg)](./LICENSE)

Two [Model Context Protocol](https://modelcontextprotocol.io) servers in one npm package, for **self-hosted Atlassian** instances:

| Server | Target | REST API |
| --- | --- | --- |
| `jira-bitbucket-mcp jira` | Jira Server / Data Center | `/rest/api/2` |
| `jira-bitbucket-mcp bitbucket` | Bitbucket Server / Data Center | `/rest/api/1.0` |

> These are **Server / Data Center** APIs. The Jira Cloud v3 API with `accountId`-based fields is not supported, and neither is the Bitbucket Cloud 2.0 API. If you are on Atlassian Cloud, use a Cloud-specific MCP server instead.

Both servers speak MCP over **stdio** and work with any MCP client (VS Code, Claude Desktop, Cursor, Zed, custom agents, …).

## Requirements

- Node.js >= 18.17
- A Jira and/or Bitbucket Server / Data Center instance reachable over HTTPS
- A personal access token for each instance

## Getting tokens

- **Jira**: avatar → Profile → Personal Access Tokens → Create token
- **Bitbucket**: avatar → Manage account → Personal Access Tokens → Create token (needs *Repository read*, plus *write* for PR actions)

Use your own token so actions are attributed to you.

## Usage

No install needed — run either server with `npx`:

```bash
JIRA_BASE_URL=https://jira.example.com JIRA_PAT=xxx npx -y jira-bitbucket-mcp jira
```

Or install globally, which puts `jira-bitbucket-mcp` on your `PATH`:

```bash
npm install -g jira-bitbucket-mcp
```

### VS Code

Add to `.vscode/mcp.json` (workspace) or your user `mcp.json`:

```jsonc
{
  "inputs": [
    { "id": "jira-pat", "type": "promptString", "description": "Jira PAT", "password": true },
    { "id": "bitbucket-token", "type": "promptString", "description": "Bitbucket token", "password": true }
  ],
  "servers": {
    "jira": {
      "command": "npx",
      "args": ["-y", "jira-bitbucket-mcp", "jira"],
      "env": {
        "JIRA_BASE_URL": "https://jira.example.com",
        "JIRA_PAT": "${input:jira-pat}",
        "JIRA_DEFAULT_PROJECT": "PROJ"
      }
    },
    "bitbucket": {
      "command": "npx",
      "args": ["-y", "jira-bitbucket-mcp", "bitbucket"],
      "env": {
        "BITBUCKET_BASE_URL": "https://bitbucket.example.com",
        "BITBUCKET_TOKEN": "${input:bitbucket-token}",
        "BITBUCKET_DEFAULT_PROJECT": "PROJ",
        "BITBUCKET_DEFAULT_REPO": "my-repo"
      }
    }
  }
}
```

Then: Command Palette → **MCP: List Servers** → start **jira** and/or **bitbucket**. You are prompted for each token once and VS Code stores it in the OS secret store.

### Claude Desktop and other clients

In `claude_desktop_config.json`, or the equivalent config of your client:

```json
{
  "mcpServers": {
    "jira": {
      "command": "npx",
      "args": ["-y", "jira-bitbucket-mcp", "jira"],
      "env": {
        "JIRA_BASE_URL": "https://jira.example.com",
        "JIRA_PAT": "your-token"
      }
    }
  }
}
```

## Environment variables

### Jira

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `JIRA_BASE_URL` | yes | – | Instance URL. Must be https (except localhost). |
| `JIRA_PAT` | yes | – | Personal access token, sent as `Authorization: Bearer`. |
| `JIRA_DEFAULT_PROJECT` | no | – | Project key used when a tool omits one, e.g. `PROJ`. |
| `JIRA_READ_ONLY` | no | `0` | Set to `1` to register only the read tools. |
| `JIRA_ALLOW_DELETE` | no | `0` | Set to `1` to register `jira_delete_issue`. Deletion is permanent. |
| `JIRA_TIMEOUT_MS` | no | `30000` | Per-request timeout. |
| `JIRA_MAX_TEXT_LENGTH` | no | `4000` | Descriptions and comments are truncated to this length. |

### Bitbucket

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `BITBUCKET_BASE_URL` | yes | – | Instance URL. Must be https (except localhost). |
| `BITBUCKET_TOKEN` | yes | – | HTTP access token, sent as `Authorization: Bearer`. |
| `BITBUCKET_DEFAULT_PROJECT` | no | – | Project key used when a tool omits one, e.g. `PROJ`. |
| `BITBUCKET_DEFAULT_REPO` | no | – | Repository slug, e.g. `my-repo`. |
| `BITBUCKET_READ_ONLY` | no | `0` | Set to `1` to register only the read tools. |
| `BITBUCKET_ALLOW_MERGE` | no | `0` | Set to `1` to register the merge and decline tools. |
| `BITBUCKET_TIMEOUT_MS` | no | `30000` | Per-request timeout. |
| `BITBUCKET_MAX_TEXT_LENGTH` | no | `20000` | Diffs, files and descriptions are truncated to this length. |

## Tools

### Jira

Read: `jira_myself`, `jira_search` (JQL), `jira_get_issue`, `jira_list_projects`, `jira_get_transitions`, `jira_get_create_meta`, `jira_list_fields`.

Write: `jira_create_issue`, `jira_update_issue`, `jira_add_comment`, `jira_transition_issue`, `jira_assign_issue`, `jira_add_worklog`, and `jira_delete_issue` (opt-in).

### Bitbucket

Read: `bitbucket_myself`, `bitbucket_list_repos`, `bitbucket_list_pull_requests`, `bitbucket_get_pull_request`, `bitbucket_get_pull_request_diff`, `bitbucket_list_branches`, `bitbucket_list_commits`, `bitbucket_get_file`.

Write: `bitbucket_create_pull_request`, `bitbucket_update_pull_request`, `bitbucket_add_pull_request_comment`, `bitbucket_review_pull_request`, plus `bitbucket_merge_pull_request` and `bitbucket_decline_pull_request` (opt-in).

Responses are trimmed projections; several read tools accept `raw: true` for the full payload.

## Safety

- Destructive operations are opt-in: `JIRA_ALLOW_DELETE` and `BITBUCKET_ALLOW_MERGE` are off by default.
- `JIRA_READ_ONLY=1` / `BITBUCKET_READ_ONLY=1` register the read tools only — a good default for exploratory agents.
- Tokens are never logged and are stripped from error messages before they are returned.
- `*_BASE_URL` must be https unless it points at localhost.

## Notes

- `jira_assign_issue` and Bitbucket reviewer lists take **Server usernames / user slugs**, not email addresses.
- Issue keys look like `PROJ-1234`; pull requests are addressed by project key + repository slug + numeric id.

## Development

```bash
git clone https://github.com/heminei/jira-bitbucket-mcp.git
cd jira-bitbucket-mcp
npm install
npm run build
```

Layout:

```
src/cli.ts      bin entrypoint, dispatches to the jira or bitbucket server
src/shared/     env parsing, HTTP client with bearer auth + token redaction, result formatting
src/jira/       Jira config, client, tools, entrypoint      -> dist/jira/index.js
src/bitbucket/  Bitbucket config, client, tools, entrypoint -> dist/bitbucket/index.js
```

Debug with the MCP inspector:

```bash
JIRA_BASE_URL=... JIRA_PAT=... npm run inspect:jira
BITBUCKET_BASE_URL=... BITBUCKET_TOKEN=... npm run inspect:bitbucket
```

Issues and pull requests are welcome.

## License

[MIT](./LICENSE) © Martin Bratvanov

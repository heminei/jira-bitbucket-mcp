# AGENTS.md

Two stdio MCP servers (Jira Server/DC REST v2, Bitbucket Server/DC REST 1.0) in one npm package. Setup, env vars, tool list and safety model are in [README.md](README.md); don't duplicate them here.

## Build

- `npm run build` (plain `tsc`, output in `dist/`). There is no test runner or linter; a clean build is the check.
- ESM + `NodeNext`: relative imports must use the `.js` extension (`import ... from "./common.js"`).
- Debug with `npm run inspect:jira` / `npm run inspect:bitbucket` (needs the `*_BASE_URL` and token env vars).

## Architecture

- [src/cli.ts](src/cli.ts) dispatches `jira` / `bitbucket` to `src/<server>/index.ts`, which wires config, client and tool registration.
- Each server has the same shape: `config.ts` (env parsing), `*-client.ts` (extends `ApiClient` from [src/shared/http.ts](src/shared/http.ts)), `common.ts` (zod schemas, `assertWritable`), and `tools/{read,write,...}.ts`.
- Shared code (`src/shared/`): `env.ts`, `http.ts` (bearer auth, timeout, token redaction, Jira + Bitbucket error envelopes), `format.ts` (`jsonResult`, `textResult`, `truncate`, `pickName`).

## Conventions

- stdout carries the MCP protocol. Log only with `console.error`, never `console.log`.
- Tools: `server.registerTool(name, { title, description, inputSchema }, handler)` with zod schemas and `.describe()` on every field. Names are prefixed `jira_` / `bitbucket_`. Return `jsonResult`/`textResult`.
- Write tools go in a write/workflow file, are skipped in `*_READ_ONLY` mode, and call `assertWritable(client)` as a second guard. Destructive tools (`jira_delete_issue`, Bitbucket merge/decline) are opt-in via `*_ALLOW_DELETE` / `*_ALLOW_MERGE`.
- Return trimmed projections (add `raw: true` where the full payload is useful) and truncate long text with `truncate()` using the configured `*_MAX_TEXT_LENGTH`.
- Never log or return tokens; route all HTTP through `ApiClient` so redaction applies.
- Jira/Bitbucket Server take usernames / user slugs, not emails or Cloud `accountId`s.
- New env var or tool: update the tables in [README.md](README.md) too. Style is 4-space indent, double quotes, trailing commas.

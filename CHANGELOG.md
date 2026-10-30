# Changelog

All notable changes to this project are documented in this file.

## [1.1.0] - 2026-10-30

### Added

#### Jira

- Attachments: `jira_list_attachments`, `jira_get_attachment` (inline for small text and images, otherwise saved to disk), `jira_add_attachment` and `jira_delete_attachment` (opt-in via `JIRA_ALLOW_DELETE`).
- Comments: `jira_update_comment` and `jira_delete_comment` (opt-in via `JIRA_ALLOW_DELETE`).
- Worklogs: `jira_list_worklogs`.
- Issue links: `jira_list_link_types` and `jira_link_issues`; `jira_get_issue` now includes `links`.
- Watchers: `jira_list_watchers`, `jira_add_watcher` and `jira_remove_watcher`.
- Jira Software: `jira_list_boards`, `jira_list_sprints` and `jira_get_sprint_issues`.
- Environment variables `JIRA_ATTACHMENTS_DIR` and `JIRA_MAX_ATTACHMENT_BYTES`.

#### Bitbucket

- Pull request comments: `bitbucket_list_pull_request_comments`, `bitbucket_update_pull_request_comment` (edit, resolve, task) and `bitbucket_delete_pull_request_comment` (opt-in via `BITBUCKET_ALLOW_DELETE`); `bitbucket_add_pull_request_comment` accepts `parentId` to reply.
- Pull request review: `bitbucket_list_pull_request_changes` and `bitbucket_get_build_status`.
- Repository: `bitbucket_browse_files` and `bitbucket_search_code`.
- Environment variable `BITBUCKET_ALLOW_DELETE`.

#### Shared

- `ApiClient` supports binary downloads, multipart uploads, per-request timeouts and per-request REST roots.

### Fixed

- `bitbucket_get_pull_request` returned `null` paths for changed files when `includeChanges` was set.

## [1.0.0]

- Initial release: Jira Server / Data Center and Bitbucket Server / Data Center MCP servers.

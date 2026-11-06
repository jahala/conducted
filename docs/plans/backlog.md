# Feature backlog

Every feature of the app, with the folder that owns it. Code placeholders call `notImplemented("<ID>")` (TypeScript), `not_implemented!("<ID>")` (Rust) or `not_implemented "<ID>"` (shell). `pnpm stubs` compares this table with the code. It fails when code names an ID that is missing here, or when a `stub` row has no placeholder left in the code. Set a row to `done` in the same change that removes its last placeholder.

Research paths are relative to `docs/research/conductor/`. Folder paths: `D` = `apps/desktop/src`, `R` = `apps/desktop/src-tauri/src`, `S` = `packages/sidecar/src`.

Priority: **1** = the first working slice (add a repo, create a workspace, chat with Claude, see the diff). **2** = needed for daily use. **3** = polish.

Needs: the ids a feature waits for. The issue sync turns them into GitHub "blocked by" links. What each feature covers, item by item, is in [items/](items/README.md).

## Platform and Rust shell (PLAT)

| ID      | Feature                                                               | Owner                                                       | Research                                             | P   | Status  | Needs                              |
| ------- | --------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------- | --- | ------- | ---------------------------------- |
| PLAT-01 | Platform contract test and in-memory stand-in for tests               | D/platform                                                  | services-map 1.1                                     | 1   | done    |                                    |
| PLAT-02 | Tauri implementation of the Platform interface                        | D/platform                                                  | services-map 1.1                                     | 1   | done    | PLAT-01                            |
| PLAT-03 | Shell commands: run, start, cancel (kills the process group), timeout | R/shell.rs                                                  | native-and-sidecar-map A2                            | 1   | done    |                                    |
| PLAT-04 | Capture the login-shell PATH at startup                               | R/shell.rs                                                  | native-and-sidecar-map B3                            | 1   | done    |                                    |
| PLAT-05 | Files: atomic write, trash, stat, read dir                            | R/files.rs                                                  | native-and-sidecar-map A2                            | 1   | done    |                                    |
| PLAT-06 | File search: tree, fuzzy match, grep (gitignore-aware)                | R/file_search.rs                                            | native-and-sidecar-map A2                            | 2   | done    |                                    |
| PLAT-07 | Terminals over PTY with flow control and screen text                  | R/pty.rs                                                    | native-and-sidecar-map A2                            | 1   | done    |                                    |
| PLAT-08 | Saved terminal scrollback                                             | R/terminal_history.rs                                       | native-and-sidecar-map A2                            | 3   | done    |                                    |
| PLAT-09 | Sidecar launcher: spawn, socket relay, restart, parent watchdog       | R/sidecar.rs                                                | native-and-sidecar-map A6                            | 1   | done    | SIDE-23                            |
| PLAT-10 | Keychain read and write                                               | R/keychain.rs                                               | native-and-sidecar-map A2                            | 2   | done    |                                    |
| PLAT-11 | Native notifications, dock badge, click opens a deep link             | R/notifications.rs                                          | native-and-sidecar-map A2                            | 2   | done    |                                    |
| PLAT-12 | On-device dictation                                                   | R/speech.rs                                                 | native-and-sidecar-map A2                            | 3   | done    |                                    |
| PLAT-13 | Self-update that waits until agents are idle                          | R/updater.rs                                                | native-and-sidecar-map A9                            | 3   | stub    | PLAT-31, PLAT-28                   |
| PLAT-14 | CPU and memory per process, grouped by workspace                      | R/resource_usage.rs                                         | native-and-sidecar-map A2                            | 3   | done    |                                    |
| PLAT-15 | App menu with accelerators from the command registry                  | R/menu.rs                                                   | native-and-sidecar-map A5                            | 2   | done    | NAV-07                             |
| PLAT-16 | `conducted://` deep links                                             | R/deep_link.rs                                              | native-and-sidecar-map A8                            | 3   | done    |                                    |
| PLAT-17 | Block startup when the database is newer than the app                 | R/db.rs                                                     | native-and-sidecar-map A11                           | 2   | done    | PLAT-32                            |
| PLAT-18 | App log files and log export                                          | R/logger.rs                                                 | native-and-sidecar-map A7                            | 2   | done    |                                    |
| PLAT-19 | Detect installed editors and terminals for "Open in"                  | R/open_with.rs                                              | ui-map 3.10                                          | 2   | done    |                                    |
| PLAT-20 | Attachments: copy dropped files, shrink large images                  | R/attachments.rs                                            | native-and-sidecar-map A2                            | 2   | done    |                                    |
| PLAT-21 | Keep the Mac awake while agents work                                  | D/platform, D/core/services                                 | native-and-sidecar-map A5; services-map 5B.2         | 2   | done    | PLAT-03, PLAT-02                   |
| PLAT-22 | Navigation guard and content security policy                          | R/navigation.rs                                             | native-and-sidecar-map A2                            | 1   | done    | PLAT-02                            |
| PLAT-23 | Window look: vibrancy, traffic lights, zoom                           | R/window.rs, D/platform                                     | native-and-sidecar-map A2, A5; ui-map 6              | 3   | done    | PLAT-02                            |
| PLAT-24 | Full Disk Access check and Privacy pane link                          | R/permissions.rs, D/platform                                | native-and-sidecar-map A2, A5                        | 3   | done    | PLAT-02                            |
| PLAT-25 | Release bundle: privacy strings, entitlements, signing, notarisation  | apps/desktop/src-tauri, scripts                             | native-and-sidecar-map A1                            | 2   | done    | SIDE-23                            |
| PLAT-26 | Online and offline events                                             | R/network.rs, D/platform                                    | native-and-sidecar-map A2, A4; services-map 6        | 3   | done    | PLAT-02                            |
| PLAT-27 | Startup hardening: file limit, panics in the log, one instance        | R/lib.rs                                                    | native-and-sidecar-map A2, A5                        | 3   | done    |                                    |
| PLAT-28 | Agent program manager: download, verify, update, prune                | R/binaries.rs, D/platform, D/features/settings              | native-and-sidecar-map A2, A6, A9; services-map 5A.8 | 2   | planned | PLAT-02, PLAT-04, PLAT-09, PLAT-30 |
| PLAT-29 | Limit the paths, programs and links the webview can reach             | R/files.rs, R/shell.rs, apps/desktop/src-tauri/capabilities | native-and-sidecar-map A3                            | 2   | done    | PLAT-03, PLAT-05                   |
| PLAT-30 | HTTP from Rust: fetch and download with progress, checksum, cancel    | R/http.rs, D/platform                                       | native-and-sidecar-map A2; services-map 1.1          | 2   | done    | PLAT-02, PLAT-29                   |
| PLAT-31 | Window focus and blur events                                          | D/platform, R/lib.rs                                        | services-map 1.1, 3.3.1, 6                           | 2   | done    | PLAT-02                            |
| PLAT-32 | System facts: macOS version and the build's CPU                       | R/lib.rs, D/platform                                        | ui-map 6, 7.4                                        | 2   | done    | PLAT-02                            |
| PLAT-33 | Platform doors for dropped files, attachments and menu shortcuts      | D/platform                                                  | native-and-sidecar-map A2, A4                        | 2   | done    | PLAT-02, PLAT-15, PLAT-20          |
| PLAT-34 | Check the bundled helper programs at launch                           | R/binaries.rs                                               | native-and-sidecar-map A2, A9                        | 2   | done    | PLAT-09                            |
| PLAT-35 | Install and update gh and watchexec (D024)                            | R/binaries.rs                                               | overview 5; native-and-sidecar-map A9                | 2   | stub    | PLAT-28                            |
| PLAT-36 | Rust command tests through a mock Tauri app                           | R                                                           | native-and-sidecar-map A2                            | 2   | planned | PLAT-03, PLAT-05, PLAT-07          |

## Sidecar core (SIDE)

| ID      | Feature                                                                        | Owner                                           | Research                                                    | P   | Status  | Needs                      |
| ------- | ------------------------------------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------- | --- | ------- | -------------------------- |
| SIDE-01 | Entry point and modes                                                          | S/main.ts                                       | native-and-sidecar-map B1                                   | 1   | done    |                            |
| SIDE-02 | JSON-RPC server over a Unix socket, NDJSON, re-attach on reconnect             | S/rpc                                           | sessions 0, 10                                              | 1   | done    | SIDE-01                    |
| SIDE-03 | Session manager: per-session queue, duplicate guard, idle after flush          | S/session                                       | sessions 2                                                  | 1   | done    | SIDE-02                    |
| SIDE-04 | Turn lifecycle and stale-run guard                                             | S/session                                       | sessions 2                                                  | 1   | done    | SIDE-03                    |
| SIDE-05 | Event batching and live-state notifications                                    | S/session                                       | sessions 5                                                  | 1   | done    | SIDE-03                    |
| SIDE-06 | Write-ahead event log: write before send, ack, replay on reconnect             | S/outbox                                        | sessions 5                                                  | 1   | done    | SIDE-05                    |
| SIDE-07 | Process manager: leases, 30-minute idle stop, warm pool of 2                   | S/process                                       | sessions 3                                                  | 2   | done    |                            |
| SIDE-08 | Checkpoints: start before first write, end with file summary                   | S/checkpoints                                   | sessions 7                                                  | 1   | done    | SIDE-04                    |
| SIDE-09 | Prompt assembly: first-message instruction, mentions, attachments, preferences | S/prompt                                        | claude-runner 5                                             | 1   | done    |                            |
| SIDE-10 | Login-shell environment capture with provider secrets removed                  | S/shell-env                                     | native-and-sidecar-map B3                                   | 1   | done    | PLAT-04                    |
| SIDE-11 | Interactions: one open per session, withdrawn on cancel or new message         | S/session                                       | claude-runner 3                                             | 1   | done    | SIDE-03                    |
| SIDE-12 | App tools as an in-process MCP server (for Claude)                             | S/tools                                         | claude-runner 4                                             | 2   | done    |                            |
| SIDE-13 | App tools over a socket bridge (for Codex and ACP agents)                      | S/tools                                         | claude-runner 4.3                                           | 2   | done    | SIDE-12                    |
| SIDE-14 | Model catalog per agent                                                        | S/models                                        | other-runners 5                                             | 1   | done    |                            |
| SIDE-15 | Agent detection, versions and sign-in flows                                    | S/models                                        | other-runners 5                                             | 1   | done    |                            |
| SIDE-16 | Slash commands and MCP server listing                                          | S/models                                        | claude-runner 7                                             | 2   | done    |                            |
| SIDE-17 | Context and plan usage                                                         | S/models                                        | claude-runner 7                                             | 2   | done    |                            |
| SIDE-18 | Sidecar logs go to the Rust shell's log files                                  | S/logging                                       | native-and-sidecar-map B5                                   | 3   | done    | PLAT-09, PLAT-18           |
| SIDE-19 | Parent watchdog and graceful shutdown                                          | S/watchdog.ts, S/shutdown.ts                    | sessions 8                                                  | 1   | done    | SIDE-01                    |
| SIDE-20 | Tell the app when the agent changes a chat's mode                              | S/session, packages/protocol, D/core/sidecar    | claude-runner 2.1, 3.5; sessions 5, 10                      | 2   | done    | AGENT-04, SIDE-05          |
| SIDE-21 | Agent settings reach the sidecar: program paths, environment, keys             | S/runners, S/process, packages/protocol, D/core | claude-runner 1.2; sessions 1, 4; native-and-sidecar-map B4 | 2   | done    | SIDE-07, SIDE-15           |
| SIDE-22 | Slash command cache that works before a chat starts                            | S/models, R/sidecar.rs                          | native-and-sidecar-map B3, D1; frontend 3c                  | 3   | done    | SIDE-16                    |
| SIDE-23 | Sidecar packaging: version flag, one program per CPU                           | packages/sidecar, apps/desktop/src-tauri        | overview 3; native-and-sidecar-map B1, C                    | 1   | done    | SIDE-01                    |
| SIDE-24 | Chat titles and branch names from a short run of the user's agent              | S/session, packages/protocol, D/core/services   | other-runners 2.2; services-map 2.4, 5B                     | 2   | done    | SIDE-03, SIDE-14, AGENT-02 |
| SIDE-25 | Sidecar adapters in their own edge modules                                     | S/modes                                         | native-and-sidecar-map B1                                   | 2   | planned | SIDE-01                    |

## Agent runners (AGENT)

| ID       | Feature                                                                    | Owner                                                 | Research                                | P   | Status  | Needs                      |
| -------- | -------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------- | --- | ------- | -------------------------- |
| AGENT-01 | Runner contract                                                            | S/runners/runner.ts                                   | other-runners 1                         | 1   | done    |                            |
| AGENT-02 | Claude: Agent SDK in streaming-input mode, resume, fork                    | S/runners/claude                                      | claude-runner 1                         | 1   | done    |                            |
| AGENT-03 | Claude: translate SDK messages to the neutral format                       | S/runners/claude                                      | claude-runner 2                         | 1   | done    | AGENT-02                   |
| AGENT-04 | Claude: tool approvals, plan mode, edit-path sandbox, live mode switch     | S/runners/claude                                      | claude-runner 3                         | 1   | done    | AGENT-02                   |
| AGENT-05 | Claude: steer with a "read by the agent" receipt                           | S/runners/claude                                      | claude-runner 6                         | 2   | done    |                            |
| AGENT-06 | Codex: `codex app-server` JSON-RPC, threads, steer, interrupt              | S/runners/codex                                       | other-runners 2.1                       | 2   | done    |                            |
| AGENT-07 | Codex: translate items to the neutral format                               | S/runners/codex                                       | other-runners 3                         | 2   | done    |                            |
| AGENT-08 | Codex: approvals, permission grants, MCP forms                             | S/runners/codex                                       | other-runners 4                         | 2   | done    |                            |
| AGENT-09 | Cursor: SDK in process                                                     | S/runners/cursor                                      | other-runners 2.3                       | 3   | planned |                            |
| AGENT-10 | Cursor: translate to the neutral format                                    | S/runners/cursor                                      | other-runners 3                         | 3   | done    |                            |
| AGENT-11 | ACP client and runner                                                      | S/runners/acp                                         | other-runners 2.2                       | 2   | done    |                            |
| AGENT-12 | ACP adapters for OpenCode and Pi, with translation                         | S/runners/acp                                         | other-runners 2.2, 3                    | 2   | done    |                            |
| AGENT-13 | Codex goals: set, pause, resume, clear                                     | S/runners/codex, packages/protocol                    | other-runners 2.1, 3; sessions 2        | 3   | done    | AGENT-06                   |
| AGENT-14 | Codex `/compact`                                                           | S/runners/codex                                       | other-runners 2.1                       | 3   | done    | AGENT-06                   |
| AGENT-15 | Turns the Claude program starts by itself                                  | S/runners/claude, S/session                           | sessions 2; claude-runner 2.2           | 2   | done    | AGENT-02, SIDE-04, DATA-04 |
| AGENT-16 | Chat options the settings offer: output style, personality, effort, Chrome | packages/protocol, S/runners/claude, S/runners/codex  | claude-runner 1.2, 1.5; other-runners 1 | 2   | done    | AGENT-02, AGENT-06, SET-01 |
| AGENT-17 | ACP chat options beyond the model                                          | packages/protocol, S/runners/acp, D/features/composer | other-runners 2.2, 5                    | 2   | done    | AGENT-11, AGENT-12         |
| AGENT-18 | Bundled skill that teaches agents the app                                  | S/runners/claude, apps/desktop/src-tauri              | claude-runner 1.2, 5.6                  | 3   | done    | AGENT-02, SIDE-23          |

## Data layer (DATA)

| ID      | Feature                                                                                                               | Owner                        | Research                          | P   | Status | Needs                  |
| ------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------- | --- | ------ | ---------------------- |
| DATA-01 | One repository module per table                                                                                       | D/core/db                    | services-map 2.3                  | 1   | done   |                        |
| DATA-02 | Data lifetime job: cut old tool outputs, compact archived chats, remove old drafts and terminals                      | D/core/db                    | services-map 2.7                  | 2   | done   | DATA-08                |
| DATA-03 | Startup repair: close turns cut off by a crash, reset stale working state                                             | D/core/db                    | services-map 6                    | 1   | done   | DATA-01                |
| DATA-04 | Event ingest: store each event in order, then acknowledge                                                             | D/core/sidecar               | sessions-and-chats "What happens" | 1   | done   | DATA-01                |
| DATA-05 | Settings store and `.conducted/settings.toml` read and write                                                          | D/core/services              | services-map 4.2                  | 1   | done   |                        |
| DATA-06 | Prune turn snapshots: remove a chat's checkpoint refs when it is deleted, and 30 days after its workspace is archived | D/core/services              | data-model.md                     | 2   | done   | DATA-08                |
| DATA-07 | Cache the last PR info and changes for a fast restart                                                                 | D/core/services              | services-map 2.7.2, 3.3.1, 5B.1.5 | 3   | done   | DATA-01, GIT-02, PR-03 |
| DATA-08 | Migration 0004: new columns, kinds and flags                                                                          | D/core/db                    | services-map 2.2, 2.3, 2.7        | 2   | done   | DATA-01                |
| DATA-09 | One home for a repo's git remote                                                                                      | D/core/lookups.ts, D/core/db | services-map 2.3                  | 2   | done   | DATA-05, GIT-01        |

## Projects and workspaces (PRJ, WS)

| ID     | Feature                                                               | Owner                                        | Research             | P   | Status | Needs                            |
| ------ | --------------------------------------------------------------------- | -------------------------------------------- | -------------------- | --- | ------ | -------------------------------- |
| PRJ-01 | Add a project from a local folder                                     | D/core/services                              | ui-map 3.9           | 1   | done   | GIT-01, DATA-01                  |
| PRJ-02 | Clone a project from GitHub                                           | D/core/services                              | ui-map 3.9           | 2   | done   | PRJ-01, PR-01                    |
| PRJ-03 | Quick start a new project from a template                             | D/core/services                              | ui-map 3.9           | 3   | done   | PRJ-01, PR-01                    |
| PRJ-04 | Per-repo config: scripts, files to copy, prompts                      | D/core/services                              | services-map 4.2     | 1   | done   | PRJ-01, DATA-05                  |
| PRJ-05 | Repository icon                                                       | D/features/sidebar, D/features/settings      | ui-map 4, 5.2, 5.3   | 3   | stub   | PRJ-01, SET-07, NAV-04, APP-12   |
| WS-01  | Create a workspace: fetch, worktree, place name, branch prefix, port  | D/core/services                              | frontend 6           | 1   | done   | GIT-01, PRJ-04, DATA-05, DATA-01 |
| WS-02  | Create from a branch, PR or issue                                     | D/core/services                              | ui-map 3.9           | 2   | done   | WS-01, PR-11                     |
| WS-03  | Setup script in a terminal, with workspace variables and copied files | D/core/services                              | frontend 6           | 1   | done   | WS-01, RUN-06                    |
| WS-04  | Rename the placeholder branch after the first message                 | D/core/services                              | frontend 6           | 2   | done   | WS-01, CHAT-02, SIDE-24          |
| WS-05  | Archive: snapshot, archive ref, archive script, remove worktree       | D/core/services                              | services-map 3.10    | 2   | done   | WS-01, GIT-10                    |
| WS-06  | Unarchive                                                             | D/core/services                              | services-map 3.10    | 2   | done   | WS-05                            |
| WS-07  | Linked workspaces and extra folders                                   | D/core/services                              | ui-map 3.10          | 3   | done   | WS-01                            |
| WS-08  | Open a workspace in another app                                       | D/features/open-in                           | ui-map 3.10          | 2   | done   | PLAT-19                          |
| WS-09  | Workspace status as a pure function                                   | D/core/status                                | ui-map 3.8           | 1   | done   | DATA-01                          |
| WS-10  | Delete a workspace                                                    | D/core/services                              | services-map 3.10    | 2   | done   | WS-05                            |
| WS-11  | Backlog workspaces: add now, start later                              | D/core/services, D/app, D/features/workspace | ui-map 3.1, 3.9, 5.4 | 3   | done   | WS-01, WS-09, DATA-01            |

## Navigation and shell (NAV)

| ID     | Feature                                                                  | Owner                                   | Research                                       | P   | Status | Needs                          |
| ------ | ------------------------------------------------------------------------ | --------------------------------------- | ---------------------------------------------- | --- | ------ | ------------------------------ |
| NAV-01 | App shell: three resizable regions, persisted sizes                      | D/app                                   | ui-map 1.1                                     | 1   | done   | APP-05, DATA-05                |
| NAV-02 | Routes and per-workspace URL state                                       | D/app                                   | ui-map 2                                       | 1   | done   | NAV-01, APP-01                 |
| NAV-03 | Sidebar: workspace list, group by status or project, sort, filter        | D/features/sidebar                      | ui-map 4                                       | 1   | done   | NAV-01, NAV-07, WS-09, DATA-01 |
| NAV-04 | Pinned, sections, drag and drop, manual order                            | D/features/sidebar                      | ui-map 4                                       | 2   | done   | NAV-03, APP-05, APP-12         |
| NAV-05 | Home grid of all workspaces                                              | D/features/home                         | ui-map 2                                       | 2   | done   | NAV-03, WS-09                  |
| NAV-06 | Kanban dashboard                                                         | D/features/dashboard                    | ui-map 2                                       | 3   | stub   | NAV-05, WS-09                  |
| NAV-07 | Command registry and default shortcuts                                   | D/core/registries                       | ui-map 5.4                                     | 1   | done   | SET-01                         |
| NAV-08 | Command palette                                                          | D/features/palette                      | ui-map 5.1                                     | 2   | done   | NAV-07, APP-15, PLAT-06        |
| NAV-09 | Shortcuts dialog and custom key bindings                                 | D/features/palette                      | ui-map 5.4                                     | 3   | stub   | NAV-07, NAV-14, SET-01         |
| NAV-10 | Center tab strip: chat, terminal, file, PR and browser tabs, split panes | D/features/workspace                    | ui-map 3.2                                     | 1   | done   | NAV-01, NAV-02, CHAT-01        |
| NAV-11 | Unread state and "next unread"                                           | D/features/sidebar                      | ui-map 4                                       | 2   | done   | NAV-03, CHAT-01, DATA-01       |
| NAV-12 | Zen mode and panel toggles                                               | D/app                                   | ui-map 1.1                                     | 3   | stub   | NAV-01, NAV-14                 |
| NAV-13 | World map of workspace place names                                       | D/features/passport                     | ui-map 4                                       | 3   | stub   | NAV-03, WS-01                  |
| NAV-14 | Shortcut and menu dispatcher                                             | D/app                                   | ui-map 5.4, 8                                  | 1   | done   | NAV-07, DATA-05                |
| NAV-15 | Terminals and previews that survive tab switches                         | D/app                                   | ui-map 1.1, 8                                  | 2   | done   | NAV-10, RUN-06                 |
| NAV-16 | Draft markers on the Create row and on workspaces                        | D/features/sidebar, D/features/composer | ui-map 4.3                                     | 3   | stub   | NAV-03, COMP-01, WS-01         |
| NAV-17 | Deep-link routes: settings, browser tab, create with a prompt            | D/core/services, D/app                  | native-and-sidecar-map A8; services-map 5B.2.5 | 3   | done   | PLAT-16, WS-01, SET-02         |

## Chat (CHAT)

| ID      | Feature                                                                | Owner                                         | Research                                        | P   | Status | Needs                              |
| ------- | ---------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------- | --- | ------ | ---------------------------------- |
| CHAT-01 | Create, close, rename chats; chat history                              | D/core/services                               | ui-map 3.2                                      | 1   | done   | DATA-01                            |
| CHAT-02 | Send a message as a new turn                                           | D/core/services                               | sessions-and-chats "What happens"               | 1   | done   | SIDE-03, SIDE-09, DATA-04, COMP-01 |
| CHAT-03 | Steer a running turn                                                   | D/core/services                               | sessions-and-chats "While the agent is working" | 2   | done   | CHAT-02, AGENT-05                  |
| CHAT-04 | Follow-up queue: edit, reorder, delete, pause, send now as steer       | D/core/services                               | ui-map 3.4                                      | 2   | done   | CHAT-02, CHAT-03                   |
| CHAT-05 | Cancel a turn                                                          | D/core/services                               | sessions 6                                      | 1   | done   | CHAT-02, SIDE-04                   |
| CHAT-06 | Message list: virtualised, one item per turn, only the tail re-renders | D/features/chat                               | frontend 5                                      | 1   | done   | CHAT-07, CHAT-08, APP-13           |
| CHAT-07 | Turn builder: events to turns, sub-agent grouping                      | D/core/services                               | frontend 5                                      | 1   | done   | DATA-04                            |
| CHAT-08 | Tool card registry and the cards                                       | D/features/chat                               | frontend 5                                      | 1   | done   | CHAT-07                            |
| CHAT-09 | Thinking and todo blocks                                               | D/features/chat                               | ui-map 3.3                                      | 2   | done   | CHAT-08                            |
| CHAT-10 | Question card                                                          | D/features/chat                               | claude-runner 3.4                               | 1   | done   | CHAT-08, SIDE-11                   |
| CHAT-11 | Tool approval card                                                     | D/features/chat                               | claude-runner 3.2                               | 2   | done   | CHAT-08, SIDE-11, AGENT-04         |
| CHAT-12 | Plan review                                                            | D/features/chat                               | claude-runner 3.5                               | 2   | done   | CHAT-11, AGENT-04                  |
| CHAT-13 | Progress tracker above the composer                                    | D/features/chat                               | claude-runner 4.2                               | 3   | stub   | CHAT-08, SIDE-12                   |
| CHAT-14 | Context wheel, cost and plan usage                                     | D/features/chat                               | claude-runner 7                                 | 2   | done   | SIDE-17                            |
| CHAT-15 | Revert to a turn                                                       | D/core/services                               | sessions-and-chats "Checkpoints"                | 2   | done   | SIDE-08, GIT-10, REV-09            |
| CHAT-16 | Fork a chat from a turn                                                | D/core/services                               | sessions-and-chats "Checkpoints"                | 3   | done   | CHAT-15                            |
| CHAT-17 | Copy transcript, search chat history                                   | D/core/services                               | ui-map 3.2, 5.1                                 | 3   | done   | CHAT-06                            |
| CHAT-18 | Resume after restart and reconnect                                     | D/core/sidecar                                | sessions 8                                      | 1   | done   | SIDE-06, DATA-03, DATA-04, PLAT-09 |
| CHAT-19 | Notify when a chat finishes or needs the user                          | D/core/services                               | ui-map 6                                        | 2   | done   | PLAT-11                            |
| CHAT-20 | More tool cards: tasks, images, REPL, monitor and others               | D/features/chat, packages/protocol, S/runners | ui-map 3.3; frontend 5                          | 2   | done   | CHAT-08, AGENT-03, AGENT-07        |
| CHAT-21 | Fork a chat to a new workspace                                         | D/core/services, D/features/chat              | ui-map 3.3                                      | 3   | done   | CHAT-16, WS-01                     |
| CHAT-22 | Codex visualizations in the chat                                       | D/features/chat                               | ui-map 3.3                                      | 3   | stub   | CHAT-06, AGENT-07, REV-08          |
| CHAT-23 | Run button on shell code blocks                                        | D/features/chat, D/core/services              | ui-map 3.3                                      | 3   | stub   | CHAT-06, RUN-06                    |
| CHAT-24 | Mermaid diagrams and video in replies                                  | D/features/chat                               | ui-map 3.3, 8                                   | 3   | stub   | CHAT-06                            |
| CHAT-25 | Turn outline and jump list                                             | D/features/chat                               | ui-map 3.3                                      | 3   | stub   | CHAT-06                            |
| CHAT-26 | Start a chat with earlier chats and plans                              | D/features/chat, D/core/services              | ui-map 3.3                                      | 3   | stub   | CHAT-01, CHAT-17, COMP-07          |
| CHAT-27 | Visible auto-retry with Retry now                                      | D/features/chat, packages/protocol            | ui-map 3.3                                      | 2   | done   | CHAT-06, SIDE-04, AGENT-03         |
| CHAT-28 | Account and rate-limit rows in the usage popover                       | D/features/chat, S/models                     | claude-runner 7                                 | 3   | stub   | CHAT-14, SIDE-17                   |
| CHAT-29 | Attachment and image viewer: copy, save, open                          | D/features/file-viewer, D/features/chat       | ui-map 3.3                                      | 3   | stub   | CHAT-06, COMP-07, PLAT-05          |
| CHAT-30 | Fast mode unavailable banner                                           | D/features/composer, packages/protocol        | ui-map 3.5                                      | 3   | stub   | COMP-02, SIDE-05, AGENT-02         |

## Composer (COMP)

| ID      | Feature                                                   | Owner               | Research             | P   | Status | Needs                            |
| ------- | --------------------------------------------------------- | ------------------- | -------------------- | --- | ------ | -------------------------------- |
| COMP-01 | Message editor, send key, drafts that survive restarts    | D/features/composer | ui-map 3.5           | 1   | done   | DATA-01                          |
| COMP-02 | Model picker: agent, model, effort, fast mode, favourites | D/features/composer | ui-map 3.5           | 1   | done   | SIDE-14, SET-01                  |
| COMP-03 | Plan mode and approval toggles                            | D/features/composer | ui-map 3.5           | 2   | done   | AGENT-04                         |
| COMP-04 | `@` file mentions                                         | D/features/composer | ui-map 3.5           | 2   | done   | PLAT-06                          |
| COMP-05 | `#` PR and issue mentions                                 | D/features/composer | ui-map 3.5           | 3   | stub   | PR-11, PR-01                     |
| COMP-06 | `/` slash commands                                        | D/features/composer | ui-map 3.5           | 2   | done   | SIDE-16                          |
| COMP-07 | Attachments: drop, paste, pick                            | D/features/composer | ui-map 3.5           | 2   | done   | PLAT-20, PLAT-33                 |
| COMP-08 | Voice dictation button                                    | D/features/composer | ui-map 3.5           | 3   | stub   | PLAT-12                          |
| COMP-09 | Prompt snippets                                           | D/features/composer | ui-map 3.5, 5.1, 5.2 | 3   | stub   | COMP-01, NAV-08, APP-12, DATA-01 |
| COMP-10 | Codex goal bar and `/goal`                                | D/features/composer | ui-map 3.5           | 3   | stub   | COMP-01, COMP-06, AGENT-13       |

## Review and files (REV)

| ID     | Feature                                                                | Owner                                   | Research                        | P   | Status | Needs                            |
| ------ | ---------------------------------------------------------------------- | --------------------------------------- | ------------------------------- | --- | ------ | -------------------------------- |
| REV-01 | Changes list and diff scopes (branch, target, uncommitted, per commit) | D/features/git-panel                    | ui-map 3.6                      | 1   | done   | GIT-02                           |
| REV-02 | Diff viewer: unified, split, whitespace, viewed files                  | D/features/diff                         | ui-map 3.6                      | 1   | done   | REV-01                           |
| REV-03 | Inline review comments with suggestions                                | D/features/diff                         | ui-map 3.6                      | 2   | done   | REV-02, DATA-01, SIDE-12         |
| REV-04 | Sync review comments with GitHub                                       | D/core/services                         | services-map 5B                 | 3   | done   | REV-03, PR-01                    |
| REV-05 | AI code review in a new chat                                           | D/core/services                         | ui-map 3.6                      | 2   | done   | CHAT-01, REV-01                  |
| REV-06 | File tree tab                                                          | D/features/git-panel                    | ui-map 3.6                      | 2   | done   | PLAT-06, REV-01                  |
| REV-07 | Quick open and search in files                                         | D/features/palette                      | ui-map 3.10                     | 2   | done   | PLAT-06                          |
| REV-08 | File viewer and editor with previews (Markdown, images, SVG, PDF, CSV) | D/features/file-viewer                  | ui-map 3.2                      | 2   | done   | PLAT-05, REV-06                  |
| REV-09 | Changes per turn, from checkpoints                                     | D/core/services                         | services-map 3.12               | 2   | done   | SIDE-08, CHAT-07                 |
| REV-10 | Artifacts tab for the workspace `.context` folder                      | D/features/git-panel, R/files.rs        | services-map 5A.5.1; ui-map 3.6 | 2   | done   | REV-06, PLAT-06, COMP-07, SET-01 |
| REV-11 | Resolve conflicts inline: current, incoming or both                    | D/features/diff, D/features/file-viewer | ui-map 3.6                      | 3   | stub   | REV-02, REV-08, GIT-07           |
| REV-12 | Review comment states, and which messages carried them                 | D/core/services, D/core/db              | services-map 2.2, 2.3           | 2   | done   | REV-03, DATA-08                  |
| REV-13 | Pull request comments without a file, with author avatars              | D/core/services, D/features/pr          | services-map 5B                 | 3   | stub   | REV-04, PR-07, DATA-08           |

## Git and pull requests (GIT, PR)

| ID     | Feature                                                           | Owner                                        | Research                        | P   | Status | Needs                   |
| ------ | ----------------------------------------------------------------- | -------------------------------------------- | ------------------------------- | --- | ------ | ----------------------- |
| GIT-01 | Git runner and command catalogue                                  | D/core/git                                   | services-map 3.0                | 1   | done   |                         |
| GIT-02 | Status polling: changed files, line counts, operation in progress | D/core/git                                   | services-map 3.3                | 1   | done   | GIT-01                  |
| GIT-03 | Branch sync: ahead, behind, rewritten remote                      | D/core/git                                   | services-map 3.6                | 2   | done   | GIT-13                  |
| GIT-04 | Git header state machine                                          | D/core/services                              | ui-map 3.6                      | 2   | done   |                         |
| GIT-05 | Commit and push, done by the agent on request                     | D/core/services                              | services-map 3.5                | 2   | done   |                         |
| GIT-06 | Pull and push                                                     | D/core/git                                   | services-map 3.6                | 2   | done   |                         |
| GIT-07 | Resolve conflicts, done by the agent on request                   | D/core/services                              | services-map 3.8                | 2   | done   |                         |
| GIT-08 | Change the target branch                                          | D/core/services                              | services-map 3.11               | 2   | done   |                         |
| GIT-09 | Rename the branch                                                 | D/core/git                                   | services-map 3.11               | 2   | done   |                         |
| GIT-10 | `bin/checkpointer.sh`: save, restore, diff with private refs      | bin                                          | native-and-sidecar-map C1       | 1   | done   |                         |
| GIT-11 | `bin/git-busy-check.sh`                                           | bin                                          | native-and-sidecar-map C2       | 1   | done   |                         |
| GIT-12 | Branch lists, branch commits and switch branch                    | D/core/services/git.ts                       | services-map 3.3.3, 3.6.6, 3.11 | 2   | done   | GIT-01, GIT-13, PLAT-31 |
| GIT-13 | Fetch on demand, at most once a minute                            | D/core/services/git.ts                       | services-map 3.0.2, 3.3.4       | 2   | done   | GIT-01                  |
| GIT-14 | Local-git forge for repos without GitHub                          | D/core/services                              | services-map 3.7.7, 5B.1.5      | 3   | done   | GIT-01, GIT-05          |
| GIT-15 | Git extras: sparse checkout, external diff tool                   | D/core/services/git.ts                       | services-map 3.11, 5A.5.3       | 3   | done   | GIT-01                  |
| GIT-16 | Explain a blocked git (Xcode licence) and offer the fix           | D/core/git, D/app                            | services-map 5A.8; ui-map 7.4   | 2   | done   | GIT-01, PLAT-07         |
| GIT-17 | Continue after a merge or from a detached HEAD                    | D/core/services/git.ts, D/features/git-panel | services-map 3.1                | 2   | done   | GIT-12, GIT-04, CHAT-02 |
| PR-01  | GitHub access through `gh`                                        | D/core/services                              | services-map 3.9                | 1   | done   | GIT-01                  |
| PR-02  | Create PR, done by the agent with written instructions            | D/core/services                              | frontend 7                      | 1   | done   | PR-01, CHAT-02          |
| PR-03  | PR status polling, batched, behind a rate-limit gate              | D/core/services                              | services-map 3.7                | 2   | done   | PR-01                   |
| PR-04  | Checks and deployments tab with logs and re-run                   | D/features/git-panel                         | ui-map 3.6                      | 2   | done   | PR-03                   |
| PR-05  | "Fix errors": send failing checks to the agent                    | D/core/services                              | ui-map 3.6                      | 2   | done   | PR-04, CHAT-02          |
| PR-06  | Merge, auto-merge, ready for review, approve                      | D/core/services                              | services-map 3.7                | 2   | done   | PR-03                   |
| PR-07  | PR tab: title, description, activity                              | D/features/pr                                | ui-map 3.2                      | 3   | stub   | PR-03                   |
| PR-08  | Stacked PRs and read-only Graphite                                | D/core/services                              | services-map 3.8                | 3   | stub   | PR-03                   |
| PR-09  | Linear issues: list, link, attach as context                      | D/core/services                              | services-map 5B                 | 3   | done   | PLAT-10                 |
| PR-10  | Link a pull request by URL or number                              | D/features/pr, D/core/services               | ui-map 3.1, 3.10                | 3   | stub   | PR-01, PR-07            |
| PR-11  | List and attach GitHub issues and pull requests                   | D/core/services                              | services-map 5B.1.10, 5B.8      | 2   | done   | PR-01, GIT-01           |
| PR-12  | Catch up a stack branch after GitHub rewrites it                  | D/core/services                              | services-map 3.8.3              | 3   | stub   | PR-08                   |

## Run and preview (RUN)

| ID     | Feature                                                             | Owner                         | Research                                       | P   | Status | Needs                     |
| ------ | ------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------- | --- | ------ | ------------------------- |
| RUN-01 | Run actions with start and stop, concurrent or exclusive            | D/core/services               | ui-map 3.7                                     | 2   | done   | DATA-05, PLAT-03, PLAT-07 |
| RUN-02 | Spotlight: test workspace changes in the repo root, restore on stop | D/core/services, bin          | services-map 3.12                              | 3   | done   | RUN-01, GIT-10            |
| RUN-03 | One port per workspace, port detection, preview URLs                | D/core/services               | ui-map 3.7                                     | 2   | done   | RUN-01, PLAT-03           |
| RUN-04 | Browser preview tab                                                 | D/features/browser-preview    | ui-map 3.2                                     | 3   | stub   | RUN-03, NAV-10            |
| RUN-05 | Point at page elements in the preview and send them to the chat     | D/features/browser-preview    | native-and-sidecar-map B3                      | 3   | stub   | RUN-04, COMP-07           |
| RUN-06 | Terminal tabs: xterm, find, big terminal mode                       | D/features/terminal           | ui-map 3.7                                     | 1   | done   | PLAT-07                   |
| RUN-07 | Terminal output for the GetTerminalOutput tool                      | D/core/services               | claude-runner 4.2                              | 2   | done   | RUN-06                    |
| RUN-08 | `bin/spotlighter.sh`                                                | bin                           | native-and-sidecar-map C3                      | 3   | stub   | RUN-02, PLAT-35           |
| RUN-09 | Zsh shell integration for terminals                                 | D/features/terminal, R/pty.rs | native-and-sidecar-map A5; services-map 5A.4.6 | 3   | stub   | PLAT-07, RUN-06           |

## Settings (SET)

| ID     | Feature                                                           | Owner                              | Research                  | P   | Status  | Needs                                     |
| ------ | ----------------------------------------------------------------- | ---------------------------------- | ------------------------- | --- | ------- | ----------------------------------------- |
| SET-01 | Settings registry                                                 | D/core/registries                  | ui-map 6                  | 1   | done    | DATA-05                                   |
| SET-02 | Settings pages and settings search                                | D/features/settings                | ui-map 6                  | 2   | done    | SET-01, APP-12, APP-15, NAV-02            |
| SET-03 | Agents page: install status, versions, sign-in                    | D/features/settings                | ui-map 6                  | 1   | done    | SIDE-15, PLAT-04, APP-12                  |
| SET-04 | Environment variables, stored in the Keychain                     | D/features/settings                | ui-map 6                  | 2   | done    | PLAT-10, DATA-05, APP-12, SIDE-21         |
| SET-05 | MCP servers: list, status, logs                                   | D/features/settings                | ui-map 3.10               | 3   | stub    | SIDE-16, SET-03                           |
| SET-06 | Appearance: theme, fonts, zoom                                    | D/features/settings                | ui-map 6                  | 2   | done    | SET-01, APP-14                            |
| SET-07 | Repo pages: scripts, actions, prompts                             | D/features/settings                | ui-map 6                  | 2   | done    | SET-01, DATA-05, APP-12, PRJ-04           |
| SET-08 | Sync agent configs between Claude Code and Codex                  | D/features/settings, S/models      | ui-map 5.2, 6             | 3   | stub    | SET-01, SET-02, SIDE-16, PLAT-05          |
| SET-09 | Agent sign-in and API key forms                                   | D/features/settings, S/runners     | ui-map 6                  | 2   | done    | SET-03, APP-12, PLAT-10, SIDE-10, SIDE-21 |
| SET-10 | OpenCode providers and their keys                                 | D/features/settings, S/runners/acp | ui-map 6                  | 2   | done    | SET-09, AGENT-12                          |
| SET-11 | Suggested variable names in the Environment form                  | D/features/settings                | ui-map 6                  | 3   | stub    | SET-04                                    |
| SET-12 | Claude settings and Codex config editors, Claude in Chrome switch | D/features/settings                | ui-map 6; claude-runner 1 | 3   | stub    | SET-03, APP-12, AGENT-16                  |
| SET-13 | Chosen program paths reach terminals and scripts                  | D/core/services, R/shell.rs        | services-map 5A.8.2       | 3   | done    | SET-03, PLAT-04, PLAT-07                  |
| SET-14 | Keep comments when the app rewrites a settings file               | D/core/services                    | services-map 4.2          | 2   | planned | DATA-05                                   |

## App (APP)

| ID     | Feature                                                                      | Owner                             | Research                       | P   | Status  | Needs                                      |
| ------ | ---------------------------------------------------------------------------- | --------------------------------- | ------------------------------ | --- | ------- | ------------------------------------------ |
| APP-01 | Startup sequence                                                             | D/app                             | services-map 6                 | 1   | done    | PLAT-09, DATA-01, DATA-03, DATA-05, APP-11 |
| APP-02 | First-run onboarding: pick agents, add a project                             | D/features/onboarding             | ui-map 7.1                     | 2   | done    | SET-03, PRJ-01, APP-05, APP-12             |
| APP-03 | Diagnostics page and log export                                              | D/features/diagnostics            | ui-map 2                       | 3   | stub    | PLAT-18, PLAT-04                           |
| APP-04 | Designed empty, loading and error states                                     | D/features (all)                  | ui-map 7                       | 1   | done    | APP-05                                     |
| APP-05 | Design system: components and tokens                                         | D/ui                              | ui-map 8                       | 1   | done    |                                            |
| APP-06 | Update notice and restart when idle                                          | D/features/updates                | ui-map 1.3                     | 3   | stub    | PLAT-13                                    |
| APP-07 | Resource usage table                                                         | D/features/sidebar                | ui-map 1.3                     | 3   | stub    | PLAT-14                                    |
| APP-08 | Start-up screens and notices                                                 | D/app, D/features/updates         | ui-map 1.3, 7.3, 7.4           | 2   | done    | APP-01, APP-04, PLAT-09, PLAT-17, PLAT-32  |
| APP-09 | Send feedback                                                                | D/features/diagnostics, R/menu.rs | ui-map 5.1, 5.2                | 3   | stub    | APP-03, APP-12, PLAT-18                    |
| APP-10 | Dismissible hints (callouts)                                                 | D/ui, D/features/settings         | ui-map 7.1                     | 3   | stub    | APP-05, SET-01                             |
| APP-11 | Async helpers: queue per key, single flight, latest wins, backoff            | D/core/async                      | services-map 1.5, 2.5.3, 3.0.3 | 1   | done    |                                            |
| APP-12 | Form controls                                                                | D/ui                              | ui-map 8                       | 1   | done    | APP-05                                     |
| APP-13 | Display components                                                           | D/ui                              | ui-map 8                       | 1   | done    | APP-05, APP-12                             |
| APP-14 | Missing design tokens: terminal colours, links, contrast modes               | D/styles.css, D/ui                | ui-map 8                       | 2   | done    | APP-05                                     |
| APP-15 | One shared fuzzy matcher                                                     | D/core                            | ui-map 6, 8                    | 2   | done    |                                            |
| APP-16 | Follow-ups the hardening found on done first-slice features and across areas | D, S, R                           | docs/reports/slice-2.md        | 2   | planned |                                            |

## Planned: cloud workspaces and Remote Control (CLOUD, RC)

Approved in principle (D018, D019). Not scaffolded yet: these rows get placeholders and the status `stub` when their spike confirms the design in [cloud-and-remote.md](cloud-and-remote.md). `pnpm stubs` ignores the status `planned`.

| ID       | Feature                                                                                                           | Owner                                  | Research                           | P   | Status  | Needs                       |
| -------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------- | --- | ------- | --------------------------- |
| CLOUD-01 | Host interface: each workspace reaches git, shell, files, terminals and its sidecar through a local or cloud host | D/core                                 | cloud-and-remote.md Part 1         | 1   | planned |                             |
| CLOUD-02 | Cloud spike: one Claude turn in a Cloudflare sandbox, driven from the desktop app                                 | apps/cloud                             | cloud-and-remote.md Part 1         | 1   | planned |                             |
| CLOUD-03 | The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay                          | apps/cloud                             | cloud-and-remote.md Part 1         | 2   | planned |                             |
| CLOUD-04 | Sandbox image with git, gh, the agent programs and our sidecar                                                    | apps/cloud                             | cloud-and-remote.md Part 1         | 2   | planned |                             |
| CLOUD-05 | Secrets stay outside the sandbox: the outbound handler swaps in the model key and GitHub token                    | apps/cloud                             | cloud-and-remote.md Part 1         | 2   | planned | CLOUD-03, CLOUD-04          |
| CLOUD-06 | Keep work across sandbox restarts                                                                                 | apps/cloud                             | cloud-and-remote.md Part 1         | 2   | planned |                             |
| CLOUD-07 | Pair the desktop app with the user's Worker                                                                       | D/core, apps/cloud                     | cloud-and-remote.md Part 1         | 2   | planned |                             |
| CLOUD-08 | Deploy flow for the user's Cloudflare account                                                                     | apps/cloud, D/features                 | cloud-and-remote.md Part 1         | 2   | planned | CLOUD-02, CLOUD-03          |
| CLOUD-09 | Cloud terminals, run scripts and previews                                                                         | D/core, apps/cloud                     | cloud-and-remote.md Part 1         | 3   | planned |                             |
| CLOUD-10 | Port forwarding from a cloud workspace to the Mac                                                                 | D/core, apps/cloud                     | services-map 5A.3.3; ui-map 3.7, 6 | 3   | planned | CLOUD-03, CLOUD-09, RUN-03  |
| CLOUD-11 | Local mirror and file sync for a cloud workspace                                                                  | D/core, apps/cloud                     | services-map 5A.5.5, 5B.10.1       | 3   | planned | CLOUD-01, CLOUD-06          |
| CLOUD-12 | SSH into a cloud workspace and open it in a local editor                                                          | D/core, apps/cloud, D/features/open-in | services-map 5A.3.3; ui-map 5.4    | 3   | planned | CLOUD-03, CLOUD-04, WS-08   |
| CLOUD-13 | Local copy of cloud data, kept apart by host                                                                      | D/core/db                              | services-map 1.2, 2.6.2            | 2   | planned | CLOUD-01, DATA-01           |
| CLOUD-14 | Cloud agents ask to run commands on the Mac                                                                       | D/core, S/tools                        | services-map 5B.6                  | 3   | planned | CLOUD-03, CLOUD-04, SIDE-12 |
| CLOUD-15 | Cloud workspace header: status, resources, cost, restart                                                          | D/features/workspace, apps/cloud       | ui-map 3.1                         | 3   | planned | CLOUD-03                    |
| CLOUD-16 | Cloud desktop tab, if the spike shows it is wanted                                                                | D/features, apps/cloud                 | ui-map 3.2, 3.6, 3.10              | 3   | planned | CLOUD-03                    |
| CLOUD-17 | Cloud settings page                                                                                               | D/features/settings, apps/cloud        | ui-map 6                           | 2   | planned | CLOUD-05, CLOUD-08          |
| CLOUD-18 | Use a subscription sign-in inside the sandbox                                                                     | S/runners, apps/cloud                  | cloud-and-remote.md Part 1         | 3   | planned | SIDE-15, CLOUD-05, CLOUD-17 |
| RC-01    | Remote Control spike: path A, then path B                                                                         | S/runners/claude                       | cloud-and-remote.md Part 2         | 2   | planned |                             |
| RC-02    | Per-chat Remote Control switch and connection status                                                              | D/features/chat, S/session             | cloud-and-remote.md Part 2         | 2   | done    | RC-01                       |
| RC-03    | Accept input from claude.ai: messages, approvals, interrupts, with who sent each                                  | S/session, D/core                      | cloud-and-remote.md Part 2         | 2   | done    | RC-01, SIDE-20              |
| RC-04    | Remote Control settings                                                                                           | D/features/settings, S/session         | ui-map 6                           | 2   | done    | RC-01, PLAT-21              |

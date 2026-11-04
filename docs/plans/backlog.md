# Feature backlog

Every feature of the app, with the folder that owns it. Code placeholders call `notImplemented("<ID>")` (TypeScript), `not_implemented!("<ID>")` (Rust) or `not_implemented "<ID>"` (shell). `pnpm stubs` compares this table with the code. It fails when code names an ID that is missing here, or when a `stub` row has no placeholder left in the code. Set a row to `done` in the same change that removes its last placeholder.

Research paths are relative to `docs/research/conductor/`. Folder paths: `D` = `apps/desktop/src`, `R` = `apps/desktop/src-tauri/src`, `S` = `packages/sidecar/src`.

Priority: **1** = the first working slice (add a repo, create a workspace, chat with Claude, see the diff). **2** = needed for daily use. **3** = polish.

## Platform and Rust shell (PLAT)

| ID      | Feature                                                               | Owner                 | Research                   | P   | Status |
| ------- | --------------------------------------------------------------------- | --------------------- | -------------------------- | --- | ------ |
| PLAT-01 | Platform contract test and in-memory stand-in for tests               | D/platform            | services-map 1.1           | 1   | stub   |
| PLAT-02 | Tauri implementation of the Platform interface                        | D/platform            | services-map 1.1           | 1   | stub   |
| PLAT-03 | Shell commands: run, start, cancel (kills the process group), timeout | R/shell.rs            | native-and-sidecar-map A2  | 1   | stub   |
| PLAT-04 | Capture the login-shell PATH at startup                               | R/shell.rs            | native-and-sidecar-map B3  | 1   | stub   |
| PLAT-05 | Files: atomic write, trash, stat, read dir                            | R/files.rs            | native-and-sidecar-map A2  | 1   | stub   |
| PLAT-06 | File search: tree, fuzzy match, grep (gitignore-aware)                | R/file_search.rs      | native-and-sidecar-map A2  | 2   | stub   |
| PLAT-07 | Terminals over PTY with flow control and screen text                  | R/pty.rs              | native-and-sidecar-map A2  | 1   | stub   |
| PLAT-08 | Saved terminal scrollback                                             | R/terminal_history.rs | native-and-sidecar-map A2  | 3   | stub   |
| PLAT-09 | Sidecar launcher: spawn, socket relay, restart, parent watchdog       | R/sidecar.rs          | native-and-sidecar-map A6  | 1   | stub   |
| PLAT-10 | Keychain read and write                                               | R/keychain.rs         | native-and-sidecar-map A2  | 2   | stub   |
| PLAT-11 | Native notifications, dock badge, click opens a deep link             | R/notifications.rs    | native-and-sidecar-map A2  | 2   | stub   |
| PLAT-12 | On-device dictation                                                   | R/speech.rs           | native-and-sidecar-map A2  | 3   | stub   |
| PLAT-13 | Self-update that waits until agents are idle                          | R/updater.rs          | native-and-sidecar-map A9  | 3   | stub   |
| PLAT-14 | CPU and memory per process, grouped by workspace                      | R/resource_usage.rs   | native-and-sidecar-map A2  | 3   | stub   |
| PLAT-15 | App menu with accelerators from the command registry                  | R/menu.rs             | native-and-sidecar-map A5  | 2   | stub   |
| PLAT-16 | `conducted://` deep links                                             | R/deep_link.rs        | native-and-sidecar-map A8  | 3   | stub   |
| PLAT-17 | Block startup when the database is newer than the app                 | R/db.rs               | native-and-sidecar-map A11 | 2   | stub   |
| PLAT-18 | App log files and log export                                          | R/logger.rs           | native-and-sidecar-map A7  | 2   | stub   |
| PLAT-19 | Detect installed editors and terminals for "Open in"                  | R/open_with.rs        | ui-map 3.10                | 2   | stub   |
| PLAT-20 | Attachments: copy dropped files, shrink large images                  | R/attachments.rs      | native-and-sidecar-map A2  | 2   | stub   |

## Sidecar core (SIDE)

| ID      | Feature                                                                        | Owner                        | Research                  | P   | Status |
| ------- | ------------------------------------------------------------------------------ | ---------------------------- | ------------------------- | --- | ------ |
| SIDE-01 | Entry point and modes                                                          | S/main.ts                    | native-and-sidecar-map B1 | 1   | stub   |
| SIDE-02 | JSON-RPC server over a Unix socket, NDJSON, re-attach on reconnect             | S/rpc                        | sessions 0, 10            | 1   | stub   |
| SIDE-03 | Session manager: per-session queue, duplicate guard, idle after flush          | S/session                    | sessions 2                | 1   | stub   |
| SIDE-04 | Turn lifecycle and stale-run guard                                             | S/session                    | sessions 2                | 1   | stub   |
| SIDE-05 | Event batching and live-state notifications                                    | S/session                    | sessions 5                | 1   | stub   |
| SIDE-06 | Write-ahead event log: write before send, ack, replay on reconnect             | S/outbox                     | sessions 5                | 1   | stub   |
| SIDE-07 | Process manager: leases, 30-minute idle stop, warm pool of 2                   | S/process                    | sessions 3                | 2   | stub   |
| SIDE-08 | Checkpoints: start before first write, end with file summary                   | S/checkpoints                | sessions 7                | 1   | stub   |
| SIDE-09 | Prompt assembly: first-message instruction, mentions, attachments, preferences | S/prompt                     | claude-runner 5           | 1   | stub   |
| SIDE-10 | Login-shell environment capture with provider secrets removed                  | S/shell-env                  | native-and-sidecar-map B3 | 1   | stub   |
| SIDE-11 | Interactions: one open per session, withdrawn on cancel or new message         | S/session                    | claude-runner 3           | 1   | stub   |
| SIDE-12 | App tools as an in-process MCP server (for Claude)                             | S/tools                      | claude-runner 4           | 2   | stub   |
| SIDE-13 | App tools over a socket bridge (for Codex and ACP agents)                      | S/tools                      | claude-runner 4.3         | 2   | stub   |
| SIDE-14 | Model catalog per agent                                                        | S/models                     | other-runners 5           | 1   | stub   |
| SIDE-15 | Agent detection, versions and sign-in flows                                    | S/models                     | other-runners 5           | 1   | stub   |
| SIDE-16 | Slash commands and MCP server listing                                          | S/models                     | claude-runner 7           | 2   | stub   |
| SIDE-17 | Context and plan usage                                                         | S/models                     | claude-runner 7           | 2   | stub   |
| SIDE-18 | Logger mode                                                                    | S/logging                    | native-and-sidecar-map B5 | 3   | stub   |
| SIDE-19 | Parent watchdog and graceful shutdown                                          | S/watchdog.ts, S/shutdown.ts | sessions 8                | 1   | stub   |

## Agent runners (AGENT)

| ID       | Feature                                                                | Owner               | Research             | P   | Status |
| -------- | ---------------------------------------------------------------------- | ------------------- | -------------------- | --- | ------ |
| AGENT-01 | Runner contract                                                        | S/runners/runner.ts | other-runners 1      | 1   | done   |
| AGENT-02 | Claude: Agent SDK in streaming-input mode, resume, fork                | S/runners/claude    | claude-runner 1      | 1   | stub   |
| AGENT-03 | Claude: translate SDK messages to the neutral format                   | S/runners/claude    | claude-runner 2      | 1   | stub   |
| AGENT-04 | Claude: tool approvals, plan mode, edit-path sandbox, live mode switch | S/runners/claude    | claude-runner 3      | 1   | stub   |
| AGENT-05 | Claude: steer with a "read by the agent" receipt                       | S/runners/claude    | claude-runner 6      | 2   | stub   |
| AGENT-06 | Codex: `codex app-server` JSON-RPC, threads, steer, interrupt          | S/runners/codex     | other-runners 2.1    | 2   | stub   |
| AGENT-07 | Codex: translate items to the neutral format                           | S/runners/codex     | other-runners 3      | 2   | stub   |
| AGENT-08 | Codex: approvals, permission grants, MCP forms                         | S/runners/codex     | other-runners 4      | 2   | stub   |
| AGENT-09 | Cursor: SDK in process                                                 | S/runners/cursor    | other-runners 2.3    | 3   | stub   |
| AGENT-10 | Cursor: translate to the neutral format                                | S/runners/cursor    | other-runners 3      | 3   | stub   |
| AGENT-11 | ACP client and runner                                                  | S/runners/acp       | other-runners 2.2    | 2   | stub   |
| AGENT-12 | ACP adapters for OpenCode and Pi, with translation                     | S/runners/acp       | other-runners 2.2, 3 | 2   | stub   |

## Data layer (DATA)

| ID      | Feature                                                                                                               | Owner           | Research                          | P   | Status |
| ------- | --------------------------------------------------------------------------------------------------------------------- | --------------- | --------------------------------- | --- | ------ |
| DATA-01 | One repository module per table                                                                                       | D/core/db       | services-map 2.3                  | 1   | stub   |
| DATA-02 | Data lifetime job: cut old tool outputs, compact archived chats, remove old drafts and terminals                      | D/core/db       | services-map 2.7                  | 2   | stub   |
| DATA-03 | Startup repair: close turns cut off by a crash, reset stale working state                                             | D/core/db       | services-map 6                    | 1   | stub   |
| DATA-04 | Event ingest: store each event in order, then acknowledge                                                             | D/core/sidecar  | sessions-and-chats "What happens" | 1   | stub   |
| DATA-05 | Settings store and `.conducted/settings.toml` read and write                                                          | D/core/services | services-map 4.2                  | 1   | stub   |
| DATA-06 | Prune turn snapshots: remove a chat's checkpoint refs when it is deleted, and 30 days after its workspace is archived | D/core/services | data-model.md                     | 2   | stub   |

## Projects and workspaces (PRJ, WS)

| ID     | Feature                                                               | Owner              | Research          | P   | Status |
| ------ | --------------------------------------------------------------------- | ------------------ | ----------------- | --- | ------ |
| PRJ-01 | Add a project from a local folder                                     | D/core/services    | ui-map 3.9        | 1   | stub   |
| PRJ-02 | Clone a project from GitHub                                           | D/core/services    | ui-map 3.9        | 2   | stub   |
| PRJ-03 | Quick start a new project from a template                             | D/core/services    | ui-map 3.9        | 3   | stub   |
| PRJ-04 | Per-repo config: scripts, files to copy, prompts                      | D/core/services    | services-map 4.2  | 1   | stub   |
| WS-01  | Create a workspace: fetch, worktree, place name, branch prefix, port  | D/core/services    | frontend 6        | 1   | stub   |
| WS-02  | Create from a branch, PR or issue                                     | D/core/services    | ui-map 3.9        | 2   | stub   |
| WS-03  | Setup script in a terminal, with workspace variables and copied files | D/core/services    | frontend 6        | 1   | stub   |
| WS-04  | Rename the placeholder branch after the first message                 | D/core/services    | frontend 6        | 2   | stub   |
| WS-05  | Archive: snapshot, archive ref, archive script, remove worktree       | D/core/services    | services-map 3.10 | 2   | stub   |
| WS-06  | Unarchive                                                             | D/core/services    | services-map 3.10 | 2   | stub   |
| WS-07  | Linked workspaces and extra folders                                   | D/core/services    | ui-map 3.10       | 3   | stub   |
| WS-08  | Open a workspace in another app                                       | D/features/open-in | ui-map 3.10       | 2   | stub   |
| WS-09  | Workspace status as a pure function                                   | D/core/status      | ui-map 3.8        | 1   | stub   |
| WS-10  | Delete a workspace                                                    | D/core/services    | services-map 3.10 | 2   | stub   |

## Navigation and shell (NAV)

| ID     | Feature                                                                  | Owner                | Research   | P   | Status |
| ------ | ------------------------------------------------------------------------ | -------------------- | ---------- | --- | ------ |
| NAV-01 | App shell: three resizable regions, persisted sizes                      | D/app                | ui-map 1.1 | 1   | stub   |
| NAV-02 | Routes and per-workspace URL state                                       | D/app                | ui-map 2   | 1   | stub   |
| NAV-03 | Sidebar: workspace list, group by status or project, sort, filter        | D/features/sidebar   | ui-map 4   | 1   | stub   |
| NAV-04 | Pinned, sections, drag and drop, manual order                            | D/features/sidebar   | ui-map 4   | 2   | stub   |
| NAV-05 | Home grid of all workspaces                                              | D/features/home      | ui-map 2   | 2   | stub   |
| NAV-06 | Kanban dashboard                                                         | D/features/dashboard | ui-map 2   | 3   | stub   |
| NAV-07 | Command registry and default shortcuts                                   | D/core/registries    | ui-map 5.4 | 1   | stub   |
| NAV-08 | Command palette                                                          | D/features/palette   | ui-map 5.1 | 2   | stub   |
| NAV-09 | Shortcuts dialog and custom key bindings                                 | D/features/palette   | ui-map 5.4 | 3   | stub   |
| NAV-10 | Center tab strip: chat, terminal, file, PR and browser tabs, split panes | D/features/workspace | ui-map 3.2 | 1   | stub   |
| NAV-11 | Unread state and "next unread"                                           | D/features/sidebar   | ui-map 4   | 2   | stub   |
| NAV-12 | Zen mode and panel toggles                                               | D/app                | ui-map 1.1 | 3   | stub   |
| NAV-13 | World map of workspace place names                                       | D/features/passport  | ui-map 4   | 3   | stub   |

## Chat (CHAT)

| ID      | Feature                                                                | Owner           | Research                                        | P   | Status |
| ------- | ---------------------------------------------------------------------- | --------------- | ----------------------------------------------- | --- | ------ |
| CHAT-01 | Create, close, rename chats; chat history                              | D/core/services | ui-map 3.2                                      | 1   | stub   |
| CHAT-02 | Send a message as a new turn                                           | D/core/services | sessions-and-chats "What happens"               | 1   | stub   |
| CHAT-03 | Steer a running turn                                                   | D/core/services | sessions-and-chats "While the agent is working" | 2   | stub   |
| CHAT-04 | Follow-up queue: edit, reorder, delete, pause, send now as steer       | D/core/services | ui-map 3.4                                      | 2   | stub   |
| CHAT-05 | Cancel a turn                                                          | D/core/services | sessions 6                                      | 1   | stub   |
| CHAT-06 | Message list: virtualised, one item per turn, only the tail re-renders | D/features/chat | frontend 5                                      | 1   | stub   |
| CHAT-07 | Turn builder: events to turns, sub-agent grouping                      | D/core/services | frontend 5                                      | 1   | stub   |
| CHAT-08 | Tool card registry and the cards                                       | D/features/chat | frontend 5                                      | 1   | stub   |
| CHAT-09 | Thinking and todo blocks                                               | D/features/chat | ui-map 3.3                                      | 2   | stub   |
| CHAT-10 | Question card                                                          | D/features/chat | claude-runner 3.4                               | 1   | stub   |
| CHAT-11 | Tool approval card                                                     | D/features/chat | claude-runner 3.2                               | 2   | stub   |
| CHAT-12 | Plan review                                                            | D/features/chat | claude-runner 3.5                               | 2   | stub   |
| CHAT-13 | Progress tracker above the composer                                    | D/features/chat | claude-runner 4.2                               | 3   | stub   |
| CHAT-14 | Context wheel, cost and plan usage                                     | D/features/chat | claude-runner 7                                 | 2   | stub   |
| CHAT-15 | Revert to a turn                                                       | D/core/services | sessions-and-chats "Checkpoints"                | 2   | stub   |
| CHAT-16 | Fork a chat from a turn                                                | D/core/services | sessions-and-chats "Checkpoints"                | 3   | stub   |
| CHAT-17 | Copy transcript, search chat history                                   | D/core/services | ui-map 3.2, 5.1                                 | 3   | stub   |
| CHAT-18 | Resume after restart and reconnect                                     | D/core/sidecar  | sessions 8                                      | 1   | stub   |
| CHAT-19 | Notify when a chat finishes or needs the user                          | D/core/services | ui-map 6                                        | 2   | stub   |

## Composer (COMP)

| ID      | Feature                                                   | Owner               | Research   | P   | Status |
| ------- | --------------------------------------------------------- | ------------------- | ---------- | --- | ------ |
| COMP-01 | Message editor, send key, drafts that survive restarts    | D/features/composer | ui-map 3.5 | 1   | stub   |
| COMP-02 | Model picker: agent, model, effort, fast mode, favourites | D/features/composer | ui-map 3.5 | 1   | stub   |
| COMP-03 | Plan mode and approval toggles                            | D/features/composer | ui-map 3.5 | 2   | stub   |
| COMP-04 | `@` file mentions                                         | D/features/composer | ui-map 3.5 | 2   | stub   |
| COMP-05 | `#` PR and issue mentions                                 | D/features/composer | ui-map 3.5 | 3   | stub   |
| COMP-06 | `/` slash commands                                        | D/features/composer | ui-map 3.5 | 2   | stub   |
| COMP-07 | Attachments: drop, paste, pick                            | D/features/composer | ui-map 3.5 | 2   | stub   |
| COMP-08 | Voice dictation button                                    | D/features/composer | ui-map 3.5 | 3   | stub   |

## Review and files (REV)

| ID     | Feature                                                                | Owner                  | Research          | P   | Status |
| ------ | ---------------------------------------------------------------------- | ---------------------- | ----------------- | --- | ------ |
| REV-01 | Changes list and diff scopes (branch, target, uncommitted, per commit) | D/features/git-panel   | ui-map 3.6        | 1   | stub   |
| REV-02 | Diff viewer: unified, split, whitespace, viewed files                  | D/features/diff        | ui-map 3.6        | 1   | stub   |
| REV-03 | Inline review comments with suggestions                                | D/features/diff        | ui-map 3.6        | 2   | stub   |
| REV-04 | Sync review comments with GitHub                                       | D/core/services        | services-map 5B   | 3   | stub   |
| REV-05 | AI code review in a new chat                                           | D/core/services        | ui-map 3.6        | 2   | stub   |
| REV-06 | File tree tab                                                          | D/features/git-panel   | ui-map 3.6        | 2   | stub   |
| REV-07 | Quick open and search in files                                         | D/features/palette     | ui-map 3.10       | 2   | stub   |
| REV-08 | File viewer and editor with previews (Markdown, images, SVG, PDF, CSV) | D/features/file-viewer | ui-map 3.2        | 2   | stub   |
| REV-09 | Changes per turn, from checkpoints                                     | D/core/services        | services-map 3.12 | 2   | stub   |

## Git and pull requests (GIT, PR)

| ID     | Feature                                                           | Owner                | Research                  | P   | Status |
| ------ | ----------------------------------------------------------------- | -------------------- | ------------------------- | --- | ------ |
| GIT-01 | Git runner and command catalogue                                  | D/core/git           | services-map 3.0          | 1   | stub   |
| GIT-02 | Status polling: changed files, line counts, operation in progress | D/core/git           | services-map 3.3          | 1   | stub   |
| GIT-03 | Branch sync: ahead, behind, rewritten remote                      | D/core/git           | services-map 3.6          | 2   | stub   |
| GIT-04 | Git header state machine                                          | D/core/services      | ui-map 3.6                | 2   | stub   |
| GIT-05 | Commit and push, done by the agent on request                     | D/core/services      | services-map 3.5          | 2   | stub   |
| GIT-06 | Pull and push                                                     | D/core/git           | services-map 3.6          | 2   | stub   |
| GIT-07 | Resolve conflicts, done by the agent on request                   | D/core/services      | services-map 3.8          | 2   | stub   |
| GIT-08 | Change the target branch                                          | D/core/services      | services-map 3.11         | 2   | stub   |
| GIT-09 | Rename the branch                                                 | D/core/git           | services-map 3.11         | 2   | stub   |
| GIT-10 | `bin/checkpointer.sh`: save, restore, diff with private refs      | bin                  | native-and-sidecar-map C1 | 1   | stub   |
| GIT-11 | `bin/git-busy-check.sh`                                           | bin                  | native-and-sidecar-map C2 | 1   | stub   |
| PR-01  | GitHub access through `gh`                                        | D/core/services      | services-map 3.9          | 1   | stub   |
| PR-02  | Create PR, done by the agent with written instructions            | D/core/services      | frontend 7                | 1   | stub   |
| PR-03  | PR status polling, batched, behind a rate-limit gate              | D/core/services      | services-map 3.7          | 2   | stub   |
| PR-04  | Checks and deployments tab with logs and re-run                   | D/features/git-panel | ui-map 3.6                | 2   | stub   |
| PR-05  | "Fix errors": send failing checks to the agent                    | D/core/services      | ui-map 3.6                | 2   | stub   |
| PR-06  | Merge, auto-merge, ready for review, approve                      | D/core/services      | services-map 3.7          | 2   | stub   |
| PR-07  | PR tab: title, description, activity                              | D/features/pr        | ui-map 3.2                | 3   | stub   |
| PR-08  | Stacked PRs and read-only Graphite                                | D/core/services      | services-map 3.8          | 3   | stub   |
| PR-09  | Linear issues: list, link, attach as context                      | D/core/services      | services-map 5B           | 3   | stub   |

## Run and preview (RUN)

| ID     | Feature                                                             | Owner                      | Research                  | P   | Status |
| ------ | ------------------------------------------------------------------- | -------------------------- | ------------------------- | --- | ------ |
| RUN-01 | Run actions with start and stop, concurrent or exclusive            | D/core/services            | ui-map 3.7                | 2   | stub   |
| RUN-02 | Spotlight: test workspace changes in the repo root, restore on stop | D/core/services, bin       | services-map 3.12         | 3   | stub   |
| RUN-03 | One port per workspace, port detection, preview URLs                | D/core/services            | ui-map 3.7                | 2   | stub   |
| RUN-04 | Browser preview tab                                                 | D/features/browser-preview | ui-map 3.2                | 3   | stub   |
| RUN-05 | Point at page elements in the preview and send them to the chat     | D/features/browser-preview | native-and-sidecar-map B3 | 3   | stub   |
| RUN-06 | Terminal tabs: xterm, find, big terminal mode                       | D/features/terminal        | ui-map 3.7                | 1   | stub   |
| RUN-07 | Terminal output for the GetTerminalOutput tool                      | D/core/services            | claude-runner 4.2         | 2   | stub   |
| RUN-08 | `bin/spotlighter.sh`                                                | bin                        | native-and-sidecar-map C3 | 3   | stub   |

## Settings (SET)

| ID     | Feature                                        | Owner               | Research    | P   | Status |
| ------ | ---------------------------------------------- | ------------------- | ----------- | --- | ------ |
| SET-01 | Settings registry                              | D/core/registries   | ui-map 6    | 1   | stub   |
| SET-02 | Settings pages and settings search             | D/features/settings | ui-map 6    | 2   | stub   |
| SET-03 | Agents page: install status, versions, sign-in | D/features/settings | ui-map 6    | 1   | stub   |
| SET-04 | Environment variables, stored in the Keychain  | D/features/settings | ui-map 6    | 2   | stub   |
| SET-05 | MCP servers: list, status, logs                | D/features/settings | ui-map 3.10 | 3   | stub   |
| SET-06 | Appearance: theme, fonts, zoom                 | D/features/settings | ui-map 6    | 2   | stub   |
| SET-07 | Repo pages: scripts, actions, prompts          | D/features/settings | ui-map 6    | 2   | stub   |

## App (APP)

| ID     | Feature                                          | Owner                  | Research       | P   | Status |
| ------ | ------------------------------------------------ | ---------------------- | -------------- | --- | ------ |
| APP-01 | Startup sequence                                 | D/app                  | services-map 6 | 1   | stub   |
| APP-02 | First-run onboarding: pick agents, add a project | D/features/onboarding  | ui-map 7.1     | 2   | stub   |
| APP-03 | Diagnostics page and log export                  | D/features/diagnostics | ui-map 2       | 3   | stub   |
| APP-04 | Designed empty, loading and error states         | D/features (all)       | ui-map 7       | 1   | stub   |
| APP-05 | Design system: components and tokens             | D/ui                   | ui-map 8       | 1   | stub   |
| APP-06 | Update notice and restart when idle              | D/features/updates     | ui-map 1.3     | 3   | stub   |
| APP-07 | Resource usage table                             | D/features/sidebar     | ui-map 1.3     | 3   | stub   |

## Planned: cloud workspaces and Remote Control (CLOUD, RC)

Approved in principle (D018, D019). Not scaffolded yet: these rows get placeholders and the status `stub` when their spike confirms the design in [cloud-and-remote.md](cloud-and-remote.md). `pnpm stubs` ignores the status `planned`.

| ID       | Feature                                                                                                           | Owner                      | Research                   | P   | Status  |
| -------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------- | -------------------------- | --- | ------- |
| CLOUD-01 | Host interface: each workspace reaches git, shell, files, terminals and its sidecar through a local or cloud host | D/core                     | cloud-and-remote.md Part 1 | 1   | planned |
| CLOUD-02 | Cloud spike: one Claude turn in a Cloudflare sandbox, driven from the desktop app                                 | apps/cloud                 | cloud-and-remote.md Part 1 | 1   | planned |
| CLOUD-03 | The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay                          | apps/cloud                 | cloud-and-remote.md Part 1 | 2   | planned |
| CLOUD-04 | Sandbox image with git, gh, the agent programs and our sidecar                                                    | apps/cloud                 | cloud-and-remote.md Part 1 | 2   | planned |
| CLOUD-05 | Secrets stay outside the sandbox: the outbound handler swaps in the model key and GitHub token                    | apps/cloud                 | cloud-and-remote.md Part 1 | 2   | planned |
| CLOUD-06 | Keep work across sandbox restarts                                                                                 | apps/cloud                 | cloud-and-remote.md Part 1 | 2   | planned |
| CLOUD-07 | Pair the desktop app with the user's Worker                                                                       | D/core, apps/cloud         | cloud-and-remote.md Part 1 | 2   | planned |
| CLOUD-08 | Deploy flow for the user's Cloudflare account                                                                     | apps/cloud, D/features     | cloud-and-remote.md Part 1 | 2   | planned |
| CLOUD-09 | Cloud terminals, run scripts and previews                                                                         | D/core, apps/cloud         | cloud-and-remote.md Part 1 | 3   | planned |
| RC-01    | Remote Control spike: path A, then path B                                                                         | S/runners/claude           | cloud-and-remote.md Part 2 | 2   | planned |
| RC-02    | Per-chat Remote Control switch and connection status                                                              | D/features/chat, S/session | cloud-and-remote.md Part 2 | 2   | planned |
| RC-03    | Accept input from claude.ai: messages, approvals, interrupts, with who sent each                                  | S/session, D/core          | cloud-and-remote.md Part 2 | 2   | planned |

# Conductor: complete structure map

This is the entry point to the Conductor research. It shows every part of Conductor 0.92.1 on one map: the layers, the modules in each, the data model and the full feature list, with where each feature is built. Everything comes from the app's own code, extracted from the installed bundle, plus its live database and processes (2026-11-04). The detail docs hold the evidence.

| Doc | Read it for |
|---|---|
| [overview.md](overview.md) | The first, high-level tour |
| [sessions-and-chats.md](sessions-and-chats.md) | How a message becomes an agent turn, and how chats are stored |
| [ui-map.md](ui-map.md) | Every screen, panel, dialog, shortcut and setting, with the labels as shown |
| [services-map.md](services-map.md) | The UI's service layer: stores, SQL per table, every git and gh command, flags, startup order |
| [native-and-sidecar-map.md](native-and-sidecar-map.md) | Rust modules and commands, sidecar modules, bundled scripts, files on disk |
| [sessions.md](sessions.md), [claude-runner.md](claude-runner.md), [other-runners.md](other-runners.md), [frontend.md](frontend.md) | Line-level notes behind the above |

## 1. The map on one page

```
Conductor.app
├── Rust shell (Tauri 2)            src-tauri/src/*.rs
│   ├── window, menus, dock badge, vibrancy, notifications, keychain, speech
│   ├── pty + terminal history      (alacritty screen model, scrollback)
│   ├── shell + files + file search (run commands, fuzzy match, grep)
│   ├── sidecar launcher            (start, socket relay, watchdog)
│   ├── agent binary manager        (download, verify, de-quarantine)
│   ├── updater, logger, app-actions
│   ├── cloud: http, websocket, port forward, tcp tunnel, file sync
│   └── db migrations + rollback    (sqlx; conductor.db, cache.db)
│
├── Web UI (React, in WKWebView)    src/client/frontends/desktop/{app,ui,core,terminal}
│   ├── Platform object vn()        the only code that touches Tauri
│   ├── 14 services over zustand    workspace, workspaceFiles, checkpoint, repo, git,
│   │                               fileDiff, settings, sessionsV2, sessions, user,
│   │                               organization, favoriteModels, sections, composer
│   ├── data layer                  SQL via tauri-plugin-sql (319 statements)
│   ├── git/gh runner               every git and gh command runs from here
│   ├── sidecar RPC tunnel          JSON-RPC over rpc_to_sidecar / rpc_from_sidecar
│   ├── Roundhouse client           cloud API + one multiplexed websocket
│   └── screens                     TanStack Router routes, shell, panels, dialogs
│
└── Sidecar (TypeScript on Bun)     src/client/sidecar-v2, single file binary
    ├── JSON-RPC server             Unix socket, Zod schemas both ways
    ├── session manager             queue, status, events, outbox, checkpoints
    ├── process manager             one agent process per chat, 30 min idle
    ├── runners                     Claude (Agent SDK), Codex (app-server), Cursor (SDK), ACP
    ├── Conductor MCP tools         AskUserQuestion, GetWorkspaceDiff, DiffComment, ...
    ├── prompt assembly             <system_instruction>, mentions, attachments
    ├── shell env capture           login shell PATH, secrets stripped
    ├── remote control              phone pairing through a relay
    └── other modes                 cli (`conductor`), logger, actions, codex-mcp, internal (cloud)

Outside the app: the cloud server "Roundhouse" (api.conductor.build), the web app
(app.conductor.build), a React Native iOS app, and Linux cloud sandboxes.
```

## 2. Source layout

File paths are stripped from the bundles, but folder names survive in leaked paths and the embedded `package.json`. It is a pnpm and turbo monorepo:

```
src/
├── client/
│   ├── frontends/
│   │   ├── desktop/
│   │   │   ├── app/        routes, screens, composition root
│   │   │   ├── ui/         design-system components (Input.tsx, ...)
│   │   │   ├── core/       services and data (UserData.ts, ...)
│   │   │   └── terminal/   xterm.js wrapper (@desktop/terminal)
│   │   └── mobile/{native,shared,visual-preview}   React Native app
│   ├── shared/             code shared by desktop and mobile
│   └── sidecar-v2/         the agent process
├── shared/core/            shared types and model mappings
└── (server packages)       @roundhouse/internal, @conductor/webapp, @conductor/marketing
src-tauri/                  the Rust shell, plus crates workspace_runtime_core,
                            file_sync_client, file_sync_core, tcp_tunnel_core
```

Build tooling seen in `package.json`: vitest, Playwright component and visual-regression tests, Storybook, oxlint and oxfmt. Code generation produces Rust types, Zod schemas and settings schemas from one source, with `--check` modes. Lint rules guard the layer boundaries (`lint:tauri-boundary`, `lint:client-shared-boundary`) and that migrations are generated.

## 3. Layer by layer

### 3.1 Rust shell

The Rust shell is a toolbox. It exposes about 100 commands and a few events. It contains no product logic.

| Area | Modules | Gives the UI |
|---|---|---|
| App and window | `lib.rs`, `navigation_guard.rs`, `network_change.rs` | Menus, quit handling, dock badge, vibrancy, traffic-light position, devtools, Full Disk Access check |
| Shell and files | `lib.rs`, `file_search.rs`, `attachments.rs` | Run shell commands (cancellable, kills the process group), write files, file tree, fuzzy match, grep, attachment copy and image resize |
| Terminals | `pty.rs`, `terminal_history_storage.rs` | Spawn, write, resize, kill, flow-control acks, screen snapshots, headless "mirror" terminals, saved scrollback |
| Sidecar | `sidecar.rs` | Start it, relay JSON-RPC lines, health check, log path |
| Agent binaries | `binary_manager.rs`, `binary_verification.rs`, `quarantine_attr.rs` | Download, verify, install or remove `claude`, `codex` and ACP providers |
| Secrets | `keychain_settings.rs`, `terminal_history_storage.rs` | Keychain access, encryption key for local storage |
| Platform | `notifications.rs`, `on_device_speech.rs` (Swift), `updater.rs`, `resource_usage.rs` | Native notifications with deep links, dictation, self-update, CPU and memory per process |
| Logging and telemetry | `app_logger.rs`, `app_actions.rs`, `posthog.rs`, Sentry | Log server, internal test-automation server, analytics, crash reports |
| Cloud | `native_http.rs`, `raw_websocket.rs`, `port_forward.rs`, `tcp_tunnel.rs`, `file_sync.rs` | HTTP with progress and proxy, websockets, local ports to cloud ports, one-way file mirror |
| Database | `migrations.rs`, `client_cache_migrations.rs`, `db_rollback.rs` | Schema for both databases, down-migrations, a block when the database is newer than the app |

### 3.2 Web UI

**Wiring.** One Platform object wraps all of Tauri. A composition root builds 14 services. Each service is a class over a zustand store with optimistic updates, and gets its dependencies passed in. A "host" value says whether a workspace is local or a cloud machine. The same code then picks `conductor.db` or `cache.db`, and runs git locally or over HTTP on the cloud machine.

**Window layout.**

```
┌──────────────┬─────────────────────────────────┬────────────────────────┐
│ Left sidebar │ Center panel                    │ Right panel            │
│              │  workspace header               │  Git panel             │
│  nav         │  tab strip: chat, terminal,     │   All files | Changes  │
│  org switch  │   file, comment, PR, browser,   │   Checks | Artifacts   │
│  Pinned      │   cloud desktop (can split)     │  ───────────────────── │
│  sections    │  chat list or file/diff view    │  Scripts panel         │
│  workspaces  │  progress | queue | composer    │   Setup | Run |        │
│              │                                 │   Terminal N | Ports   │
└──────────────┴─────────────────────────────────┴────────────────────────┘
```

**Routes.**

| Route | Screen |
|---|---|
| `/repository/$repositoryId/workspace/$localWorkspaceId` | The workspace screen. The open tab, file and diff live in URL search params. |
| `/all-workspaces` | Home: a card grid of all workspaces with filters |
| `/dashboard` | Kanban board by status (behind a setting) |
| `/create` | Full-page new-workspace flow |
| `/settings/user/*`, `/settings/repos/$repoId/*`, `/settings/organization/*` | Settings |
| `/diagnostics` | Environment capture and log export |
| `/login`, `/first-run-onboarding`, `/new-member-onboarding`, `/cloud-collab-onboarding` | Sign-in and onboarding |
| `/routines/*`, `/pull-requests`, `/profile/$orgSlug/$userId` | Cloud team features |

**Cross-cutting UI systems.** One command registry with 176 shortcuts feeds the menus, the command palette (`Cmd+K`) and the shortcut dialog. One settings registry (about 140 settings, each with tab, key, scopes and text) feeds the settings pages and settings search. A "surface" layer keeps terminals and browser previews alive outside React's tab content. Workspace status is a pure function of session status, workspace lifecycle and PR state.

### 3.3 Sidecar

| Module | Job |
|---|---|
| RPC server | NDJSON JSON-RPC over a Unix socket, re-attachable by a new app connection |
| Session manager | Per-session queue, `idle`/`working` status, event batching, duplicate guard, steering policy |
| Process manager | Leases per agent process, 30-minute idle stop, at most 2 pre-warmed processes |
| Runners | Claude: Agent SDK in streaming-input mode. Codex: `codex app-server` JSON-RPC. Cursor: SDK in process. ACP: OpenCode, Pi, Muse. Piccolo: a cloud-only agent with summarising memory. |
| Conductor tools | In-process MCP server for Claude, socket bridge for Codex and ACP |
| Durable outbox | One file per session, resent until the UI confirms it saved the event |
| Checkpoints | Calls `checkpointer.sh` at turn start and end |
| Prompt assembly | First-message `<system_instruction>`, mentions, attachments, user preferences |
| Shell env, auth | Login-shell `PATH` capture, GitHub token per session, model catalog, harness versions |
| Remote control | Phone pairing and relay, reads the database read-only |
| Other modes | `cli` (the `conductor` command for the cloud API), `logger`, `actions`, `codex-mcp`, `internal` (runs inside cloud sandboxes) |

## 4. Data model

Two SQLite files: `conductor.db` for local data and `cache.db` for cloud data, with the same table shapes. The Rust side creates the tables. The UI does all reads and writes.

| Group | Tables |
|---|---|
| Projects | `repos`: remote, default branch, root path, setup/run/archive scripts, run mode, custom prompts (review, create PR, rename branch, fix errors, resolve conflicts), Spotlight toggle |
| Workspaces | `workspaces`: worktree path, branch, state (`ready`, `archived`), derived and manual status, archive commit, PR title and description, target branch, pinned, notes, linked dirs, cloud fields (host, sandbox, org, access) |
| Chats | `sessions`: agent type, model, effort, permission mode, status, title, unread, context use, queue paused. `session_events`: append-only event log. `session_messages`: older message log, still written. `session_state`: live state and config snapshot. |
| Outgoing | `session_messages_outbox`, `session_messages_outbox_state`, `session_assets_outbox`: messages and uploads with retry state |
| Review | `diff_comments`: file, line range, body, author, thread, resolved and outdated flags, suggested change |
| Files | `attachments`, `symlinks_pending_deletion` |
| Terminals | `terminal_sessions`: size, cwd, screen modes, replay sequences |
| Navigation | `navigation_sections`, `navigation_section_memberships`, `favorite_models` |
| Config | `settings` (about 30 UI keys such as panel widths, theme, sort order, sound), `env_vars` |
| Cloud sync | `identity_associations` (local id to server id), revision counter, deletion tombstones, `port_forwards` |
| Schema | `_sqlx_migrations` (149 applied), `migration_rollbacks` (stored down-SQL) |

Outside SQLite: `~/.conductor/settings.toml` (global), `<repo>/.conductor/settings.toml` (shared, read from the default branch) and `settings.local.toml`. There are also JSON "local storage" files in the data folder (drafts, terminal layout, caches), the event outbox folder, downloaded agent binaries, and Claude's own transcripts in `~/.claude/projects/`.

## 5. Feature inventory

Each row says where the feature is built. "UI" means the web UI's services, "Sidecar" the agent process, "Rust" the shell. "Cloud" marks team-only features.

### Projects and workspaces

| Feature | Built in |
|---|---|
| Add project: open folder, clone from GitHub, quick-start template | UI (git, gh), Rust (dialogs) |
| New workspace from a prompt, branch, PR or issue (Linear, GitHub) | UI: `git fetch`, `git worktree add`, city name, branch prefix |
| Setup script with `CONDUCTOR_*` variables, logged in a terminal | UI + Rust PTY |
| Automatic branch rename after the first message | UI + agent |
| Sidebar: pinned, sections, group by status or project, sort, manual order, drag and drop | UI, `navigation_sections` |
| Status per workspace (working, needs input, checks failing, ready to merge...) | UI pure function over session and PR state |
| Home grid, Kanban dashboard, Passport world map of workspace cities | UI |
| Archive: snapshot, archive ref, archive script, remove worktree, optional branch delete; unarchive | UI (git, `checkpointer.sh`) |
| Open in editor or terminal (about 35 apps) | UI + Rust shell |
| Linked workspaces and extra directories | UI, passed to agents as additional directories |

### Chats and agents

| Feature | Built in |
|---|---|
| Several chats per workspace, as tabs, with split panes and fork-to-new-tab | UI |
| Agents: Claude Code, Codex, Cursor, OpenCode, Pi (ACP) | Sidecar runners, Rust binary manager |
| Model, effort, fast mode and personality per chat; favourite models | UI + Sidecar (model catalog) |
| Send, queue, steer, cancel | UI queue + Sidecar session manager |
| Streaming chat with tool cards, thinking, todos, sub-agent groups | UI (virtualised list, card registry) |
| Questions, tool approvals, plan mode approval | Sidecar requests, UI cards |
| Progress tracker above the composer | Sidecar MCP tool `UpdateProgress`, UI |
| Context wheel and plan usage (5-hour and 7-day windows) | Sidecar via SDK, UI |
| Composer: `@` files, `#` PRs and issues, `/` slash commands, attachments, drafts, voice dictation | UI (TipTap), Sidecar (slash commands), Rust (speech) |
| Revert to a turn, fork a chat from a turn | UI + `checkpointer.sh`, Sidecar (`resumeSessionAt`) |
| Copy transcript, chat history search | UI (SQL on messages) |
| Conductor tools for agents: diff, comments, terminal output, target branch | Sidecar MCP, answered by the UI |
| Resume after restart | Agent's own transcript + UI database + Sidecar outbox |

### Review, git and PRs

| Feature | Built in |
|---|---|
| Changes list, diff scopes (branch, target, uncommitted, per commit), viewed checkboxes | UI (git), `@pierre/diffs` |
| File tree, quick open, search in files, file editor (CodeMirror), previews | UI + Rust file search |
| Inline review comments for the agent, synced GitHub comments | UI, `diff_comments`, agent MCP tools |
| AI code review in a new chat | UI (custom prompt) + agent |
| Git header state machine: commit and push, pull, push, resolve, merge | UI; commits and conflict fixes are delegated to the agent through chat |
| Create PR, ready for review, merge, automerge, merge stacks | UI (bundled `gh`, `gh stack`); "Create PR" asks the agent |
| Checks and deployments with logs, "Fix errors" | UI (batched GitHub GraphQL polling) |
| Graphite stacks (read-only) | UI (`gt`) |

### Run, test and preview

| Feature | Built in |
|---|---|
| Run actions (dev server, tests) with a stop and start button | UI process store + Rust PTY |
| Spotlight: test workspace changes in the repo root, restore on stop | `spotlighter.sh`, `checkpointer.sh`, `watchexec` |
| Port per workspace (`CONDUCTOR_PORT`), detected ports, preview URLs | UI |
| In-app browser preview with an annotation overlay for the agent | UI + Sidecar proxy |
| Terminals: tabs, find, big terminal mode, saved history | Rust PTY + UI xterm.js |
| Resource usage per process | Rust |

### Settings, platform and diagnostics

| Feature | Built in |
|---|---|
| Settings registry with search, per-user, per-repo and per-org scopes | UI, `settings` table, `settings.toml` |
| Agent provider setup and login (Claude, Codex, Cursor, custom providers) | Sidecar auth flows, Rust keychain |
| MCP server management and status | UI + Sidecar |
| Keyboard shortcuts, command palette, themes, fonts, zoom | UI |
| Notifications, sounds, dock badge | Rust + UI |
| Updates that wait until agents are idle | Rust updater + UI |
| Diagnostics page and log export | UI + Rust logger |
| Feature flags (PostHog), analytics, crash reports | UI, Rust, Sidecar |
| `conductor` CLI | Sidecar `cli` mode, talks to the cloud API |

### Cloud and team (a second product on top)

| Feature | Built in |
|---|---|
| Organizations, members, SSO, sharing and access levels | UI + Roundhouse |
| Cloud workspaces in Linux sandboxes, cloud terminals, cloud desktop | Roundhouse, Sidecar `internal` mode, Rust websocket |
| File sync to a local folder, port forwarding, preview URLs | Rust `file_sync`, `port_forward`, `tcp_tunnel` |
| `RunLocalCommand`: a cloud agent runs a command on your Mac | Sidecar MCP + UI approval |
| Routines: agent runs triggered by webhooks or schedules | UI + Roundhouse |
| Workspace chat, pokes, profiles, team artifacts and templates | UI + Roundhouse |
| Remote control from the iPhone app | Sidecar relay, UI handles actions |
| Cloud computer configurations (install scripts, snapshot builds) | UI + Roundhouse |

## 6. Patterns worth copying

1. **One boundary object for the native layer.** All UI code asks one Platform object for files, shell, database, terminals and the sidecar. Lint rules keep Tauri imports out of everything else.
2. **Hosts as values.** Local and cloud workspaces share one code path. Only the host decides where commands run and which database is used.
3. **Registries for commands and settings.** Menus, palette, shortcuts, settings pages and search all come from two declarative lists.
4. **Status as a pure function.** The sidebar, Home, tabs and Git panel all derive status from the same inputs.
5. **Delegate risky git work to the agent.** The app does not commit, rebase or resolve conflicts itself. It writes instructions and lets the agent do the work in the chat, where the user can see it.
6. **Hidden git refs for every turn.** They give diffs per turn, revert, fork, archive and Spotlight for little cost.
7. **Generated schemas across languages.** One source produces Rust types, Zod schemas and settings schemas, checked in CI.

## 7. Not verified

- The Rust source beyond module, command and symbol names. Six commands the UI calls do not exist in the binary. They look stale, but this needs a runtime trace.
- The server side: Roundhouse, the web app and the sandboxes were seen only from the client.
- Exact screen layouts. The maps list components, labels and states, not pixels. Screenshots of the running app would confirm the layout.
- A few small items: the default tab limit, the `§` composer trigger, the new-member onboarding screen.

The extracted code is in `.context/conductor-re/`, which git ignores. Re-create it after a Conductor update with `scripts/conductor-re/extract_bun_sidecar.sh` and `scripts/conductor-re/extract_tauri_assets.py`.

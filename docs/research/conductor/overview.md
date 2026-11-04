# How Conductor is built

Findings from inspecting Conductor 0.92.1 as installed on this Mac (2026-11-04). Everything here comes from the app bundle, the running processes, the open sockets, the log files and the SQLite databases. Nothing is guessed from marketing pages. Where something could not be verified, the last section says so. The full map of every part is [structure-map.md](structure-map.md). The deep dive on sessions and chats is [sessions-and-chats.md](sessions-and-chats.md).

## The short version

Conductor is three programs working together:

1. A **Tauri desktop shell** written in Rust. It draws the window, runs the terminals and the database migrations, and talks to macOS.
2. A **web UI** written in React, running inside the system WebKit view that Tauri provides. Besides drawing the screens, it writes all chat data to the database and runs git.
3. A **"sidecar"** written in TypeScript and compiled with Bun into one executable. It runs the coding agents (Claude Code, Codex, Cursor, OpenCode and others).

Each chat you open is one more `claude` (or `codex`) process, started and supervised by the sidecar. Each workspace is a git worktree on disk.

```
┌──────────────────────────── Conductor.app (Tauri, Rust) ────────────────────────────┐
│  Window + menus + notifications + updater                                            │
│  ┌──────────────────────────────┐   Tauri IPC    ┌──────────────────────────────┐   │
│  │ Web UI (React, Vite, Radix,   │ ◄────────────► │ Rust core (src-tauri/)       │   │
│  │ Tailwind, Shiki, Mermaid)     │                │ pty, sidecar, file_sync,     │   │
│  └──────────────────────────────┘                │ port_forward, db migrations  │   │
│                                                   └──────┬────────────┬──────────┘   │
└──────────────────────────────────────────────────────────┼────────────┼─────────────┘
                     JSON-RPC over a Unix socket            │            │  PTYs (/dev/ptmx)
                     conductor-sidecar-v2-<pid>.sock        ▼            ▼
                ┌───────────────────────────────────┐   your terminal tabs (zsh)
                │ conductor-runtime sidecar (Bun)    │
                │ Claude Agent SDK, Codex SDK, ACP   │
                └──┬──────────┬──────────┬───────────┘
      stdio stream-json       │          │  Conductor's own tools via MCP
                   ▼          ▼          ▼
               claude      claude     codex …   (one process per active chat,
               (chat 1)    (chat 2)              cwd = that workspace's worktree)
```

## 1. The desktop shell (Rust + Tauri)

The app bundle is tiny: one 72 MB executable (`Contents/MacOS/conductor`), an icon, and a `bin/` folder of helpers. There is no `Frameworks/` folder, because Tauri uses the WebKit that ships with macOS instead of bundling Chromium the way Electron does.

Libraries found in the binary: Tauri 2.11, wry and tao (window and webview), tokio (async runtime), sqlx (SQLite), alacritty_terminal 0.26 (terminal emulation), portable-pty 0.9 (pseudo-terminals), Sentry (crash reports) and PostHog (analytics).

Tauri plugins in use: shell, sql, fs, http, store, dialog, notification, updater, deep-link (`conductor://` URLs), clipboard-manager and window-state.

Conductor's own Rust modules, from paths left in the binary under `src-tauri/src/`:

| Module | What it does |
|---|---|
| `sidecar.rs` | Starts and supervises the sidecar process |
| `pty.rs`, `terminal_history_storage.rs` | Runs terminal tabs and saves their scrollback |
| `binary_manager.rs`, `binary_verification.rs` | Downloads and checks the `claude`, `codex` and other agent binaries |
| `file_sync.rs`, `tcp_tunnel.rs`, `raw_websocket.rs`, `port_forward.rs` | Cloud workspaces: syncing files and forwarding ports to a remote sandbox |
| `db_rollback.rs` | Database migration safety |
| `file_search.rs` | Fast file search (fuzzy matching, gitignore-aware) |
| `notifications.rs`, `on_device_speech.rs` | macOS notifications and speech-to-text |
| `updater.rs`, `posthog.rs`, `app_logger.rs` | Updates, analytics and logging |

The Rust layer is thin. It does the jobs a browser cannot: processes, terminals, files, native OS features. The product logic lives in TypeScript.

## 2. The web UI (React)

The interface is a Vite build embedded inside the Rust binary, brotli-compressed. `scripts/conductor-re/extract_tauri_assets.py` unpacks it. The stack:

- React, Radix UI primitives and Tailwind CSS.
- TanStack Router and TanStack Query, zustand for client state, Zod for message validation.
- TipTap for the message composer, xterm.js for terminals, `@pierre/diffs` for diffs, and a virtualised chat list (`VirtuosoMessageList`).
- Lucide icons (hundreds of `a-arrow-down-….js` style chunks, one per icon).
- Shiki for syntax highlighting (one chunk per language grammar).
- Mermaid for diagrams and KaTeX for maths in chat.
- Catppuccin colour themes.

Small bits of UI state (drafts, terminal layout, model picker choices, the "turn changes" cache) are stored as JSON files named `local-storage.subsystem.*.json` in the app's data folder.

## 3. The sidecar (TypeScript compiled with Bun)

`Resources/bin/.internal/conductor-runtime` is a 104 MB Bun 1.4 single-file executable. Small shell wrappers call it in different modes: `sidecar`, `logger`, `actions`, `internal` and `cli` (the `conductor` command you can run in a terminal).

It bundles:

- `@anthropic-ai/claude-agent-sdk` (version 0.3.308 at the time of writing) to drive Claude Code.
- A JSON-RPC client for `codex app-server` to drive Codex. The `@openai/codex-sdk` package is bundled, but only its version number is read.
- An ACP client (Agent Client Protocol) for OpenCode, Pi and similar agents. ACP is an open protocol where the app sends `session/new`, `session/load` and prompt requests to any compliant agent.
- Zod for validating every message, and pino for logging.

### How it talks to the app

At start-up the sidecar opens two servers: an HTTP server on `127.0.0.1` and a Unix socket at `$TMPDIR/conductor-sidecar-v2-<pid>.sock`. The Rust app connects to the socket. Messages are JSON-RPC, with typed methods in both directions:

- **App → sidecar:** `query` (send a prompt), `cancel`, `steer` (redirect a running turn), `updatePermissionMode`, `fetchSlashCommands`, `contextUsage`, `listCodexModels` and similar.
- **Sidecar → app, as notifications:** `message` (each streamed agent message), `sessionStatusNotification`, `checkpointCreated`, `enterPlanModeNotification`.
- **Sidecar → app, as requests that wait for an answer:** `toolApproval`, `askUserQuestion`, `exitPlanMode`, `getDiff`, `getDiffComments`, `getTerminalOutput`.

The last group matters. When an agent wants permission or asks a question, the sidecar pauses and asks the UI, and the UI asks you.

### How it runs an agent

For Claude, the sidecar starts the real `claude` CLI once per chat. Flags seen on a live process:

```
claude --input-format stream-json --output-format stream-json --verbose
       --model=… --effort=high --max-turns=1000
       --resume=<session id> --permission-prompt-tool=stdio
       --setting-sources=user,project,local --plugin-dir=<bundled conductor skill>
       --disallowedTools=AskUserQuestion
```

So Conductor does not reimplement the agent. It runs Claude Code headless, sends prompts as JSON lines on stdin, and reads every event as JSON lines on stdout. `--resume` lets a chat continue after the app restarts. Built-in `AskUserQuestion` is disabled and replaced by Conductor's own version, so questions show up as proper UI.

Each agent process gets environment variables describing where it is (`CONDUCTOR_WORKSPACE_PATH`, `CONDUCTOR_ROOT_PATH`, `CONDUCTOR_PORT`, `CONDUCTOR_DEFAULT_BRANCH` and others). Before starting an agent, the sidecar runs your login shell (`zsh -ilc`) once to capture your real `PATH`, and strips API keys from it.

The agent's `mcp__conductor__*` tools (`GetWorkspaceDiff`, `DiffComment`, `GetTerminalOutput`, `AskUserQuestion`) come from an MCP server running inside the sidecar. For Claude, tool calls travel over the same stdin/stdout pipes as the chat. Codex and ACP agents reach the same tools through a helper process and a socket per workspace (`$TMPDIR/cmcp-…/s`).

## 4. Workspaces are git worktrees

- `~/conductor/repos/<repo>` is the main clone.
- `~/conductor/workspaces/<repo>/<city-name>` is one `git worktree` per workspace, each on its own branch.

This is the core idea of the product. Several agents work on the same repository at once without stepping on each other, because each has its own folder and branch but they share one `.git` store.

**Checkpoints** use private git refs. A bundled script, `checkpointer.sh`, saves the full state (HEAD, index, working tree, untracked files) at the start and end of every turn into `refs/conductor-checkpoints/session-<id>-turn-<id>-start|end`. These refs never touch your branch, so they cost nothing and enable "revert this turn". A companion script, `git-busy-check.sh`, refuses to checkpoint during a rebase or merge.

## 5. Where data lives

| Location | Contents |
|---|---|
| `~/Library/Application Support/com.conductor.app/conductor.db` | Main SQLite database (WAL mode), 25 tables, 152 migrations run by sqlx |
| `…/cache.db` | A client-side message cache. It is empty now, but still takes 3.9 GB because deleted space was never reclaimed |
| `…/sidecar-v2-session-event-outbox/` | One JSON file per session: a durable queue (`nextSequence`, `pending`) so no agent event is lost if the app is closed mid-turn |
| `…/bin/`, `…/agent-binaries/` | Downloaded copies of `claude`, `codex`, `gh`, `watchexec` |
| `~/.conductor/settings.toml` | Global settings (models, effort, branch prefix) |
| `<repo>/.conductor/settings.toml` | Per-repo settings, shared with the team |

The main tables: `repos` → `workspaces` → `sessions` → `session_messages` and `session_events`. Others hold `terminal_sessions`, `diff_comments`, `attachments`, `port_forwards`, `env_vars` and the sidebar's `navigation_sections`.

Every JSON line the agent streams is stored as its own row in `session_messages`, including full tool outputs. On this Mac that is 3,035,587 rows across 351 sessions, and the database has grown to 12 GB (`session_messages` alone is 9.8 GB). Since October 2026 each message is also written to the newer `session_events` log, so new chats are stored twice. Nothing appears to remove old rows.

## What to take from this for your own app

1. **Drive existing agent CLIs instead of building an agent.** Conductor's value is the workflow around Claude Code and Codex: parallel workspaces, review, checkpoints. The agents themselves are the vendors' own binaries, driven through stream-JSON, an SDK, or ACP. Start with the Claude Agent SDK and add ACP later to support many agents through one protocol.
2. **One worktree per task is the key primitive.** It is cheap, it isolates agents, and it maps neatly onto branches and pull requests.
3. **Split native work from product logic.** A thin native shell (Tauri or Electron) handles processes and terminals. A TypeScript process handles agents. A web UI handles everything visible. They talk over a typed JSON-RPC channel validated with Zod.
4. **Make every agent pause point a real request.** Tool approval, questions and plan approval are requests the UI must answer, which is what makes the app feel controllable.
5. **Plan storage lifetime from day one.** Storing every raw stream event forever is simple, but it produced a 12 GB database here. Decide early what is kept, for how long, and what prunes the rest.
6. **Tauri or Electron?** Tauri gives a 72 MB app with no bundled browser, but you write Rust for native parts and depend on Safari's WebKit quirks. Electron is larger but all-JavaScript. Conductor chose Tauri plus a Bun sidecar, which keeps the Rust small and the agent code in TypeScript, where the agent SDKs live.

## Not verified

- The Rust source was not read beyond library and module names.
- The cloud side (Linux sandboxes, the iOS app, remote control pairing) was only seen from the client end: the `hosting_server_url` and `sandbox_provider` columns, the file-sync and tunnel modules, and the remote-control RPC methods.

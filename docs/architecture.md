# Architecture

What the parts are, what each may depend on, and where each kind of logic lives. Decisions behind it are in [decisions.md](decisions.md). The behaviour it implements is in [research/conductor/structure-map.md](research/conductor/structure-map.md).

## The parts

| Part         | Folder                   | Runs as                        | Owns                                                                                                                                                                                                                                                            |
| ------------ | ------------------------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rust shell   | `apps/desktop/src-tauri` | the app process                | Windows and menus, terminals (PTY), shell commands, file search, Keychain, notifications, dictation, updates, launching and relaying the sidecar, the cloud connection, database migrations, the read-only copy of Conductor's database for the import (APP-17) |
| Cloud Worker | `apps/cloud`             | the user's Cloudflare account  | The Worker and one Durable Object per cloud workspace: auth, routes, sandbox lifecycle, keep-alive, the sidecar relay (CLOUD-03), and the sandbox image in `apps/cloud/sandbox` (CLOUD-04)                                                                      |
| Web UI       | `apps/desktop/src`       | the WebKit view inside the app | Everything visible, all database reads and writes, all git and `gh` commands, the follow-up queue, settings                                                                                                                                                     |
| Sidecar      | `packages/sidecar`       | a separate Bun process         | Agent processes (one per active chat), turns, steering, interactions, checkpoints, prompt assembly, the write-ahead event log, the app tools agents call                                                                                                        |
| Protocol     | `packages/protocol`      | library                        | Zod schemas for every message between the UI and the sidecar, the session events, live state and the neutral agent-message format                                                                                                                               |
| Shared       | `packages/shared`        | library                        | Branded ids, `Result`, `notImplemented`, `Clock`, `IdSource`, the error helpers and the keyed serial queue                                                                                                                                                      |
| Scripts      | `bin/`                   | shell                          | Git snapshots (`checkpointer.sh`), the busy-repo check, Spotlight                                                                                                                                                                                               |

How they talk:

- **UI and Rust:** Tauri commands and events. The names are fixed in [plans/tauri-commands.md](plans/tauri-commands.md).
- **UI and sidecar:** JSON-RPC 2.0, one message per line. Rust relays the lines between the WebKit view and the sidecar's Unix socket without reading them.
- **Sidecar and agents:** each runner speaks its agent's protocol: the Claude Agent SDK, `codex app-server` JSON-RPC, the Cursor SDK, or ACP for OpenCode and Pi.

## Dependency rules

| Code in                           | May import                                                                                                                                                                                                                                           | Must not import                                                                                                                     | Guard                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `packages/shared`                 | nothing of ours                                                                                                                                                                                                                                      | any other package                                                                                                                   | Biome `noRestrictedImports` |
| `packages/protocol`               | `shared`, `zod`                                                                                                                                                                                                                                      | `sidecar`, `apps/*`                                                                                                                 | Biome `noRestrictedImports` |
| `packages/sidecar`                | `shared`, `protocol`, agent SDKs                                                                                                                                                                                                                     | `apps/*`                                                                                                                            | Biome `noRestrictedImports` |
| `apps/desktop/src/platform`       | `@tauri-apps/*`, `shared`, `protocol`                                                                                                                                                                                                                | `core`, `features`, `ui`, `app`                                                                                                     | Biome `noRestrictedImports` |
| `apps/desktop/src/core`           | `platform/platform.ts` (the interface), `shared`, `protocol`                                                                                                                                                                                         | `@tauri-apps/*`, `features`, `ui`, `app`                                                                                            | Biome `noRestrictedImports` |
| `apps/desktop/src/features`, `ui` | `core/context.tsx`, `core/model.ts`, `core/hooks.ts`, `core/api.ts`, `core/registries/**`, `core/status/**`, `core/async/**`, pure helpers outside `core/services/**`, other features, `ui`, `shared`, `protocol` types, `app/command-dispatcher.ts` | `core/services/**`, `core/container.ts`, `core/db/**`, `core/cloud/**`, `core/git/**`, `core/conductor-import/**`, `@tauri-apps/**` | Biome `noRestrictedImports` |
| `apps/desktop/src/app`            | everything in `src`                                                                                                                                                                                                                                  | `@tauri-apps/*` outside `platform`                                                                                                  | Biome `noRestrictedImports` |

`scripts/guards/boundaries.test.ts` writes one forbidden import per rule into a temporary file and asserts that Biome rejects it, so the rules cannot silently stop matching. Test files under `features`, `ui` and `src/test` are exempt from the features and ui rule, because they wire real containers (D126).

## Where each kind of logic lives

| Logic                                               | One home                                           | Also used by                                                                                                                        |
| --------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Message shapes between UI and sidecar               | `packages/protocol`                                | both sides parse with the same schemas                                                                                              |
| Mention tokens (`@file`, `#PR`)                     | `packages/protocol/src/mentions.ts`                | composer writes them, sidecar expands them                                                                                          |
| Canonical tool names                                | `packages/protocol/src/tools.ts`                   | runners map to them, chat cards key on them                                                                                         |
| Agent providers, sign-ins and their key variables   | `packages/protocol/src/agent-providers.ts`         | the sidecar's key filter and routing, the Providers dialog, the app's launch                                                        |
| Which names hold a secret (`isSecretName`)          | `packages/shared/src/secret-names.ts`              | the sidecar logger, the diagnostics report, the Rust logger (shared fixture)                                                        |
| Workspace status (sidebar, Home, tabs, Git panel)   | `apps/desktop/src/core/status/workspace-status.ts` | every screen that shows a status                                                                                                    |
| Git panel header state and its main action          | `apps/desktop/src/core/status/git-header.ts`       | Git panel, command palette                                                                                                          |
| Commands and their shortcuts                        | `apps/desktop/src/core/registries/commands.ts`     | menus (sent to Rust), palette, shortcut dialog, tooltips                                                                            |
| Shortcut conflict rule                              | `apps/desktop/src/core/registries/commands.ts`     | settings page, custom bindings                                                                                                      |
| Settings, their scopes and defaults                 | `apps/desktop/src/core/registries/settings.ts`     | settings pages, settings search, services                                                                                           |
| Session lifecycle (queue, steer, cancel, idle)      | `packages/sidecar/src/session`                     | every runner                                                                                                                        |
| Sidecar process, file, socket and environment edges | `packages/sidecar/src/adapters`                    | `modes/sidecar-mode.ts` wires them; the modules that are themselves an edge are listed under [Sidecar I/O edges](#sidecar-io-edges) |
| Turn grouping for display                           | `apps/desktop/src/core/services` (turn builder)    | the chat list                                                                                                                       |
| Database schema                                     | `apps/desktop/src-tauri/migrations`                | UI repositories in `core/db`                                                                                                        |
| Which host a workspace's calls may use (D092)       | `apps/desktop/src/core/host.ts` (`checkHost`)      | lookups, terminals, workspace lifecycle; the chat context carries it                                                                |
| Which runtime runs a workspace's calls (CLOUD-03)   | `apps/desktop/src/core/cloud/`                     | the shell and file adapters and the host-routed sidecar client                                                                      |
| Conductor's rows as ours, for the import (APP-17)   | `apps/desktop/src/core/conductor-import/`          | the Settings row and first-run offer; chat events map in `packages/sidecar/src/import/` for the spike                               |

### Sidecar I/O edges

`packages/sidecar/src/adapters` holds the process, file, socket and environment ports the composition root (`modes/sidecar-mode.ts`) wires and passes down. A module outside `adapters/` may touch the outside world directly only when it is itself the edge: the implementation of a port, a listener, or the one helper for an external program. `scripts/guards/sidecar-edges.ts` fails on a new such module, and this list is the rule:

| Module                                                  | Why it is the edge                                                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `packages/sidecar/src/outbox/node-storage.ts`           | the `node:fs` implementation of `OutboxStorage`, whose port is `outbox/outbox-file.ts`                     |
| `packages/sidecar/src/models/completions-cache.ts`      | `createNodeCompletionsFiles`, the slash-command cache's file edge                                          |
| `packages/sidecar/src/prompt/pull-request-stub.ts`      | the pull-request stub writer, passed to the assembler as a port                                            |
| `packages/sidecar/src/rpc/server.ts`                    | the Unix socket listener itself; `adapters/sockets.ts` only builds its path                                |
| `packages/sidecar/src/tools/socket-bridge.ts`           | the private Unix socket the app-tools helpers call                                                         |
| `packages/sidecar/src/tools/mcp-stdio-server.ts`        | the helper process that connects to that socket                                                            |
| `packages/sidecar/src/process/spawn-child.ts`           | the one spawn helper for long-lived agent children, wired by `adapters/process.ts`                         |
| `packages/sidecar/src/checkpoints/run-checkpointer.ts`  | runs `bin/checkpointer.sh` as a detached process group, behind the checkpointer's port                     |
| `packages/sidecar/src/runners/managed-programs.ts`      | reads the program manager's links in the app's bin folder                                                  |
| `packages/sidecar/src/runners/claude/transcript.ts`     | reads Claude's own transcript files, whose folder the agent owns                                           |
| `packages/sidecar/src/runners/claude/claude-session.ts` | checks whether a bundled skill plugin file exists                                                          |
| `packages/sidecar/src/runners/acp/acp-client.ts`        | answers an ACP agent's file reads and writes, restricted to the workspace                                  |
| `packages/sidecar/src/runners/cursor/cursor-runner.ts`  | reads the launch script the Cursor SDK needs                                                               |
| `packages/sidecar/src/util/read-text.ts`                | the one "read a text file, a missing file is null" helper                                                  |
| `packages/sidecar/src/main.ts`                          | the entry point: the launcher environment enters here once, for `config.ts`                                |
| `packages/sidecar/src/packaging.ts`                     | build-time packaging run by the package's `build` script, not by the sidecar process                       |
| `packages/sidecar/src/cloud-build.ts`                   | build-time packaging for the cloud image, run by `apps/cloud/sandbox/build.ts`, not by the sidecar process |

Every other module receives its files, processes, sockets and environment as values or ports from the composition root.

## Shared helpers

Use these before writing your own. A second copy is a finding in review.

| Need                                       | Use                                              | Lives in                                                                |
| ------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------- |
| Run work one at a time per key             | `createKeyedQueue`                               | `packages/shared/src/serial-queue.ts`                                   |
| Store, then acknowledge, in order          | `persistThenAck`                                 | `packages/shared/src/serial-queue.ts`                                   |
| Ignore a second request while one runs     | `createSingleFlight`                             | `apps/desktop/src/core/async/single-flight.ts`                          |
| Let only the newest answer change state    | `createLatestWins`                               | `apps/desktop/src/core/async/latest-wins.ts`                            |
| Optimistic change with rollback            | `createOptimisticStore`                          | `apps/desktop/src/core/async/optimistic.ts`                             |
| Retry with backoff                         | `createBackoff`                                  | `apps/desktop/src/core/async/backoff.ts`                                |
| Start work without awaiting it             | `fireAndForget`                                  | `apps/desktop/src/core/async/fire-and-forget.ts`                        |
| Trash an app data file if it is there      | `trashIfPresent`                                 | `apps/desktop/src/core/fs-helpers.ts`                                   |
| Copy a file, keeping its mode (`cp -p`)    | `copyFileKeepingMode`                            | `apps/desktop/src/core/fs-helpers.ts`                                   |
| Write a settings file, keeping comments    | `SettingsService.updateSettingsFile`             | `apps/desktop/src/core/services/settings.ts`                            |
| A database write that returns nothing      | `executeVoid`                                    | `apps/desktop/src/core/db/row-codec.ts`                                 |
| Parse a JSON column, collect results       | `parseJsonColumn`, `collectResults`              | `apps/desktop/src/core/db/row-codec.ts`                                 |
| Show an error toast from a `Result`        | `toastError`                                     | `apps/desktop/src/ui/Toast.tsx`                                         |
| Light or dark mode for code views          | `useThemeType`                                   | `apps/desktop/src/ui/use-theme-type.ts`                                 |
| Menu and context-menu parts and classes    | `menuItemClass`, `MenuItemContents` and siblings | `apps/desktop/src/ui/Menu.tsx`                                          |
| Error text and error checks                | `messageOf`, `isAppError`, `asAppError`          | `packages/shared/src/errors.ts`                                         |
| Signal a process group (Rust)              | `process_group`                                  | `apps/desktop/src-tauri/src/process_group.rs`                           |
| Lock a mutex, even a poisoned one (Rust)   | `lock`                                           | `apps/desktop/src-tauri/src/error.rs`                                   |
| The main window or `window_missing` (Rust) | `main_window`                                    | `apps/desktop/src-tauri/src/window.rs`                                  |
| A real container or database in a test     | `createTestContainer`, `openTestDatabase`        | `apps/desktop/src/test/container.ts`, `apps/desktop/src/test/sqlite.ts` |
| Answer a test container's sidecar requests | `answerSidecar`                                  | `apps/desktop/src/test/sidecar-answers.ts`                              |

## State and time

- Product state lives in a zustand store the service owns, built by `core/container.ts`. A module-level singleton is allowed only for state that belongs to the one web view and dies with it, where a service would add indirection and no testability. Each entry in [Module-level state](#module-level-state) holds no product data, does no I/O and starts empty on every web-view load. `scripts/guards/module-state.ts` reads that table and fails on a new one.
- One module-level singleton should move into the container: the command registry in [Module-level state](#module-level-state). APP-16 moves it into `core/container.ts` and makes the helpers take the container's registry.
- In the Rust shell, a `static` is allowed for a value that must live as long as the process and cannot be passed in: the cache and the two locks in [Module-level state](#module-level-state), and an atomic counter that makes a temp file's name unique. Product state lives in Tauri-managed state. `scripts/guards/module-state.ts` fails on any other module-level cache or lock (`Mutex`, `RwLock`, `OnceLock`, `OnceCell` or `Lazy`).
- The sidecar keeps per-chat state inside its session manager, keyed by session id. A restart loses it by design: chats resume from the agent's own transcript and the UI's database.
- Time, ids, the Platform and the shell environment are passed in from the composition roots (`apps/desktop/src/core/container.ts`, `packages/sidecar/src/modes/sidecar-mode.ts`).
- One home per fact. A stored value that can be read or derived from another row is not stored again; a copy that must exist names its reason and the code that keeps it in step. No guard holds this yet: the per-PR audits check it. #395 settled the copies the system audit listed: linked folders live on the workspace row, a model's context window in `model_context_windows`, and each attachment path in its `attachments` row; `docs/data-model.md` names the copies that stay and their tests.
- Only the newest async result changes state. The sidecar's run guard drops results from cancelled or superseded turns. UI services drop query results whose request id is no longer the latest.

### Module-level state

The only module-level singletons the code may create. `scripts/guards/module-state.ts` reads this table, so a new one fails until it is added here.

| Kind             | Where                                                         | Name                     | Why                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| zustand store    | `apps/desktop/src/ui/Toast.tsx`                               | `useWorkspaceToastStore` | the workspace-scoped toasts the host is showing                                                                                                                                              |
| zustand store    | `apps/desktop/src/app/overlay-store.ts`                       | `useOverlayStore`        | which window-level overlay is open                                                                                                                                                           |
| zustand store    | `apps/desktop/src/features/composer/snippet-dialogs-store.ts` | `useSnippetDialogsStore` | which snippet dialog is open and the insert callback of the composer that opened it                                                                                                          |
| command registry | `apps/desktop/src/app/command-dispatcher.ts`                  | `defaultRegistry`        | a fallback for a screen rendered without its provider, which hides a missing provider in tests; APP-16 moves it into `core/container.ts` and makes the helpers take the container's registry |
| Rust static      | `apps/desktop/src-tauri/src/terminal_history.rs`              | `CACHED_KEY`             | a cache that saves a second Keychain read                                                                                                                                                    |
| Rust static      | `apps/desktop/src-tauri/src/terminal_history.rs`              | `KEY_LOCK`               | a lock that serialises two threads                                                                                                                                                           |
| Rust static      | `apps/desktop/src-tauri/src/binaries.rs`                      | `PATH_OVERRIDES_SYNC`    | a lock that serialises two threads                                                                                                                                                           |

## Calls that cost money

Every agent turn spends the user's model budget. All of them go through one door: the sidecar's session manager (`packages/sidecar/src/session`).

- A message is sent to an agent once. The duplicate guard drops a repeat of the same message id.
- A turn cut off by a crash is marked `interrupted` and never sent again by itself. The user decides whether to retry.
- Each turn's reported cost and tokens are recorded on its `usage` item, and shown per turn.
- Reserving budget before a turn is not possible: the agent programs bill their own provider accounts. This app only records what they report.

Guards: the duplicate guard's tests in `packages/sidecar/src/session`. Nothing yet holds the "never resent after a crash" rule; its first test belongs to DATA-03.

## Trust boundaries

- The WebKit view may call only the commands and plugins listed in `src-tauri/capabilities/default.json`.
- Agents run with the user's permissions inside a worktree. File edits outside the workspace and its linked folders are refused by the runner's path check (AGENT-04).
- Provider keys are removed from the environment passed to agents. Secrets live in the Keychain; the database holds only references.

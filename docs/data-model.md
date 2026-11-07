# Data model

What the app stores, where, and for how long. The schema itself lives in `apps/desktop/src-tauri/migrations`. Never edit an applied migration: add a new numbered file, then run `bun scripts/guards/migrations.ts --lock-new`. The rules behind this are in [decisions.md](decisions.md) (D006, D007).

## Who writes what

- The **web UI** reads and writes `conducted.db` through `apps/desktop/src/core/db`. Screens never touch it directly (lint-enforced).
- The **Rust shell** creates the schema (migrations) and refuses to start when the database is newer than the app (PLAT-17).
- The **sidecar** never writes the database. It keeps its own write-ahead log until the UI confirms it stored each event.
- A row that belongs to a cloud workspace is kept here as a local copy, reached through its workspace's `host_kind`, `host_url` and `host_vm_id` columns (D103). The host has one home on `workspaces`; sessions, events, live state, comments and terminals follow it by reference. Local work reads local rows only, and removing a cloud host deletes its workspaces with their child rows in one transaction (`core/db/host-copy.ts`).
- Ids are UUID text, times are milliseconds since the epoch, JSON columns hold data validated by `packages/protocol`.

## Tables

Generated from the migrations by `bun scripts/guards/data-model.ts --write`. `pnpm guards` fails when this table is stale or a table has no lifetime.

<!-- generated:tables -->
| Table | Holds | Lifetime | Created in |
|---|---|---|---|
| `repos` | A git repository the user added. | until the user removes it. | 0001_init.sql |
| `workspaces` | One git worktree with its own branch. | archived rows are kept (they are small) until the user deletes them; their worktree folder is removed on archive. | 0001_init.sql |
| `sessions` | One chat. | deleted with its workspace, or by the user. | 0001_init.sql |
| `session_events` | The chat's durable event log (packages/protocol events.ts). Append-only, idempotent on event_id. | tool outputs larger than the retention limit are cut after 30 days, and events of archived workspaces are compacted after 90 days (DATA-02). Both limits are settings. | 0001_init.sql |
| `session_live_state` | Last known live state per chat, so a restart can show it before the sidecar answers. | one row per session. | 0001_init.sql |
| `queued_messages` | Follow-up messages typed while the agent works. | sent and cancelled rows are removed once their user_message event is stored. | 0001_init.sql |
| `diff_comments` | Review comments on the workspace diff, from the user, an agent, or GitHub. | deleted with the workspace. | 0001_init.sql |
| `attachments` | Files attached to messages or drafts. The file itself lives under the app data folder. Rebuilt in 0004 with the pdf and review kinds and the link to a review comment. | draft attachments older than 7 days are removed with their files. | 0001_init.sql, rebuilt in 0004_review_states_backlog_snippets_keys.sql |
| `terminals` | Terminal tabs and script runs of a workspace, and the one terminal of each repository. Scrollback lives in files written by the Rust shell. Rebuilt in 0004 for repository terminals. | ended terminals older than 14 days are removed with their scrollback files. | 0001_init.sql, rebuilt in 0004_review_states_backlog_snippets_keys.sql |
| `sections` | Sidebar sections. | until the user deletes them. | 0001_init.sql |
| `section_members` | Which workspaces sit in which section. | removed with the section or the workspace. | 0001_init.sql |
| `favorite_models` | Saved model choices for the model picker. | until removed. | 0001_init.sql |
| `settings` | App settings, keyed by the settings registry (apps/desktop/src/core/registries/settings.ts). Repo-scoped values use the key "repo:<repoId>:<key>". | fixed set of keys. | 0001_init.sql |
| `env_vars` | Environment variables passed to agents and scripts. Values are stored in the macOS Keychain; this table holds only the names and where they apply. | until the user removes the variable, which also removes its Keychain entry (SET-04). | 0001_init.sql |
| `backlog_workspaces` | A workspace saved to the backlog: the prompt and settings to start it later, with no worktree, branch or port yet. Starting it creates the workspace row with the same id and removes this one. Rebuilt in 0008 so a draft whose repository was removed stays, with no repository. | until the user starts or deletes it. | 0004_review_states_backlog_snippets_keys.sql, rebuilt in 0008_backlog_repo_optional.sql |
| `snippets` | Prompt snippets, private to this Mac (D025). | until the user deletes the snippet. | 0004_review_states_backlog_snippets_keys.sql |
| `provider_keys` | Provider keys the user gave an agent on the Agents page (D033). The values are stored in the macOS Keychain; this table holds only where each key goes. acp_agent is '' for agents that are not ACP agents. source 'this_mac' means the key is read from the Mac's environment, so no Keychain entry exists. | until the user removes the key, which also removes its Keychain entry. | 0004_review_states_backlog_snippets_keys.sql |
| `model_context_windows` | The context window an agent last reported for one model. agent is the agent kind, or 'acp:<agent>' for an ACP agent; model is the model id the chat was started with. | one row per agent and model, replaced by the next report for that model; the table grows only with the number of models used. | 0006_model_context_windows.sql |
<!-- /generated:tables -->

The generated rows quote each migration's comment. Some comments in earlier migrations are out of date, and an applied migration is never edited, so the corrections live here:

- `session_events`: its row above quotes "Both limits are settings". That is wrong. The 30-day tool-output cut and the 90-day archived-chat compaction have fixed limits, `DEFAULT_LIFETIME_LIMITS` in `apps/desktop/src/core/db/lifetime.ts`, which `core/container.ts` passes unchanged; no setting changes them (DATA-02). `scripts/guards/lifetime-limits.ts` fails when a settings key takes one over.
- `settings`: its row above quotes "fixed set of keys". That is wrong. The table holds the settings registry's keys and one internal bookkeeping key, `data_lifetime_last_run_at`, which stores when the data-lifetime job last ran (DATA-02). `scripts/guards/settings-keys.ts` fails on a `_KEY` constant in `core/db` that this file does not name.
- `workspaces` no longer has a `notes` column, and `terminals` no longer has `cols` or `rows`. Nothing read them, so migration 0011 dropped them.
- `workspaces.archived_at` is only the time an archive finished, read by the data-lifetime and checkpoint jobs (DATA-02, DATA-06). Whether a workspace is archived comes from `state` alone, through `isArchivedWorkspace` in `apps/desktop/src/core/status/archived.ts`. A workspace being restored is `initializing` while its archived time is still set, so every screen reads it as live.
- `session_events.compacted_at` is the one marker for "this event was compacted": the daily tool-output cut sets it on an agent event, and the archived-chat compaction sets it on a turn's `turn_ended` event. Migration 0011 moved the older JSON `$.compacted` flags into it and removed the flag.

## Stores outside the database

| Store | Where | Lifetime | Enforced by |
|---|---|---|---|
| Sidecar write-ahead event log | `$CONDUCTED_OUTBOX_ROOT/<session>` | An entry is removed when the UI confirms it. At most 20,000 pending entries per chat. A chat's file with nothing pending and no activity for 30 days moves to the Trash. | SIDE-06 |
| App logs | app data `logs/` | 14 days; files roll over at 20 MB. Exports are removed after 7 days. | PLAT-18 |
| Slash command cache | app data `sidecar-v2-completions/slash-command-snapshots.json` | An entry expires 30 days after its last refresh. At most 500 entries and 5 MiB; the oldest go first. | SIDE-22 |
| Cursor SDK run stores | app data `cursor-sdk-store/<hash of the workspace path>/` | The SQLite run store of Cursor's SDK, written by the SDK once the user installs it (AGENT-09, D083): one folder per workspace that ran a Cursor chat. Deleting a workspace moves its folder to the Trash (WS-10); an archived workspace keeps it, because its chats stay. | WS-10 |
| Sidecar log files | app data `logs/sidecar-<pid>.log` | The Rust shell writes the sidecar's redacted stderr there; the newest five files are kept and older ones are removed. | PLAT-09 |
| Managed programs | app data `agent-binaries/<program>/<version>/` for claude, codex, gh and watchexec, and `agent-binaries/cursor/<version>/node_modules/` for Cursor's SDK tree (about 45 MB unpacked) | One version per program: once a new version installs, older ones move to the Trash. Remove moves the program to the Trash. A compressed download is removed once its program is unpacked; an SDK tarball once it is unpacked, and a staging folder `cursor/.<version>.partial` when its install fails. | PLAT-28, AGENT-09 |
| Program install records | app data `agent-binaries/.meta/<program>-<version>.json` | About 200 bytes per version ever installed. Nothing removes them yet, as in Conductor. | none |
| Program links | app data `bin/`, and `agent-binaries/cursor/current` for Cursor's SDK | One link per managed program, replaced at each install and removed with the program, beside the copy of the bundled scripts (PLAT-34). Cursor's SDK is no program on PATH, so its link sits beside its versions. | PLAT-28 |
| Terminal scrollback | app data `terminal-history/`, encrypted with the key in the macOS Keychain under `build.conducted.app` / `local-storage-entry-encryption-key-v1` (D087) | 14 days after the terminal ends, and at most 50 MB in total, oldest first. Plain entries left by an earlier version are encrypted on the first start. The key stays until the user deletes it in Keychain Access. | PLAT-08 |
| Draft attachments | app data `draft-attachments/` | 7 days for drafts never sent. | DATA-02 |
| Composer drafts | app data `drafts/<session>.json` | 30 days without an edit, and when the chat is deleted. | DATA-02 |
| Uploaded repository icons | app data `icons/<repo>-<id>.<ext>` | One image per project with an uploaded icon, at most 10 MB. The earlier image moves to the Trash once the project points to a new one; clearing the icon, choosing an emoji or removing the project moves it to the Trash too. | PRJ-05 |
| Workspace panel layouts | the web view's `localStorage`, key `conducted.panel-layout:<group id>` | Removed with its workspace when WS-05 deletes or archives it; a saved layout for a panel that no longer exists is ignored. The app shell's sidebar lives in the settings table, not here. | WS-05 |
| Run history | the web view's `localStorage`, key `conducted.run-history:<workspace id>` | The last 20 run actions of one workspace; removed when the workspace is deleted or archived. | RUN-01 |
| Hidden run actions | the web view's `localStorage`, key `conducted.hidden-run-actions:<repo id>` | The shared run actions this user hid for one project; removed when the project is removed. | SET-07, removed by PRJ-01 |
| Last workspace location | the web view's `localStorage`, key `conducted.workspace-location-v1` | Replaced on every route change; removed when the route has no workspace to reopen. | NAV-02 |
| Dismissed macOS warning | the web view's `localStorage`, key `conducted.macos-version-warning-dismissed` | The app version whose "macOS is too old" warning the user dismissed; the warning returns after an update, which replaces the value. | APP-08 |
| Cached changes and PR info | app data `git-cache/changes/<workspace>.json` and `git-cache/pr-info/<workspace>.json` | 25 MB for changes and 5 MB for PR info in total; the oldest files go first. Removed with the workspace. | DATA-07 |
| Terminal shell integration | app data `terminal-shell-integration/zsh/` | Four small files, rewritten at every app start. | RUN-09 |
| Setup script logs | app data `setup-logs/<workspace>.log` | Removed with the workspace. | WS-10 |
| "Viewed" ticks in the diff | app data `viewed-files/<workspace>.json` | Removed with the workspace. | WS-10 |
| Turn snapshots | `refs/conducted/checkpoints/*` in each repo | Removed when their chat is deleted, and 30 days after their workspace is archived. | DATA-06 |
| Archive snapshots | `refs/conducted/archive/<workspace>` in each repo | Until the workspace is deleted. | WS-10 |
| Worktrees | the workspaces folder | Removed when the workspace is archived. | WS-05 |
| Global settings | `~/.conducted/settings.toml` | Owned by the user; fixed size. | DATA-05 |
| Repo settings | `<repo>/.conducted/settings.toml` | Owned by the repo; fixed size. | DATA-05 |
| Repo local settings | `<repo>/.conducted/settings.local.toml` | Owned by the user; git-excluded; fixed size. | DATA-05 |
| Environment variable secrets (env vars, tokens) | macOS Keychain, key `env:global:<NAME>` for a global value or `env:repo:<repoId>:<NAME>` for a repository value | Until the user removes the variable or its project, or signs out. | SET-04 |
| Agent transcripts | the agent's own folder (for example `~/.claude/projects/`) | Owned by the agent program, not by this app. | none |
| Cloud workspace backups | the user's R2 bucket `conducted-cloud-backups`, keys `workspace-backups/<uuid>.tar.zst`, with one record per directory in the Workspace Durable Object's storage | The newest backup of `/workspace` and each agent transcript folder (`/root/.claude`, `/root/.codex`), replaced at each turn end: three objects per workspace once a save finishes. A new backup is stored before the object it replaces is deleted. Deleted with the workspace (CLOUD-08) and when the Worker is uninstalled (CLOUD-07); neither flow is built yet. | CLOUD-06 |

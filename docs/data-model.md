# Data model

What the app stores, where, and for how long. The schema itself lives in `apps/desktop/src-tauri/migrations`. Never edit an applied migration: add a new numbered file, then run `bun scripts/guards/migrations.ts --lock-new`. The rules behind this are in [decisions.md](decisions.md) (D006, D007).

## Who writes what

- The **web UI** reads and writes `conducted.db` through `apps/desktop/src/core/db`. Screens never touch it directly (lint-enforced).
- The **Rust shell** creates the schema (migrations) and refuses to start when the database is newer than the app (PLAT-17).
- The **sidecar** never writes the database. It keeps its own write-ahead log until the UI confirms it stored each event.
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
| `attachments` | Files attached to messages or drafts. The file itself lives under the app data folder. | draft attachments older than 7 days are removed with their files. | 0001_init.sql |
| `terminals` | Terminal tabs and script runs. Scrollback lives in files written by the Rust shell. | ended terminals older than 14 days are removed with their scrollback files. | 0001_init.sql |
| `sections` | Sidebar sections. | until the user deletes them. | 0001_init.sql |
| `section_members` | Which workspaces sit in which section. | removed with the section or the workspace. | 0001_init.sql |
| `favorite_models` | Saved model choices for the model picker. | until removed. | 0001_init.sql |
| `settings` | App settings, keyed by the settings registry (apps/desktop/src/core/registries/settings.ts). Repo-scoped values use the key "repo:<repoId>:<key>". | fixed set of keys. | 0001_init.sql |
| `env_vars` | Environment variables passed to agents and scripts. Values are stored in the macOS Keychain; this table holds only the names and where they apply. | until the user removes the variable, which also removes its Keychain entry (SET-04). | 0001_init.sql |
<!-- /generated:tables -->

## Stores outside the database

| Store | Where | Lifetime | Enforced by |
|---|---|---|---|
| Sidecar write-ahead event log | `$CONDUCTED_OUTBOX_ROOT/<session>` | An entry is removed when the UI confirms it. At most 20,000 pending entries per chat. A chat's file with nothing pending and no activity for 30 days moves to the Trash. | SIDE-06 |
| App logs | app data `logs/` | 14 days; files roll over at 20 MB. Exports are removed after 7 days. | PLAT-18 |
| Sidecar log buffer | memory | 64 MiB, oldest dropped first. | SIDE-18 |
| Terminal scrollback | app data `terminal-history/` | 14 days after the terminal ends, and at most 50 MB in total, oldest first. | PLAT-08 |
| Draft attachments | app data `draft-attachments/` | 7 days for drafts never sent. | DATA-02 |
| Composer drafts | app data `drafts/<session>.json` | 30 days without an edit, and when the chat is deleted. | DATA-02 |
| Setup script logs | app data `setup-logs/<workspace>.log` | Removed with the workspace. | WS-10 |
| "Viewed" ticks in the diff | app data `viewed-files/<workspace>.json` | Removed with the workspace. | WS-10 |
| Turn snapshots | `refs/conducted/checkpoints/*` in each repo | Removed when their chat is deleted, and 30 days after their workspace is archived. | DATA-06 |
| Archive snapshots | `refs/conducted/archive/<workspace>` in each repo | Until the workspace is deleted. | WS-10 |
| Worktrees | the workspaces folder | Removed when the workspace is archived. | WS-05 |
| Secrets (env vars, tokens) | macOS Keychain | Until the user removes the variable or signs out. | SET-04 |
| Repo settings | `<repo>/.conducted/settings.toml` | Owned by the repo; fixed size. | DATA-05 |
| Agent transcripts | the agent's own folder (for example `~/.claude/projects/`) | Owned by the agent program, not by this app. | none |

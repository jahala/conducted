# Moving from Conductor to Conducted

Issue #353. Decision D100. Someone who uses Conductor can move to Conducted, keep their projects, workspaces, chats, settings and scripts, and still go back to Conductor at any time.

## Safety rules

These hold for every step, and each has a test (section "Checks").

1. **Conductor's files are only read.** Its database is opened read-only and copied with SQLite's backup API into a folder the import owns. Every later step reads that copy. Nothing in `~/Library/Application Support/com.conductor.app/`, in a repo's `conductor.json` or `.conductor/`, or in a worktree is written, moved, renamed or locked.
2. **A dry run comes first.** The import lists what it will bring over, what it cannot, and why, before it changes anything in Conducted. The user then chooses to go ahead.
3. **All or nothing.** Conducted's own database is written in one transaction. A failure rolls it back, so Conducted's data is as it was. Keychain entries the import made are removed on rollback.
4. **Checked after.** The import counts each kind of item before and after, and opens one sample of each (a workspace's folder, a chat's history, a setting). A count that differs fails the import and rolls it back.
5. **Worktrees stay where they are.** A workspace keeps its folder and branch; Conducted points at the folder. Nothing on disk moves.
6. **Secrets never show.** Conductor keeps environment variable values in its database in plain text. The import moves each value straight into the macOS Keychain, as ours are kept (SET-04). Values never appear in the dry run, a log or an error.
7. **Once per item.** Each imported row records the Conductor id it came from, so a second import skips what is already there and adds only what is new.

## What comes over

| Conductor | Conducted | Notes |
|---|---|---|
| `repos` | `repos` | Name, remote, root folder, default branch, display order. |
| repo scripts (`repos.setup_script`, `run_script`, `archive_script`, and `conductor.json`) | `<repo>/.conducted/settings.toml` | Written once, as a new file, only when the repo has none. `conductor.json` stays as it is. |
| `workspaces` (active and archived) | `workspaces` | Branch, folder, state, unread, target branch. An archived workspace keeps its archived state. |
| `sessions` | `sessions` | Title, model, permission mode, the agent's own session id, so a chat resumes from the agent's transcript (D006). |
| `session_events` | `session_events` | Mapped event by event to our event format (packages/protocol events.ts). Their older `session_messages` table is read only for chats that have no events. The spike decides whether this row ships. |
| `settings` | `settings` | Only keys whose meaning matches one of ours, by a written key map. Every other key is listed in the dry run as not brought over. |
| `env_vars` | `env_vars` + Keychain | Values into the Keychain (rule 6). |
| `navigation_sections`, `navigation_section_memberships` | `sections`, `section_members` | Sidebar sections and who is in them. |
| `favorite_models` | `favorite_models` | Models that we offer; others are listed. |
| `diff_comments` | `diff_comments` | Review comments on open workspaces. |

Left out, each listed in the dry run with the reason: terminal tabs and their history (the spike checks whether `terminal_sessions` holds anything we can show), port forwards, the outbox and identity tables (Conductor's own servers), attachments whose files are gone.

## Scripts and `CONDUCTOR_*` names

D027 stays: Conducted sets only `CONDUCTED_*` names, with no alias. When the import writes `.conducted/settings.toml`, it renames every `CONDUCTOR_` variable in the scripts it copies to `CONDUCTED_`, and the dry run shows each rename. A script file in the repo that reads a `CONDUCTOR_*` name (for example `./scripts/setup.sh`) belongs to the user, so the import does not edit it: the dry run lists the file, the line and the new name to use.

## Where it lives

- The reading and mapping are pure functions in `packages/shared` (or the desktop app's `core/`): Conductor's rows in, our rows and a list of what was left out. They take the database copy as a value and do no I/O.
- The Rust shell makes the read-only copy and moves secrets into the Keychain.
- The user starts it from Settings (General, "Import from Conductor") and on first launch when Conductor's folder exists. The exact place follows D098: Conductor has no such control, so it goes where a first-run import most logically sits in Conductor's layout, and docs/design.md names it.

## The spike first

Before the import is built, a spike maps chat history on real data.

- Data: a backup copy of a real Conductor database (rule 1). The owner's own database is the only one we have, so the owner says yes before it is read (see the report).
- Pass mark, written before the run: at least 99% of events in the sampled chats map to one of our events, and every chat that maps shows the same visible messages in the same order as Conductor.
- Kill criterion: below that, chat history does not come over. Chats still resume from the agent's transcript, and the dry run says history was left out.

## Checks

- A test builds a Conductor database from `conductor-schema.sql` with known rows, runs the import, and compares counts and samples.
- A test watches the Conductor folder's files (size, modified time, a hash) before and after, and fails on any change.
- A test fails the import part-way and checks that Conducted's database and Keychain are as they were.
- A test runs the import twice and checks that nothing is doubled.
- A test checks that no secret value appears in the dry run, the log or an error.

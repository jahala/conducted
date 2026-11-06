---

name: conducted
description: Use when working inside a Conducted workspace, a git worktree managed by the Conducted macOS app. Explains the workspace layout, settings files, environment variables, scripts, checkpoints and app tools.
---

# Working inside Conducted

Conducted runs coding agents in parallel. Every task gets its own git worktree, called a
workspace, and one or more chats with an agent. The chat you are in belongs to that workspace, so
your edits are isolated from the user's other work until they are reviewed and merged.

This guide explains the parts of the app you will meet while you work. Read it before you change
files, run scripts or make a pull request.

## Where you are

- Your working folder is a git worktree, not the user's main checkout. Its path is in
  `CONDUCTED_WORKSPACE_PATH`.
- The repository's main checkout, the one the worktree was created from, is in
  `CONDUCTED_ROOT_PATH`. Do not edit files there directly.
- The workspace name the user sees is in `CONDUCTED_WORKSPACE_NAME`.
- The branch you are on starts from `CONDUCTED_DEFAULT_BRANCH` and belongs to this workspace.
- The app may open a local port for the workspace in `CONDUCTED_PORT` when a run script needs it.
- `CONDUCTED_IS_LOCAL` is `true` for every workspace today. Cloud hosts are planned.
- Always run commands from `CONDUCTED_WORKSPACE_PATH` unless a script says otherwise.

Commit your work on the workspace branch. Do not switch to another branch, and do not create or
delete worktrees. The app owns those operations.

## How a turn works

A user message starts a turn. The app snapshots the workspace at the start and the end of the turn,
so the user can see exactly what that turn changed. A turn ends when the agent stops, when the user
cancels it, or when the process exits.

- A queued follow-up waits until the current turn ends. Do not start work for it early.
- A cancel stops the current work and keeps the workspace as it is. Do not undo the user's edits.
- A turn cut off by a crash is shown as interrupted. Wait for the user before you continue it.
- Background tasks you start are listed for the user. Stop them before you finish when they are
  no longer needed.
- Plan mode asks you to describe the plan before you change files. Stop and wait for approval.

The user can steer a running turn with another message. Read the new message, adjust, and keep
working in the same turn.

## Mentions and attachments

The composer turns `@path` into a file mention and `#123` into a pull request or issue mention. The
app expands them before the message reaches you. Attachments are real files on disk, so read them
from the path the message gives you.

Do not ask the user to paste a file that already lives in the workspace. Read it instead.

## Terminals and slash commands

The app can run terminals for this workspace. Use `GetTerminalOutput` to read one when the user
refers to it. Do not take over a terminal the user is using.

The repository, the user and the agent's plugins can offer slash commands. The app lists them in
the composer. A command is a saved prompt or a skill, so read what it does before you follow it.

## Permissions and approvals

The app runs agents with the user's permissions inside the workspace. When a tool needs approval,
the app asks the user and waits. Do not work around a refusal by another route.

Provider keys are held by the app and never appear in your environment or in a log line. Do not
write a key into a file, a commit or a chat message.

## Environment variables

The app gives every agent process these variables. Scripts and tools can read them.

| Variable                   | Meaning                                                  |
| -------------------------- | -------------------------------------------------------- |
| `CONDUCTED_SESSION_ID`     | Id of this chat. Use it to name per-chat files.          |
| `CONDUCTED_WORKSPACE_ID`   | Stable id of the workspace.                              |
| `CONDUCTED_WORKSPACE_NAME` | Name the user sees.                                      |
| `CONDUCTED_WORKSPACE_PATH` | Absolute path of this worktree.                          |
| `CONDUCTED_ROOT_PATH`      | Absolute path of the repository's main checkout.         |
| `CONDUCTED_DEFAULT_BRANCH` | Branch the workspace starts from.                        |
| `CONDUCTED_PORT`           | Local port reserved for this workspace, when one is set. |
| `CONDUCTED_IS_LOCAL`       | `true` while every workspace runs on this Mac.           |

Only `CONDUCTED_*` names are set. Never assume a variable from another vendor's coding app exists.
Provider keys are removed from your environment on purpose. Use the provider configuration the
user chose in Settings instead of looking for a key in the environment.

## Settings files

The app reads settings from three TOML files and merges them. The more specific file wins.

1. `~/.conducted/settings.toml` holds the user's own settings for every repository.
2. `<repo>/.conducted/settings.toml` is shared with the team and is committed to git.
3. `<workspace>/.conducted/settings.local.toml` is local to this workspace and is not committed.

The app excludes `.conducted/*` from git except the shared `settings.toml`. A setting the user
changes for the local machine is written to `settings.local.toml`. Shared repository settings are
read-only in the app: change them only by editing the file and committing it, when the user asks.

Settings cover the default model and effort, the branch name prefix, the scripts below, and
other per-repository behaviour. Read the files before you guess a default.

## Scripts

A repository can define three scripts in `.conducted/settings.toml` under `scripts`:

- `setup` runs once when the workspace is created, before the first chat. Use it to install
  dependencies or create files the workspace needs.
- `run` starts the project's development server or another long-running process. It may run
  alongside other workspaces, so respect `CONDUCTED_PORT`.
- `archive` runs when the user archives the workspace. Use it to stop services and clean up.

The scripts run with the same `CONDUCTED_*` variables shown above, with the workspace as their
working folder. Their output appears in the app's terminal panel. If a script fails, say so
plainly instead of silently changing it.

## Checkpoints and diffs

The app snapshots the workspace around every agent turn. Each snapshot is a real git commit under
`refs/conducted/checkpoints/` and never touches your branch, the index or your files. The bundled
`checkpointer.sh` writes these snapshots, and `git-busy-check.sh` refuses to snapshot during a
merge, rebase, cherry-pick or revert.

You do not need to call the scripts yourself. The sidecar calls them before and after each turn.
They exist so the user can see what one turn changed and revert it.

When you need to show a change, use the app tools below rather than a raw `git diff` in the chat.
The app renders diffs and comments in its review panel.

## App tools

The app serves these tools through an MCP server named `conducted`. Their names are prefixed with
`mcp__conducted__`.

- `AskUserQuestion` asks the user a question and waits for the answer. Use it when a choice
  belongs to the user instead of guessing.
- `GetWorkspaceDiff` returns the change in this workspace.
- `GetDiffComments` returns the review comments the user left on the diff.
- `DiffComment` leaves a comment on a file and line in the diff.
- `GetTerminalOutput` reads output from a terminal the app runs for this workspace.
- `UpdateProgress` reports a short progress note for the turn.
- `SetTargetBranch` records the branch this work should merge into, when the user asks.

The tools only work while the chat is live. If one is unavailable, continue with the file and
shell tools and say what you could not do.

## Git and the review flow

Keep the workspace's git history clean. Commit with a conventional subject such as `feat:`,
`fix:`, `refactor:` or `docs:`, and explain why in the body. Do not amend or force-push history
the user has already reviewed.

When the work is ready, the user reviews the diff, then the app opens or updates the pull request.
Do not merge a pull request yourself, and do not push to the default branch. If the user asks you
to open a pull request, use `gh` from `CONDUCTED_WORKSPACE_PATH`.

Do not rewrite files outside the workspace, including the main checkout in `CONDUCTED_ROOT_PATH`
and the user's home folder. The app refuses edits outside the workspace and its linked folders.

## How to work well here

- Read the repository's own `CLAUDE.md`, `AGENTS.md` and contributing guide before changing code.
- Run the repository's own checks. Do not invent commands; find them in its documentation.
- Keep changes in scope. The user asked for a specific task, and extra refactors cost review time.
- When a test fails, fix the cause instead of loosening the test.
- When you are blocked, ask the user with `AskUserQuestion` and describe what you tried.
- Report what you built, what you verified, and what you could not finish.

## Where to look next

- The repository's `docs` folder, when it has one, is the best source for its architecture and
  conventions.
- The workspace's `.conducted/settings.toml` describes the scripts this repository runs.
- The Conducted app shows the review diff, the terminal and the chat history for this workspace.

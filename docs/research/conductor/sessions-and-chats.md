# How Conductor runs agent sessions and chats

A deep dive into Conductor 0.92.1, made on 2026-11-04. The map of the whole app is [structure-map.md](structure-map.md). Sources are the sidecar's JavaScript and the React bundle, both extracted from the app, plus the live database and running processes. The detailed notes, with line references, are in this folder:

| File | Covers |
|---|---|
| [sessions.md](sessions.md) | The session core: queueing, status, events, checkpoints, restart |
| [claude-runner.md](claude-runner.md) | How Claude Code is driven: SDK options, approvals, questions, plan mode, Conductor's own tools |
| [other-runners.md](other-runners.md) | Codex, Cursor and ACP agents, and the shared runner contract |
| [frontend.md](frontend.md) | The React app: stack, routes, SQL, chat rendering, worktree creation |

The scripts in `scripts/conductor-re/` re-extract the code after an update. The extracted code itself stays in `.context/conductor-re/`, which git ignores.

## The words used here

- **Workspace**: one git worktree with its own branch. A repo has many.
- **Session**: one chat tab inside a workspace. A workspace can hold several (up to 47 on this Mac).
- **Turn**: one user message plus everything the agent does in reply, until it stops.
- **Event**: one entry in a session's log, such as a user message, one agent message or a checkpoint.
- **Runner**: the adapter that drives one kind of agent (Claude, Codex, Cursor, ACP).

## Who does what

| Layer | Owns |
|---|---|
| React UI (in the webview) | The database: it writes every message and event itself through Tauri's SQL plugin (319 SQL statements found). It also runs git through the shell: creating worktrees, archiving, PR actions. It renders chats, queues follow-ups and answers approvals. |
| Rust shell | Database migrations, terminals (PTYs), file search, binary downloads, notifications, port forwarding, file sync for cloud workspaces. |
| Sidecar (TypeScript on Bun) | Running agents: one process per chat, turn tracking, checkpoints, prompt assembly, Conductor's tools for the agent. It never writes the database. It opens it read-only for the iPhone remote-control feature. |

The two halves meet at one JSON-RPC channel. The UI calls the Tauri command `rpc_to_sidecar`. Rust forwards each line over the sidecar's Unix socket, and replies come back as the Tauri event `rpc_from_sidecar`. Both sides validate every message with Zod schemas.

## What happens when you send a message

1. **The UI stores it first.** It writes the message to SQLite as a user row with a `turn_id`, then sends `query` to the sidecar. The `query` carries the session id, agent type, message text and options (model, effort, folder, permission settings, `resume` id).
2. **The sidecar puts it on that session's queue.** Each session has its own one-at-a-time queue, so two messages for the same chat never race. A cancel skips the queue.
3. **It finds or starts the agent process.** If the chat's `claude` process is alive, it is reused. If not, it starts one with `--resume <session id>`, so the agent reloads its own history from disk. For Claude, Conductor's session id is also Claude's session id.
4. **It builds the prompt.** On the first message it adds a hidden `<system_instruction>` block to the user's text: which folder to work in, the `.context` folder for sharing files, the target branch, and to keep the final message complete. It also expands file and PR mentions and lists attachments. The system prompt itself stays Claude Code's default.
5. **It takes a "start" checkpoint** (a hidden git ref with the full working state). This never delays the reply. A hook only makes the agent's first file-changing tool wait for the snapshot.
6. **It returns at once.** The `query` call answers when the turn starts, not when it ends.
7. **Output streams back as events.** Each message from the agent becomes an event `{type:"agent", rawPayload, turnId}` with its own id. The sidecar sends them to the UI in batches of up to 50 events or 0.8 MB.
8. **The UI saves each event and confirms.** It appends the event to `session_events` (skipping duplicates by event id), then sends back `persistedSessionEvent`. Until that confirmation arrives, the sidecar keeps the event in a file on disk and resends it after a reconnect.
9. **The turn ends.** The sidecar spots the end from Claude's `result` message, takes an "end" checkpoint with a summary of changed files, flushes every remaining event, and only then reports `idle`. So the UI never shows "done" before the last message has arrived.

A session's status is only `idle` or `working`. Everything else is a separate flag: a question waiting, a plan to approve, background tasks running, steer messages not yet read, an error.

## While the agent is working

There are three ways to react to a busy agent:

- **Queue.** A follow-up waits until the turn ends. In the database it is a user row with no `sent_at` and a `queue_order`. You can edit, reorder or delete it in the UI.
- **Steer.** The message is pushed into the running turn. Claude reads it at its next step. A steer is just a `query` with `deliveryMode: "steering"`. The UI marks it as pending until the agent has really read it. Conductor knows this because Claude writes a copy of its transcript back to the sidecar (`--session-mirror`), and the steer shows up in it. Agents that cannot steer (OpenCode, Pi) get it as a normal follow-up.
- **Cancel.** It stops the turn, takes the end checkpoint and drops queued messages. For Claude, cancel kills the process: SIGTERM, then SIGKILL after 5 seconds. The next message starts a new process that resumes from disk. Codex gets an in-protocol interrupt instead.

Every async step carries a run number. When a cancel or a newer turn bumps it, late results from the old run are dropped. This is what keeps a cancelled turn from overwriting the state of the next one.

## Questions, approvals and plans

When an agent needs the user, the sidecar sends a request to the UI and waits for the answer:

| Moment | Request to the UI | Answer |
|---|---|---|
| Agent asks a question | `askUserQuestion` | Chosen options, or "cancelled" |
| Agent wants to run a tool (if approvals are on) | `toolApproval` | allow, allow edits for this session, allow with suggested rules, always allow, deny |
| Agent finishes a plan in plan mode | `exitPlanMode` | approved, or rejected with feedback |
| Codex asks for a permission or an MCP form | `codexPermissionApproval`, `codexMcpElicitation` | Grant or decline, 300 s timeout |

Locally, questions and approvals wait with no timeout. Sending a new message or cancelling withdraws them. Only one question or approval per session is open at a time.

Claude always starts in `bypassPermissions` mode and is switched live with the SDK's `setPermissionMode` when you toggle approvals or plan mode. Claude's built-in `AskUserQuestion` tool is turned off and replaced by Conductor's own tool with the same name. When the agent calls it, the tool's code simply waits for the UI's answer.

## Conductor's own tools for the agent

For Claude, these are an MCP server running inside the sidecar process (the SDK's `createSdkMcpServer`). Tool calls travel over the same stdin/stdout pipes as the chat. Codex and ACP agents reach the same tools through a small helper process and a socket for each workspace.

| Tool | What it does |
|---|---|
| `AskUserQuestion` | Structured questions with options |
| `GetWorkspaceDiff` | The same diff the user sees, against the merge base |
| `GetDiffComments` / `DiffComment` | Read and write review comments on the diff |
| `GetTerminalOutput` | Output from the run script, Spotlight or a terminal tab |
| `UpdateProgress` | The progress tracker above the chat input |
| `SetTargetBranch` | Change the branch the workspace merges into |
| `RunLocalCommand` | Cloud only: run a command on the user's Mac, after approval |

Most of these call back into the UI, which reads its database or terminals and answers. "Create PR" is not a tool. The button writes an instructions file and sends the agent a message asking it to open the PR.

## How one app supports many agents

Each agent type has a runner with the same methods:

| Method | Purpose |
|---|---|
| `warmSession` | Start the process early while you type |
| `runUserMessage` | Run one turn; resolves when the turn ends |
| `steerUserMessage` | Push a message into a running turn |
| `stopSession`, `destroySession` | Cancel the turn or end the session |
| `getSessionRuntimeStatus`, `getContextUsage` | Report state |
| `rollbackSession`, `getSlashCommands`, `getSkills`, `getMcpServers` | Agent-specific extras |

Runners report back only through callbacks (`onAgentMessage`, `onToolApproval`, `onAskUserQuestion` and others). Anything a runner cannot do throws a typed "not supported" error. Queueing, steering fallbacks, checkpoints, status and events live once, in the session manager above the runners.

| Agent | How Conductor talks to it |
|---|---|
| Claude Code | Claude Agent SDK; one long-lived `claude` process per chat, fed new messages through an async generator |
| Codex | `codex app-server --listen stdio://`, JSON-RPC (`thread/start`, `turn/start`, `turn/steer`, `turn/interrupt`) |
| Cursor | Cursor SDK inside the sidecar process |
| OpenCode, Pi, Muse | ACP (Agent Client Protocol) over stdio: `session/new`, `session/load`, `session/prompt`, `session/cancel` |

**The common message format is Claude's.** Cursor and ACP output is translated into Claude SDK messages, including renamed tools (`read_file` becomes `Read`, `shell` becomes `Bash`). ACP plans become a fake `TodoWrite` call. So one set of chat components draws three agents. Codex is the exception: it keeps its own item format and needs its own rendering.

## How processes are managed

- One process per active chat. With 8 chats busy, 8 `claude` processes run. No limit on concurrent sessions was found.
- A process idle for 30 minutes is stopped, unless it has background tasks. The sweep runs every 2 seconds.
- `warmAgent` starts a process before you send, to cut waiting time. At most 2 such unused warm processes are kept.
- A settings change that Claude cannot take live (personality, fast mode, extra folders, tool flags) restarts the process with `--resume`.
- If the app dies, the sidecar notices its parent process is gone within 2 seconds and shuts down, so nothing is left running.

## How chats are stored

Per session, four kinds of data:

| Store | Contents |
|---|---|
| `session_events` | The newer append-only log: `userMessage`, `agent` (raw agent payload), `checkpointCreated`. Each has an `event_id` and a `session_index`. Reverting a turn marks later events with `reverted_at`. |
| `session_messages` | The older log (since January 2026): one row per agent message, with the raw JSON in `content`. It is still written alongside `session_events`. |
| `session_state` | A JSON snapshot of live state (status, background tasks, pending steers) and settings (model, effort, plan mode). |
| `session_messages_outbox` | Outgoing messages with a retry state (`waiting`, `uploading`, `sending`, `failed`), mainly for cloud sessions. |

The UI groups rows into turns by `turn_id` and places sub-agent messages under the tool call that started them. The chat list is a virtualised list (`VirtuosoMessageList`) with one item per turn. While a reply streams in, only the newest turn re-renders. A registry maps each tool name to a card component (Bash, Edit, Read, Todo, sub-agent, thinking and about 30 others), with a generic card for unknown tools.

Agent history exists twice: Claude keeps its own transcript under `~/.claude/projects/`, which it uses for `--resume`, and Conductor keeps its event log for display. The sidecar keeps session state only in memory. After a restart it rebuilds from the agent's transcript and the UI's database.

## Checkpoints, revert, fork and archive

- **Checkpoints**: `checkpointer.sh save` stores the full working state as `refs/conductor-checkpoints/session-<id>-turn-<id>-start|end`. It skips during a merge or rebase. Each end checkpoint includes a list of changed files (up to 200).
- **Revert / fork**: "Revert to this version" restores a start checkpoint and marks later events as reverted. Forking a chat from a turn restarts Claude with `resumeSessionAt` and `forkSession`.
- **Archive**: snapshot uncommitted work, save the head as `refs/conductor-archive-heads/<id>`, run the repo's archive script, remove the worktree, optionally delete the branch. Unarchive restores from the saved commit.

## How a workspace is created

The UI does this through the shell, not the sidecar:

1. Pick a random city name from bundled lists (common to "legendary" rarity), skipping names in use. The branch is `<github user>/<city>` by default.
2. `git fetch origin`, then `git worktree add <path> -b <branch> origin/<base>`.
3. Set `push.autoSetupRemote` for that worktree.
4. Run the repo's setup script in a terminal, with `CONDUCTOR_WORKSPACE_PATH`, `CONDUCTOR_ROOT_PATH`, `CONDUCTOR_PORT` and similar variables.
5. The placeholder branch name is renamed later, once the agent knows what the work is.

## Weak spots found

These are worth avoiding in your own app.

- **Storage grows without limit.** `conductor.db` is 12 GB, with 3 million message rows, and every message is written twice (old and new log). `cache.db` takes 3.9 GB on disk but holds zero rows: its data was deleted and the file was never compacted.
- **The backup outbox is not a full write-ahead log.** Only one backup write per session can be in progress, so in a burst of events only the first is sure to be backed up. The main path (socket, then database, then confirmation) carries the reliability.
- **Outbox files are never removed**, one per session, even when empty.
- **A turn running when the sidecar crashes** gets no end event and no end checkpoint. The sidecar has no repair step.
- **Cancel kills Claude's process**, so each cancel costs a full restart and history reload.
- **Dead code**: a JSONL session-log writer exists but is never switched on.

## A blueprint for your own app

1. **Keep the three layers**: UI, a thin native shell, and an agent process talking JSON-RPC with schemas on both sides.
2. **Drive Claude through the Agent SDK in streaming-input mode.** One process per chat lives across turns. Follow-ups and steers are more messages on the same stream. Restart with `--resume` only for settings that cannot change live.
3. **Keep the runner small and the session manager in charge.** Write queueing, status, checkpoints and events once, above the agents.
4. **Choose your own neutral message format** (text, thinking, tool call, tool result, question, plan, usage) and translate every agent into it. Borrowing Claude's format worked for Conductor until Codex arrived and needed a second renderer.
5. **Make every human pause a request with an answer**: question, approval, plan. Withdraw them all on cancel.
6. **Give every event an id, store it before confirming, and resend until confirmed.** Write the backup before sending.
7. **Return from "send" at turn start, report "idle" only after the last event is flushed**, and drop late results from cancelled runs.
8. **Snapshot with hidden git refs** before the first write and at the end of every turn. It makes revert and fork cheap.
9. **Decide data lifetimes on day one**: keep one log, not two; prune or archive old sessions; compact the database file.

## Not verified

- The Rust side of the protocol: who restarts the sidecar, and how it handles a turn that was running during a crash.
- Whether local sessions use `session_messages_outbox`, or only cloud ones do.
- The cloud server ("Roundhouse") and sandboxes were seen only from the client side.
- How the `checkpointer.sh restore` path is called from the UI.

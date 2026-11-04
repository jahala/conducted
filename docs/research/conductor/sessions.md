# Conductor sidecar: session core

Source: `sidecar.js` (347k lines, minified names). All line numbers refer to that file as grep -n reports them.
Tags: **VERIFIED** = I read the code at the cited lines. **INFERRED** = reasoned from code or from files on disk, not directly shown.
Read-only analysis. Nothing was executed. One look at `~/Library/Application Support/com.conductor.app/sidecar-v2-session-event-outbox/` (file count and key names only, no event content).

## 0. Shape of the system in one page

```
Rust app (Tauri) <--NDJSON JSON-RPC over unix socket--> CJi (SidecarV2 server)        [313906]
                                                          |
                          sessions Map<sessionId,{workspaceDir,agentType,processKey}>  [313908]
                          workspaces Map<workspaceDir, {host: b4t, sessionStore}>     [Zqi 312275]
                          processManager N4t (leases, idle sweep, warm cap)           [313740]
                          sessionLifecycleQueues (serial queue per sessionId)         [313914]
                          sessionEventOutbox (durable file per session)               [W3r 45259]
                                                          |
                           b4t "workspace host" = PFe handlers + OFe in-memory store  [311905, 311833, 311894]
                                                          |
                    agentRunnerFactory: claude=Dat, codex=aut, cursor=zae, acp=...     [gFe 310119]
                                                          |
   Dat (Claude): one Agent-SDK query() = one `claude` CLI child per live session      [98832, startGenerator 99300]
   aut (Codex):  one `codex app-server --listen stdio://` child per live session      [Tat 99615, createSession 102884]
```

- VERIFIED: The same session core (`PFe` handlers, `bFe` session manager, `kFe` send logic) is reused by a second entrypoint that is a cloud/sandbox workspace server (lines ~339143, 340880 to 341700: Roundhouse HTTP inbox, persisted session store, Linux OOM watchdog). The local sidecar uses a plain in-memory store (`OFe`, 311894). So "session core" is host-agnostic; persistence and queueing policy are injected.
- VERIFIED: There is an older, mostly dead method surface `BGt` (5400 to 5580, instance named `ad`). Only its `request*`/`send*` helpers are used by V2 (tool approval, getDiff, plan, questions). Its `on*` registration methods and `sendMessage`/`sendCheckpointNotification` have no callers. The V2 server registers JSON-RPC methods itself in `setupJsonRpc` (314001).
- VERIFIED: The HTTP server (`r2r`, 35513) serves only `GET /v1/health` with a bearer token bootstrapped via stdin (`CONDUCTOR_SIDECAR_HTTP_BOOTSTRAP=stdin-v1`). It carries no session traffic.

## 1. Keys and identity

| Key | Meaning | Evidence |
|---|---|---|
| `sessionId` (wire name `id` in `query`/`cancel`/`warm_agent`) | One chat tab. The only key the app and sidecar share. | `PV` schema 4708: `{type:"query", id, agentType, message, prompt, options}` |
| `workspaceDir` (`options.cwd`) | The git worktree. One "workspace host" per directory. | `ensureWorkspace` 314146, `Zqi` 312275 |
| `configKey` | sha256 of executable paths, env vars, API keys, base URLs. A change recreates the host (only if no session is working). | 312239 (`Vqi` tail), 312275 to 312300 |
| `processKey` | `${agentType}:${sessionId}:${sha256({workspaceDir,configKey})[0:16]}`. Key of the OS process lease. | `d0` 44454 |
| `userMessageId` (`options.userMessageId`) | Id of the user message; also used for duplicate detection. Random UUID if absent. | 313423 (`cJi`), `kFe` dedupe 311586+ |
| `turnId` (`options.turnId`) | Names a turn and its checkpoints. Optional: no turnId means no checkpoints. | `kFe`: `w ? JH(...)` |
| `eventId` | UUID per durable event, assigned in the session manager (`crypto.randomUUID()`), used for outbox ack. | `ce()` in `bFe` ~311000 |
| `notificationIndex` | Per-session monotonic counter of manager notifications (`nextNotificationIndex`). Exposed in `get_session_status`. | `bFe`, `Dji` 312561 |
| agent session id | **Claude: equal to the Conductor `sessionId`** for a new session (`sessionId: e` passed to the SDK) and `resume: e` afterwards. **Codex/ACP: separate thread/session id**, read from the agent stream (`thread_id` / `session_id`) and stored by `setAgentSessionId`. The app also passes `options.resume`. | 99336 (SDK options), `kFe` onAgentMessage callback |

- VERIFIED: A session can change agent type. If `g.agentType !== a` the old process is disconnected and the session is re-initialized (`cJi` 313423+).
- INFERRED: The DB column `sessions.claude_session_id` (query at ~44216) is where the app stores the agent session id for all agents.

## 2. Lifecycle of a `query`

Entry: `setupJsonRpc` registers `Fu.QUERY` and `Vn.STEER` with the same handler (314010 to 314020). **`steer` is just a `query` with `options.deliveryMode:"steering"`**. Both are queued on `sessionLifecycleQueues.run(sessionId, ...)`, a serial queue per session. `cancel` is deliberately not on that queue.

`cJi` (313423), step by step. VERIFIED unless noted.

1. `k4t` registers an `AbortController` in `pendingQueries[sessionId]`. A later `cancel` aborts these. The handler checks `signal.aborted` at four stages: `workspace_setup`, `session_reset`, `session_warm`.
2. `ensureWorkspace(cwd, options)` resolves/creates the workspace host (see section 4).
3. Builds the session config `J1e(...)`: collaborationMode (`plan`|`default`), model, thinkingLevel, fastMode, requiresToolApprovals, autoPermissionModeEnabled, Codex approval policy and sandbox mode, additionalDirectories, feature flags (localExecutionMcp, getDiffComments, progressUpdates). Initial permission fields are only honored when the session is new (`y = g === undefined`).
4. Validates the model for this host (`WB({harness, model, host:"local"})`); invalid model throws `INVALID_REQUEST`.
5. If `agentParams.shouldResetGenerator` (Claude) and the session exists: `processManager.disconnect(key)` and drop the session, so the next start uses `resumeSessionAt` (fork/rollback).
6. `processManager.claimActive({key, start, disconnect})`. `start` runs only for a new entry: `host.initializeSession` (creates the in-memory session with `liveState.status:"idle"`, 310202) then `host.warmSession` (creates the generator/process, no message sent yet).
7. `host.sendUserMessage(...)` = `kFe` (311586). Details below.
8. In `finally`: `lease.release()`, then `markBusyIfIdleGenerationUnchanged` so a turn that is already running keeps the process "active" (race guard: it only marks busy if no idle transition happened meanwhile).
9. Errors: `catch` sends notification `queryError` with `{id, type:"error", agentType, error}` (`_3r` 44550). `finally` removes the AbortController.

`kFe` (send a message), VERIFIED:
- Duplicate guard: ignores the message if its id equals `runningMessageId`, or is in `pendingMessages`, `recentlyHandledMessageIds` (cap 100), or `inFlightMessageIds`.
- If session `status === "working"`: branch on `deliveryMode` (section 7).
- Otherwise start a turn:
  - emit `userMessage` event with `state:"sent"` and live state `{status:"working", pendingSteerMessageIds:[]}`;
  - `activeRunId += 1` (`jH`, 310404); remember `currentTurnRunId`, `runningMessageId`, `currentTurnId`;
  - wait for the previous turn's end checkpoint (`VUi`) and start checkpoint (`YUi`);
  - take the **start checkpoint** (section 8);
  - call `runner.runUserMessage({... callbacks ...})`. **This promise is not awaited by the RPC.** `kFe` returns `{type:"sendUserMessageResponse"}` as soon as the turn is launched. The turn promise is stored in `session.inFlightTurnChain`.
  - on resolve: if `currentTurnRunId` still equals this run, clear `runningMessageId`/`currentTurnId`, call `onTurnEnded` hook, take the **end checkpoint**, then `y4t`.
  - on reject: `Wo` (SessionCancelledError) sets liveState `{status:"idle", error:"aborted by user" | "system_interrupt:<reason>", backgroundTasks:[], pendingSteerMessageIds:[]}`; any other error sets `liveState.error` (OOM attribution on Linux only) and the notification pipeline turns that into `queryError`.
  - `y4t` (311562): `await manager.waitForNotifications()` (flush all queued events first), call optional `onReadyForQueuedMessages`, and if nothing is running set `status:"idle"` and pop the next queued message with `_4t` (311549). Result: the UI never sees `idle` before the turn's last event.
- Stale-result guard: every continuation compares `session.currentTurnRunId !== runId` and drops itself if a cancel or a newer turn bumped `activeRunId`. This is the "only the newest async result changes state" rule.

### Status and state literals

| Where | Values |
|---|---|
| `liveState.status` and `session_status_notification.status` | `"idle"`, `"working"` (`aVu` in 4708) |
| `get_session_status` reply | `"working"`, `"idle"`, `"unknown"` (unknown session, workspace or manager) (`cVu` 4708, `Dji` 312561) |
| `userMessage` event `state` | `"queued"`, `"sent"` |
| `liveState` extras | `error`, `fastModeAvailable`, `activeQuestions`, `activeUserInteraction` (`question`, `mcpElicitation`, `codexPermissionApproval`), `proposedPlan`, `backgroundTasks`, `waitingSince`, `pendingSteerMessageIds` |
| Process entry state | `"starting"`, `"live"`; retention `"warm"`, `"active"` (313740+) |
| Checkpoint type | `"start"`, `"end"` |
| App DB queue (`session_messages_outbox.state`) | `waiting`, `uploading`, `ready`, `sending`, `cancelling`, `failed`; mode `queue`/`steer` (44300 to 44330, zod at `zYe`) |
| Codex goal status | `active`, `paused`, `blocked`, `usageLimited`, `budgetLimited`, `complete` |
| Cancel reasons | `systemReason` `"config_change"`, `"shutdown"` |

So the state machine is tiny: `idle <-> working`, plus orthogonal flags (pending interaction, background tasks, error). VERIFIED.

Turn boundary detail (Claude), VERIFIED 99300 to 99560: the sidecar treats the SDK `result` message as turn end, but with care. It tracks `awaitedTurnUserMessageUuids` (the uuid of every message it injected), ignores `result` messages for turns it did not start ("foreign result"), suppresses a result while injected steers are not yet consumed, and arms a **settlement watchdog of 120 000 ms** (`n8a`, 99544) that force-resolves the turn if a result was ignored and no follow-up turn started. Background-task notifications ("mini results") are not turn boundaries. The CLI is launched with env `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1` (91213 and `getClaudeLaunchOptions`), and `system/session_state_changed` events drive `onInProgressChanged`, so turns started by the CLI itself (background task wakes) also flip `working`/`idle`.

## 3. Process management

### Claude (Dat, 98832)
- VERIFIED: One live generator per session in `liveSessions: Map<sessionId, live>`. A generator is `queryFn({prompt: asyncGenerator, options})` from the bundled Claude Agent SDK; the SDK spawns the `claude` binary with `--output-format stream-json --verbose --input-format stream-json` plus `--resume <id>` (96656 to 96711; `--resume-session-at` at 96760). The prompt is an async generator that yields `{type:"user", message, session_id, uuid}` whenever `sendMessage` is called, so the CLI stays alive between turns (streaming input mode).
- VERIFIED SDK options (99336): `permissionMode:"bypassPermissions"` always; approvals are done in the `canUseTool` callback (SDK passes `--permission-prompt-tool=stdio`); `maxTurns:1000`; `settingSources:["user","project","local"]`; `systemPrompt:{preset:"claude_code"}` plus Conductor additions; built-in `AskUserQuestion` is disallowed and aliased to the MCP tool `mcp__conductor__AskUserQuestion`; an in-process MCP server named `conductor` provides AskUserQuestion, GetWorkspaceDiff, DiffComment/GetDiffComments, GetTerminalOutput, UpdateProgress (`z1` 52539, `AYr` 98471); `sessionStore` with `sessionStoreFlush:"eager"` mirrors the transcript.
- VERIFIED spawn (new session): `{sessionId: e}`. Existing: `{resume: e}` if `startedSessionIds` has it or a transcript exists on disk (`hasResumableTranscriptOnDisk` 99034, which also renames an empty transcript to `.stale`). Fork/rollback: `{resume, sessionId, resumeSessionAt, forkSession:true}`; `rollbackSession` just stores `pendingResumeSessionAts` and stops the generator (99188).
- VERIFIED restart without losing the turn: `reconcileSessionConfig` (98971) recreates the generator when config changes in a way the running CLI cannot absorb, when managed credentials changed, or when a brokered OAuth token is near expiry. It moves `resolveTurn`/`rejectTurn` to the new generator.
- VERIFIED kill: `stopLiveGenerator` (99123): rejects the turn with `Wo`, deletes the live entry, calls `stopGenerator()` and `abortController.abort()`. The SDK transport then sends **SIGTERM, and SIGKILL after 5 s** if the child is still alive (96893 to 96897). **Cancel for Claude means kill the process, not an in-band interrupt** (no `interrupt()` call exists in `Dat`). The next message respawns with `--resume`.

### Codex (aut) and Cursor
- VERIFIED: Codex runs `codex app-server --listen stdio://` per live session (`Tat.start` 99615 ff, `createSession` 102884) and talks JSON-RPC through `Iat` (the "JsonRpcAdapter", 99677; it is the sidecar to codex-app-server channel, not the sidecar to app channel). It recreates the process if the transport closed between turns (102461). Cancel uses `thread.interrupt(activeTurnId)` then `abortController.abort()` (102780 ff), so Codex does get an in-band interrupt.
- VERIFIED: Cursor uses the Cursor SDK in-process (`zae`, ~309925); no child process owned by the sidecar. `stopSession` calls `run.cancel()`.

### Process manager N4t (313740)
- VERIFIED: Entry per `processKey` with `activeLeases`, `retention`, `lastIdleAt`, `idleGeneration`, `state`.
- `claimActive` (lease +1, retention `"active"`) is what `query` uses. `ensureWarm` (retention `"warm"`) is what `warm_agent` uses.
- `markBusy`/`markIdle` are called from the notification handler when live state status flips (313190 area in `iJi`). `markIdle` bumps `idleGeneration` and stamps `lastIdleAt`.
- **Idle timeout: 30 min** (`EJi = 1800000`, 314188). Sweep runs every **2 s** from the parent watchdog interval (313940). A process is skipped by the sweep while the session has background tasks (`tji` 312312 via `zH`).
- **Warm cap: `maxWarmProcesses: 2`** (313913). `enforceWarmProcessCap` (313860) only counts entries with `retention==="warm"` and 0 leases, and disconnects the least recently idle beyond 2.
- INFERRED consequence: once a session has had a real turn its retention stays `"active"`, so the cap of 2 applies only to pre-warmed, never-used agents. Used-but-idle sessions are bounded only by the 30 min timeout.
- **No concurrency limit** across sessions was found (grep for concurrency/max in the scoped ranges: nothing). N chats working = N CLI processes. VERIFIED absence in the scoped ranges; INFERRED overall.
- `disconnect(key)` calls the entry's `disconnect` closure = `ng` (44463) = `host.stopSession({destroySession:true})` + `sessions.delete`. The in-memory manager is then dropped from the store.

### `warmAgent` / `resetGenerator`
- `warm_agent` (`qFe` 312983, registered 314055): same setup as `query` minus the message. Runs on the session lifecycle queue, errors are only logged. If the model is invalid for this host it warms with the default model and logs. Purpose (INFERRED): spawn the CLI and load MCP servers while the user is still typing, so first-token latency drops. Warm sessions use `permissionMode:"default"`.
- `reset_generator` (`Fu.RESET_GENERATOR`, 314109): `S4t(..., destroySession:true)` on the lifecycle queue: disconnect process, delete session, delete manager. Next `query` starts clean (with `resume` if the app passes one).
- `stopAll` and shutdown: `shutdownAllWorkspacesAndExit` (314171) calls `host.stopAll({systemReason:"shutdown"})` for every workspace, flushes the outbox, closes HTTP and socket, `process.exit(0)`. Tqi (311752) waits up to 10 s (`zCu`) for in-flight turns.

## 4. Workspace hosts

- VERIFIED `Zqi` (312275): per `workspaceDir` serial queue. Reuses the host if `reuseExistingHost` or `configKey` matches. On mismatch it **defers** recreation while any session is working or has background tasks; otherwise stops all, prunes sessions, builds a new host reusing the old store.
- VERIFIED: `ensureWorkspace` also starts a per-workspace Conductor MCP bridge (`_X`, 314150 area) used by Codex for local execution; failure only logs.

## 5. Message flow: agent output to the UI

Pipeline, VERIFIED:

1. Runner callback `onAgentMessage(msg)` (inside `kFe`) calls `manager.notify({newEvents:[{type:"agent", rawPayload: msg, userMessageId, turnId}]})`. For Claude `rawPayload` is the raw SDK stream-json message (zod-parsed with `Xo`). Result messages get `conductor_sdk_metadata` (model, fast mode, tier, `marginalCostUsd`).
2. `bFe.notify` (`ce`, ~311000): assigns `notificationIndex`, assigns a UUID `eventId` to each event, pushes onto `pendingNotifications`, and starts a single-flight drain loop.
3. Drain `Re`/`Ce` (310830 to 310900): **batches** consecutive notifications into one `sendNotification` call, up to **50 events** (`CCu`) or ~**838 860 bytes** (`i4t = floor(1 MiB * 0.8)`). A notification carrying `updatedLiveState` or `updatedConfig` ends the batch. Oversize payloads are truncated by `ZUi` (310560), but the truncation field list `pCu` only knows **Codex item types** (commandExecution output, mcpToolCall result, fileChange diff, ...). Claude messages are not truncated here (VERIFIED by reading `pCu`).
4. `sendNotification` for the local host is `iJi` (313130). Retries on throw with delays `[250, 1000, 5000, 15000, 30000, 60000]` ms (`_Cu`, 311134); a non-retryable `Nt` error drops the batch (the dropped events go to a 1000-entry `skippedNotifications` buffer).
5. `iJi` fans out to the app over the socket:
   - for each event whose type is `agent`, `userMessage` or `checkpointCreated` (`Qji` 313299; these are the **durable** types): notification `sessionEventNotification` = `{type:"session_event_notification", id: sessionId, event, runnerEvent}`;
   - for live-state/config changes: `sessionStateNotification` `{id, updatedLiveState, updatedConfig}`;
   - when status, backgroundTasks, waitingSince or pendingSteerMessageIds change: `sessionStatusNotification` `{id, agentType, status, backgroundTasks?, waitingSince?, pendingSteerMessageIds?}`;
   - `liveState.error` becomes `queryError`; `fastModeAvailable:false` becomes `fastModeUnavailableNotification`; switching into plan mode becomes `enterPlanModeNotification`;
   - a proposed plan triggers sidecar-to-app **request** `exitPlanMode`; active questions trigger `askUserQuestion`; Codex MCP elicitation and permission approval use requests with a 300 s timeout (`FGt`). If the app is disconnected, plan resolves `approved:false, feedback:"Frontend disconnected"`, questions resolve to `[]`, and MCP/permission prompts auto-resolve as `interaction_unavailable` (`Mwu` 313249).
   - `processManager.markIdle/markBusy` is driven from this same function.
6. Tool approval for Claude does not go through live state: `canUseTool` calls `onToolApproval` which sends request `toolApproval` (no timeout) and maps the answer (`allow`, `allow_edits_for_session`, `allow_with_permissions`, `always_allow`, `deny`) to SDK permission updates (99336).

### Durable event outbox (the "sequence numbers")
- VERIFIED `W3r` (45259): one JSON file per session in a directory; file name is `base64url(utf16le(sessionId)).json` (`H3r` 45209). Content `{version:1, sessionId, nextSequence, pending:[{sessionId,eventId,eventType,event,workspaceDir,notificationIndex,sequence,persistedAt}]}` (zod 45200). The default root is `~/.conductor/sidecar-v2-session-event-outbox`, overridden by `CONDUCTOR_SESSION_EVENT_OUTBOX_ROOT`; the directory the app really uses is `~/Library/Application Support/com.conductor.app/sidecar-v2-session-event-outbox` (INFERRED that the app sets the env var; 49 files seen there, all with `pending:0`, `nextSequence` between 7 and 23).
- Writes are atomic: write `*.tmp` with mode 0600, fsync, rename, fsync the directory. If the directory fsync fails the session is marked `durabilityUncertain` and blocked. Corrupt files block that session (`corruptPersistedState`) instead of being deleted.
- `sequence` is per session and strictly increasing. Acknowledgement is **head-only**: you can only ack the oldest pending entry (`notHead` otherwise).
- Live path (`iJi`, `Zji` 313307): every durable event is both sent live and enqueued to the outbox (fire and forget, 1 s timeout `Pwu`). If the outbox misbehaves, `disableBackup()` turns the whole backup off for the process lifetime and logs. The app, after it has written the event to its own SQLite, sends notification **`persistedSessionEvent {sessionId, eventId}`** (`Fu.PERSISTED_SESSION_EVENT`, handler 314002). `sJi` (313322) records the ack and `removeAcknowledgedHeads` pops acked heads from the outbox.
- Replay path: `handleConnection` (313975) and outbox initialization call `replaySessionEventOutbox` (`aJi`, `qwu` 313353): for each session with pending entries, one at a time, send **request** `deliverSessionEvent` (`oh.DELIVER_SESSION_EVENT`, timeout `Kji` = 10 s) and wait up to 10 s for the matching `persistedSessionEvent` ack.
- If no app is connected, `iJi` still enqueues events to the outbox and answers `{}`.
- INFERRED: the app dedupes by `eventId`, so replay is at-least-once.
- Observation, VERIFIED reading but consequence INFERRED: `tryStartBackupEnqueue` (45564) returns false while another enqueue for the same session is in flight, and `iJi` loops through all events of one batch synchronously. In a burst only the first event of a batch is guaranteed to be enqueued; later events in that same batch skip the backup and their acks are ignored (`recordAcknowledgement` requires an accepted event). So the outbox is a best-effort backup, not a full write-ahead log. The primary path (socket notification, then app writes SQLite) is the real durability.
- Lifetime: outbox files are never deleted when empty (only `*.tmp` files are removed); the directory grows by one small file per session. VERIFIED by reading `W3r`; matches the 49 files with empty queues.
- Dead path: `persistSessionLogs = false` is a field initializer and is never set (313921; used at 313149 and 313426). The JSONL session log store (`j3r` 45124, `~/.conductor/sessions/<workspaceDir with / as -->/<sessionId>.jsonl[.gz]`) therefore never runs. VERIFIED.

### Does the sidecar write the SQLite DB?
- VERIFIED: **No writes.** `CONDUCTOR_DB_PATH` (`eKe`, 37319) is opened **read-only** with `node:sqlite` (`new DatabaseSync(path,{readOnly:true,timeout:5000})`, 37322). Its only consumer is the remote-control feature (`eQe` 44930, `m3r` ~44370). Queries cover `workspaces`, `sessions` (id, workspace_id, agent_type, claude_session_id, model, codex_thinking_level, claude_effort_level, fast_mode, is_hidden, title), `repos`, `session_messages`, `session_messages_outbox`, `session_messages_outbox_state`, `local_workspace_revision_counter`, `local_workspace_deletion_tombstones`, and session events (44040 to 44440).
- The two `bun:sqlite` imports (273, 635) belong to the bundled Cursor SDK local store, not Conductor data.
- So the Rust app owns `conductor.db`: it persists events from `sessionEventNotification`, owns the queued-message table `session_messages_outbox`, and acks via `persistedSessionEvent`. Anything the sidecar needs from the app beyond that goes through requests such as `frontendRelay` (e.g. `remoteControlCreateSession`, `remoteControlComposerSend`).

## 6. User input during a turn

All VERIFIED in `kFe` 311586+ unless noted.

- **Default delivery while `working`** (`deliveryMode:"default"`): the message is pushed to `session.pendingMessages` in memory and a `userMessage` event with `state:"queued"` is emitted. When the current turn finishes, `y4t` then `_4t` pops it and calls `kFe` again (which emits `state:"sent"` and starts the turn). A failed queued message is logged and the next one is tried.
- **`steer`** (`deliveryMode:"steering"`, 311598): calls `runner.steerUserMessage`.
  - Claude (99062): pushes another user message into the same generator stdin (`sendMessage`) with a fresh uuid, adds it to `awaitedTurnUserMessageUuids` and `unconsumedSteerUserMessageUuids`. If tools are running and the transcript already has content, it returns an `agentReceived` promise. The sidecar puts the message id in `liveState.pendingSteerMessageIds` until the agent consumes it (`GCu` 311574), so the UI can show it as "pending steer".
  - If the runner says there is no active turn (`yh`, NoActiveTurnError) and the session really stopped, the steer is rejected ("Steering arrived after the session was stopped; not falling through"). If it raced with turn completion, it falls through to a new normal turn.
  - Cursor: `run.steer()`; `aX` (SteerRevertedToFollowUpError) makes `kFe` recurse as a default message.
  - After the steer is accepted: `cancelPendingInteractions()` (an open question or plan is cancelled), config update applied, `userMessage` event emitted.
  - `cJi` waits for `waitForNotifications()` after a steer so the RPC returns after the event is flushed (313470).
- **Cancel** (`Vn.CANCEL`, `S4t` 312325, runs `Rqi` 311777 in the host): aborts pending `query` controllers first, so a query still in setup never sends. Then `jH` bumps `activeRunId` (invalidates in-flight continuations), takes the **end checkpoint** for the running turn, clears `runningMessageId`, `currentTurnId`, **drops all queued `pendingMessages`**, cancels pending questions/plans, and calls `runner.stopSession`. With `expectsTerminalResponse`, if no live runner will report the end, it sends the idle status itself. `systemInitiated` with reason `config_change`/`shutdown` yields `error:"system_interrupt:<reason>"`.
- **Interrupt vs kill**: Claude is killed (section 3). Codex is interrupted in-band, then aborted.
- **`updatePermissionMode`** (314095 area): toggles `collaborationMode` plan/default via `updateSessionConfig`; `setClaudeEditAutoAccept` sets `autoApproveEditsForSession` on the live Claude generator.
- **Answering questions/plans**: `answerUserQuestion` (`Tji` 312574, also accepts a question snapshot to detect stale answers: reply `{ok, superseded, sessionGone}`), plan response via `respondToPlan`. Plan approval with feedback is stored as a `userMessage` event with id `plan-feedback:<id>` (310996).
- **App-side queue**: the persistent follow-up queue the user sees lives in the app DB (`session_messages_outbox`, states and `queue_order`, with a per-session pause flag in `session_messages_outbox_state`). INFERRED: the app sends `query` when it releases an item and uses `steer` for items in `steer` mode. The sidecar's `pendingMessages` is an in-memory second line; the app does not appear to rely on it.

## 7. Checkpoints

VERIFIED (310248 to 310450, `kFe`, `Rqi`).

- Id: `session-<sessionId>-turn-<turnId>-<start|end>` (`Hae` 310248). Git ref: `refs/conductor-checkpoints/<id>` (`GUi`).
- Command: `$CONDUCTOR_INTERNAL_BIN_DIR/checkpointer.sh save --id <id> --force` in the workspace dir, spawned detached (`HUi` 310270). If the env var is not set, the checkpoint is skipped and logged.
- Timeout 60 s (`aCu`), then SIGTERM to the process group and SIGKILL 5 s later (`uCu`). Exit 0 = created; **101** = skipped (merge or rebase in progress); **102** = skipped (index has unresolved conflicts); anything else = failure logged.
- On any non-success the sidecar still emits `checkpointCreated` with no `checkpointId`/`refPath`, so the UI knows the turn boundary but has no restore point.
- Event: `{type:"checkpointCreated", turnId, checkpointType, checkpointId?, refPath?, diff?}` is a **durable** event type (goes through the outbox).
- End checkpoints also compute a diff summary: `checkpointer.sh diff <startId> <endId> -- --name-status` and `-- --numstat`, parsed to `[{path,status,linesAdded,linesRemoved,isBinary,oldPath}]`. Over **200 files** (`oCu`) the diff is omitted.
- When:
  - **Start**: in `kFe` right after emitting the user message and before the runner is called, only if a `turnId` was given. Stored as `checkpointState.pendingStart`.
  - Claude: the pending start promise is handed to the runner. A `PreToolUse` hook awaits it before any tool outside the read-only allowlist (`Read, Glob, Grep, ToolSearch, LSP, TaskGet, TaskList, TaskOutput, WebFetch, WebSearch, CronList, EnterPlanMode`) runs (99396). So the snapshot never delays the model's first tokens, but always precedes the first write.
  - Codex: a per-session gate `mXr`/`hXr` (102030) does the same job.
  - **End**: on turn success, on turn failure (if no end checkpoint is pending), and on cancel (`Rqi`). Serialised through `Wae`, which first awaits the pending start. The next turn awaits `pendingEnd` and `pendingStart` before starting (`VUi`, `YUi`).
  - Shutdown does not take a checkpoint.
- Restore is not in this scope (no `restore` call found in these ranges).

## 8. Resume after restart or crash

- VERIFIED: **Session state in the sidecar is in-memory only** for the local host (`OFe` = a `Map`; `flushPendingWrites` is a no-op, 311894). A sidecar restart loses `sessions`, `pendingMessages`, `liveState`, and all processes. The cloud variant rehydrates sessions from a persisted store (339143), which shows what the local one lacks.
- VERIFIED sidecar self-protection: parent-PID watchdog every 2 s: if `process.ppid` changes the sidecar shuts down (313940), so a dead app does not leave orphans. SIGINT/SIGTERM trigger the same graceful shutdown. `uncaughtException` and `unhandledRejection` handlers log and report to Sentry instead of exiting (registered in the module init block after 314188).
- VERIFIED: New sidecar process reads the outbox directory at start (45259 to 45330) and replays pending events when the app connects (313975). Each connection also re-registers all RPC methods, so the app can reconnect to a living sidecar without it losing sessions (`handleConnection` replaces `rpcTunnel`; `U3r` only clears it if the closed tunnel is still the active one). Pending requests are rejected with "Frontend RPC tunnel stopped".
- VERIFIED: `get_session_status` (`Dji`) lets a reconnecting app ask whether a session is `working`/`idle`/`unknown`, plus `nextNotificationIndex`, `pendingSteerMessageIds`, `activeQuestions`. `unknown` means the sidecar has no such session (restarted).
- VERIFIED agent-side continuity: Claude resumes from its own transcript on disk via `--resume <sessionId>` (`hasResumableTranscriptOnDisk`); Codex resumes `resumeThread(threadId)` and falls back to `startThread` if resume fails (102906). The app supplies `options.resume` on `query`.
- INFERRED: after a sidecar crash the app marks the session idle from its own DB state, re-sends `warm_agent`/`query` with `resume`, and uses the replayed outbox events plus `eventId` dedupe to fill gaps. The Rust side was not examined.
- Gap, VERIFIED: a turn that was mid-flight when the sidecar died has no end event and no end checkpoint; nothing in this file repairs that. The app must.

## 9. Other notable things

- **Watchdogs**: parent PID (2 s); idle process sweep (same tick, 30 min idle); Claude turn settlement 120 s; frontend event ack 10 s; checkpoint 60 s; notification "has not settled" log every 60 s (`SCu`); outbox init 1 s then continue without backup; outbox close 1 s at shutdown; cloud-only OOM watchdog reading `/proc/vmstat` and `/tmp/conductor-memory-watchdog-incident.json` (98500 to 98620; no-ops on macOS).
- **Keep-awake**: `Ju.KEEP_AWAKE` (`keepAwake`) is sent every 5 s (`Xeo`) **only while a remote-control relay request to the app is pending** (`bSr.beginPendingRequest`, 37222 to 37292). It is not tied to agent turns in the sidecar; the app presumably handles turn-based sleep prevention itself (INFERRED, from `sessionStatusNotification`).
- **Remote control** (iPhone): `eQe` (44930) is a host that pairs phones with static keys and talks through a relay; it reads `conductor.db` read-only to list workspaces/sessions/events/queue and forwards actions (`remoteControlComposerSend`, `Cancel`, `Steer`, `SetPaused`, create workspace/session, archive) back to the **app** through `frontendRelay` requests (`oh.FRONTEND_RELAY`, default timeout 60 s, `Qeo`). So a phone message takes the same app-owned path as a desktop one. Model overrides from a phone are checked against what this Mac can run (`L1e` ~44350).
- **Multi-sender messages**: `userMessage` events carry optional `senderId`, `senderSessionId`, `senderApiKeyName`, `senderSource` (`{kind:"slack", url, label}` only; 37146). The local `cJi` never sets them. They come from the cloud inbox path (340880 ff) for messages sent through the public API / `conductor` CLI / Slack. The agent system prompt for API-enabled sandboxes tells the agent it can "start agent sessions, send them prompts, read their replies" with the `conductor` CLI (`sqi` 311173), so agents driving other sessions exists as a cloud feature. A text-injection guard strips `<conductor_message_sender` tags from user text (`h4t` 311277). Local agent to agent messaging: **not found** in scope.
- **Message enrichment** (`IFe` 311445): when `localMessageEnrichment` is given, the sidecar itself builds the final agent message: resolves `@⟦name⟧(path)` file mentions, writes `.context/pull-requests/<n>.md` stubs for `#⟦..⟧(pull-request:n)` mentions, lists attachments in `<system_instruction>` blocks, adds linked directories (Codex only), and on the first message prepends the Conductor system instruction (workspace dir, `.context` dir, target branch, "don't rename branch") and user preferences. So prompt assembly is a sidecar job, not an app job.
- **Per-session GitHub auth**: tokens per session and per message are registered with a broker (`githubAuthBroker`, `Bqi` 311542) and cleared at turn end; the agent process gets a refreshed `GH_TOKEN` from `getGitHubAuthEnv(sessionId)` at spawn.
- **Env passed to every Claude spawn** (98960 area): `CONDUCTOR_SESSION_ID`, `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1`, shell env captured by the sidecar (`warm_shell_env`/`get_shell_env`), plus Conductor env from the app.

## 10. Wire contract summary (sidecar side)

App to sidecar: requests/notifications `query`, `steer`, `cancel`, `warmAgent`, `resetGenerator`, `getSessionStatus`, `answerUserQuestion`, `updatePermissionMode`, `setClaudeEditAutoAccept`, `contextUsage`, `fetchSlashCommands`, `fetchAvailableMCP`, `claudeAuth`/`codexAuth`/..., `codexRollback`/`codexCompact`/`codexGoal*`, `persistedSessionEvent` (ack), `remoteControl*`, settings setters (verbose logging, PostHog id, model catalog, ...).
Sidecar to app: notifications `sessionEventNotification`, `sessionStateNotification`, `sessionStatusNotification`, `queryError`, `enterPlanModeNotification`, `fastModeUnavailableNotification`, `keepAwake`, `remoteControlState`, `harnessVersionsNotification`, `shellEnvCaptureNotification`, `codexMcpConsentDeliveryFailed`; requests `deliverSessionEvent`, `toolApproval`, `askUserQuestion`, `exitPlanMode`, `getDiff` (20 s), `getDiffComments`, `diffComment`, `getTerminalOutput`, `codexMcpElicitation`/`codexPermissionApproval` (300 s), `frontendRelay`.
Framing: one JSON-RPC message per line (`handleConnection` splits on `\n`, 313975); library `json-rpc-2.0` `JSONRPCServerAndClient` (`MVe` 36914). Errors become code `-32000` with the serialized error as data.

## 11. What to copy, what to change (for a remake)

1. Keep the three-layer split: transport (JSON-RPC peer), session manager (event queue, live state), runner (agent adapter). Runners expose `warm / runUserMessage / steer / stop / destroy / status`; the rest is agent-agnostic.
2. Use the Claude Agent SDK streaming-input mode (async generator prompt) so one CLI lives across turns and steering is just another message.
3. Make `query` return when the turn **starts**; signal completion with `status:idle` after flushing events. Both idle-after-flush and run-id stale guards are cheap and matter.
4. Event ids and one durable ack protocol (`eventId` + head-only ack) are worth copying, but make the outbox write-ahead (enqueue before sending) and not best-effort; the single-flight gate in `tryStartBackupEnqueue` is a weakness.
5. Decide the owner of persistence early. Conductor's choice (app owns SQLite, sidecar read-only) keeps the sidecar disposable, at the cost of the outbox, the replay protocol and in-memory-only session state.
6. Cancel by killing the Claude process is simple and robust but costs a respawn plus `--resume` per cancel; Codex shows the in-band alternative.

## 12. Not verified / out of scope

- The Rust side: who restarts the sidecar, who sends `persistedSessionEvent`, how `session_messages_outbox` rows are released to `query`/`steer`, and how it prevents sleep during turns.
- `v8a(I)` (filter on which SDK messages are forwarded as `agent` events) and `Xo` schema contents were not read.
- Restore of checkpoints (`checkpointer.sh restore`) and the shell script itself.
- The cloud entrypoint (339000 to 341700) was only skimmed to confirm it shares the session core.
- ACP and Cursor runner internals beyond the lifecycle surface.

# Conductor sidecar: Claude runner notes

Source: `sidecar.js` (line numbers refer to it). VERIFIED = read in code at the cited lines. INFERRED = deduced, not directly shown.
SDK in the bundle reports version `0.3.308` (line ~82326, `CLAUDE_AGENT_SDK_VERSION`).

## 0. Map and scope corrections

| Thing | Where | Notes |
|---|---|---|
| Claude runner class `Dat` (log tag `[ClaudeAgentRunner]`) | 98832-99538 | One instance per workspace dir. Holds `liveSessions: Map<sessionId, live>` |
| Runner factory (claude/codex/cursor/acp) | 310120-310135 | `get("claude")` returns the `Dat` instance |
| Session manager (Conductor-side session state, pending questions/plan, notification outbox) | 310600-311130 | Not the SDK SessionStore |
| Handlers (`sendUserMessage` = `kFe`, steering, etc.) | 311586-311760, 311845 | Wires runner callbacks to the session manager |
| Local-app RPC (sidecar to Mac app JSON-RPC over stdio) | 5380-5460 (`BGt`, method names `oh`), 313140-313260 | |
| Cloud RPC broker (frontend RPC with timeouts) | 314483-314620 | Used in sandbox/cloud mode |
| Conductor tools (`z1`) + MCP bridge | 52027-52600 | |
| SDK `query()` (`HKr`) | 82445 | SDK code, not Conductor |

Scope corrections (all VERIFIED):
- `TranscriptStore` (`M2t`, 151455) and `LocalTranscriptWriter` (`A7t`, 153843) belong to the bundled Cursor agent runtime (they operate on `conversationState` and a `blobStore`). They are not on the Claude path. Same for `OutputSuppressionController` (119975): it throttles shell output in the sandboxed shell executor (exported in module at 254061 with `NaiveTerminalExecutor`, `BashState`). Not Claude-specific.
- The `SessionStore` at 82284-82440 is the Agent SDK's own storage-adapter feature, not a Conductor class. Conductor passes a tiny custom adapter (see section 6).
- The `cmcp-<hex>-<rand>/s` Unix-socket server is NOT how Claude gets its tools. Claude gets an in-process SDK MCP server (section 4). The socket bridge serves Codex and ACP agents (section 4.3).

## 1. How the runner calls the Agent SDK

`queryFn = HKr` (the SDK's `query`, default in the constructor, 98866-98870 region). Called in `startGenerator` (99300), `b = this.queryFn({ prompt: m, options: v })` at ~99397.

### 1.1 Prompt is an async iterable (streaming input) (VERIFIED)
99307-99316: a hand-written `async function*` (`m`) with a queue `d` and a resolver `p`. It loops `while (!f)`, awaits the next pushed message, and yields:
```js
{ type: "user", message: { role: "user", content: T.text }, parent_tool_use_id: null, session_id: e, uuid: T.userMessageUuid }
```
`sendMessage({text, userMessageUuid})` (99398-99403) pushes onto the queue or wakes the waiting resolver. `stopGenerator` sets `f = true` and wakes the generator with an empty message so it ends (99410-99414).
So one `claude` process lives for the whole chat, and every follow-up or "steer" is pushed into the same stdin stream (SDK `streamInput`, 82426 `GKr`). The content is a plain string (attachments are inlined as text, section 5).

A second generator type `GYr` (98753) is a never-yielding prompt used for "metadata" queries (slash commands, MCP status, account info, context usage of a non-live session).

### 1.2 Options passed to `query()` (VERIFIED, 99336-99397, object `v`)
| Option | Value |
|---|---|
| `abortController` | new per generator; `stopLiveGenerator` aborts it (99134) |
| `pathToClaudeCodeExecutable` | from launch options; may be an exe-proxy path (`B8a`, 98809) and `.js` paths are launched via `process.execPath` (`hat`, 98351) |
| `cwd` | `this.workspaceDir` (the worktree) |
| `env` | `{...launchEnv, CLAUDE_CODE_ENABLE_OPUS_4_7_FAST_MODE: "1"}` (see 1.3) |
| `sessionStore` + `sessionStoreFlush: "eager"` | custom no-op adapter, see section 6. This is what turns on `--session-mirror` |
| resume / session id | `resumeSessionAt` set: `{resume: r ?? e, sessionId: e, resumeSessionAt, forkSession: true}`; else `resume` set: `{resume}`; else `{sessionId: e}`. Conductor's session id is used as the Claude session id (`--session-id`) |
| `model` | `aM(config.model, {env: modelRoutingEnv})`, maps catalog id to wire name (5975) |
| `thinking` | `WKr` (98185): `none` -> `{type:"disabled"}` (or omitted if model rejects disabled); adaptive models -> `{type:"adaptive", display:"summarized"}`; others -> `{type:"enabled", budgetTokens, display:"summarized"}` |
| `effort` | `pve` (98195): `none` -> undefined, `ultra` -> `"max"`, else the level as is |
| `permissionMode` | always `"bypassPermissions"` at spawn. The real mode is applied right after via `setPermissionMode` (see section 3.4) |
| `systemPrompt` | `y8a` (98748): `{type:"preset", preset:"claude_code"}`; with the progress-tracker feature adds `append: <pizza-tracker text>` and `snapshot:false` |
| `settingSources` | `["user","project","local"]` (`wat`, 99603) |
| `plugins` | `[{type:"local", path: $CONDUCTOR_INTERNAL_SKILL_PLUGIN_DIR}]` plus optional computer-admin skill dir (98470-98510, `getConductorSkillPlugins`). Becomes `--plugin-dir` |
| `maxTurns` | `1000` |
| `additionalDirectories` | `config.additionalDirectories ?? []` (`--add-dir`) |
| `disallowedTools` | `["AskUserQuestion"]` (built-in tool turned off) |
| `toolAliases` | `{ AskUserQuestion: "mcp__conductor__AskUserQuestion" }`. Sent in the SDK initialize request (97433) so the CLI presents the Conductor MCP tool in place of the built-in one. Exact CLI semantics INFERRED |
| `settings` | `$Kr` (98200): JSON with `outputStyle` (personality: Proactive/Concise/Explanatory/Learning), `fastMode`, `ultracode`, only when set |
| `extraArgs` | `{chrome: null}` when `chromeEnabled` (`--chrome`) |
| `stderr` | callback: drops `[DEBUG]` lines; detects "Fast mode requires extra usage billing" -> `onFastModeUnavailable`; logs the rest as `[ClaudeAgentRunner:stderr]` |
| `canUseTool` | see section 3 |
| `hooks` | one `PreToolUse` hook, see 1.4 |
| `mcpServers` | `buildMcpServers` (98957): user/cloud MCP servers converted to `{type:"http", url, headers}` (`T8a`/`I8a`, 98825-98832) plus `conductor` SDK server (section 4) |

NOT set (VERIFIED by absence in `v`): `includePartialMessages`, `includeHookEvents`, `systemPrompt.excludeDynamicSections`, `planModeInstructions`, `agents`, `allowedTools`, `fallbackModel`, `maxBudgetUsd`, `persistSession`. So there is no token streaming from the CLI (the `v8a` filter at 98759 still drops `stream_event content_block_delta` defensively).

The resulting CLI flags are built by the SDK at 96655-96790: `--output-format stream-json --verbose --input-format stream-json --thinking=adaptive --thinking-display=summarized --effort --max-turns --model --permission-prompt-tool=stdio` (because `canUseTool` is set) `--resume/--session-id --disallowedTools --mcp-config <json of non-sdk servers> --setting-sources --permission-mode --session-mirror --plugin-dir --add-dir --settings`. SDK MCP servers (`type:"sdk"`) are not in `--mcp-config`; they are announced in the initialize control request (`sdkMcpServers`, 97431-97433).

### 1.3 Environment (VERIFIED, `getClaudeLaunchOptions`, 98896-98945)
Base env = sidecar `process.env` minus undefined (`C8a`, 98774) + `cloudEnv` from the workspace settings bundle. Then:
- `CLAUDE_CONFIG_DIR` pinned to the value at sidecar boot (`getEffectiveEnv`, 98878).
- `getGitHubAuthEnv(sessionId, env)` (token env for `gh`/git).
- `getConductorEnv()` (host-provided `CONDUCTOR_*` vars such as `CONDUCTOR_WORKSPACE_PATH`; set via `setConductorEnv`, 311916).
- `CONDUCTOR_SESSION_ID=<id>` and `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS="1"`.
- The SDK adds `CLAUDE_CODE_ENTRYPOINT=sdk-ts`, `CLAUDE_AGENT_SDK_VERSION`, `CLAUDE_CODE_SDK_READS_SESSION_STATE=1` (82313-82330) and strips `NODE_OPTIONS`/`DEBUG` (96796).
- Auth: `getClaudeAuthForNextSpawn()` can return `{type:"env", env}` (replaces `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` / scopes) or `brokered-oauth`: the sidecar asks a token provider to `refresh()` (forceRefresh if Claude rejected the token before) and injects `CLAUDE_CODE_OAUTH_TOKEN` + `CLAUDE_CODE_OAUTH_SCOPES`, deleting `ANTHROPIC_API_KEY`. The expiry is stored in `claudeOauthTokenExpiresAt`.
- Provider routing: runs `claude auth status --json` (5 s timeout, 98355-98369) and, for `bedrock|vertex|foundry`, sets `CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY=1` (`fLe`, 5966). The result is cached 60 s (`_8a`).
- Cloud sandbox adds `CLAUDE_CODE_SANDBOXED=1` (341650 region).
- Log lines redact env values (`F8a`, ~98780: keys matching KEY/TOKEN/SECRET/PASSWORD/CREDENTIAL/PAT and `CONDUCTOR_INTERNAL_*` become `<redacted:N>`).

### 1.4 Hooks (VERIFIED, 99388-99397)
Only `PreToolUse` (no matcher). For any tool NOT in the read-only set `p8a` (`Read, Glob, Grep, ToolSearch, LSP, TaskGet, TaskList, TaskOutput, WebFetch, WebSearch, CronList, EnterPlanMode`, 99601) it awaits `live.pendingStartCheckpoint` before returning `{}`. Purpose (INFERRED): the git "start" checkpoint of the turn (`JH`, 310427, checkpoint refs) must finish before the agent mutates files. The turn handler passes `pendingStartCheckpoint` for Claude only (311650 area, `le ? R : undefined`).

### 1.5 Lifecycle and live reconfiguration (VERIFIED)
- `warmSession` (99078) spawns the process before the first message (`startGenerator`). The host calls it on the `warmAgent` method (5511).
- `runUserMessage` (99022): prepare/fetch settings bundle; get or start generator; reject if `resolveTurn` already set ("A turn is already in progress"); reconcile config; set `inProgress`; `sendMessage({text, userMessageUuid: randomUUID()})`; await the `turn` promise, which is resolved when a matching `result` message arrives (99480-99490).
- Config policy table `fat` (98287-98291), kinds `derived | live | liveIfSupported | recreate | ignored`:
  - live via control request: `model` -> `queryResult.setModel`, `thinkingLevel` -> `applyFlagSettings({effortLevel})` only if the model supports live effort switch (`Tpe`, 5998);
  - derived to permission mode: `collaborationMode`, `requiresToolApprovals`, `autoPermissionModeEnabled`;
  - kill and respawn with `--resume`: `claudePersonality, ultracode, fastMode, additionalDirectories, chromeEnabled, localExecutionMcpEnabled, localExecutionMcpRoutedEnabled, getDiffCommentsEnabled, progressUpdatesEnabled, workspaceSettingsRevision`;
  - forced respawn reasons: Claude rejected the brokered OAuth token, `agentAuthGeneration` changed (managed credentials changed), or OAuth token expires within 5 min (`b8a = 300000`, `S8a`, 98766).
  - If a turn is in progress (`canRecreate` false) the change is deferred to the next turn (log at 98265).
- Respawn keeps history: `resumeForRestart` (99108) uses the current resume token, else the session id if `startedSessionIds` has it or a resumable transcript exists on disk, else a truncating resume.
- Resumable-on-disk check: `ZKr` (98293) computes `~/.claude/projects/<cwd with non-alphanumerics replaced by "-">/<sessionId>.jsonl` (honours `CLAUDE_CONFIG_DIR`, hash suffix when >200 chars); `eYr` (98315) scans for a non-sidechain `user`/`assistant` line. A transcript with no conversation is renamed to `.stale` so the id can be reused (99105).
- Stop (`stopLiveGenerator`, 99123): rejects the turn with `SessionCancelledError`, calls `stopGenerator()` and `abortController.abort()`; the SDK kills the process. There is no graceful `interrupt()` call. A bump counter (`stopGenerations`) lets in-flight async starts notice they were cancelled.
- Rollback / fork (`rollbackSession`, 99185): stores `pendingResumeSessionAts[sessionId] = messageUuid` and stops the session. The next start uses `resume + sessionId + resumeSessionAt + forkSession:true` (99336), i.e. `--fork-session --resume-session-at <uuid>`. `dropForkOfStartedSession` (99108) ignores a fork request if the id already has its own transcript.
- Steering (`steerUserMessage`, 99062): only while a turn is open; pushes another `user` message into the same generator (the CLI queues it as a `queued_command` attachment). Details in section 6.

## 2. SDK message processing (`for await (let I of b)`, 99416-99492)

Everything the SDK yields is forwarded as-is; there is no Conductor-specific message format for Claude. The UI event is `{type:"agent", rawPayload: <sdk message>, userMessageId, turnId}` (311657-311658). The schema `Xo` is `Record<string, unknown>` (37146), so no validation.

Per message (VERIFIED):
1. `system/init`: records `currentSdkModel` (`a8a`), adds the id to `startedSessionIds`, sets `inProgress` and fires `onInProgressChanged(true)`. If `init.permissionMode === "plan"` calls `onEnterPlanMode` (host then sets `collaborationMode:"plan"` and notifies the UI with `enter_plan_mode_notification`, 313201).
2. `system/session_state_changed` (emitted because of `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS`): `state !== "idle"` means busy. `running` disarms the settlement watchdog. Drives `inProgress` / `onInProgressChanged` so background work after a `result` still shows as working.
3. `system/task_started | task_notification | task_updated`: maintain `backgroundTasks` map (`pYr`, 98401; types `local_agent|remote_agent|subagent`; skips `skip_transcript`/`ambient`); reported with `onBackgroundTasksChanged({backgroundTasks, waitingSince})`.
4. `assistant`/`user` messages: track `runningToolUseIds` (`d8a`, 98692), blocking `TaskOutput` waits (`fYr`, 98430: assistant `tool_use` named `TaskOutput` with `block:true` and a known task id => waiting) and subagent parent mapping (`cYr`/`dYr`, 98381-98399: `tool_use.id -> parent_tool_use_id`, so `task_*` system messages get `parent_tool_use_id` filled in).
5. `assistant` with `error === "authentication_failed"` while a brokered OAuth token is in use: marks the session for forced token refresh (99436).
6. `result`: see below.
7. Forwarded to UI unless filtered by `v8a` (98759): dropped are `stream_event` with `content_block_delta`, `system/thinking_tokens`, `system/task_progress`. Everything else (including `autocompact_state`, `compact_boundary`, `rate_limit_event`, `post_turn_summary`, `session_metadata`, `active_goal`, tool_use, tool_result, thinking blocks) is passed on. The SDK itself routes some frames into the same stream (97193-97202).
8. Not forwarded to the Claude path: `transcript_mirror` (consumed by the SDK, section 6), `control_request`, `keep_alive`.

`result` handling (the heart of turn bookkeeping):
- Adds `conductor_sdk_metadata` to the result (`o8a`, 98656): `requestedModel, requestedReasoningEffort, requestedFastMode, requestedThinkingLevel, model (SDK-reported), serviceTier, speed, isForeignResult, marginalCostUsd`. `marginalCostUsd = max(0, total_cost_usd - lastReportedCostUsd)` (`bYr`, 98517), because the SDK reports a cumulative cost per process.
- Turn matching: each `sendMessage` gets a uuid in `awaitedTurnUserMessageUuids`; a `result` carries `user_message_uuid`. A result whose uuid is not awaited is "foreign" (e.g. the CLI ran a turn for a background task notification); it is forwarded but does not resolve the turn, and arms the settlement watchdog (120 s, `n8a`, 99544): if no follow-up turn starts, `forceSettleTurnAfterIgnoredResult` (99150) resolves the turn anyway. A task-notification result with `num_turns === 0` ("mini result") is ignored as a boundary (`hve`, 98669).
- Steer suppression: if steers are still unconsumed (`unconsumedSteerUserMessageUuids.size > 0`) and the mirror shows the transcript has been written to, the pre-steer `result` is not forwarded and does not resolve the turn (99428-99432, 99476-99479). The watchdog is armed as a safety net.
- `is_error: true` is only logged ("resolving turn anyway", 99482); the raw error result is forwarded to the UI and the turn resolves normally.
- `deferred_tool_use` on a result (a PreToolUse hook returned `defer`) is logged as an error (99468).
- On resolve: clears `blockingWaits`, `runningToolUseIds`; sets `inProgress=false` and fires `onInProgressChanged(false)` only if nothing else is pending; calls `resolveTurn()`.

Loop end (99492-99506):
- Stream ends without stop: `rejectTurn(new Error "Claude session ended unexpectedly")`, session removed from `liveSessions`.
- Exception: logged with `code/errorClass/exitCode/signal` (`D8a`, 98814) and the turn is rejected with the same error (or "Claude session failed"); session removed. The next message starts a new generator with `--resume`.
- `exited` promise resolves in `finally` (used by `pendingCancellationExits`).

What goes onward to the host (`kFe` callbacks, 311650-311680): `onAgentMessage -> notify({newEvents:[{type:"agent", rawPayload, userMessageId, turnId}]})`, `onInProgressChanged -> updateStatus("working") | drain queued messages`, `onBackgroundTasksChanged -> liveState {backgroundTasks, waitingSince}`, `onFastModeUnavailable -> liveState.fastModeAvailable=false`, `onEnterPlanMode`, `onExitPlanMode`, `onAskUserQuestion`, `onToolApproval`, `onGetDiff`, `onGetDiffComments`, `onDiffComment`, `onGetTerminalOutput`, `onRunLocalCommand`. A debug tap `py({source:"workspace <> SDK", direction, data})` logs every upstream/downstream message.

## 3. Tool approvals, questions, plan mode

### 3.1 Permission mode (VERIFIED)
`pat` (98215): `requiresToolApprovals` false -> `"bypassPermissions"`; true -> `"auto"` if `autoPermissionModeEnabled` else `"default"`. `R1a` (98210): `collaborationMode === "plan"` -> `"plan"`, else `pat(...)`. `M1a` (98253) calls `queryResult.setPermissionMode(mode)` whenever it differs from `currentPermissionMode`, run on every `reconcileSessionConfig`. The CLI is always spawned with `bypassPermissions` and switched live. The CLI flag `--permission-prompt-tool=stdio` makes the CLI send permission questions to the SDK as `control_request` subtype `can_use_tool` over stdout; the SDK calls `canUseTool` (97298) and writes a `control_response` back on stdin. There is no timeout in the SDK for this.

### 3.2 `canUseTool(toolName, input, {toolUseID, decisionReason, blockedPath, suggestions, agentID, signal})` (VERIFIED (99342-99387), in order)
1. `ExitPlanMode`: `await callbacks.onExitPlanMode(input)`. Approved: new mode `H = pat(...)` (so default/auto/bypass), stored in `currentPermissionMode`, returns `{behavior:"allow", updatedInput:{...input, planFilePath, _targetMode:H}, updatedPermissions:[{type:"setMode", mode:H, destination:"session"}]}`. Rejected: `{behavior:"deny", message: feedback ?? "Plan not approved", interrupt:true}`.
2. Edit tools `Edit, MultiEdit, Write, NotebookEdit` (`JYr`): path (`file_path`/`notebook_path`) is `realpath`-resolved (`x8a`) and must be inside `cwd` or an additional directory (incl. their realpaths, `m8a`); otherwise deny with "Cannot edit files outside allowed directories (...)".
3. Any `mcp__conductor__*` tool (`f8a = gYr()`, 98466; every tool of the conductor server, name `mcp__conductor__<name>`) is auto-allowed.
4. Session no longer live -> deny "Tool use denied because the Claude session is no longer active."
5. `requiresToolApprovals !== true` -> allow.
6. Edit tool and `autoApproveEditsForSession` -> allow.
7. No `onToolApproval` callback -> deny.
8. Otherwise ask the UI: `onToolApproval({toolUseId, toolName, toolInput, decisionReason, blockedPath, suggestions (only type+rules[].ruleContent, A8a 98730), subAgentId})` and map the decision:
   - `deny` -> `{behavior:"deny", message:"<tool> denied by user."}`
   - `allow_edits_for_session` -> sets `autoApproveEditsForSession`, allow
   - `allow_with_permissions` -> allow with `updatedPermissions: P.suggestions` (SDK permission suggestions, e.g. directory rules)
   - `always_allow` -> allow with `updatedPermissions:[{type:"addRules", rules:[{toolName}], behavior:"allow", destination:"localSettings"}]` (writes to `.claude/settings.local.json` via the CLI)
   - `allow` / default -> allow
Note (INFERRED): in the default `bypassPermissions` mode the CLI does not ask for ordinary tools, so steps 2 to 8 only matter when `requiresToolApprovals` is on; `ExitPlanMode` and the question tool always arrive here.

### 3.3 Approval transport
Runner callback `onToolApproval` -> `outgoing.toolApproval({sessionId, ...})` (311668).
- Local Mac app: `outgoing.toolApproval` = `ad.requestToolApproval` (314156 -> 5428) = JSON-RPC request `toolApproval` over the stdio tunnel (`FrontendRpcTunnel.request`, 36947). No timeout in the sidecar (INFERRED: json-rpc peer default). Response `{decision}`.
- Cloud mode: `LJi` (314572) emits a session event `frontendRpcRequest {kind:"toolApproval", requestId, toolUseId, toolName, toolInput, decisionReason, blockedPath, suggestions, subAgentId}`, parks a promise in `NJi` (314483), and the client answers via `session.resolveFrontendRpc` (314386 -> `rMt.resolve`). Timeout `O5u = 120000` ms: on timeout `j5u` (314539) returns `{decision:"deny", timedOut:true}` for toolApproval (similar error responses for getDiff etc.), and a `frontendRpcResponse ... timedOut:true` event is emitted. `routedRunLocalCommand` uses its own deadlines (`M5u` 60 s default, `N5u` 120 s, `L5u` 1800 s with extended reason, +`U5u` 120 s).

### 3.4 Questions (replacement AskUserQuestion) (VERIFIED)
- Built-in `AskUserQuestion` is disallowed and aliased to the Conductor MCP tool `AskUserQuestion` (ppo, 52305). Its input is `{questions: [{question, options: (string | {label, description?, preview?})[] (max 4), header?, multiSelect?}] (1..4)}` (52027). Description text: see section 4.2.
- Execution (52305-52332): maps to `{question, options:[labels], multiSelect, header, richOptions?}`, calls `getCallbacks().onAskUserQuestion(questions)` which resolves to `{answers}`; `answers[i]` is a string or string[] per question. Handling: `["USER_CANCELLED"]` -> tool result "User cancelled the question. Please continue without this information..." with code `CONDUCTOR_ASK_USER_QUESTION_USER_CANCELLED`; wrong count or non-array -> error result with codes `..._MALFORMED_ANSWERS`/`..._WRONG_ANSWER_COUNT`, `Retryable: yes`, `Suggested action: Retry AskUserQuestion once if the question is still relevant.`; success -> text `User responses:\n1. <answer>\n2. ...` (multi answers become indented `   - x` lines, `dpo` 52295).
- Host side (`askQuestions`, 310997): queues a `{kind:"question"}` interaction, one active at a time, published as `liveState.activeQuestions` / `activeUserInteraction`. Local app: `Yji` (313236) sends JSON-RPC `askUserQuestion` to the Mac app, then `host.answerQuestion` (session.answerQuestion, `EUi` 310138) resolves the promise. If the RPC fails, answers become `[]` (which then trips the wrong-count branch).
- No timeout: the tool call just waits. It is cancelled (`answers:["USER_CANCELLED"]`, 310696) by `cancelPendingInteractions` when the user sends a new non-steering message, steers, stops, or the session shuts down. On `shutdown`, `askQuestions` returns `USER_CANCELLED` immediately.

### 3.5 Plan mode (VERIFIED)
- Entering: user toggles `collaborationMode:"plan"` -> `setPermissionMode("plan")` (live). The agent itself can call `EnterPlanMode` (read-only allowlist `p8a`, auto-allowed); the `system/init` check (99461) mirrors a CLI-side plan mode into `collaborationMode:"plan"`.
- Exiting: the agent calls `ExitPlanMode` -> `canUseTool` -> `onExitPlanMode({plan})` -> `proposePlan(planText)` (310986) sets `liveState.proposedPlan` and returns a pending promise. Local app: `Owu` (313223) sends JSON-RPC `exitPlanMode {sessionId, toolInput:{plan}}` and then `host.respondToPlan({approved, feedback, planFilePath})` (session.respondToPlan, `kUi` 310214 -> `resolvePlan`). If the RPC fails: `{approved:false, feedback:"Frontend disconnected"}`.
- On approval without feedback the host sets `collaborationMode:"default"` (311661); the runner switches the CLI mode via the `setMode` permission update. With feedback, the feedback is stored as a user message event (`plan-feedback:<id>`) and the plan is denied with `interrupt:true`.
- Cancelling (new message, stop): `{approved:false}` -> deny "Plan not approved".
- `planModeInstructions` SDK option is NOT used (VERIFIED absence).

## 4. The Conductor MCP server

### 4.1 Construction (VERIFIED)
For Claude: in-process SDK server. `AYr` (98471) calls `qHr` (76302, the SDK's `createSdkMcpServer`) with `{name:"conductor", version:"1.0.0", tools:z1({...}).map(c => UHr(name, description, inputSchemaShape, execute, {annotations, alwaysLoad}))}`. It runs in the sidecar process; the CLI reaches it through `control_request` subtype `mcp_message` over the stdio pipes (SDK `processControlRequest`, 97295-97326; SDK also pre-fetches `initialize`/`tools/list` manifests at startup, 97382-97420). Tool names reach the model as `mcp__conductor__<Name>`. No socket and no separate process for Claude.

Tool availability flags (`z1`, 52539) come from session config: `localExecutionMcpEnabled|localExecutionMcpRoutedEnabled -> RunLocalCommand`, `getDiffCommentsEnabled -> GetDiffComments`, `progressUpdatesEnabled -> UpdateProgress`, runner option `includeSetTargetBranchTool -> SetTargetBranch`, `includeComputerAdminTools -> 5 computer tools`. A config change of these flags forces a respawn (policy `recreate`).

### 4.2 Tools and descriptions (VERIFIED, descriptions at 52202-52208 and 52543-52563)
Each handler logs `[conductorMCPServer] <Tool> invoked for session <id>`, gets callbacks via `getCallbacks()` (the live session's current callbacks; error "no active session callbacks" otherwise) and returns MCP `content:[{type:"text"}]`.

| Tool | Always? | Input | Description (short excerpt) | Backend |
|---|---|---|---|---|
| `AskUserQuestion` (alwaysLoad, readOnly) | yes | `questions[1..4]` | "Use this tool when you need to ask the user questions during execution. ... An 'Other' option that allows free-form input is automatically provided ... do NOT include 'Other'..." (same text as the built-in tool) | `onAskUserQuestion` |
| `GetWorkspaceDiff` (readOnly) | yes | `file?` (abs path), `stat?` | "You can use this tool to see what the user is currently working on, or when the user refers to the \"workspace diff\", \"PR diff\", or \"all changes\". This compares all changes on the current branch (including uncommitted changes) against the merge base. It's the same diff the user will see in the Conductor UI, and the same diff that will be used in any PRs." | `onGetDiff` -> host (local RPC `getDiff` has a 20 s timeout `Jvs`, 5583; cloud 120 s). Returns `diff || "No changes found."` |
| `GetDiffComments` (readOnly) | flag | `file?` | "Use this tool to read the review comments the user has left on the workspace diff, e.g. when the user asks you to \"address the comments\" ... These are the same comments shown in Conductor's Changes tab ... including comments left by the user, by an agent, and synced from GitHub. Reading comments does not change or resolve them." Output format `path (line N | lines A-B | no line) [user|agent|GitHub]\n<body>` | `onGetDiffComments` |
| `DiffComment` | yes | `comments[{file, lineNumber, body}]` | "Use this tool to leave review feedback on the user's diff in Conductor's Checks panel. Each comment targets a specific file and line number. Prefer this tool over posting review feedback to GitHub unless the user explicitly asks you to comment on GitHub. Prefer plain text over markdown formatting." | `onDiffComment` -> "Posted N comment(s) on the diff." |
| `GetTerminalOutput` (readOnly) | yes | `source?: spotlight|run_script|terminal|auto`, `maxLines?` (default 1000) | "Use this tool to view terminal output in the user's workspace. This is helpful when: - You need to see the output of a running command (like a dev server) - You want to check for errors or logs from a build/test process - The user mentions output they're seeing in their terminal - You need to debug issues with a running process. Returns the terminal output along with information about what type of terminal it came from." | `onGetTerminalOutput`; output prefixed `[Spotlight|Action|Terminal - running|stopped]` |
| `UpdateProgress` (alwaysLoad, idempotent) | flag | `title?`, `blocks[]` of `bar{label,value?,max?,detail?}`, `steps{steps:[{label,status: pending|in_progress|done|failed}]}`, `text{text}` | "Show the user the progress of long, multi-step work in a Domino's-style pizza tracker above the chat input. ... Each call replaces the previous update, so always send the full current state. ... call it with an empty blocks list when the work is done or abandoned." | No callback: returns "Progress updated."; the UI reads the tool_use input from the transcript stream (INFERRED) |
| `SetTargetBranch` (idempotent) | runner flag | `targetBranch` (no `origin/` prefix) | "Change the branch this workspace merges into (its target branch), e.g. when the user asks you to base your work on or open the pull request against a different branch. Pass the branch name on origin ... run `git fetch origin <branch>` first. ... This tool does not rebase your branch or change the base of an already-open pull request" | Local: verifies `refs/remotes/origin/<b>` with git and returns a text note; no state change in the sidecar (the UI infers the new target from the tool call, INFERRED) |
| `RunLocalCommand` (destructive, openWorld) | cloud, flag | `command, description?, reason?, cwd?, timeoutMs?, extendedTimeoutReason?` | "Use this tool when the user describes a task that requires access to content that is local to the laptop where they are working from. ... runs a one-shot shell command on the Mac laptop that created this remote workspace ... Commands default to 60 seconds and can run for up to 120 seconds. To request up to 30 minutes, set `timeoutMs` and include `extendedTimeoutReason` ..." Output > 32,000 chars is saved to `.context/conductor/run-local-command-output-<id>.txt` and the result points to it | `onRunLocalCommand` (user approves in the UI); local Mac host answers "only available for remote workspaces" (314156) |
| `ListComputers`, `GetComputerConfiguration`, `CreateComputerConfiguration`, `GetComputerBuildStatus`, `UpdateRepositorySetupScript` | computer-admin flag | computerId etc. | e.g. "Lists the cloud computers you can administer, with the id you need for the other Computer tools. Call this first" ; "Publish a new configuration for the cloud computer with a replaced install script, and start a snapshot build ..." | `computerAdminClient` (cloud admin API) |

### 4.3 The `cmcp-` Unix socket bridge (NOT used by Claude) (VERIFIED)
`_X` (52116) creates a socket server in `mkdtemp($TMPDIR/cmcp-<sha256(workspaceId)[:16]>-)` at `<dir>/s` (`K0o` 52070). Protocol: one JSON line per connection, `{authToken, sessionId, toolName, args}` (tools restricted to `GetWorkspaceDiff, GetDiffComments, DiffComment, GetTerminalOutput, RunLocalCommand` and the five computer tools, 52019) or a `{authToken, sessionId, hello:{pid}}` handshake; a per-session base64url 32-byte token (`createAuthToken`) authenticates; 30 s idle socket timeout (`J0o`); dispatch in `Y0o` (52086) calls the same outgoing RPCs as the in-process tools. A child helper process (`codex-local-execution-mcp.js`, args `--session-id --socket --workspace-dir --enable-*`, token in env `CONDUCTOR_MCP_AUTH_TOKEN`) speaks MCP stdio to the agent and relays to the socket. Consumers: Codex (`M_a`, 103440: `--config mcp_servers.conductor.command/args/env`) and ACP agents (`Fpo`, 52579). It is started once per sidecar/workspace (314158, 341649). So a live `claude` process does not use it, even though the socket exists in `$TMPDIR` while Conductor runs. (The user-observed Claude MCP tools are `mcp__conductor__*` via the stdio control channel.)

## 5. Prompt additions

The system prompt is only the stock preset `claude_code` (plus the tracker paragraph below). Conductor's context is injected into the first USER message as `<system_instruction>` blocks, built host-side before the runner call: `sendUserMessage` (311927) -> `IFe` (311462). VERIFIED.

1. System prompt append (only when `progressUpdatesEnabled`, `G8e`, 52563): "Conductor shows the user a Domino's-style pizza tracker above the chat input. During long, multi-step work, keep it current with the mcp__conductor__UpdateProgress tool: a few stages with one-to-three-word labels ... Skip it for quick tasks."
2. First-message preamble `SFe` (311150), added when `context.firstMessage` is set:
   - "You are working inside Conductor, a Mac app that lets the user run many coding agents in parallel."
   - "Your work should take place in the ${dir} directory (unless otherwise directed), which has been set up for you to work in."
   - "Each workspace has a .context directory (gitignored) where you can save files to collaborate with other agents."
   - (storageVersion 2) "DO NOT EVER read or write files at ${repoRoot}."
   - "The target branch for this workspace is ${remote}/${branch}. Use this for actions like diffing (`git diff ${remote}/${branch}...`) or creating PRs (`gh pr create --base ${branch}`)."
   - "You're on a new branch with a placeholder name." (when a rename is pending)
   - "Do not rename the current branch unless the user explicitly tells you to do so."
   - "Conductor shows the PR for whichever branch is checked out. After you open a PR from a different branch, or a PR stack, check out that PR's branch ..."
   - "By default, the user will only see the last message that you send before stopping. Include all essential information in the last message. The intermediate messages will be collapsed ..."
   - "Save screenshots under `.context/` and embed them inline in the final response using Markdown image syntax"
   - "If the user asks you to work on several unrelated tasks, you can suggest they start new workspaces." / "...a message they meant to send in a different workspace..." / "Help -> Send Feedback".
3. Cloud-only blocks: `sqi` (311173) VM/Vercel sandbox text, "Sync files" one-way note, "To access the user's Mac, use the RunLocalCommand tool", model-family lists, `gh stack` hint, `conductor` CLI hint; `oqi` (311193) Slack reply instruction (curl POST to `$CONDUCTOR_SLACK_REPLY_URL`). Used by `Sqi` (311505) for the public-API first message.
4. Per-message additions: `_qi` (311372) `<system_instruction>The user has attached these files. Read them before proceeding.` + path list; PR mentions `#⟦name⟧(pull-request:N)` become `[name](.context/pull-requests/N.md)` with stub files written with flag `wx` (`NCu`); `@⟦x⟧(artifact:slug)` team-artifact-template expansion (`kCu`, `RCu`: instructions to run `conductor artifact new/publish`); Codex only: linked directories block (`UCu`).
5. Preferences `g4t`/`fqi` (311284, 311450): `<user-preferences>...</user-preferences>` appended to the message, or the long form "IMPORTANT: The following are the user's custom preferences. These preferences take precedence over any default guidelines..." with organization and user sections. The sender-tag `<conductor_message_sender` is escaped by `h4t` (311277) to block spoofing.
6. Also: Conductor skill plugin (`skills/conductor/SKILL.md`, optional `skills/computer-admin/SKILL.md`) from env `CONDUCTOR_INTERNAL_SKILL_PLUGIN_DIR` / `..._COMPUTER_ADMIN_SKILL_PLUGIN_DIR`, loaded with `--plugin-dir` (98470-98510).

## 6. Transcripts, session mirror, steering receipts

VERIFIED:
- Source of truth for Claude history is the CLI's own JSONL at `~/.claude/projects/<mangled cwd>/<sessionId>.jsonl` (98293). Conductor does not write a Claude transcript itself; it reads that file only to decide whether `--resume` is possible (98315) and renames empty ones.
- Conductor's own durable record is its session event log + notification outbox (`sessionEventStore.appendEvents`, 313135; session manager persistence), fed by the `agent` events built from SDK messages. (Other notes cover this.)
- `sessionStore` passed to the SDK (99318-99335):
  ```js
  E = { append: async (key, entries) => { _.hasAppended = true; for (const P of entries) { const O = c8a(P); if (O) y.delete(O) } }, load: async () => null }
  ```
  With a `sessionStore` the SDK sets `sessionMirror: !!store` -> `--session-mirror` (82408, 96743). The CLI then emits `transcript_mirror` frames `{filePath, entries[]}` alongside normal output; the SDK batches them (`GJr`, 70803; `eager` flush means no batching: `maxPendingEntries 0`) and awaits `store.append`. Frames are also flushed on each `result`. `load` returns null, so a resume with a store (`T1a`, 82451) finds nothing in the store and spawns the CLI normally on the local `~/.claude` files. `listSessions`/`listSubkeys` are not implemented (so `continue` is unusable, fine).
  - `c8a` (98685) extracts a uuid from a mirrored entry: `user` entry -> its `uuid`; `attachment` entry of type `queued_command` -> `source_uuid`.
  - Purpose (INFERRED from the code path): steering receipts. `steerUserMessage` registers the steer uuid in `unconsumedSteerUserMessageUuids` (a `Bat` map of uuid -> promise resolver, 99577) and returns `{agentReceived: promise}` only if tools are running and the mirror has been used (99062-99077). The promise resolves when the CLI writes that user message (or its queued_command attachment) into the transcript, meaning the agent has really consumed it. The host (`GCu`, 311574) shows the steer as pending (`pendingSteerMessageIds`) until then. This is why pre-steer `result`s are suppressed (section 2).
- Sidecar tears down the temp resume dir created by the SDK for store-backed resume (`zKr`, 82432; never created here because `load` is null).

Not Claude (VERIFIED location, relevance INFERRED): `TranscriptStore` (`M2t` 151455) writes txt/json/jsonl transcripts from Cursor `conversationState` via blob store; `LocalTranscriptWriter` (`A7t` 153843) serialises writes (`writeChain`) per conversation, with subagent paths; `OutputSuppressionController` (119975) suppresses runaway shell output ("Suppressing shell output") using chars-per-second thresholds and event-loop pressure.

## 7. Context window, compaction, usage

VERIFIED:
- Context usage is on demand only. Host method `session.getContextUsage` / app method `contextUsage` -> `Dat.getContextUsage` (99509): live session -> `queryResult.getContextUsage()` (SDK control request `get_context_usage`, 97755) in parallel with plan usage. Not live but `externalSessionId` known -> spawns a throwaway metadata query with `resume: externalSessionId` (prompt = never-yielding `GYr`), asks, then ends it. The payload `contextUsageData` is opaque to Conductor (`Je()` any, 37146); UI interprets it. Shape for Claude: `{contextUsageData, planUsage?}`.
- Plan usage: `s8a` (98629) calls the SDK's experimental `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({skipBehaviors:true})` (control request `get_usage`, 97759), with a 10 s timeout (`i8a`), validates `{subscription_type, rate_limits_available, rate_limits:{five_hour, seven_day:{utilization, resets_at}}}` and returns `{subscriptionType, fiveHour:{usedPercent, windowDurationMins:300, resetsAt(epoch s)}, sevenDay:{..., 10080}}`. Failures are swallowed at debug level.
- Cost: `marginalCostUsd` per turn in `conductor_sdk_metadata` (section 2). Fast mode and service tier/speed are read from `result.usage` (`u8a`, `l8a`).
- Compaction: the runner has no compaction code. `compact_boundary` system messages and the `autocompact_state` frames are produced by the CLI/SDK and passed through to the UI in `agent` events (SDK enqueues `autocompact_state` into the message stream, 97206). The only compaction-aware code is in the SDK (97224, treating `compact_boundary` as activity). `/compact` is a normal slash command in the user text (supported commands come from `queryResult.supportedCommands()`, `getSlashCommands` 99196). Codex has an explicit `codexCompact` method (4751), Claude does not.
- The strings `freshly_compacted` and `context_used_percent` do not occur anywhere in `sidecar.js` (grep returned nothing), so they come from the CLI binary or the UI, not this file.
- Session state (`session_state_changed`: idle / running / requires_action) is consumed as in section 2.

## 8. Error handling

VERIFIED unless noted.
- Crash or exit of the `claude` process: SDK transport builds an error ("Claude Code process exited with code N" + stderr tail, or "terminated by signal", 96820-96830), the `for await` throws, the runner logs `Session <id> error` with `code/errorClass/exitCode/signal`, rejects the current turn, deletes the live session. Next user message respawns with `--resume`. No automatic retry or restart inside the runner.
- Host turn failure (`kFe`, 311700+): `liveState.error = message` and a `queryError` notification to the app. Before showing, it checks memory exhaustion: marker file `/tmp/conductor-memory-watchdog-incident.json` (`{kind:"workspace_memory_exhausted", trigger crash|thrash, phase sweeping|killed}`, 98540-98620, 30 s window) or an increase of `oom_kill` in `/proc/vmstat` (cloud Linux), and then replaces the message with "Workspace ran out of memory, so agents and running commands were stopped. Retry, or move memory-heavy work to a separate workspace." (`PYr`). A `result` with `is_error` and text containing "Can't reach the API server" after a recent memory-kill becomes "Agents in this workspace can't reach the network. The workspace ran out of memory earlier ... Restart the workspace" (`wYr`, 98526).
- Result errors (`is_error: true`, e.g. API errors, max turns, billing): logged at warn, forwarded to the UI as the raw `result` (UI renders them), turn resolved as normal.
- Auth: `assistant.error === "authentication_failed"` with brokered OAuth -> flags session; next spawn force-refreshes the token and respawns (99436, 98969). Tokens within 5 min of expiry cause proactive respawn (`S8a`, 98766). `agentCredentialsChanged` (workspace method, 314323) bumps a generation to respawn live sessions. Token refresh failures surface as `CLAUDE_AUTH_REQUIRED` (339400). `authenticate()` (99215) uses a forced throwaway metadata query and `accountInfo()`.
- Rate limits: no Claude-specific handling in the runner (no retry, no backoff, no `fallbackModel`). `rate_limit_event` messages from the CLI pass through to the UI (INFERRED: UI shows them). Plan usage windows are available via `planUsage` (section 7). Retries on 429/529 happen inside the CLI (INFERRED, standard CLI behaviour).
- Fast mode: stderr "Fast mode requires extra usage billing" -> `onFastModeUnavailable` -> `liveState.fastModeAvailable=false` and a `fast_mode_unavailable_notification` (~313196).
- Hangs: `settlementWatchdog` 120 s (99143-99160) force-settles a turn whose result was ignored or suppressed; `claude auth status` has a 5 s kill timeout; `claude --version` 5 s; plan usage 10 s; SDK `SessionStore.append` 60 s timeout with backoff (70803).
- Cancelled/stale starts: `stopGenerations` counters throw `SessionCancelledError` for starts that raced a stop (99300-99320). Concurrent `startGenerator` calls for one session share the pending promise (`pendingGeneratorStarts`).
- Frontend gone: local RPC failures for plan/questions resolve to "Frontend disconnected" / empty answers (313223-313250); cloud RPCs time out into deny/empty results (314539).
- Missing workspace dir: `getClaudeLaunchOptions` throws `Workspace directory missing: <dir>` (98897).
- Deferred tools: a `PreToolUse` hook returning `defer` is treated as an error (99468) (no Conductor hook returns it today).

## 9. Takeaways for a re-implementation (design-level, INFERRED)
1. One long-lived `claude` per chat, driven through the Agent SDK with an async-iterable prompt; follow-ups and steers are just more `user` messages on the same stream. Respawn with `--resume` for anything that cannot be changed live.
2. Run in `bypassPermissions` by default and switch modes live with `setPermissionMode`; handle only `ExitPlanMode` and (optionally) approvals in `canUseTool`.
3. Replace the built-in `AskUserQuestion` with an in-process SDK MCP tool plus `disallowedTools` and `toolAliases`; the tool's promise is the "wait for human" primitive.
4. Pass SDK messages through unchanged; add a small metadata envelope only on `result` (cost delta, model, tier). Do all turn bookkeeping with the `user_message_uuid` on results, `session_state_changed`, and a watchdog for foreign results.
5. Use `sessionStore` + `--session-mirror` only as a "the agent consumed my steer" signal.
6. Keep Conductor context out of the system prompt: prepend `<system_instruction>` to the first user message.

# Conductor sidecar: non-Claude runners and the shared abstraction

Source: `sidecar.js` (line numbers refer to it). Identifiers are minified; I give the minified name once, then use the role name.
Status marks: **VERIFIED** = read in the code at the cited lines. **INFERRED** = my reading of intent, not stated in code.
Nothing was executed.

## 0. Map of the pieces

| Role | Minified | Lines |
|---|---|---|
| Runner factory (one runner per workspace, `get(agentType)`) | `gFe` | 310119-310132 |
| Claude runner | `Dat` | (not in scope) |
| Codex runner | `class aut` | 102310-103446 |
| Codex app-server client (JSON-RPC over stdio) | `class oj` (+ `Tat` transport, `Iat` rpc adapter, `Vee` thread) | 99634-99720, 99900-100040, 100487-100700 |
| Codex notification -> thread-event converter | `yve` | 100738 |
| ACP runner | `class W8e` | 53152-53671 |
| ACP wire client (standard ACP) | `hFr` | 51230-51340 |
| ACP wire client (MSP, Muse's own protocol) | `aFr` | 50697-50975 |
| ACP adapters (opencode, pi, muse) registry | `w0o`/`o3` | 51879-51887; adapters at 51844 (opencode), 51877 (pi), 48404 (muse) |
| ACP -> Claude-shape transcript converter | `H8e` | 52952-53063 |
| Cursor runner | `class zae` | 309917-310090 |
| Cursor -> Claude-shape converter | `hUi`, `$6u` | 309787, 309825 |
| Per-session manager (queue, steering, interactions, events) | `kFe` (send), `PFe` (host API), closure at ~310600-311050 | 311560-311850 |
| RPC method names (the "verbs" the app calls) | `Vn` | 4751 |
| RPC method handlers | `setupJsonRpc` | 314000-314140 |
| Shared Zod schemas (session config, events, live state) | one huge line | 37146 |

## 1. Is there a common runner interface?

**Yes, by duck typing. There is no declared interface or base class** (minified JS, so types are gone). All four runners are plain classes with the same method names, and the host calls them through `agentRunnerFactory.get(session.agentType)`.

VERIFIED factory (310119-310132): `get(o)` returns `r` (claude) / `n` (codex) / `i` (cursor) / else `s` (acp). It also exposes `getClaude/getCodex/getCursor/getAcp` for harness-specific calls.

Method set (VERIFIED by reading each class; Claude not read):

| Method | Codex (`aut`) | ACP (`W8e`) | Cursor (`zae`) |
|---|---|---|---|
| `warmSession({sessionId, config, resume, callbacks})` | 102525 | 53172 | 309933 |
| `runUserMessage({sessionId, message, config, callbacks, resume, ...})` runs one turn, resolves when the turn ends | 102457 | 53177 | 309939 |
| `steerUserMessage({sessionId, message})` | 102533 | 53444 | 309967 |
| `stopSession({sessionId, systemInitiated, systemReason})` returns bool "was a turn live" | 102770 | 53449 | 309978 |
| `destroySession` | 102800 | 53468 | 309990 |
| `getSessionRuntimeStatus` -> `{activelyWorking, hasPendingCancellation}` | 102796 | 53464 | 309986 |
| `rollbackSession` | 102810 (real) | 53480 throws "not supported" | 309996 throws |
| `getSlashCommands`, `getSkills`, `getMcpServers` | 102646-102670 | 53483-53505 | 309999-310008 |
| `authenticate` | throws "not supported" (102732) | throws (53522) | throws (310009) |
| `getContextUsage` | 102735 | 53525 | returns undefined (310012) |

Unsupported operations throw a typed error (`INVALID_REQUEST`, "X is not supported") rather than being missing. That keeps the call sites uniform.

Callbacks passed into `runUserMessage` (VERIFIED, 311625-311650). This is the runner's only way to talk back:
- `onAgentMessage(msg)` : every normalised message. The session manager wraps it as `{type:"agent", rawPayload: msg, userMessageId, turnId}` and appends it to the session event log (311628-311631).
- `onToolApproval({toolUseId, toolName, toolInput, decisionReason})` : yes/no on a tool call (goes to the frontend as a `frontendRpcRequest` of kind `toolApproval`, schema at 37146).
- `onAskUserQuestion(questions)` : structured questions.
- `requestMcpElicitation(req)`, `requestCodexPermissionApproval(req)` : Codex-specific interaction kinds.
- `onExitPlanMode`, `onEnterPlanMode`, `onFastModeUnavailable`, `onGetDiff`, `onGetDiffComments`, `onDiffComment`, `onGetTerminalOutput`, `onRunLocalCommand`, `onBackgroundTasksChanged`, `onInProgressChanged`.

Errors/termination are control-flow by exception: `Wo` = user cancelled (turn ends quietly, marked "aborted by user" or `system_interrupt:<reason>`), `yh` = steer arrived when no turn is active, `aX` = "runner cannot steer, send as a normal follow-up" (see 2.4).

**What the runner does not own** (VERIFIED, 311560-311740): message queueing, duplicate-message guard, status `idle|working`, checkpoints (git ref snapshots before/after each turn), persistence of the agent's own session id, event log, notifications to the UI. That is all in the per-session manager above the runners. The runner is only "start process, run one turn, stream normalised messages, answer interactions, stop".

Per-agent options stay out of the interface by passing one `config` object (schema `qS`, 37146): `{collaborationMode: default|plan, model, harness, thinkingLevel, fastMode, acpAgentId, acpConfig, personality, requiresToolApprovals, codexApprovalPolicy, codexSandboxMode, additionalDirectories, localExecutionMcpEnabled, ...}`. Each runner reads only its own fields. Mapping from UI settings to this config: `J1e` (44520ff).

## 2. How each runner talks to its agent

### 2.1 Codex: `codex app-server --listen stdio://` over JSON-RPC (VERIFIED)

- Not the `@openai/codex-sdk` library. The sidecar spawns the Codex binary (pinned `codex: "0.164.0"`, 35321) with `app-server --listen stdio://` (99634) and speaks newline-delimited JSON-RPC 2.0 using the `json-rpc-2.0` package (`Tat` transport 99620-99660, `Iat` adapter 99670ff). The only mention of `@openai/codex-sdk` is reading its package.json version for client info (100460). INFERRED: the `Thread` API (`runStreamed`, `steer`, `interrupt`, `compact`) is modelled on the SDK, but re-implemented on the raw protocol.
- Handshake (100507-100536): `initialize {clientInfo, capabilities:{experimentalApi:true}}`, notify `initialized`, then `account/login/start` with `{type:"apiKey"}` or `{type:"chatgptAuthTokens"}` if credentials are supplied.
- One app-server process per live Conductor session (`createCodex` 103281 per session; `liveSessions` map). The process is recreated if the transport closed between turns (102459).
- Launch config (`getCodexLaunchConfig` 103336+): env from shell + GitHub auth + `CONDUCTOR_SESSION_ID`, `OPENAI_BASE_URL` override, exe-proxy wrapper; MCP servers injected with `--config mcp_servers.<name>.url=...` flags. Conductor's own tools are injected as a stdio MCP server named `conductor` whose command is `conductor-runtime codex-mcp` (103447-103449, `$qi` 312237, entry switch 347497/347516). It talks back to the sidecar over a unix socket with a per-session auth token. It also edits `~/.codex/config.toml` to remove clashing `mcp_servers.conductor` entries (`FXr` 103385).
- A `preToolUseHooks` hook bridge (matcher `.*`, "Waiting for Conductor checkpoint", 120 s timeout, 103295) makes Codex pause before each tool so a git checkpoint can be taken. INFERRED purpose from the status text.
- `codex-code-mode-host` binary: some models list `requiredArtifacts: ["codexCodeModeHost"]` (model table 5661). The runner only warns if `<codex dir>/codex-code-mode-host` is missing and says Codex "falls back to in-process code mode" (103314-103320).
- **New turn**: `thread/start` (100540) or `thread/resume` (100545), then `turn/start` via `Thread.runStreamed` (99916-99940). Events arrive as JSON-RPC notifications and are consumed in `runTurn` (102946-103280).
- **Follow-up message while idle**: another `runUserMessage` on the same live thread (settings refreshed first via `refreshSessionSettings` 102434).
- **Steer** (while a turn runs): `thread.steer(text)` -> `turn/steer {threadId, input, expectedTurnId}` (99965-99972, runner 102533). Codex "goal" commands (`set/resume/pause/clear`) are routed to `thread/goal/*` instead (102541-102560). If there is no live session the runner throws `SESSION_NOT_FOUND`; if no abortController it throws `yh` (no active turn).
- **Cancel**: `stopSession` (102770) sends `turn/interrupt {threadId, turnId}` (100026, with one retry using the server's actual active turn id on mismatch, 100031) AND aborts the local AbortController. Stop generations (`bumpStopGeneration`) guard against a stop arriving during initialisation (`stoppedSessions`, 102776).
- **Resume**: thread id. `persistedThreadIds.get(sessionId) ?? resume` is tried with `thread/resume`; if it fails with a non-abort, non-auth error, it silently starts a new thread (102895-102905). The thread id is captured from `thread.started` and from `onAgentMessage` (`ie.thread_id`, 311617) and saved as `agentSessionId`.
- **Rollback / compact / goals**: `thread/rollback` (or `thread/turns/list` + `thread/revert` for paginated history, 100580-100600); `/compact` is intercepted in `runUserMessage` and run through `thread/compact/start` with synthetic `contextCompaction` items (102460-102500).
- **Rate-limit retry**: up to 4 retries with jittered exponential backoff for 429/overloaded (`Bve=4`, `h_a` 102183, 103182-103237).
- **Sub-agents**: `collabAgentToolCall` items are expanded by opening `observeThread` on child threads and re-emitting their items tagged `parentToolUseId` (102990-103080, `l_a` 102132).

### 2.2 ACP runner: stdio JSON-RPC to a child process (VERIFIED)

- One child process per Conductor session (`liveSessionsByConductorId`, 53153; spawn in `i0o` 51574 with `stdio: pipe`). Command comes from an adapter descriptor (`FL` table 43912): `opencode acp` (min version 1.16.2), `pi-acp` (binary from the `conductor-acp-providers` release), `muse` (own entry). Binaries are downloaded per platform (`install.targets`). A version check runs `--version` first (51551).
- Two wire protocols selected by `adapter.protocol` in `eU` (51589-51612):
  - Standard ACP (opencode, pi) via `hFr` (51230).
  - **MSP** (`protocol: "msp"`, muse only, 48404) via `aFr` (50697). MSP is a different JSON-RPC dialect: `initialize` with `userInputDialogs:false`, `session/resume {excludeItems:true}`, `session/setApprovalMode`, notifications `session/closed`, `session/viewHealthChanged`, `session/contextUsage`, delivery-gap filling through a `VL` session-fold object. It takes no MCP servers and no additional directories (50943-50946). INFERRED: MSP = Muse's session protocol; the runner folds it into the same internal event shape as ACP (`events.push({type:"turn_ended"...})` 50648).
- ACP client side (`hFr`): `initialize {protocolVersion:1, clientCapabilities:{fs:{readTextFile,writeTextFile}, elicitation:{form}, session:{configOptions:{boolean}}}, clientInfo:{name:"conductor"}}` (51276-51279, 53636+ for capabilities). Client handles agent->client calls: notification `session/update`, requests `session/request_permission`, `elicitation/create`, `fs/read_text_file`, `fs/write_text_file` (51270-51272). The client does the file IO itself, restricted to workspace + additional directories (`fX` 50979).
- Client->agent calls: `session/new`, `session/load`, `session/resume`, `session/prompt` (text-only prompt array), notify `session/cancel`, `session/set_config_option`, `session/set_mode`, `session/close` (51294-51330).
- Per-session event queue `dX` (50333) is an async queue; `consumeSessionQueue` (53259) is a loop that pulls typed events (`text`, `thought`, `tool_call`, `plan`, `usage`, `config_options`, `available_commands`, `mode`, `permission_request`, `question`, `turn_ended`, `turn_failed`) and dispatches.
- **New turn**: `runUserMessage` (53177) sets `activeTurn` (throws if one exists), waits for pending config-option writes, runs the adapter's `checkPrompt` (e.g. opencode slash-command validation `f0o`), reconciles model/config options, emits a synthetic `system/init` message, calls `session.prompt(...)` without awaiting it, then awaits a `settled` promise that `consumeSessionQueue` resolves on `turn_ended` (53399).
- **Follow-up**: another `runUserMessage` on the same ACP session (same process stays alive).
- **Steer**: **not supported**. `steerUserMessage` throws `yh` if no turn, else "ACP steering is not supported" (53444). The caller falls back (see 2.4).
- **Cancel**: `session.cancel()` = `session/cancel` notification, set `cancelled`, run `pendingPermissionCancels` (resolve every open permission/question as cancelled) (53455-53463). Result then arrives as `stopReason: cancelled` -> `Wo`.
- **Resume**: `openSession({resumeSessionId})` (51313-51330): prefers `session/resume` if the agent advertises it, else `session/load`, else warns and starts a new session. For MSP: `session/resume`, and a `sessionNotFound` falls back to a new session (50925-50935). The ACP session id is persisted from `onAgentMessage` (`ie.session_id` for `acp`, 311617). OpenCode has a `sessionStorage` hook that points the agent at a storage dir and prefixes ids (`persistedIdPrefix`, 51921-51931, `I4r`).
- Mid-session config: model and `acpConfig` options are reconciled before each prompt (`reconcileSessionConfig` 53211, `NFr` 51983). Model change = `session/set_config_option` on the option with `category:"model"`. The runner waits for the model catalog to contain the model if the adapter says `waitForModelCatalog` (opencode, 53592).
- One-shot prompts (`Xtt` 64269): a throwaway ACP process/session for utility prompts. `oneShotStrategy`: `"text"` or `"mcp-submit-response"` (agent must call a `SubmitResponse` tool on a local HTTP MCP server). Tools are rejected in one-shot mode.

### 2.3 Cursor runner: in-process SDK, no child protocol (VERIFIED)

- Uses `@cursor/sdk` loaded lazily in-process (`D6u` 309529; package metadata at 249437). Platform created with `createAgentPlatform({localStore: sqlite, eventNotifier, workspaceRef})`; local run state kept in a SQLite store under `cursor-sdk-store/<hash(workspaceDir)>` (309543-309556).
- Agent creation (310044-310056): `platform.resumeAgent(id, opts)`; if it throws a non-auth error, falls back to `platform.createAgent({...opts, agentId})`. `opts = {apiKey, model:{id, params:[{id:"fast",...},{id:"effort"|"reasoning_effort",...}]}, local:{cwd}, mcpServers}`. Cursor session id = Conductor session id (`resume ?? sessionId`); no separate id is persisted for Cursor (the persist branch at 311617 only handles codex and acp).
- **New turn**: `agent.send(...)` returns a run `u`; `for await (m of u.stream())` yields SDK messages; `await u.wait()`; one run at a time, else error "A turn is already in progress" (309939-309965).
- **Follow-up**: next `runUserMessage` reuses the live agent.
- **Steer**: `run.steer?.(text)`; outcome `"complete_delivered"` = ok, otherwise the runner throws `aX` ("revert to followup") unless the run was cancelled (309967-309977).
- **Cancel**: sets `cancelled=true` and calls `run.cancel()` (309978-309985).
- Env: because the SDK reads `process.env`, `withCursorEnv` (310076) temporarily mutates `process.env` under a serial promise queue (`envQueue`) and restores afterwards. INFERRED: this is a workaround for per-session env in a library with global env; it serialises all Cursor work that needs env.
- Tools: Conductor's own tools are passed as SDK `mcpServers`/tool objects (`O6u` 309579); user MCP from `~/.cursor/mcp.json` and `<workspace>/.cursor/mcp.json` is read and forwarded, with Conductor cloud servers overriding by name (`xUi` 309882, `Z6u` 309912, merge at 310057).
- No permission callbacks at all in the Cursor runner (see section 4).

### 2.4 Steering fallback is a shared policy (VERIFIED, 311601-311640)

Message arrives while the session is `working` and `deliveryMode === "steering"`:
1. call `runner.steerUserMessage(...)`.
2. `aX` -> re-run the whole send as a normal queued message (`deliveryMode:"default"`). This is what Cursor does on a non-delivered steer.
3. `Wo` -> swallow (user cancelled meanwhile).
4. `yh` (no active turn) -> either the turn just finished, so start a new turn; or the session was stopped, so surface the error.
5. any other error -> rethrow.
Otherwise (non-steering) the message goes into `pendingMessages` and a `userMessage` event with `state:"queued"` is emitted; the queue is drained after the turn ends.
For ACP the throw is `mc("ACP steering is not supported")`, which is an ordinary error, so steering ACP agents fails visibly rather than degrading. INFERRED: the UI hides the steering option for ACP.

## 3. Output normalisation: what is the "common shape"?

Two levels (VERIFIED at 37146 and the converters):

**Level 1, the event envelope (truly common).** The session event log holds `aL = teo | ieo | aeo | Oeo | Meo | ueo | leo`:
- `{type:"agent", rawPayload, userMessageId, turnId}` : the agent's output (payload is `z.record(string, unknown)`; type `Xo`, 36982/37146).
- `userMessage {id, message, state: queued|sent, turnId, resume, config, sender...}`
- `checkpointCreated {turnId, checkpointType: start|end, refPath, diff[]}`
- `frontendRpcRequest` / `frontendRpcResponse` (tool approval, diff, terminal output, run local command)
- `sandboxRestart`, `sessionHarness {harness}`
Plus a live-state object `GVe {status: working|idle, activeQuestions, activeUserInteraction, proposedPlan, error, backgroundTasks, pendingSteerMessageIds, fastModeAvailable}`. Notifications to the UI are `sessionNotification {notificationIndex, newEvents, updatedLiveState, updatedConfig}`.

**Level 2, the payload inside `rawPayload` (two dialects).**
- **Claude-SDK dialect = the de facto common shape.** Claude passes through natively. Cursor and ACP (incl. MSP) are *translated into Claude SDK messages*:
  - `{type:"system", subtype:"init", session_id, content}`
  - `{type:"assistant", session_id, message:{role:"assistant", content:[{type:"text",text}|{type:"thinking",thinking}|{type:"tool_use",id,name,input}]}}`
  - `{type:"user", session_id, message:{role:"user", content:[{type:"tool_result", tool_use_id, content, is_error}]}}`
  - `{type:"result", subtype:"success"|status, session_id, is_error, result, conductor_sdk_metadata:{...}}`
  - `{type:"error", session_id, content}` (Cursor)
- Tool names are rewritten to Claude's vocabulary so the UI renders them with its existing Claude tool cards:
  - Cursor `mFe` (309619): read/read_file->`Read`, edit/edit_file->`Edit`, shell->`Bash`, glob->`Glob`, list_dir->`LS`, createPlan->`ExitPlanMode`; input fields re-keyed (`path`->`file_path`, `globPattern`->`pattern`) by `mUi` 309639; MCP calls become `mcp__<server>__<tool>` (`U6u` 309692).
  - ACP: per-adapter `toolNameHints` (pi `find`->`Glob`; muse `exec_command`->`Bash`, `web_fetch`->`WebFetch`, `web_search`->`WebSearch`), `normalizeToolOutput`, diff content rendered as "Wrote/Edited <path>" (`cBr` 52923).
  - ACP plans become a fake `TodoWrite` tool_use + tool_result "Plan updated" (52985-52994); ACP questions become an `AskUserQuestion` tool_use (53054).
  - Streaming text/thought chunks are buffered and flushed as one `assistant` message at tool boundaries or turn end (`H8e.apply/flush`, 52952-53040; Cursor `pendingText/pendingThinking` 310000).
  - Usage: ACP `usage_update` -> `conductor_sdk_metadata.acpContextUsage` on the `result` message (52920).
- **Codex dialect (not translated to Claude shape).** Payload is `{event: ThreadEvent, thread_id}` where `ThreadEvent` is SDK-style: `thread.started`, `turn.started`, `turn.completed{usage}`, `turn.failed{error}`, `error{willRetry}`, `item.started|updated|completed{item}` (`yve`, 100738-100770). Items are Codex app-server items (`agentMessage`, `commandExecution`, `fileChange`, `mcpToolCall`, `contextCompaction`, `collabAgentToolCall`, ...). Extra Conductor-made events: `codex.mcpConsentOutcome`, `codex.subAgentStatus`, `thread.goal.updated|cleared`, `conductor_sdk_metadata.codexUsage`. So the frontend must have a second renderer for Codex. INFERRED (the renderer is not in the sidecar).

Where the agent's own session id comes from: sidecar reads `thread_id` (codex) or `session_id` (acp) off each payload and stores it as `agentSessionId` (311617-311620). That is why every payload carries the id.

## 4. Permissions and approvals

Shared plumbing (VERIFIED): a per-session manager holds **one** `activeUserInteraction` at a time with kinds `question | mcpElicitation | codexPermissionApproval` (schema `eeo`, 37146; closure 310690-311045). Each `request*` returns a promise stored with its `resolve`; the frontend answers through RPC `resolveMcpElicitation`, `resolveCodexPermissionApproval`, `answerQuestion` (311950-311960). `cancelPendingInteractions` resolves everything as cancelled/declined (310701-310712). Tool approvals use a different path: `callbacks.onToolApproval` -> `outgoing.toolApproval` -> frontend RPC `toolApproval` -> `{decision: allow|allow_edits_for_session|allow_with_permissions|always_allow|deny}` (`yeo`, 37146).

| | Mechanism |
|---|---|
| **Codex** | Policy is set per thread at `thread/start`: `approvalPolicy` (default `"never"`) and `sandbox` (default `"danger-full-access"`) from config (`EXr` 102258), clamped to what the org allows (`S_a` 102269ff; the rule is in 4.1). Server-initiated requests registered on the JSON-RPC peer (100673-100700): `item/commandExecution/requestApproval` -> tool approval as toolName `Bash` (`decline`/`acceptForSession`/`accept`, 102970-102979); `item/fileChange/requestApproval` -> toolName `Edit` (102980-102995); `item/tool/requestUserInput` -> `onAskUserQuestion`; **`mcpServer/elicitation/request`** -> `requestMcpElicitation` (forms: string/number/bool/enum/array schemas, `openai/form`, `url` mode; 37146 `WZs`); **`item/permissions/requestApproval`** -> `requestCodexPermissionApproval` with filesystem read/write/glob/network permission sets, answer `grant{grantedPermissions, scope: turn|session}`, `decline`, or `cancel` (`XZs/ZZs`). Handlers live in `setCodexMcpConsentHandlers` (102924); outcomes `user_declined`, `user_canceled`, `interaction_unavailable`, `timeout`, `agent_cancelled` are logged and emitted as `codex.mcpConsentOutcome`. If a callback is missing, command approvals decline; permission approvals throw. |
| **ACP** | Policy is binary: `requiresToolApprovals ? "ask" : "auto_approve"` (`pBr` 53072). For `auto_approve` the runner answers `allow_once` itself (53356). For `ask`: `session/request_permission` is turned into a `permission_request` event; the runner first shows the tool_use, then calls `onToolApproval` and maps decision -> ACP option kinds `allow_once`/`allow_always`/`reject_*` (`Ddo` 51122). Agents also get the policy via env (opencode `OPENCODE_CONFIG_CONTENT` permission `"*":"ask"` or `"allow"`, 51806-51812). If a permission request offers >=2 allow options and no reject option, it is treated as a **question** (`Bdo` 51115). ACP `elicitation/create` (form mode only) becomes a `question`; other modes are declined (51250). MSP: approvals come through `session.onApproval` and are surfaced the same way; MSP "userInput" is not answered (50763). |
| **Cursor** | None in the runner (VERIFIED by absence: no `onToolApproval`/question callbacks in `zae`). Cursor local agents run with the SDK's own defaults; Conductor does not intercept. Its own tools (`z1`) are built with `includeAskUserQuestion:false` (309579-309586; `M6u` metadata). |

### 4.1 Codex managed requirements (VERIFIED by running, 7 November 2026)

Codex can carry requirements an administrator sets (a `requirements.toml` or MDM entries). codex-cli 0.154.0's app-server protocol has `configRequirements/read` (no params, `codex app-server generate-ts`, `v2/ConfigRequirementsReadResponse.ts`). Its answer is `{requirements: ConfigRequirements | null}`, null when nothing is configured. Of its many fields, `allowedApprovalPolicies` (`AskForApproval[] | null`, where `AskForApproval` is `untrusted | on-request | never | {granular}`) and `allowedSandboxModes` (`read-only | workspace-write | danger-full-access`, or null) limit what a thread may ask for.

Conductor's sidecar sends `configRequirements/read` once per app server, after `initialize` and `experimentalFeature/enablement/set` and before the first `thread/start`. A Codex that answers with an error (the fake's "method not found") gets the requested values unchanged. Conductor then narrows the thread's policy and sandbox. The sidecar differential run measured the rule on eight sets of requirements (scenarios `codex-requirements*`), each list also in reverse order, and the order never mattered:

| Asked (policy, sandbox) | Allowed policies | Allowed sandboxes | Conductor sent |
|---|---|---|---|
| never, danger-full-access | untrusted, on-request | read-only, workspace-write | on-request, workspace-write |
| on-request, danger-full-access | on-request, never | danger-full-access | on-request, danger-full-access |
| on-request, workspace-write | untrusted, never | read-only, danger-full-access | untrusted, read-only |
| untrusted, read-only | on-request, never | workspace-write, danger-full-access | on-request, read-only |
| on-request, workspace-write | never | danger-full-access | never, workspace-write |

So an allowed choice is kept. Otherwise each setting takes the widest allowed choice below the one asked for (fewer actions without asking). With nothing allowed below it, the approval policy takes the narrowest allowed choice above, and the sandbox stays as asked. Our `narrowToRequirements` (runners/codex/thread-settings.ts) follows this rule. Not measured: a granular policy object in the allowed list (ours passes over it), an empty list, and whether Conductor reads the requirements again on `thread/resume` (ours reads once per app server, before its first thread or resume).

## 5. Model discovery and auth

**Model catalog (static, per harness).** A built-in table: `GV` claude (5635), `PGt` codex (5661), `LGt` cursor (5671); entries have `id`, `label`, `status: picker|gated|deprecated`, `effortLevels`, `wireName`, `requiredArtifacts`. `defaultModel` per harness is read through `J0(harness,{host})` (44505-44507). A catalog can be replaced at runtime via `SET_MODEL_CATALOG` (314118) and validated server-side (`Gu(model)`, `q1e`). Codex wire model/provider is chosen by `getModelRouting` (102369) which can swap to a "managed model provider" (AI gateway) when workspace settings say so.

**Dynamic discovery:**
- `listCodexModels` (`Vn.LIST_CODEX_MODELS`, handler `Gji` 313048): spawns a temporary `oj` client, `initialize`, pages through `model/list {cursor, includeHidden:true}` (`wXr` 102239), returns `{id, displayName, description, hidden}`; hidden models are dropped unless they are in the static catalog. Separately `codex debug models` output is converted to a `model_catalog_json` config file for the ChatGPT route (103322-103335, written to tmp dir atomically).
- `listAcpModels` (`Vn.LIST_ACP_MODELS`, `Lji` 312976 -> `Ztt` 64336): launch the ACP agent, `session/new`, read the `session/config_options` entry with `category:"model"` and type `select` (`t6` 51897, `tU` 51902). For `waitForModelCatalog` adapters (opencode) it waits up to 15 s for config options to arrive. When given `configModelIds` it also sets each model in turn and snapshots the per-model option set (thinking level etc.), whole run capped at 90 s. This is the "opencode model discovery" path; there is no separate file, it is the adapter flag `waitForModelCatalog` plus `Ztt`. (A `listMcpServers` hook `TFr` handles OpenCode native MCP discovery.)
- Cursor: no list call; static catalog only.
- Per-session ACP option RPCs: `fetchAcpSessionConfigOptions`, `syncAcpSessionModel`, `setAcpSessionConfigOption` (314063-314073, handlers 313009-313047), always serialised through `sessionLifecycleQueues.run(sessionId, ...)` and refused (`deferred`/`not_ready`) while a turn is live.

**Auth:**
- Claude: `claudeAuth` -> `authenticate()` returns account info (312364). 
- Codex `codexAuth` (`oji` 312371): `refreshCodexAccountInfo` spawns a throwaway app-server, `account/read`, then starts a thread to learn the real provider (102672-102694). Account types `apiKey | chatgpt | amazonBedrock`.
- Codex cloud auth (`codexCloudAuthStart/Finish`, 102695-102731, 312382-312397): starts an app-server with an isolated temp `CODEX_HOME` (credentials store forced to file), calls `account/login/start {type:"chatgptDeviceCode"}`, returns `{loginId, verificationUrl, userCode}`; the finish call awaits `account/login/completed` (10 min timeout), reads the resulting auth cache (`A_a`) and returns it so a remote/cloud sandbox can reuse the ChatGPT subscription login; the temp dir is deleted by cleanup (also on a 10 min timer). ChatGPT token refresh is delegated to a host-supplied provider (`onChatGptAuthTokensRefresh` -> `refreshChatGptAuthTokens`, 102873). Usage-limit and subscription-sharing errors are mapped to friendly messages (`NQr/LQr` 100802/100822).
- Cursor cloud auth (`cursorCloudAuthStart/Finish/Cancel`, 312399-312450): `Cursor.auth.login({openBrowser:false, onLoginUrl, store:null, apiKeyName:"Conductor"})` from the SDK; start returns `{loginId, loginUrl}`, finish returns `{apiKey, email, apiKeyExpiresAt}` (the key is handed back to the app to store; the sidecar keeps no store); only one pending login at a time (new start aborts the old). Cursor API key is otherwise read from `CURSOR_API_KEY` env or provider settings; a rejected key becomes a specific message pointing to Settings (310047, `gUi` 310095).
- ACP: `authenticate` unsupported in the runner; the ACP `initialize` result's `authMethods` are kept and used only to improve error messages (`m4r` via `ZL` 51586). OpenCode/Pi/Muse keys come from the user's own agent config or env (muse hint: "Check your Muse Code API key in Settings").

## 6. Harness-specific versus shared

**Shared (written once, harness-blind):**
- Session manager: queue, dedupe, steering policy, status, checkpoints, event log with outbox/ack, notifications (311560-311850, `PFe`).
- Event envelope, live-state, interaction kinds, config schema (37146).
- RPC verbs (`Vn` 4751): `query`, `steer`, `cancel`, `warmAgent`, `contextUsage`, `fetchSlashCommands`, `fetchAvailableMCP`, `answerUserQuestion`, one-shot prompts. `STEER` reuses the `QUERY` handler with `deliveryMode:"steering"` (314012).
- Process manager keyed by `agentType:sessionId[:hash(workspaceDir, configKey)]` (`d0` 44454): warm/claim/disconnect leases; changing agent type mid-session disconnects the old process (313447).
- Conductor tools: one tool list `z1(...)` (run local command, get diff comments, update progress, set target branch, computer admin) exposed three ways: SDK tool objects (Cursor), stdio MCP via `conductor-runtime codex-mcp` + unix socket (Codex), MCP servers built by `tBr` 52608 / `fZe` 52594 (ACP, with capability checks `stdioMcp/httpMcp/sseMcp`). Same idea, three transports.
- Workspace-settings bundle (cloud MCP servers, env) refreshed per session start, with last-known fallback.
- Env building is per harness (`Jqi` claude, `Gqi` codex, `zqi` cursor, `Hqi` acp: 312168-312230). Each strips its own secrets from the inherited env (codex strips `OPENAI_API_KEY`, claude strips `ANTHROPIC_*`) then applies user overrides.

**Harness-specific:**
- Codex: app-server protocol, thread/turn ids, goals, `/compact`, rollback, sub-agent observation, MCP elicitation and filesystem/network permission grants, sandbox/approval policy, rate-limit/usage windows, ChatGPT login, `~/.codex/config.toml` surgery, code-mode host, checkpoint hooks.
- ACP: capability negotiation (resume vs load, boolean config options, MCP transports), per-adapter descriptor (`resolveCommand`, `minimumVersion`, `normalizeToolOutput`, `toolNameHints`, `prepareAgentText`, `checkPrompt`, `waitForModelCatalog`, `permissionPolicy`, `nativeMcp`, `sessionStorage`, `oneShotStrategy`, `listSkills`, `listMcpServers`), MSP as a second wire protocol behind the same adapter list, client-side `fs/*`.
- Cursor: in-process SDK + SQLite store, process.env mutation lock, `~/.cursor/mcp.json` merge, browser login for API key, no approvals, no slash commands/skills/MCP listing (`getSlashCommands` returns `[]` at 309999, `fetchAvailableMCP` returns `[]` for cursor at 313058).
- Capability asymmetry is handled at the call site by `agentType` branches (e.g. `getContextUsage` 311860-311880, `fetchSlashCommands` 44790ff) and by runner methods that throw "not supported", not by capability flags on the runner.

## 7. Lessons for designing a multi-agent app

1. **Pick a canonical message dialect and translate everything into it.** Conductor chose the Claude SDK message format (`system/init`, `assistant{text|thinking|tool_use}`, `user{tool_result}`, `result`) and rewrote Cursor and ACP into it, including renaming tools and fabricating `TodoWrite` and `AskUserQuestion` calls. One renderer then serves three agents. The cost is lossy mapping and fake tool names. Codex was the exception (its own item model), which forces a second renderer. If you start fresh, define your own neutral schema (message, tool call, tool result, plan, question, usage) instead of borrowing a vendor's.
2. **Keep the envelope neutral and the payload opaque.** Storing `{type:"agent", rawPayload}` means new agents need no schema migration and the event log keeps raw fidelity. Pull out only what the host needs (session id, usage) from each payload.
3. **Thin runner contract, fat session manager.** Runner = `warm / runTurn / steer / stop / destroy / status / contextUsage / rollback`. Queueing, steering fallback, checkpoints, persistence and UI state sit above it. A turn is one awaited call; the runner pushes messages through callbacks.
4. **Make "unsupported" explicit and typed.** Throw `NotSupported` / `NoActiveTurn` / `Cancelled` / `RevertToFollowup` and let one place (the steering block, 311601) decide the fallback. Use distinct errors for "user cancelled" so it never shows as a failure.
5. **Model human-in-the-loop as a few interaction kinds with one-at-a-time state.** question, tool approval, structured permission grant, MCP form. Every agent's native request is mapped onto these, and cancel resolves them all.
6. **Prefer open protocols where they exist, wrap SDKs where they do not.** ACP gives opencode/pi for one client implementation plus a small adapter descriptor. Even there Conductor needed a second protocol for Muse and many per-agent hooks (tool names, text cleanup, model-catalog waiting, permission via env). Budget for an adapter layer on top of any "standard".
7. **Agent session ids are the resume key, per harness.** Codex thread id, ACP session id (+ resume/load capability), Cursor agent id = your id. Persist whatever the agent reports, always try resume, and fall back to a fresh session with a log line (Codex, ACP and MSP all do).
8. **Serialise config changes against turns.** Model/option changes are rejected or deferred while a turn is live (`deferred`/`not_ready`), and per-session lifecycle operations go through a per-session queue.
9. **Stop is a protocol, not a flag.** Codex: interrupt RPC plus local abort plus stop generation counter for the init race; ACP: cancel notification plus release pending interactions; Cursor: run.cancel plus flag. All three also need "stop during startup" handling.
10. **Isolate credentials and env per session.** Strip inherited provider keys, inject per-session tokens (GitHub, MCP bridge token), keep logins (Codex device flow) in temp homes that are cleaned up on a timer.
11. **Give agents your own tools through MCP, one definition, several transports.** Local execution, diff comments, progress, target branch.
12. **Discover models from the agent when it can tell you, otherwise ship a static catalog** with `picker/gated/deprecated` status and effort levels. Both exist here (Codex `model/list`, ACP config options, static tables).

## 8. Gaps and unverified points

- Codex start-up calls Conductor makes that ours does not, seen in the sidecar differential run (docs/reports/sidecar-diff-2026-11-07.md) and not yet researched or built:
  - `experimentalFeature/enablement/set` once per app server (`{enablement: {background_paginated_rollout_migration: true}}` in that run).
  - `account/read` and `thread/goal/get` for each chat, after `thread/start`.
  - On `thread/start`: `personality` (default `pragmatic`), `persistExtendedHistory: true`, `experimentalRawEvents: false` and six `features.*` flags in `config`.
  - On each `turn/start`: `collaborationMode` (Codex plan mode) and `summary: "none"`.
  What each changes for the user, and which Codex versions accept them, is research to do.

- Claude runner (`Dat`) not read. Statement that it passes through natively is INFERRED from the shape the other runners imitate.
- The frontend renderer is not in the sidecar, so "the UI has a second renderer for Codex" is INFERRED.
- Muse/MSP: protocol meaning of "MSP" is not spelled out in the code; the behaviour described is from the client code only.
- Exact content of `checkPrompt` for opencode (`f0o`, 51748) and `I4r` (opencode session storage) were not read in full.
- The `codex-mcp` server body (`bhs`, 344346) was not read; only how it is launched and what args it receives.
- Cursor `localExecution`/approval behaviour inside the SDK is outside this file; absence of callbacks is only a statement about Conductor's runner.

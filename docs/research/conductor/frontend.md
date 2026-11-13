# Conductor frontend: extraction and structure notes

Source: `/Applications/Conductor.app/Contents/MacOS/conductor` (Tauri 2, Mach-O arm64).
All offsets below are character offsets in the minified bundle (`@N`), so they can be re-found with `scripts/conductor-re/ctx.py`.
VERIFIED = read in the extracted code at the cited location. INFERRED = reasoned from names or surrounding code, not traced end to end.

## 1. Extraction (worked)

Script: `scripts/conductor-re/extract_tauri_assets.py`. Run it with `/usr/bin/python3 -I scripts/conductor-re/extract_tauri_assets.py <binary> <outdir>`.

Method (VERIFIED by result):
- Tauri codegen emits a `phf::Map<&str, &[u8]>`. Its entries array sits in `__DATA_CONST,__const` as runs of four 8-byte words: `(key_ptr, key_len, val_ptr, val_len)`.
- The pointers are chained-fixup rebases. The low 36 bits hold the target, as a vm offset from `0x100000000`.
- The script scans `__const` word by word. A candidate is kept when both pointers resolve inside the file, the key is printable and starts with `/`, and the value brotli-decompresses.
- It found 3,091 candidates and wrote 2,951 files. The 139 failures are non-asset `(str, str)` pairs, such as `/usr/bin/gzip` and cargo source paths.
- `brotli` lives in the user site-packages, which `-I` hides. The script appends `site.getusersitepackages()` to `sys.path` explicitly.

Output: `.context/conductor-re/frontend/`, with paths preserved. It holds `assets/` (1,980 files), `material-icons/` (910), `app-icons/`, `fonts/`, sounds, onboarding mp4s, `cities_top_{100,1000,5000}.txt` and `index.html`.
- `index.html` loads `/assets/main-BE1h_1MP.js`. This build's app chunk is `renderApp-DeUrsznk.js` (12.2 MB), not the `BgVPQyGe` hash named in the task.
- Bundles end with `sourceMappingURL=...map` plus a Sentry `debugId`, but no `.map` files are embedded.
- The Rust side of the source tree is `src/client/frontends/desktop/app/src/theme.css`, named in an `index.html` comment.

Helper scripts:
- `scripts/conductor-re/ctx.py <file> <regex> [before] [after] [max]` prints regex hits with context.
- `scripts/conductor-re/extract_sql.py <out> <bundles...>` dumps SQL literals. The dump is at `.context/conductor-re/sql-statements.txt` (319 unique statements).

Main bundles analysed: `assets/main-BE1h_1MP.js` (3.9 MB, services and data layer) and `assets/renderApp-DeUrsznk.js` (12.2 MB, React UI).

## 2. Stack and state management

| Concern | Library | Evidence |
|---|---|---|
| UI | React with the React Compiler (`Y.c(n)` memo caches everywhere) | VERIFIED, renderApp throughout |
| Routing | TanStack Router (`routesById`, `beforeLoad`, `validateSearch`, `useLoaderData`) | VERIFIED renderApp @217111 |
| Server/async state | TanStack Query (`QueryClientProvider`, `invalidateQueries` ×73, `ensureQueryData`) | VERIFIED main @631040 |
| Client state | zustand. `Yn` = vanilla `createStore`, `pr` = React `create`, `Ar` = `subscribeWithSelector`, plus the `persist` middleware (localStorage) | VERIFIED main @273978, @274232, @421685, @274896 |
| Validation | zod. Every sidecar message is `.parse()`d against a schema | VERIFIED main @1664016–1690000 |
| Composer | TipTap / ProseMirror, with Mention nodes | VERIFIED renderApp (`[tiptap error]` strings) |
| Chat list | `@virtuoso.dev/message-list` (commercial `VirtuosoMessageList`; the license key is embedded, not copied here) | VERIFIED renderApp @9608198 |
| Diff viewer | `@pierre/diffs` (`FileDiff`, `pierre-dark/light` themes, Shiki highlighting) | VERIFIED |
| Terminal | xterm.js over Rust PTY commands | VERIFIED |
| Other | Base UI menus, cmdk palette, Sentry, PostHog | VERIFIED by string counts |

Stores and services are mostly class singletons that wrap zustand stores. Examples: `Ne` (workspace service, `Ne.state.workspacesById`), `lv` (setup process store), `usePortAllocationStore`, `useSetupProcessStore`. Dependencies are injected through a `t.dependencies.{shell,db,fs,git,stores,settings,logging}` object, and a full mock set exists at main @573000–575000 (INFERRED: for tests and dev fixtures).

Routes (VERIFIED, `path:`/`to:` literals in renderApp):
- Workspace: `/repository/$repositoryId/workspace/$localWorkspaceId`.
- Top level: `/all-workspaces`, `/dashboard`, `/pull-requests`, `/create`, `/login`, `/diagnostics`, `/profile/$orgSlug/$userId`. Remote control is a settings tab, not a route. `/automations/*` redirects to `/routines/*`. Full table in [ui-map.md](ui-map.md).
- Routines: `/routines`, `/routines/new`, `/routines/$automationId`.
- Onboarding: `/first-run-onboarding`, `/new-member-onboarding`, `/cloud-collab-onboarding`.
- Settings: `/settings/user/{general,providers,models,account,git,connections,experimental,internal}`, `/settings/repos/$repoId/{scripts,actions,misc}`, `/settings/organization/{computer,prompts,environment,mcp,repositories/$owner/$repo/...}`.

## 3. How the UI talks to the backend

### 3a. Tauri invoke
The invoke wrapper is `oe(cmd,args)` in main (@3590), exported as `bw` and imported as `ha` in renderApp. A second copy, `wt`, is used by the plugin JS. There are 104 custom commands (VERIFIED, grep of `oe("…"`/`wt("…"`/`ha("…"`):

- Sidecar: `ensure_sidecar_started`, `rpc_to_sidecar`, `check_sidecar_http_health`, `configure_sidecar_inspect`, `configure_sidecar_internal_user`, `get_sidecar_log_path`.
- Shell: `execute_shell_command`, `execute_shell_command_cancellable`, `cancel_shell_command`, `get_user_shell`, `get_path_env`.
- PTY: `pty_spawn`, `pty_write`, `pty_resize`, `pty_kill`, `pty_ack_bytes`, `pty_screen_snapshot`, `pty_screen_text`, `pty_load_terminal_history`, `pty_persist_terminal_history`, `pty_create_mirror`, `pty_write_mirror`, `pty_resize_mirror`, `pty_delete_mirror`.
- Files: `list_file_tree`, `fuzzy_filter_files`, `fuzzy_match_files`, `grep_workspace`, `get_file_metadata`, `write_file_async`, `list_workspace_artifacts`, `materialize_local_path_attachment`.
- Agent binaries: `get_agent_binary_state`, `request_agent_binary_download`, `redownload_agent_binary`, `remove_agent_binary`, `prefetch_agent_binaries_from_updater_endpoint`, `sync_agent_path_overrides`, `get_binary_verification_errors`, `check_codex_auth`.
- Networking: `native_http_fetch(_cancel)`, `native_http_download_file`, `native_http_upload_file`, `raw_websocket_{open,send_text,ping,close}`, `configure_http_proxy`, `find_available_local_port`.
- Port forwarding: `start/stop/list_port_forward(s)`, `resolve/reject_port_forward_token`.
- Remote file sync: `start/stop/trigger_remote_file_sync`, `cleanup_remote_file_sync`, `set_remote_file_sync_foreground`, `resolve/reject_remote_file_sync_direct_info`.
- Keychain: `get/set/delete_keychain_setting`, `get_or_create_local_storage_encryption_key`, `get_anthropic_api_key_from_env`, `get_openai_api_key_from_env`, `get_deepgram_api_key`.
- Speech: `start/stop/cancel_on_device_speech`, `on_device_speech_available`.
- App: `get_db_uri`, `get_db_version_warning`, `send_native_notification`, `set_dock_badge`, `update_window_vibrancy`, `update_traffic_light_position`, `quit_app`, `set_quit_handler_ready`, `check_for_updates`, `get_installed_manual_update`, `poll_app_action`, `submit_app_action_result`, `ensure_app_actions_started`, `take_pending_notification_deep_links`, plus logging and Sentry config commands.

Plugins used: `sql`, `shell`, `fs`, `http`, `dialog`, `clipboard-manager`, `opener`, `notification`, `deep-link`, `updater`, `process`, `os`, `window`, `webview`, `event`.

### 3b. Tauri events listened to (VERIFIED; `Uo` in main @5411, imported as `hv`)
- Sidecar and agent binaries: `rpc_from_sidecar`, `agent_binary_progress`, `binary_verification_errors`, `manual_update_status`.
- PTY: `pty-data`, `pty-exit`, `pty-ready`.
- Port forwarding: `port-forward-event`, `port-forward-token-request`.
- App lifecycle: `quit_requested`, `deep-link://new-url`.
- Menu actions: `toggle_left_sidebar`, `toggle_right_sidebar`, `open_settings_page`, `open_diagnostics_page`, `open_feedback_dialog`, `open_keyboard_shortcuts_dialog`, `open_submit_prompt_dialog`, `open_documentation_url`, `open_changelog_url`, `open_best_practices_url`.

### 3c. Sidecar JSON-RPC tunnel (VERIFIED main @2681605, class `iOt`, singleton `Ve`)
- It uses the `json-rpc-2.0` npm package as a `JSONRPCServerAndClient`.
- Outbound: `invoke("rpc_to_sidecar", {line: JSON.stringify(msg), agent})`. The `agent` field is set to `claude` or `codex` only when no custom executable path is given, so Rust can resolve the bundled binary.
- Inbound: Tauri event `rpc_from_sidecar` with `payload.line`, which goes through JSON parse, then `peer.receiveAndSend`.
- The tunnel is bidirectional. The frontend is also an RPC server: the sidecar calls *into* the UI.

Method enums (VERIFIED main, `Fa`/`Ui`/`fn`/`ta` objects):
- Frontend→sidecar notifications (`ta`): `query`, `updatePermissionMode`, `setClaudeEditAutoAccept`, `resetGenerator`, `setVerboseLogging`, `setInternalUser`, `setAppLoggerUrl`, `crashTest`, `setPostHogDistinctId`, `setExternalLoggingDisabled`, `setModelCatalog`, `persistedSessionEvent` (the delivery ack), `remoteControlChanges`.
- Frontend→sidecar requests (`fn`): `cancel`, `steer`, `claudeAuth`, `codexAuth`, `codexCloudAuthStart/Finish`, `cursorCloudAuthStart/Finish/Cancel`, `fetchAvailableMCP`, `fetchSlashCommands`, `fetchPreWorkspaceCompletions`, `contextUsage`, `warmShellEnv`, `warmAgent`, `getShellEnv`, `codexRollback`, `codexCompact`, `codexGoalSet/Clear/Get`, `getSessionStatus`, `getHarnessVersions`, `answerUserQuestion`, `startAgentationProxy`, `listLocalhostPorts`, `listAcpModels`, `fetchAcpSessionConfigOptions`, `syncAcpSessionModel`, `setAcpSessionConfigOption`, `listCodexModels`, `acpOneShotPrompt`, `cursorOneShotPrompt`, `remoteControl{Start,Stop,Status,CreatePairingOffer,ClearPairingOffer,ListPairedDevices,RemovePairedDevice}`.
- Sidecar→frontend notifications (`Ui`): `message`, `queryError`, `sessionEventNotification`, `sessionStatusNotification`, `sessionStateNotification`, `enterPlanModeNotification`, `fastModeUnavailableNotification`, `checkpointCreated`, `shellEnvCaptureNotification`, `harnessVersionsNotification`, `codexMcpConsentDeliveryFailed`, `keepAwake`, `remoteControlState`, `remoteControlPairedDevicesChanged`.
- Sidecar→frontend requests (`Fa`, the frontend answers): `deliverSessionEvent`, `exitPlanMode`, `askUserQuestion`, `toolApproval`, `codexMcpElicitation`, `codexPermissionApproval`, `getDiff`, `getDiffComments`, `diffComment`, `getTerminalOutput`, `frontendRelay`. These back Conductor's own MCP tools (`mcp__conductor__GetWorkspaceDiff`, `DiffComment`, `GetTerminalOutput`, …): the agent's MCP call goes to the sidecar and then to the UI, which reads its DB or terminals.

Key payload schemas (VERIFIED main):
- `query` (@1677377): `{type:"query", id, agentType, message, prompt, options}`.
  - `agentType` is one of `claude|codex|cursor|acp|unknown` (@1664016).
  - `options` (`rwt` @1672386) has `cwd, model, workspaceId, host{hostingServerUrl,vmId}, userMessageId, maxTurns, resume, turnId, conductorEnv, ghToken, permissionMode, additionalDirectories, fastMode, requiresToolApprovals, mainWorktreePath, agentParams, showThinking, deliveryMode, …`.
- `message`: `{type:"message", id(sessionId), agentType, data:<raw agent SDK message>, turnId?}` (@1670276).
- `sessionStatusNotification`: `{status:"working"|"idle", backgroundTasks[], waitingSince, pendingSteerMessageIds[], pendingSteersOnly}` (@1681859).
- Session feed events (@1681413), a union of three shapes:
  - `userMessage{eventId,id,message,state:"queued"|"sent",turnId,inboxHandoff{mode:"queue"|"steer",…}}`
  - `agent{eventId,rawPayload,userMessageId,turnId}`
  - `checkpointCreated{…}`
- `toolApproval` request: `{sessionId, toolUseId, toolName, toolInput, decisionReason, blockedPath, suggestions}`. The decision is one of `allow|allow_edits_for_session|allow_with_permissions|always_allow|deny`.
- `askUserQuestion`: `{sessionId, questions[{question, options[], multiSelect, header, richOptions, isOther, isSecret}]}`.

Send path (VERIFIED main @3223185, `executeSession`):
- On a local host it calls `ts.query(c)`. When `options.deliveryMode==="steering"`, it calls `ts.steer(c)` instead.
- Steer falls back to `query` when the sidecar answers MethodNotFound (@3103767).
- On a cloud host it calls `et.cloud.executeSession(...)` over HTTP to "Roundhouse" (Conductor's server).

Inbound path (VERIFIED renderApp @12085900–12091266):
- `onMessage` calls `Wul()`, which calls `U1.persistAgentPayload` to write into SQLite, then handles result and usage.
- `onSessionEvent` / `onDeliverSessionEvent` call `ingestSessionEvent`. Ingestion runs through a **per-session serial queue**.
- After persisting, the frontend sends `persistedSessionEvent` back as an ack. So the sidecar keeps the event until the UI confirms it is durable.

## 4. The frontend runs SQL itself (VERIFIED)

- main @957538 is a thin `tauri-plugin-sql` wrapper: `plugin:sql|load/execute/select/close`. The DBs are `sqlite:conductor.db` (main, URI from `get_db_uri`) and `sqlite:cache.db`. WAL is set by `PRAGMA journal_mode = WAL` (@958089).
- The bundles hold 319 unique statements (`sql-statements.txt`). Tables touched include `workspaces` (79 statements), `session_messages` (40), `diff_comments`, `sessions` (24), `attachments`, `port_forwards`, `identity_associations`, `repos`, `client_cache_session_state/segments`, `session_messages_outbox`, `session_assets_outbox`, `session_events`, `session_state`, `session_pending_messages`, `terminal_sessions`, `settings`, `env_vars`, `navigation_sections`, `favorite_models`.
- There is **no `CREATE TABLE` in the frontend**. Schema migrations live in Rust as sqlx migrations: `strings` on the binary shows `_sqlx_migrations` plus about 30 `CREATE TABLE` statements (VERIFIED).

Representative statements (VERIFIED, offsets in main):
```sql
-- @2457399 new session
INSERT INTO sessions (id, workspace_id, status, claude_session_id, last_user_message_at, agent_type, model, acp_config,
  permission_mode, codex_thinking_level, agent_personality, fast_mode, claude_effort_level, feed_offset, created_at, updated_at)
VALUES (?, ?, 'idle', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, -1, ?, ?)
-- @1429849 message row (full_message = raw SDK JSON)
INSERT INTO session_messages (id, session_id, role, content, sent_at, created_at, full_message, model, sdk_message_id, turn_id,
  last_assistant_message_id, is_resumable_message, queue_order, sender_id, sender_session_id, sender_api_key_name, sender_source) VALUES (...)
-- @1548674 append-only event log, idempotent on event_id
INSERT INTO session_events (session_id, session_index, event_id, event_type, content, received_at)
SELECT ?, COALESCE(MAX(session_index), -1) + 1, ?, ?, ?, ? FROM session_events WHERE session_id = ?
ON CONFLICT (session_id, event_id) DO NOTHING RETURNING session_index
-- @1539454 queued (unsent) messages
SELECT * FROM session_messages WHERE session_id = ? AND sent_at IS NULL AND cancelled_at IS NULL ORDER BY COALESCE(queue_order, 0), created_at, id
-- @1549242 revert: mark later events reverted
UPDATE session_events SET reverted_at = ? WHERE session_id = ? AND reverted_at IS NULL AND session_index >= (SELECT MIN(session_index) ... event_type = 'userMessage' ...)
-- @1144763 archive
UPDATE workspaces SET state = 'archived', branch = ?, archive_commit = ? WHERE local_id = ?
```

Data model as the frontend sees it:
- A **queued message** is a `session_messages` row with `role='user'`, `sent_at IS NULL` and a `queue_order`. Sending sets `sent_at` and `turn_id` (@1546406).
- A **turn** is grouped by the user message `turn_id`.
- `session_state` holds JSON `live_state` and `config` per session.
- `session_messages_outbox` and `session_assets_outbox` are a composer outbox with retry state (`send_attempt_count`, `next_send_attempt_at`) (INFERRED: offline-safe delivery, mainly for cloud sessions).
- `identity_associations` maps local ids to server ids for cloud sync.

## 5. Chat rendering (renderApp)

- **List** (VERIFIED @9608198, `Dma`): `VirtuosoMessageList` with `increaseViewportBy:600`. There is **one item per turn** (`data` = turns, key = turn id), plus a Header (history loading) and Footer. A "Scroll to bottom" button is portalled into an overlay. Each turn has its own error boundary ("This chat turn failed to render").
- **History in pages** (VERIFIED main and renderApp, offsets below). A chat opens on a window of its last five turns (`egt` @1531473, `Xmt` @1531402), counted by when each turn's first user row was sent. Its rows are read in pages of 500 (`AA` @1538061, `TO` @1537075). While older turns are stored, the list's Header shows "Loading messages…" and, each time the top of the list is within 800 pixels (`jQi` @9596045), loads one more turn (`_ma` @9596613, `expand` @1531832). A failed load shows "Couldn't load messages" with Retry (`tWt` @9596053). Until the turns fill the list, nothing older is stored, a load failed or 5 seconds pass, the list is hidden under the loading skeleton (`Wma` @9609810, `vma` @9597304). The turn outline lists every turn from a separate query of each turn's first 100 characters (`ugt` @1541753) and marks plans in loaded turns only (@9415668). Picking an outline turn that is not loaded loads that turn alone (`revealTurn` @1532172) and leaves a gap marker that loads the turns beside it as it scrolls into view (`FQi`, `yma`). Find in the chat searches the loaded turns. Copying a transcript reads every row (`getCompleteMessages` @1399804).
- **Turn building** (VERIFIED main @1427000–1429800):
  - Rows group into turns.
  - Sub-agent messages are bucketed under their parent `Task`/`Agent`/`collab__spawnAgent` tool call, using `parent_tool_use_id` (`vmt`, `_mt`).
  - An incremental differ (`IW`) fingerprints settled rows (id, role, turn_id, sent_at, cancelled_at, last_assistant_message_id). It classifies each update as `same|appended|truncated|inserted|cleared|initial`, so streaming only re-renders the tail.
- **What one turn shows** (VERIFIED main, offsets below). This is the rule the chat history spike compares against (APP-18).
  - The chat reads only sent rows of `session_messages`, ordered by `sent_at`, then `rowid` (`AA` @1538196). Queued rows live in the queue, not the chat.
  - Each row is one message. A `user` row's `content` is the text the user sent. An `assistant` row's `content` is one raw agent message as JSON: an assistant message, a user message holding tool results, a result, a system message or an error. A `SUMMARY` row is a compaction summary. A row that does not parse, or has no `turn_id`, shows as a "could not be displayed" placeholder (`CW` @1432258, `PW` @1523426, `Hmt` @1525134).
  - Rows group by `turn_id`. Turns are ordered by when their first user row was sent. A group without a user row is not shown (`MW` @1528687, `wp` @1423850).
  - In a turn, the first user row is the turn's message and later user rows are steers. Everything is shown in send order, ties broken by creation time (`kW` @1419414, `Yhe` @1419057).
  - A message whose payload names a `parent_tool_use_id` belongs to a sub-agent. It is shown inside the card of the `Task`, `Agent` or `collab__spawnAgent` call that started it, not in the main transcript (`vmt` @1427555, `_mt` @1427823).
  - Each turn is built from its own rows only (`wp` @1423850). A row is saved under the turn running when it arrives (`Mmt` @1440920), so a background sub-agent's later messages sit in a later turn. There `vmt` still takes them out of the main transcript, but `_mt` makes a card only for a call of the same turn, so they show nowhere. The same holds for a sub-agent message whose parent call never arrived. A `task_notification` for a top-level call stays in the later turn's main transcript, but the system view draws nothing for it (renderApp `Ipa` @9596117 draws only a row with `content`). Ours shows that later work inside the earlier turn's card instead (D129).
  - Which messages show (`AW` @1421589, `jhe` @1417526): an assistant message shows when one of its blocks shows. A text block shows when its text is not blank. A tool_use block shows as a card, except `collab__wait`, and `collab__closeAgent` only when its result is an error. Thinking and other blocks show. A user payload shows as a user bubble unless all its blocks are tool results or its text is `/compact` (`Zft` @1421093); the bubble renders through the same component as a typed message (renderApp @9566846). Errors show, results show only when they are errors, and system messages show only for a compaction, an API retry or a background task start.
  - Beside a compaction, the agent's one-word "Compacted" reply is hidden (`cmt` @1424913, `omt` @1424403). An error that will be retried shows only when it is the turn's last message (`lmt` @1425012).
  - Three or more messages in a row that are not "preview" messages fold into one summary line ("3 tool calls, 2 messages"), which opens on click (`smt` @1422621, `Vhe` @1417866, `jft` @1418144). The folded messages are still in the turn; the fold is presentation.
  - So one Claude agent message is spread over several rows: each streamed content block, each tool call and each tool result is a row of its own. Counting rows does not count what the chat shows.
- **Tool cards** (VERIFIED renderApp @8830671): a registry maps tool kind to component, keyed as `ask-user-question, bash, bash-output, codex-collab, context7-mcp, diff-comment, edit, enter-plan-mode, exit-plan-mode, get-diff-comments, get-terminal-output, get-workspace-diff, glob, grep, image-generation, linear-mcp, ls, multi-edit, node-repl-js, read, run-local-command, schedule-wakeup, send-message, skill, slash-command, sub-agent, task-create/get/list/update, teammate, thinking, todo, update-progress, web, write`. Unknown tools fall back to a generic card (`OHe`). The name-to-kind lookup is exact first, then by prefix (`gWo` @8538073).
- **Thinking** is its own registry kind (`thinking`). There is a "Find in messages and thinking" search.
- **Todo lists** use the `todo` kind (TodoWrite/TodoRead). Task tools are separate cards.
- **Approvals**: inline permission cards with per-tool prompts, such as "Do you want to run this command on your Mac?" for `mcp__conductor__RunLocalCommand` (@8830900).
- **Queued messages and steering**: queued messages can be edited, deleted, reordered or "Save and steer"ed. OpenCode and Pi show "doesn't support steering". `pendingSteerMessageIds` from the status notification drives the UI state (VERIFIED strings, renderApp).
- **Plan mode**: `enterPlanModeNotification` records `permission_mode='plan'`. `exitPlanMode` is a sidecar→UI request answered with `{approved, feedback, planFilePath}`.
- **Checkpoints**: `checkpointCreated` (start/end per turn, with a file diff summary) drives "Revert to this version" and fork-from-turn ("Unable to fork chat: checkpoint not found for this turn").

## 6. Workspace creation, setup and archive (all in the frontend, via shell)

- **Who runs git**: the frontend. `executeZsh` runs `invoke("execute_shell_command", {shell, command, noRcs, resourceCommand})` with the captured login-shell PATH/env prepended (VERIFIED main @3827770). For cloud hosts the same calls go over HTTP to the workspace VM (`/shell/execute`, `/files/*`), selected by the `host` argument (local host constant `F`).
- **worktree add** (VERIFIED main @1087107, `Ide`):
  - First it ensures the repo has a HEAD; if not, it runs `git commit --allow-empty -m "Initial commit"`.
  - New branch: `git worktree add <path> -b <newBranch> <rev of remote branch>`. Existing branch: `git worktree add <path> <existingBranch>`.
  - The command runs through `executeInternalScript` in the main worktree.
  - Afterwards it sets `extensions.worktreeConfig true` and `config --worktree push.autoSetupRemote true` (`Sde`).
- **Naming** (VERIFIED main @229976, `UWe`):
  - The directory name is a random city from rarity tiers (common, uncommon, rare, legendary), skipping names already used. The city lists ship as `cities_top_*.txt`.
  - Branch = prefix + city. The prefix comes from `branch_prefix_type` = `github_username` (default) → `<ghuser>/`, `custom`, or `none` (@3140494).
  - Collisions get `-v1`, `-v2`, … (`Nm`).
  - Placeholder branch names get auto-renamed later (`auto_rename_new_branches`, `user_set_branch_name`).
- **Setup script** (VERIFIED main @3030770): runs in a **PTY terminal session** (`kind:"setup"`, `execution:{mode:"direct_script"}`). Remote runs prepend `set -euo pipefail`. Logs are written to `setup_log_path`. The env comes from `QI()` (@195370): `CONDUCTOR_WORKSPACE_NAME`, `CONDUCTOR_WORKSPACE_PATH`, `CONDUCTOR_ROOT_PATH`, `CONDUCTOR_DEFAULT_BRANCH`, `CONDUCTOR_PORT`, `CONDUCTOR_USER_ID`, `CONDUCTOR_IS_LOCAL`.
- **Scripts config**: setup, run, archive and `run_mode` are stored per repo and in `.conductor/settings.toml` (`scripts.setup|run|archive|run_mode`). A migration from the legacy `conductor.json` opens a PR (@3013595).
- **Archive** (VERIFIED main @1139000–1145000):
  1. `checkpointer.sh save --id … --force` snapshots uncommitted state. It handles merge or rebase residue.
  2. `git update-ref refs/conductor-archive-heads/<localId> <HEAD>`.
  3. The archive script runs.
  4. `git worktree remove` runs, falling back to direct removal plus `git worktree prune`.
  5. If `delete_branch_on_archive` is set, the branch is deleted (never the default branch).
  6. The DB row is updated with `state='archived'`.
  - `archive_on_merge` archives after a PR merge. Unarchive restores from `archive_commit` (or a new branch).

## 7. Feature areas visible

- **Diff review**: `@pierre/diffs` file diffs, with `diff_comments` stored locally. Agents read and write the comments through `mcp__conductor__GetDiffComments` / `DiffComment` (VERIFIED).
- **PR creation**: the "Create PR" button writes `.context/.../PR instructions.md` and sends the *agent* a "Create a PR …" message. The agent does the work, and a custom per-repo prompt can be added (VERIFIED main @3689383). The app also uses `gh pr list` for PR state, GitHub checks, merge and automerge, and Graphite stacks (INFERRED from strings).
- **Terminals**: xterm.js frontends over Rust PTYs (`pty_*`, events `pty-data/exit/ready`), with persisted history and mirrors (VERIFIED).
- **Run scripts**: a process store (`startProcess`, concurrent or exclusive `run_script_mode`) and port allocation per workspace (`CONDUCTOR_PORT`) (VERIFIED main @3078680).
- **Spotlight testing**: runs the workspace's changes in the **repository root** instead of the worktree, then restores the "pre-spotlight state" on stop ("Replace Run with Spotlight for this repository…") (VERIFIED main @3078680, renderApp strings).
- **Cloud workspaces**: "Roundhouse" server (`roundhouse_client_url_override`, `hostingServerUrl`). Sandboxes come from providers such as Vercel (`/home/vercel-sandbox`), with standby sandboxes, remote file sync to a local mirror, port forwarding and SSH (VERIFIED strings). Organizations, members and computer configurations with install scripts appear too.
- **Remote control**: pairing offers and paired devices, run by the sidecar (`remoteControl*` RPCs). Local organizations only; disabled under enterprise data privacy (VERIFIED strings).
- **Also present**: Routines (scheduled automations), Linear and GitHub issue context files, MCP server management, multiple agents (Claude Code, Codex, Cursor, ACP, OpenCode, Pi), on-device speech dictation, a notification-sounds picker, and dock badge.

## Open items (not verified)
- The exact outbox semantics, and whether local sessions use `session_messages_outbox` or only cloud ones do.
- Answered in [services-map.md](services-map.md) 1.2: `Dn(deps, host)` picks `cache.db` for cloud hosts and `conductor.db` for local ones.
- The sidecar side of the protocol. Cross-check it against `.context/conductor-re/sidecar.js`, which was extracted separately.

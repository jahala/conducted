# Conductor services map: non-visual architecture of the web app

Scope: the service layer of the extracted web UI (`main-BE1h_1MP.js`, plus the composition root in `renderApp-DeUrsznk.js`). It covers stores and services, the data layer, every git and gh command, feature flags and settings, the feature subsystems and the startup order. The visual UI is out of scope.

Conventions:
- `m@N` or `main @N` is a character offset in `main-BE1h_1MP.js`. `r@N` is an offset in `renderApp-DeUrsznk.js`. `s@N` is `sidecar.js`. Re-find any offset with `scripts/conductor-re/ctx.py` or `scripts/conductor-re/slice.py <m|r> <start> <end>`.
- `scripts/conductor-re/finddef.py <chars> <name...>` finds a minified identifier and resolves renderApp aliases to main's local names. `scripts/conductor-re/maindef.py` does the same for main only.
- VERIFIED means the code was read at the cited place. INFERRED means reasoned from names or neighbouring code.
- Some sections also read files that sit inside the installed app (`/Applications/Conductor.app/Contents/Resources/bin/*.sh`, bundled `gh`). These are marked `app`.
- Secrets embedded in the bundle (PostHog project key, Sentry DSN, Virtuoso licence, GitHub App client id) are deliberately not copied.
- Each part below was written as its own unit. Section numbers inside a part are local to that part, so "see 1.2" means "see 1.2 of this part".
- Build analysed: app version 0.92.1, production (`main @19220`).

## The map on one page

```
Tauri/Rust shell  --(invoke, events)-->  Platform object  vn()   (main @3901665; the only place that touches Tauri)
                                              |
                     composition root  y1l()  (renderApp @12108439)
   +------------------------------------------+-------------------------------------------+
   | 14 services: workspace, workspaceFiles, checkpoint, repo, git, fileDiff, settings,      |
   | sessionsV2, sessions, user, organization, favoriteModels, sections, composer            |
   | each = class over a Zustand store (optimistic base U$ or plain y0), built by a factory  |
   +------------------------------------------+-------------------------------------------+
        |                      |                         |                       |
   SQLite via plugin     shell/git/gh via         sidecar JSON-RPC          Roundhouse cloud
   conductor.db (local)  executeZsh/executeGit    tunnel (Ve, ts)          (HTTP + 1 multiplexed
   cache.db (cloud)      (host = local or VM)     agents run there          websocket)
   chosen by Dn(deps, host)
```

Ten findings that matter for a remake:
1. One `Platform` interface hides Tauri. All shared code asks `vn()` for fs, db, secrets, shell, git, pty, http, sidecar. Copy this boundary first.
2. Hosts are values. `{hostingServerUrl:"/", vmId:""}` is local. Anything else is a cloud VM. `Dn(deps, host)` picks `cache.db` for cloud and `conductor.db` for local (m@1080972).
3. The frontend does everything a backend normally does: it runs SQL, spawns git, and polls GitHub. The Rust side is a thin tool box (PTY, shell, files, keychain, updater).
4. TanStack Query is configured with `staleTime: Infinity` and no persister (m@954552). SQL data does not go through it. Workspaces, sessions, repos and messages live in service stores with an optimistic overlay. Queries cover git, GitHub, Roundhouse and config.
5. The app never commits, rebases or resolves conflicts itself. It sends the agent a chat instruction. The one exception is a guarded auto-rebase for GitHub stack branches.
6. Each agent turn becomes a real git commit under `refs/conductor-checkpoints/*`, built from a temp index by `checkpointer.sh`. Archive pins HEAD under `refs/conductor-archive-heads/*`. These drive turn diffs, revert, archive and Spotlight.
7. All GitHub work goes through the bundled `gh` binary with an injected token. PR polling is batched GraphQL behind a rate-limit gate. Graphite is read-only (`gt state`, `gt checkout`). "Sync stack" is `gh stack sync`.
8. Feature flags have one source: client-side PostHog. Only 15 flags map to settings keys and change behaviour. "Internal user" is the flag `conductor-internal`.
9. Two backends: Roundhouse (`api.conductor.build`, typed routes plus one multiplexed websocket) and the web app host (`app.conductor.build`, sign-in and provider keys). Linear is queried directly from the client.
10. Startup is strictly ordered and gated: a DB written by a newer app blocks the whole runtime. Working sessions are reset to idle before any UI sees them.

Parts:
1. Services, stores and dependency injection
2. Data access layer
3. Every git and gh command
4. Feature flags and settings keys
5. Feature subsystems (5A local and process subsystems, 5B cloud, PR and platform subsystems)
6. App startup sequence

Appendix: gaps and unverified items (end of file).

## Part 1. Services, stores and dependency injection

### 1.1 The three layers of wiring (VERIFIED)

1. **Platform object** (`vn()` = `getPlatform()`, main @1658; set once by `Fxe(await nan())` at the end of main, @3901665 and @3906449). It is the only place that touches Tauri. Everything shared goes through it. It is a ready-made port boundary for a remake.
2. **Service container** (renderApp `y1l`, @12108439). Plain object `{db, cacheDb, metrics, notifications}` plus 14 lazily-resolved services. A getter throws "`<name>` service accessed before initialization" if a service is read before its factory has run.
3. **Per-service dependency object**. Each service factory gets the container and builds its own narrow `dependencies` object (shell, fs, git, stores, settings, logging, ...). Example: the workspace service, below.

**Platform object fields** (main @3901665-@3906440, all VERIFIED):

| Field | What it wraps |
|---|---|
| `database`, `cacheDatabase` | `conductor.db` and `cache.db` through `tauri-plugin-sql` (`zit` @957983 reads `get_db_uri`; `Git` @958754 loads the cache DB). Both get `PRAGMA journal_mode = WAL`. |
| `secrets` | `ean(...)`: encrypted local storage, key from `get_or_create_local_storage_encryption_key`, plus keychain commands (`get/set/delete_keychain_setting`). |
| `fs`, `paths` | Read/write text and binary, atomic write (temp file plus rename), `exists`, `mkdir`, `remove`, `readDir`. Paths: appData, appConfig, appSupport, home, temp, resource. All calls pass `host:F` (the local host). |
| `http`, `webSocket` | `native_http_fetch` and the raw websocket transport class `oR` (@2940941). |
| `opener`, `clipboard`, `dialog`, `deepLink`, `window`, `events` | Tauri plugin wrappers. `window` has `setDockBadge`, `setVibrancy`, `openDevtools`, `isFocused`. |
| `appInfo`, `os`, `logSink`, `analytics`, `notifications`, `feedback` | Name, version, build type; OS info; `submit_app_logs`; PostHog `capture`; `send_native_notification` after a permission check; sonner toasts (`toast` and `workspaceToast`). |
| `updater` | `checkForUpdate` and install, `relaunch`, `quit`. |
| `workspaces` | `createWorktree` runs `git -C <repo> worktree add -b <branch> <path>`; `createSymlink` runs `ln -s`; `runSetupScript` runs `cd <cwd> && <script>`. |
| `pty` | `spawn` (80x24, flow control on), `write`, `resize`, `kill` over `pty_*` commands. |
| `fileSearch` | `list_file_tree` and `fuzzy_match_files`; `getMetadata`. |
| `sidecar` | `ensureStarted()` and `rpc()` on the JSON-RPC tunnel `Ve`. |
| `ssh` | `ensureKey`, `regenerateConfig`. |
| `shell`, `git` | `execute` and `executeCancellable` (through `Je` = executeZsh), and `git.execute({args,cwd,host})` (through `Fn` = executeGit with `gitArgs`). |

Note: the older, smaller "Platform" shape (createWorktree, runSetupScript, pty, fileSearch) looks like it exists for shared code that also runs in another front end (INFERRED: the leaked path `src/client/frontends/desktop/...` implies a sibling `frontends/` folder).

### 1.2 Host abstraction: local vs cloud (VERIFIED)

- A **host** is `{hostingServerUrl, vmId}`. The local host is `F = {hostingServerUrl: "/", vmId: ""}` (main @1094-@1155). `fa` is the empty host.
- `lt(host)` = `host.hostingServerUrl !== F.hostingServerUrl`, i.e. "is cloud" (@1169). `Vn(host)` returns `"cloud"` or `"local"`.
- `Dn({db, cacheDb}, host)` = `lt(host) ? cacheDb : db` (main @1080972). **This answers the open item in frontend.md.** Rows for cloud workspaces live in `cache.db`. Local rows live in `conductor.db`. The same repository code runs against either; the host picks the database.
- At startup, `prepare-cache-db` (renderApp @12115985) moves any cloud rows that older versions had put in `conductor.db` (`repos` hidden, `workspaces`, `sessions`, `identity_associations`) into `cache.db`, then deletes them from `conductor.db`.
- Shell, file and git calls also take `host`. For a cloud host they go over HTTP to the workspace VM (`/shell/execute`, `/files/*`; see frontend.md). `_x(host)` is a guard called before shell and git use (INFERRED: asserts the host is usable).

### 1.3 Service container: the 14 services (VERIFIED, renderApp @12112900-@12115985)

| Container key | Factory (renderApp -> main) | Class / role | Log tag or offset | Owns |
|---|---|---|---|---|
| `workspace` | `qWr` -> `jwn` -> `qut` | `Wut` (main @1160019), extends the optimistic-store base `U$` | `workspace-*` | `workspacesById` (each entry `{data,error,isLoading}`), paging by organization, create, archive, unarchive, delete, restart, cloud state sync, port-forward discovery reconcile. Global alias `Ne`, set at @3738147 (`Ne=n`) |
| `workspaceFiles` | `GWr` -> `nfn` | workspace file service (`jIt` @2068420 `exists`, read, write) | `workspace-mirror-files` | read/write/list/grep over local FS or cloud VM |
| `checkpoint` | `WWr` -> `ayn` -> `kQt` | checkpoint service (@3626426) | | wraps `checkpointer.sh`; turn changes cache (`EQt` @3619153) |
| `repo` | `VWr(YWr(...))` -> `rhn(shn(...))` | `lst` (@882830), base `U$` | `repo-service` | `reposById`, cloud repos sync (`cst` @879204), repo scripts/config |
| `git` | `HWr` -> `q_n` -> `_nt` | `tnt` (@841168), base `y0` | `git-service` | branch state, changes, PR info, push/pull/merge/stack, Graphite |
| `fileDiff` | `UWr` -> `H_n` | file diff service (@3708429) | `file-diff` | per-file diff content cache and prefetch |
| `settings` | `zWr` -> `J0n` -> `i7e` -> `Xqe` | `OU` (@390796), base `U$` | `settings-service` | `settingsByKey`, feature flags, remote repo shared settings |
| `sessionsV2` | `BWr(WKr(...))` -> `lmn` | sessions data layer (renderApp @149667) | | session list, create, rename, status |
| `sessions` | `$Wr` -> `Yyn` -> `aSt` | `oSt` (@1781353), base `y0` | `roundhouse` for cloud | messages, transcript load, queue, questions, tool approvals, feed sync |
| `sections` | `FWr(mJr(...))` -> `z_n` | sidebar sections (pinned and custom) | | `sections` plus cloud backend (`QQr` local, `HQr` cloud) |
| `favoriteModels` | `jWr(EQr(...))` -> `Xgn` | favourite models | | `favorite_models` table, default model per agent |
| `user` | `MWr` -> `Wgn` -> `gWt` | `mWt` (@3124263), base `y0` | `user-service`, `UserDataAPI` | auth token, cached user data, validate token |
| `organization` | `LWr(WGr(...))` -> `hhn` | organization service (`VGr`) | | organizations, memberships, org contexts |
| `composer` | `PWr` -> `jvn` -> `IAt` (@2010585) | composer: remote part `nAt` (@1952038, cloud) plus local part `Wkt` (@1930181), joined by `iAt` (@1992955) | `composer-service` | drafts, attachments, outbox, queued edits, pending messages |

Base classes: `U$` (@276803) holds a `canonicalStore` and a public `store`. Its `run({optimisticUpdate, action, scheduler})` applies an optimistic patch, runs the action, then rolls back or reconciles. `y0` (@638899) is a minimal empty base. Each service is also published through a module-level setter (`Jqe` settings, `rhn` repo, `hhn` organization, `lmn` sessionsV2, `Xgn` favorites, `z_n` sections) and read through a facade object (for example `je` for sessionsV2 @2472442, `Me` for settings, `St` for repo). Singleton plus injected: the injected object is for tests (a full mock set sits at main @573000-@580000), the singleton is for UI code.

### 1.4 The workspace service dependency object (VERIFIED, main @3734059 `jwn`)

| Group | Members |
|---|---|
| top level | `platform`, `roundhouseClient` (`Kg`), `db`, `cacheDb`, `metrics`, `notifications`, `getSessionRunnerStatus` (calls sidecar `getSessionStatus`), `hasPendingConsentInteraction`, lazy getters for `checkpoint, git, repo, settings, sessions, sessionsV2, user, organization, composer`, `workspaceVisibilityStore` (`ao`), `getRoundhouseWebSocketEndpoint`, `setupLogWebSocketClient`, `getRoundhouseClientBaseUrl`, `organizationLivenessEnabled`, `onWorkspaceMention`, `emitStateTransition` |
| `archiveSideEffects` | `cancelSession`, `onWorkspaceArchived` (clears runs, history, port forwards), `cleanupRemoteFileSync`, `listPendingRemoteFileSyncCleanups` |
| `unarchiveSideEffects` | `openRestoreDialog`, `onWorkspaceUnarchived` |
| `createSideEffects` | `createTextAttachmentForSession`, `prepareInitialMessageAttachments`, `materializeDraftAttachments`, `notifyOfflineFetchFallback` ("Couldn't fetch remote updates. Creating the workspace from the latest local revision."), `notifySessionAttachmentsChanged` |
| `shell` | `supportsLocalHost`, `executeInternalScript`, `executeZsh`, `executeUserScript` |
| `fs` | `exists, mkdir, tempDir, joinPath, getWorkspacesV3Root, getArchivedContextsRoot, getBundledBinDir, isSymlink, createSymlink, removeSymlink` |
| `logging` | `logger` |
| `gitInfra` | `branchNameIsTaken, gitFetchUnlocked, withRepoGitLock, withWorktreeGitLock` |
| `roundhouse` | `ensureRoundhouseOrganizations, resolveWorkspaceHostingServerUrl, getRemoteWorkspacePath, readLocalExecutionClientId, clearWorkspaceDirectAccessCacheForHost` |
| `config` | `getConductorConfigOrDefault`, `getConductorConfigForRepo` |
| `workspaceHelpers` | `workspaceEvents` (`tu`), `getWorkspacePath`, `copyWorktreeIncludedFiles`, `collectWorktreeIncludedFilesToSync` |
| `stores` | `usePortAllocationStore` (`r6`, only `getPorts`), `useSetupProcessStore` (`lv`) |
| `portForward` | `setupSshForWorkspace, ensureSshPortForwardRunning, ensureSshPublicKey, removeArchivedWorkspacePortForwards, stopRunningPortForwardsForWorkspaces, cancelDiscoveredPortsSubscriptions, syncDiscoveryForWorkspaces` |
| `network` | `resetCoordinatorStateForWorkspace` |
| `activityLogger` | `agentActivityLogger` (`ai`) |
| `terminal` | `createTerminal, destroyAllWorkspaceTerminals, initializeWorkspaceTabs` |
| `sidecar` | `warmShellEnv` |
| `other` | `getBranchPrefix, createContextFolder, ensureDefaultSandboxProvider, showErrorToast, ensureFreshGhToken` |

The git service (`tnt`) takes a similar object; its mock (@579836) shows `dependencies.shell = {executeGit, executeZsh, shellEscape, executeZshWithGhToken, SHELL_TIMEOUT_EXIT_CODE}` and `dependencies.git = {gitFetchUnlocked}`.

### 1.5 Other singletons and Zustand stores outside the container (VERIFIED by definition site)

| Name | Offset | Role | State or API |
|---|---|---|---|
| `_t` | @954552 | TanStack `QueryClient` | defaults: queries `retry:false, networkMode:"always", staleTime:Infinity`; mutations `networkMode:"always"`. A `mutationCache` (`Fit`) handles errors. So server-state queries never go stale on their own; every refresh is an explicit invalidation or a push. |
| `ts` (class `Ac`) | @3096610 / @3118365 | Sidecar API facade | typed methods for every sidecar RPC (`query, steer, cancel, setModelCatalog, getSessionStatus, ...`), RPC timeouts (ACP one-shot 200 s, remote control 120 s) |
| `Ve` (class `iOt`) | @2681404 / @2683066 | Sidecar JSON-RPC tunnel | see frontend.md 3c |
| `RR` (class `d5t`) | @3568306 | Agent run lifecycle ("MessageProcessingService" tag) | `onClaudeComplete`, `cancelSession`, completion handling |
| `Va` | @2965343 | Terminal facade over stores `Si` and `vs` | `createTerminal, destroyAllWorkspaceTerminals, initializeWorkspaceTabs, useWorkspaceTerminals, useActiveTab, useRepoTerminalId` |
| `Si`, `vs` | @2956970, @2960642 | Terminal stores (persisted) | `terminals`, `workspaceTerminals`, `activeTabPerWorkspace`, `repoTerminalId`, `lastTabKind` |
| `lv` | @3033800 | Setup process store (`U$t` factory, tag `SetupProcessStore`) | setup scripts as PTY sessions; reads transcripts from the terminal runtime `ln` |
| `ur`, `Eh` | @3076758, @3036140 | Action/run process store and run history | `processes, processStates, startAttemptIds, waitingProcesses, lastRunIds, retainedRunOutcomes, logBuffers...`; history `workspaceHistories`, `activeTaskId` |
| `r6` | @2973250 | Port allocation store | `allocations: Map`, `highestPort`, `getPorts(workspaceId, count)` returns a stable block of ports per workspace (base `hBt`, step `nZ`) |
| `uEe` | @3836418 | SSH command cache for port forwarding | `sshCommandsByWorkspaceId` |
| `jt` | @3037953 | Remote file sync status | `statuses, engaged, syncRequestedByLocalUse, cleanupTargets` |
| `Hbe` | @3583789 | Agent binary store (`AgentBinaryStore`) | `statuses` keyed by agent and kind; subscribes to `agent_binary_progress` |
| `Am` | @3095196 | Pending interactions per session | `interactionsBySessionId` (consent, questions) |
| `mR` | @3197897 | Local-execution approvals | `alwaysAllowLocalExecution`, `sessionApprovals` |
| `iw`, `ao` | @1003968, @1003954 | Session and workspace visibility stores | `focusedSessionId`, `visibleSessionIds`; used to scope polling to what is on screen |
| `YF` | @957072 | Archiving workspaces | `archivingWorkspaceIds` |
| `Ha` | @1409144 | History backfill state | `backfillingSessionIds, knownEmptyInitialFeedSessionIds, catchingUpSessionIds` |
| `em`, `Pk` | @1578555, @3617749 | Message send lifecycle and retry status | `recordsBySessionId`; `retryStatusByMessageId` |
| `sg` | @1392789 | Context window per model | `contextWindowsByModel` |
| `MU` | @381922 | Local model-catalog snapshot | `local` |
| `$n` | @3609794 | Persisted UI view history | `userChangedGitPanelState, closedTabsHistory, recentWorkspaceIds, sessionViewHistory, centerPanelTabViewHistory, browserTabsByWorkspace` |
| `_en` | @3716854 | Top tab bar | `tabs`, `recentlyClosedWorkspaceIds`, `openWorkspaceTab` |
| `cH` | @3712112 | Surface layout registry | `anchors, surfaceConfigs, surfacePlacements, requestedFocusSurfaceId` |
| `UR` | @3724380 | Dialog manager | `activeDialogId`, `openDialog(id, data)` |
| `W_` | @3821823 | GitHub health / auth state | reset by `lbn`; set by `gh` checks |
| `tu` (`$At`) | @2018366 | Workspace event bus | `emitStateTransition(workspaceId, from, to)` |
| `ai` (`p1t`) | @2445378 | Agent activity logger | |
| `Kg` | @554209 | Roundhouse client identity | `{clientType:"mac-desktop", clientVersion, supportsRoutedLocalExecution:true}` |

Reusable primitives:

| Name | Offset | Role |
|---|---|---|
| `Ns` | @192626 | Task queue. `type:"serial"` or `"concurrent"`, supports barriers. Used for per-session, per-repo and per-workspace serial work. |
| `Xn()` | | Dedupe helper. `renameBranchDedupe`, `pushDedupe`, `mergePrDedupe` collapse concurrent identical calls. |
| `zd(promise, ms)` | @191399 | Timeout wrapper that throws `TimeoutError`. |
| `fireAndForget` | | Promise extension (`.fireAndForget()`, `.logErrorAndForget()`); every unawaited promise is marked on purpose. |
| `Y3` | @1008739 | Exponential backoff counter. |
| `tv` | @1009190 | Websocket-backed "desired state" reconciler (retry policies, key queues). |
| `Ehe` | @1373092 | Keyed lock map. |
| `mt` | @30186 | App error class `{code, retryable, source, userMessage, details}`; codes live in object `It`. |

---

## Part 2. Data access layer


Scope: how the web UI bundle reads and writes its data. Sources: `main-BE1h_1MP.js` (m) and `renderApp-DeUrsznk.js` (r), plus `sql-statements.txt`.
Tags: VERIFIED means I read the code at the offset given. INFERRED means a reasoned guess. The CREATE TABLE statements are not in the frontend (they live in Rust migrations), so column lists below are the columns the frontend touches, not the full schema.

### 2.0 Headline findings

1. There are three persistent stores, not two. `conductor.db`, `cache.db`, and an encrypted file-based key/value store (`ds()`, "local storage subsystems"). The KV store holds PR info, workspace changes, composer drafts, terminal history and more. VERIFIED m@253900, m@249288.
2. One routing rule decides the database: `Dn({db,cacheDb}, host)` returns `cacheDb` for a cloud host and `db` for a local host. VERIFIED m@1080972. So cloud workspaces, their sessions, repos, messages and port forwards live in `cache.db`. Local ones live in `conductor.db`.
3. TanStack Query holds almost no SQL data. Workspaces, sessions, repos and messages flow through service classes and zustand stores. Query keys cover git, GitHub, Roundhouse HTTP, filesystem and config. The one exception is the db version warning. VERIFIED by key survey in section 5.
4. The query client default is `staleTime: Infinity`, `retry: false`. Data never goes stale on its own. Freshness comes from explicit invalidation, polling `refetchInterval`, or server push. VERIFIED m@954588.
5. `session_messages` is a materialized projection, not a plain table. Local sessions also keep an append-only `session_events` log with a `reverted_at` column. Cloud sessions keep a segmented cache with a feed offset. VERIFIED m@1721961, m@1548674.
6. `cancelled_at` on `session_messages` is only read by the frontend. No frontend statement sets it. VERIFIED by scanning all 40+ mentions; the compaction insert writes `NULL AS cancelled_at` (m@1721961).
7. The frontend never deletes data by age. All time-based retention is either size-capped LRU in the KV store, or happens in Rust. See section 7.3.

### 2.1 Storage topology

| Store | Access path | Offsets | Notes |
|---|---|---|---|
| `conductor.db` (`db`) | tauri-plugin-sql through class `Xm`; global `Gc` | Xm m@957464, URI `sqlite:conductor.db` m@957933, `Gc` m@958913 | URI comes from Tauri command `get_db_uri`. WAL mode is set from the frontend. VERIFIED |
| `cache.db` (`cacheDb`) | `Xm.load("sqlite:cache.db")`; global `Es` | m@958089 (`Git()`), `Es` m@958913 | WAL as well. Same schema shape as `conductor.db` for the copied tables. VERIFIED |
| Local-storage KV (subsystems) | class `U4e` over backend `W4e`; accessor `ds()` | U4e m@245003, W4e m@249288, `ds` m@253900 | Per-subsystem size limit, evicts oldest by `lastUpdatedAt`. Entries stored in a tauri store file or per-entry files, optionally encrypted. VERIFIED |
| TanStack Query cache | singleton `_t` in main, imported as `Os` in renderApp | m@954588 | In-memory only. No persister found. VERIFIED (section 5) |
| zustand stores | `Yn()(...)` / `pr(...)` factories inside services | e.g. U$ m@276803, aIt m@2027404 | In-memory canonical + optimistic projection. VERIFIED |

SQL wrapper facts (VERIFIED m@957464 to m@958913):
- `select` on `db` is single-flighted: identical concurrent query + bind values share one promise (`Xn()` dedupe).
- Both wrappers log "slow sqlite select/execute" at 1000 ms (`kK=1e3`).
- Some callers use `executeTransaction` with a `BEGIN IMMEDIATE ... COMMIT` string (navigation sections, r@280593). Most do not use transactions.

### 2.2 Table catalog

Columns are the union of INSERT lists, UPDATE SET clauses and SELECT lists in the dump. "db/cache" means both, split by the host rule.

| Table | DB | Owner (role, factory/class, offset) | Columns the frontend touches |
|---|---|---|---|
| `repos` | db and cache | Repo service `lst` (tag "repo-service") m@882830. Readers `Rnt` m@861623, writers `Lnt`/`$nt`/`oK` m@865017..871079 | id, remote_url, name, default_branch, remote, root_path, setup_script, archive_script, run_script, run_script_mode, storage_version, display_order, hidden, icon, conductor_config, custom_prompt_{code_review,create_pr,fix_errors,resolve_merge_conflicts,rename_branch,general}, file_include_globs, spotlight_testing, updated_at |
| `workspaces` | db (local), cache (cloud) | Workspace service `Wut` m@1160019. Cloud import `XF` m@984940, local create m@1083668, row reader `ode` m@996193 | local_id (PK), id (server id), number, repository_id, directory_name, secondary_directory_name, workspace_name, workspace_path, branch, placeholder_branch_name, intended_target_branch, initialization_parent_branch, state, derived_status, manual_status, active_session_id, hosting_server_url, sandbox_provider, organization_id, creator_user_id, creator_client_id, assignee_user_id, watcher_user_ids, permission_level, restricted, access_level, is_computer_admin, workspace_template_id, description, pr_title, pr_description, archive_commit, unread, user_set_branch_name, user_set_workspace_name, remote_file_sync_enabled, port_forwarding_enabled, auto_forward_enabled, linked_workspace_ids, linked_directory_paths, initialization_log_path, initialization_files_copied, setup_log_path, pinned_at, revision, created_at, updated_at, last_activity_at |
| `sessions` | db (local), cache (cloud) | Sessions V2: factory `WKr` r@149667 builds `HKr` with backends `qqr` (local) r@110662 and `Wqr` (cloud) r@108343. SQL helpers m@2449623..2461967 | id, workspace_id, status, claude_session_id, agent_type, model, acp_config, permission_mode, codex_thinking_level, claude_effort_level, agent_personality, fast_mode, title, is_hidden, remote_archived_at, unread_count, freshly_compacted, resume_session_at, context_used_percent, context_token_count, last_user_message_at, feed_offset, created_at, updated_at |
| `session_messages` | db (local), cache (cloud) | Sessions service `oSt` m@1781353. Insert `tpe` m@1429849, projection writer `VW` m@1727204 (SQL `cbt` m@1721961) | id, session_id, role, content, full_message, sent_at, created_at, cancelled_at (read only), turn_id, sdk_message_id, last_assistant_message_id, is_resumable_message, queue_order, model, sender_id, sender_session_id, sender_api_key_name, sender_source, and for the cache projection: session_index, source_rowid |
| `session_events` | db (local only) | `vgt` m@1548582 (append), `ygt` m@1549162 (revert) | session_id, session_index, event_id, event_type, content (JSON), received_at, reverted_at. Unique on (session_id, event_id) |
| `session_state` | db | `bgt` m@1550546 | session_id, live_state (JSON), live_state_updated_at, config (JSON), config_updated_at |
| `session_messages_outbox` | db | Composer outbox repo: `xc` m@1209518 (list), `phe` m@1215414 (insert), `Ls` m@1220282 (update), `Vl` m@1218922 / `wV` m@1219103 (delete) | message_id, session_id, delivery_payload, config, mode, asset_ids, queue_order, state, send_attempt_count, next_send_attempt_at, last_error, created_at, updated_at |
| `session_messages_outbox_state` | db | `qfe` m@1905758 (read), `lk` m@1905943 (write) | session_id, paused_at, updated_at |
| `session_assets_outbox` | db | `fhe`/`_V` m@1216650, `bV` m@1219917 | attachment_id, message_id, source_ref, original_name, asset_id, relative_path, state, upload_attempt_count, next_upload_attempt_at, last_error, created_at, updated_at |
| `session_pending_messages` (+ `_state`) | cache | `zht` m@1212967, `Ght` m@1213481, `jht` m@1214359 | session_id, message_id, delivery_payload, config, mode, position, revision, sender_id, received_at, generation; state table: session_id, generation, paused, snapshot_at, cache_version |
| `client_cache_session_state` | cache | `sv` m@1403644, `Sft`/`Eft` m@1408165..1408436 | session_id, cache_version, cache_revision, feed_offset, first_written_at, last_modified_at, last_read_at |
| `client_cache_session_segments` | cache | `rv` m@1405133, `$he` m@1405431 | session_id, start_index, end_index (NULL means open ended) |
| `attachments` | db | Attachment repo m@1869932..1874833, reads m@1553639 | id, type, original_name, path, is_loading, is_draft, session_id, session_message_id, comment_id |
| `diff_comments` | db | Store `aIt` m@2027404 | id, workspace_id, file_path, line_number, end_line_number, body, state, location, created_at, updated_at, edited_at, remote_url, author, author_avatar_url, thread_id, reply_to_comment_id, is_outdated, is_resolved, suggestion_base_code |
| `port_forwards` | cache (via `Es`) | Port-forward module m@3841778..3843192 | id, workspace_id, remote_port, local_port, protocol, label, auto_detected, enabled, created_at |
| `identity_associations` | db, mirrored to cache | `sce` m@587000, class `Ds` m@589997 | local_id, server_id (1:1 bijection) |
| `terminal_sessions` | db (`Gc`) | m@2969778 | session_id, workspace_id, started_at, ended_at, cwd, cols, rows, rehydrate_sequences, alternate_screen, bracketed_paste, has_received_user_input. Transcript text goes to KV subsystem `terminal-history` |
| `settings` | db | Settings service `OU` m@390796; SQL m@368952..375020 | key, value, deprecated_at |
| `env_vars` | db | m@460831..463220 | key, scope, context, value (NULL = tombstone) |
| `favorite_models` | cache or db by scope (INFERRED) | r@238712..240104 | id, position, configuration, created_at, plus scope columns (organization_id, user_id, optional hosting_server_url) |
| `navigation_sections` | same as above | r@276546..280630 | id, name, emoji, kind, sort_order, created_at, updated_at, plus scope columns |
| `navigation_section_memberships` | same | same | id, section_id, workspace_id, created_at |
| `symlinks_pending_deletion` | db | m@1153216, m@1153317, m@3755770 | path |

Notes:
- `favorite_models` and `navigation_sections` use a scope object `{columns, values}` from `VQr` r@276481: local scope is `(organization_id, user_id)`, cloud scope adds `hosting_server_url` and sets `idsAreServerIds`. These tables are write-through copies of Roundhouse data (see 7.1). Which physical DB they use depends on the `database` argument passed by the service constructor. INFERRED, not traced.
- `workspaces.id` is the server id for cloud rows, `local_id` is the primary key. `identity_associations` is the authority that maps them. Conflicts throw (`qYe` m@588900 area: "already associated with").
- Placeholder repos: hidden rows (`hidden = 1`, `root_path = Ym`) inserted into `cache.db` for cloud-only workspaces (`Xnt` m@875905). Unused ones are deleted by `Znt` m@876512.

### 2.3 Operations per table

Statement shapes are abbreviated. Offsets are the SQL position in the dump.

#### 2.3.1 workspaces

| Operation | Statement shape | Offset |
|---|---|---|
| create local workspace | `INSERT INTO workspaces(local_id,id,repository_id,directory_name,... state='initializing', derived_status='in-progress', ...)` preceded by `DELETE ... WHERE local_id=? AND state='unstarted'` | m@1083668, m@1083579 |
| create cloud placeholder (unstarted) | HTTP `createUnstartedWorkspace`, then `associate`, then import summary into cache | `Flt` m@1123775 |
| import or refresh cloud summary | `INSERT OR IGNORE INTO workspaces(28 cols)`; update by `WITH updates(...) UPDATE`, guarded by revision (summary older than local row is ignored) | m@984380, m@980318, `wot` m@976047 |
| list workspaces | `SELECT w.*, r.root_path, ... FROM workspaces w JOIN repos r LEFT JOIN identity_associations` on db filtered by `Xf`, plus the same on cache | m@995401, m@995775, `ode` m@996193 |
| start setup | `SET state='setting_up', initialization_log_path=?, initialization_files_copied=?` | m@1091866 |
| finish setup | `SET state='ready' WHERE local_id=? AND state='setting_up'` | m@1100632 |
| fail setup | `SET state='failed' WHERE ... AND state='setting_up'`, only when a workspace made from a checkpoint cannot be restored (`rlt`, called from m@1118975). A setup script that fails still ends in ready: `Zct` runs it, moves the row to ready, then toasts "Setup script failed. Check the setup tab for logs." (m@1101155) | m@1102132 |
| fail init | `SET state='failed' WHERE ... AND state='initializing'` | m@1109003 |
| archive | `SET state='archived', branch=?, archive_commit=?` (db only, local workspaces) | m@1144708 |
| unarchive step 1 | `SET state='initializing'` | m@1147721 |
| unarchive step 2 | `SET branch,directory_name,workspace_path,state='setting_up',last_activity_at` or `SET state='setting_up',last_activity_at` | m@1149734, m@1150134 |
| set intended target branch | `SET intended_target_branch=? WHERE local_id=?` | m@1108709, method `setIntendedTargetBranch` m@1167895 |
| set manual status | `SET manual_status=?` ; derived: `SET manual_status=NULL, derived_status=?` | m@1106282, m@1106618 |
| set branch / PR metadata | `SET branch=?`; `SET branch,placeholder_branch_name,intended_target_branch,pr_title=NULL,pr_description=NULL`; dynamic `SET ${cols}` | m@1103564, m@1103871, m@1104775 |
| mark unread, flags | `SET unread=?`, `remote_file_sync_enabled`, `port_forwarding_enabled`, `auto_forward_enabled` | m@1105136..1105966 |
| link workspaces / dirs | `SET linked_workspace_ids` / `linked_directory_paths` (JSON text); bulk `CASE local_id WHEN` | m@1107122, m@1107975, m@1053887 |
| touch activity | `SET last_activity_at = CASE WHEN older THEN ? ELSE keep END WHERE hosting_server_url IS NULL` | m@1054957 |
| rename | `SET directory_name, secondary_directory_name=NULL, workspace_path, workspace_name, user_set_workspace_name=CASE...` | m@1151727, m@1152949 |
| set permission / access | `SET permission_level`, `SET restricted, access_level` | m@1060033, m@1126336, m@1127689 |
| sync cloud state | read `state`, then `SET state=?` on cache | m@1059428, m@1059550, `jat` m@1059413 |
| delete | `DELETE FROM workspaces WHERE local_id IN (...)` on both DBs; by repo: select ids, delete sessions via sessionsV2, delete rows | m@1058108, `Gat` m@1058700 |
| startup cleanup | `DELETE WHERE (state='failed' OR state='initializing') AND local`; `UPDATE state='ready' WHERE state='setting_up' AND local` | m@1073201, m@1073517, `hct` m@1072900 |

#### 2.3.2 repos

| Operation | Statement shape | Offset |
|---|---|---|
| list repos | `SELECT *, COALESCE(storage_version,1), COALESCE(display_order,0) FROM repos` on db and cache | m@861411 |
| insert repo | `INSERT INTO repos(id,remote_url,name,default_branch,remote,root_path,setup_script,archive_script,storage_version,display_order)` | m@865017 |
| update fields (batched) | `UPDATE repos SET col = CASE id WHEN ? THEN ? ... END, updated_at=datetime('now') WHERE id IN (...)` over `default_branch, remote, remote_url, icon, hidden, conductor_config, display_order` | m@871079, list `Unt` m@870569 |
| delete repo | `DELETE FROM repos WHERE id=?` on db and cache | m@870473 |
| add placeholder repos | `SELECT MAX(display_order)` then multi-row `INSERT ... hidden=1` into cache | m@875905, m@875996 |
| purge unused placeholders | `DELETE ... WHERE root_path=? AND hidden=1 AND NOT EXISTS(workspaces) RETURNING id` | m@876512 |
| clear migrated columns | `UPDATE repos SET col=NULL,... updated_at` (conductor.json migration) | m@3016242 |
| read repo settings | `SELECT id, custom_prompt_*, file_include_globs, spotlight_testing, setup_script, archive_script, run_script, run_script_mode, conductor_config` | m@3018811 |

#### 2.3.3 sessions and transcript

| Operation | Statement shape | Offset |
|---|---|---|
| create session (local) | `INSERT INTO sessions(... status='idle', feed_offset=-1 ...)` | m@2457399 |
| import cloud sessions | `INSERT OR IGNORE INTO sessions(... status 'idle', remote_archived_at, is_hidden, title ...)` in chunks of 50 | m@2461280, `Tge` m@2461182 |
| list sessions | `SELECT * FROM sessions WHERE (cond) AND NOT EXISTS(cloud workspace)` on db; same without the guard on cache | m@2449715, m@2449776 |
| rename | `UPDATE sessions SET title, updated_at=datetime('now') RETURNING updated_at` | m@2450425 |
| change agent config | dynamic `SET agent_type, model, acp_config, fast_mode, ...`; ACP config compare-and-set | m@2452791, m@2454167 |
| personality, permission mode, hide, unread | one-column updates | m@2454400..2454786 |
| clear workspace unread | `SET unread_count=0 WHERE workspace_id=? AND unread_count=1 AND id NOT IN(...) RETURNING id` | m@2454931 |
| record status / external id / usage | `SET status=CASE WHEN ? THEN ? ELSE status END, claude_session_id=..., last_user_message_at=max, context_*` | m@2456319 |
| set status | `UPDATE sessions SET status=?`; compare-and-set `... WHERE id=? AND status=?` | r@115061, r@115200 |
| reset to idle at startup | `UPDATE sessions SET status='idle' WHERE (working OR cancelling OR needs_user_permission OR waiting) AND local workspace`, then patch `session_state.live_state.status` with `json_set` | r@115725..116279, r@116836 |
| delete sessions | delete from `session_events`, `session_state`, then `sessions` (by id list or by workspace) | m@2457923..2458414, m@2461967 |
| append event | `INSERT INTO session_events SELECT ?, COALESCE(MAX(session_index),-1)+1, ... ON CONFLICT(session_id,event_id) DO NOTHING RETURNING session_index` | m@1548674 |
| revert events | `UPDATE session_events SET reverted_at=? WHERE session_index >= (MIN index of the given userMessage ids)` | m@1549242 |
| patch live state / config | `INSERT INTO session_state ... ON CONFLICT(session_id) DO UPDATE` (read-modify-write in JS) | m@1551173 |
| queue message (transcript) | `INSERT INTO session_messages(... sent_at NULL, queue_order = next)`; next = `MAX(queue_order)+1` among unsent and uncancelled | m@1429849, m@1431247 |
| mark queued as sent | `UPDATE session_messages SET sent_at=?, last_assistant_message_id=?, turn_id=? WHERE id=? AND sent_at IS NULL AND cancelled_at IS NULL` | m@1546406, `pgt` m@1546010 |
| requeue a sent message | `SET sent_at=NULL, turn_id=NULL, last_assistant_message_id=NULL, queue_order = MAX+1` | m@1543979, `dgt` m@1542220 |
| edit queued text | `SET content=?, turn_id=?` | m@1545443 |
| count queued | `COUNT(*) WHERE sent_at IS NULL AND cancelled_at IS NULL` | m@1751685 |
| revert (rewind chat) | `DELETE FROM session_messages WHERE session_id=? AND COALESCE(sent_at,cancelled_at) > watermark`; local also marks events reverted; cloud bumps cache revision | m@1552063, `Sgt` m@1551786 |
| compact or batch project | big `WITH input ... INSERT ... ON CONFLICT(id) DO UPDATE` used for both storage targets | m@1721961, `VW` m@1727204 |
| search chats | `LIKE` on `content` for sent or cancelled rows within a session id list | r@10590252 |
| backfill events (legacy) | `INSERT INTO session_events ... json_each` only when the session has no events but has messages | r@10628775..10629261 |

#### 2.3.4 Composer outbox (message queueing and sending)

| Operation | Statement shape | Offset |
|---|---|---|
| queue (send) a message | `INSERT OR IGNORE INTO session_messages_outbox(... state, queue_order=max+1 ...)` plus asset rows | `phe` m@1215414; local `sendMessage` m@1934179 sets state `ready` |
| list outbox | `SELECT * FROM session_messages_outbox [WHERE session_id=?] ORDER BY COALESCE(queue_order,0), created_at, message_id` | m@1209573, m@1217962 |
| mark sending / retry / failed | `Ls`: dynamic `UPDATE ... SET state, send_attempt_count, next_send_attempt_at, last_error, updated_at` | `Ls` m@1220282 |
| mark sent (ack) | delete outbox row and its asset rows | `wV` m@1219103, `Vl` m@1218922 |
| cancel | delete the row (`cancelMessage`); cloud variant first sets `cancelling`, then calls the server | local m@1936500 region, cloud `nAt` m@1952038 |
| steer | `Ls({mode:'steer'})` | local `steerMessage` |
| reorder queue | loop `Ls({queueOrder: i+1})` over desired id order | local `reorderMessages` m@1936500 region |
| pause or resume | `INSERT OR REPLACE INTO session_messages_outbox_state(session_id, paused_at, updated_at)`; pause only if a `queue` mode row exists | m@1905980, `lk` m@1905943 |
| restore to draft | copy payload text into the draft, restore attachments, delete rows (not rows in `sending`) | `restoreMessagesToDraft` m@1936500 region |
| retry failed asset | `SET state='pending', upload_attempt_count=0 ... WHERE message_id=? AND state!='uploaded'` | m@1220038 |
| mirror server queue (cloud) | replace all rows of `session_pending_messages` for the session, then upsert `_state` | m@1213656, m@1214130 |

#### 2.3.5 Other tables

| Table | Operation | Statement shape | Offset |
|---|---|---|---|
| attachments | add draft | `INSERT INTO attachments(id,type,original_name,path,is_loading,is_draft,session_id,session_message_id,comment_id)` | m@1873229 |
| attachments | finish load | `SET path=?, is_loading=0` | m@1873676 |
| attachments | remove | `DELETE ... WHERE id=? AND session_id=? [AND is_draft=1] RETURNING *` | m@1873922 |
| attachments | attach drafts to a message | `SET session_message_id=?, is_draft=0 WHERE is_draft=1 [AND id IN]` | m@1874222, m@1874607 |
| attachments | restore to draft | `SET session_message_id=NULL, is_draft=1` | m@1874833 |
| diff_comments | create or sync from GitHub | `INSERT OR IGNORE`, else guarded `UPDATE` skipping states hidden/superseded | m@2029550, m@2030338 |
| diff_comments | resurface edited GitHub comment | `SET state='pending' ... WHERE state IN ('hidden','reviewed') AND body IS ?` | m@2031369 |
| diff_comments | delete GitHub comments no longer present | `DELETE ... WHERE workspace_id=? AND id LIKE 'github-%' AND state<>'superseded' AND id NOT IN(...)` | m@2033320 |
| diff_comments | state moves | `SET state = ready_for_review / pending / hidden / reviewed / superseded` | m@2034788..2037018 |
| diff_comments | resolve thread | `SET is_resolved=1 WHERE workspace_id=? AND thread_id=?` | m@2036361 |
| port_forwards | add, toggle, delete | `INSERT`; `SET enabled`; `DELETE` by id or by workspace list | m@3842719..3843192 |
| terminal_sessions | upsert, delete | `INSERT OR REPLACE`; `DELETE WHERE session_id=?` | m@2970020, m@2970677 |
| settings | get, list, deprecate, set, delete | `SELECT value ... LIMIT 1`; `... WHERE deprecated_at IS NULL`; `UPDATE deprecated_at=datetime('now')`; `INSERT OR REPLACE`; `DELETE` | m@368952..375020 |
| env_vars | set, tombstone, delete | upsert on (key,scope,context); `value=NULL` upsert; delete | m@462401..463220 |
| identity_associations | associate | guarded `INSERT ... WHERE NOT EXISTS`; mirror with `INSERT OR IGNORE` into cache | m@587576, m@588194 |
| favorite_models | list, upsert, reorder, delete | by scope columns, ordered by `position` | r@238712..240104 |
| navigation_sections | replace scope | `INSERT OR REPLACE` sections and memberships, delete the rest, inside `BEGIN IMMEDIATE`; skipped if DB rows are newer than the value (`updated_at` check) | r@279771..280630, `KQr` r@278635 |
| symlinks_pending_deletion | track | `INSERT (path)` before removing a symlink, `DELETE` after, `SELECT path` on startup | m@1153216..3755770 |

### 2.4 Lifecycle state machines

#### 2.4.1 workspaces.state (VERIFIED)

Allowed stored values: `unstarted, initializing, setting_up, ready, failed, sleeping, archived`. The normalizer `Cnt` (m@861191) maps legacy `building_snapshot`, `preparing`, `updating` to `initializing`; any unknown value also becomes `initializing`. Server enum `VI` (m@171414) also has `deleted` and `updating`. `deleted` rows are filtered out (`state != 'deleted'`, m@987310) and mapped by `Kat` (m@1061453) to a caller-chosen state, default `archived`.

Local workspace:

```
(create) -> initializing -> setting_up -> ready -> archived
              |               |            ^          |
              v               v            |          v
            failed          failed         +-- (setup done)  initializing -> setting_up -> ready  (unarchive)
```

| Edge | Trigger | Guard | Offset |
|---|---|---|---|
| none to initializing | create workspace | none | m@1083668 |
| initializing to setting_up | worktree and context folder created | none | m@1091866 |
| setting_up to ready | setup script finished, failed or was stopped, or repo has no setup script | `AND state='setting_up'` | m@1100632, m@1101155 |
| setting_up to failed | a checkpoint restore that throws (`rlt`), never a failed setup script | `AND state='setting_up'` | m@1102132, m@1118975 |
| initializing to failed | `markWorkspaceInitializationFailed` | `AND state='initializing'` | m@1109003 |
| ready to archived | archive (script then DB update, stores branch and archive_commit) | db only | m@1144708 |
| archived to initializing | unarchive | none | m@1147721 |
| initializing to setting_up | rehydrate done | none | m@1149734, m@1150134 |
| startup: failed or initializing to deleted | `hct` | local rows only | m@1073201 |
| startup: setting_up to ready | interrupted setup; also `markSetupInterrupted` in the in-memory setup store | local rows only | m@1073517 |

Cloud workspace (state mirrored from Roundhouse, written to cache): `Kat` m@1061453 maps server `unstarted->unstarted`, `initializing->initializing`, `updating->initializing`, `ready->ready` (or `setting_up` when the lifecycle step says so), `sleeping->sleeping`, `archived->archived`, `deleted->(param, default archived)`. The code sets `failed` locally for orphaned `initializing` rows (`kot` m@986694, `pct` m@1074133) and sets `permission_level='read'` when the server says deleted (m@1060017). Becoming `archived` or `sleeping` resets that workspace's sessions to idle and removes port forwards. An `unstarted` summary is ignored while the local row is `initializing` or `setting_up` (`yA` m@970076).

Other workspace status columns:
- `derived_status` and `manual_status`: `backlog, in-progress, in-review, done, canceled`. Unknown or missing derived status becomes `in-progress` (`Not`, `lde`, `iot` m@1002442, m@967395). Display value is `manualStatus ?? derivedStatus` (`xfn` m@2440167). VERIFIED.
- `permission_level`: `read` or `write` (`Hot` m@1003188).

#### 2.4.2 sessions.status (VERIFIED)

Values: `idle, working, error, needs_plan_response, needs_user_input, needs_user_permission, cancelling, waiting` (`k1t` m@2450659; unknown throws). Local runner events set it through `recordStatus` and the CAS helper `Jqr` (r@115200). Pending-send path: `canProcessQueuedMessages` allows queue processing only when status is `idle`, `error`, or `waiting` with no live background tasks (m@1800579). At startup, local sessions in `working, cancelling, needs_user_permission, waiting` are reset to `idle` (r@115061 `eKr`). A wider set including `needs_plan_response` and `needs_user_input` is reset when a specific workspace stops (`Zqr`). Live-state JSON inside `session_state` only has `working` or `idle` (m@151627) and is patched together.

#### 2.4.3 session_messages queued, sent, cancelled (VERIFIED for queries)

```
queued: sent_at IS NULL AND cancelled_at IS NULL, ordered by queue_order
sent:   sent_at NOT NULL (turn_id set; turn_id = id for the first message of a turn)
cancelled: cancelled_at NOT NULL (never written by the frontend)
```

| Edge | Statement | Offset |
|---|---|---|
| insert as queued | `INSERT ... sent_at NULL, queue_order = max+1` | m@1429849 |
| insert as sent | same insert with `sent_at` set (`addUserMessage mode asSent`) | m@1799637 |
| queued to sent | `markQueuedMessageAsSent` | m@1546406 |
| sent to queued | requeue with new `queue_order` | m@1543979 |
| sent to removed | rewind delete by watermark | m@1552063 |
| promote sentinel | cloud batch writes `queue_order = xA` (`xA = -1`, m@1713700) when a queued user row becomes sent; `KW` later NULLs rows still equal to that sentinel (INFERRED purpose: mark the row as just promoted) | m@1721484, m@1721961 |

#### 2.4.4 Outbox states (VERIFIED)

`session_messages_outbox.state` values: `waiting, uploading, ready, sending, cancelling, failed` (`Lht` m@1207902). Unreadable rows map to `failed`. `Bht` maps `waiting/ready/cancelling` to UI `pending` (m@1209300).

Cloud drainer `akt` (m@1896517):
```
waiting --(target resolved, generation ensured)--> uploading (if any asset not uploaded) or ready
uploading --(all assets uploaded)--> ready ; any asset upload failure --> failed
ready --> sending --(server ack, row present in snapshot)--> row deleted
sending --(transport error)--> ready with backoff, send_attempt_count+1 ; at 20 attempts --> failed (Wfe=20)
sending --(409/403 conflict with terminal reason)--> failed
cancelling --> resumed by cancellation handler; retried until server confirms
```
Backoff: `initialDelayMs 2000, maxDelayMs 60000`, doubling (`Hfe`, `OA` m@1896149). Drain is single-flight per session (`running`/`again` flags) and runs inside a serial lock per session.

Local drainer `lkt` (m@1906213): picks `steer` rows first, then the first `queue` row unless paused. It sets `sending`, marks draft attachments as sent, calls `delivery.deliver`, and on success the row is deleted. Rows stuck in `sending` after a crash are settled: if the message is already in the transcript the row is deleted, else it returns to `ready` (`settleStaleSending` m@1906555). Recovery at start pauses sessions that still hold rows (`recoverOutbox` m@1941667 local, m@1991486 cloud, sets `paused_at`).

`session_assets_outbox.state`: `pending, uploaded, failed`, shown as `uploading, uploaded, failed` (`Vht`, `Yht` m@1214600).

#### 2.4.5 diff_comments.state (VERIFIED from statements)

Values: `draft, pending, ready_for_review, reviewed, superseded, hidden`. Moves: draft body edit only while `draft` (m@2034282); `ready_for_review` sets `created_at` (m@2035039); bulk pending to ready_for_review when not outdated or resolved (m@2037018); mark reviewed (m@2035683, m@1871203, never from `superseded`); `superseded` for a whole workspace (m@2035279); `hidden` and back to `pending` (m@2035931, m@2036130); GitHub edits resurface from `hidden` or `reviewed` to `pending` (m@2031369). GitHub-sourced ids start with `github-` and general PR comments with `github-general-`.

#### 2.4.6 Setup and run status (VERIFIED, in memory only)

The setup process store (`lv` m@3033800, `useSetupProcessStore`) keeps per-workspace `idle, running, completed, failed, cancelled`. It is not in SQL. Only the log paths (`initialization_log_path`, `setup_log_path`) and `workspaces.state` persist. `markSetupInterrupted` sets `failed` with exit code 1 and the text "Setup script was interrupted because Conductor quit." Run script history persists in the KV subsystem `run-script-history` (5 MB, 20 entries per workspace, m@3035206).

### 2.5 Query cache (TanStack Query)

#### 2.5.1 Client and defaults (VERIFIED)

| Item | Value | Offset |
|---|---|---|
| Singleton | `_t = new QueryClient({mutationCache: Fit, defaultOptions})` in main, exported as `Os` | m@954588 |
| Query defaults | `retry: false, networkMode: "always", staleTime: Infinity` | m@954588 |
| Mutation defaults | `networkMode: "always"`; mutation cache `Fit` logs errors with variables redacted unless `meta.logVariables` | m@954268 |
| gcTime default | library default 5 min (300000), or Infinity when `dp` is true (`dp = typeof window > "u" || "Deno" in globalThis`, so non-browser runtimes); overridden per query | m@605802 |
| Shared option preset `Aa` | `retry: (n, err) => n < 2 && !4xx`, `staleTime: 30000`; spread into settings and port-forward queries | m@954404 |
| Persisted query cache | none. No `persistQueryClient`, `dehydrate` or persister in either file. Persistence is done by custom persisters over the KV store. | grep, both files |
| Counts | `invalidateQueries(` 36 in main (35 call sites + class method), 73 in renderApp; `setQueryData(` 6 + 17; `refetchQueries(` 3 + 1; `resetQueries` 2 + 2; `removeQueries` 3 + 1; `cancelQueries` 2 + 2; `queryKey:` 96 + 221; `mutationKey` 145 | grep |

Typical per-query overrides: `staleTime: Infinity, gcTime: Infinity` for app icons (r@502578) and port discovery (m@3722093); `staleTime 300s / gcTime 300s` for some cloud lists (r@2748062); `gcTime 24h` for repo availability (r@1912391); `staleTime 1h, gcTime 2h` for one list (r@2485699); `gcTime 0` for one polled view (r@3025744).

#### 2.5.2 Key to meaning to invalidation

Key factories are plain objects returning arrays (`{all, list, detail, workspace}`). Minified names are given with their first key element.

| Key (factory) | Caches | Invalidated or updated by | Offsets |
|---|---|---|---|
| `["git","workspace",localId,...]` (`tb`, `DR`) incl. `topLevelDirectories`, `subdirectories`, `workingDirectories`, `commit-files-changed`, `turn-changes`, `stack-combined-changes`, PR status rollups | git file lists, diffs, directories per workspace | Whole subtree invalidated when an AI turn completes (`c5t`, with `refreshWorkspaceChanges`); after setup completes; after file revert (`removeQueries ["all-file-contents",id]`); after sparse-checkout change; `["git"]` after chat reset with file reset; `setQueriesData` patches status rollups in place | m@3654637, m@3236017, m@3651135, m@3692041, m@3697457, m@3707275, m@3743193 |
| checkpoint turn diff (`jpi`, key `["git","workspace",id,path,host,"turn-changes",sessionId,turnId]`) | per-turn diff | `setQueryData` with the diff carried by `checkpointCreated` events (`updatedAt: MAX_SAFE_INTEGER`), otherwise invalidate | r@12083454, r@12090330, m@3623489 |
| `["workspace-files",id,path,host]` (`du.workspace`, alias `sPr`) | file tree/list | After rename, fork, setup, git ops | m@2095874, r@272387, m@3743193 |
| `["fuzzy-file-search",...]`, `["workspace-grep",...]` | search results | Not invalidated here (staleness only) | m@2088216 |
| `["file-last-modified-time",id,file]` | mtime poll | `refetchInterval 5s`, `gcTime 5s` | m@2070362 |
| `["workspacePlans",id]` | plan files | After plan write | m@2094634, m@2095903 |
| `["diffComments","workspace",id]` (`HTt`) | triggers store hydrate; list data lives in the `aIt` store | invalidated after attachment stage; side effect `zTt` loads comments | m@2100607, m@3588109 |
| `["github-stack",id,...]` (`zwe`) | PR stack info | `t5t`, `n5t` predicate by workspace; after AI turn | m@3234078, m@3234435 |
| `["github", ...]` (`kh`: recentRepositories, pullRequests, pullRequestSearch, pullRequestByNumber, issues) | GitHub reads | Linear `myActive` and GitHub `issues` are invalidated inside a React effect (trigger not traced); Linear search is invalidated after a 300 ms debounce | m@3215905, r@5661587 |
| `["githubAppConnection"]` (`sF`, `H_e.status`) | GitHub App status | After credential change, auth change, refresh; `setQueryData` then invalidate; Roundhouse URL override change | m@377016, m@956993, m@3816832, r@261304, r@11050619 |
| `["githubCLIAuth"]` (`Nz`) | gh CLI auth | On GitHub auth or credential change | m@3816832 |
| `["workspaces"]` | legacy/cloud workspace page key | Roundhouse URL override change only | m@3817080 |
| `["workspacePullRequests",baseUrl,id,linkRevision]` (`FSe`, alias `shi`) | PR links of a workspace | After closing a PR; after link or create dialogs | m@3726794, m@3727966, r@5527030, r@5532817 |
| `["workspacePreview",baseUrl,id]` (`m$t`) | cloud preview | After preview mutations; `refetchInterval 60s` | r@3021715, r@3022629 |
| `["contextArtifacts", ...]` (`fAi`, infinite) | artifacts list | `resetQueries` on tab open; invalidate after upload; `setQueryData` prepends a new file | r@3017310, r@3018932, r@3020960 |
| `["teamArtifacts", ...]` (`Do`) | team and workspace artifacts | Cloud topic message `workspace-artifacts` invalidates `workspaceArtifact` and `workspaceArtifacts` (exact) on ready and on push | m@3573787, m@3579170 |
| `["workspaceChatMessages",id]` (`wxe`) | cloud workspace chat | `setQueryData` on topic message `workspace-chat`; invalidate on subscription ready | r@2992649, r@2993277, r@2993939 |
| `["port-forwards",id]` (`jR`/`dN`) | forward list per workspace | After every toggle, add, remove, reconcile; also run-localhost helpers | m@3841778, m@3861007..3865583, r@3027540, r@5002317 |
| `["port-forward-discovered",id]` (`kI`) | discovered ports | `setQueryData` from a discovery subscription; `resetQueries` when discovery is cancelled | m@3722093, m@3722373 |
| port settings (`XR`, `qin`, `ein`, `rin`, `pin`) | per-org settings (range, strategy, overrides, hasActivePortForwards) | invalidated by their mutations | m@3848404, m@3869252, r@11146478..11153596 |
| `["conductorConfig","team"/"home"]` (`aI`, `gg`) | conductor.json team and home config | `fs.watch` callback invalidates `gg.team` and `gg.home`; `refetchInterval 30s` | m@3024012, m@3026504, m@3027812 |
| `["acpSessionConfigOptions",...]` (`$w`) | ACP option snapshot | invalidated by option mutation; `setQueryData` from fetch | m@3593500, m@3594819, m@3596125 |
| `["providerModels",...]` (`GCt`, `qJr` predicate) | model lists per provider | Opencode binary path change; `setQueryData` by prefetch | r@311532, r@317899, r@313644 |
| `["agentWorkspace",id,"slashCommands"/"availableMcp"]` (`Gw`) | slash commands, MCP servers | After restart and config refresh; `availableMcp` predicate on MCP edits | r@9296974, r@9300407, r@8673289, r@9505965 |
| `["mcpServers",...]` (`bXe`) | org MCP servers | list invalidated by edits | r@8670191, r@8673195 |
| `["cloudAgentCredentialSelection",...]`, `["cloudHarnessModels"]` (`RXe`) | cloud harness credentials and models | invalidated on credential save | r@9098681, r@9100335, r@9102929 |
| `["automations", list/detail/versions/runs]` (`T4`) | cloud automations | per-key invalidate after each mutation; `removeQueries` on delete; `setQueryData` on create | r@10395909, r@10399599, r@10402949, r@10400587 |
| `["envVars",...]`, `["envVarsMap","shared","local",...]`, `["personalCloudEnvVars",...]`, `["organizationSharedEnvironment",...]` | env var views (SQL `env_vars` plus cloud) | invalidated after any env edit | r@10682207, r@10990210, r@10870478, r@10872261 |
| `["promptSnippets",...]` (`Dye`) | prompt snippets | `invalidate all` after edit | r@8188858, r@8191305 |
| `["organizationGithubInstallations"]`, `list` (`Knr`, `IGt`) | GitHub installs | after connect or disconnect | r@10825649, r@10826319 |
| `["organizationActionPreferences",...]` (`_Ht`) | action prefs | by mutation | m@3213086, r@10902335 |
| `["prWorkspaceLinkSetting",...]` (`prr`) | setting | by mutation (`setQueryData` then invalidate) | r@11126781 |
| `["conductorJsonMigrationState",repoId]` (`kor`) | migration state | by migration action | r@11749730 |
| `["agent-config-sync","diff"]` (`Tui`) | config sync diff | after sync | r@11416156 |
| `["codexChatGptLocalProxyToken",...]` (`E6`) | token | `removeQueries all()` on sign-out | m@3119709 |
| `["linearIssues",...]` (`Em`) | Linear issues | invalidated after a 300 ms search debounce | m@2662385, m@2663554 |
| `["dbVersionWarning"]` | result of `get_db_version_warning` | `ensureQueryData` once at startup; no refetch | r@12034318 |
| `["minimumClientVersion",url]` | forced-update check | `refetchQueries` after network change; `refetchInterval 5 min` | r@12043302, r@12043483 |
| `["resetChatAlsoResetFiles"]` (`Wsi`) | UI pref from KV | invalidated after set | r@9571488, r@9572720 |
| turn outline (`wsi.detail`, `F1a`) | cloud turn outline | invalidated when last known turn id differs from loaded outline | r@9416042, r@9416491 |
| paired devices (`cnr`) | remote-control paired devices | invalidated by Tauri event `onRemoteControlPairedDevicesChanged` | r@10639217, r@10640389 |
| `["Fir.root"]` change-root-path | root path | invalidated after root path change, together with refreshWorkspaces/refreshRepos | r@10965514, r@10965924 |

All `Os.invalidateQueries` calls are chained with `.fireAndForget()` almost everywhere, so no caller waits for the refetch. A few (`_Se`, `Gw.availableMcp` on restart) are awaited.

#### 2.5.3 The second read mechanism: service stores

Pattern (VERIFIED m@276803, m@1930138):
- Each domain service owns a zustand store `__store`. Writers update it via `set`; readers use `useStore`-style selectors (`nt(store, selector)`) or `store.subscribe` (84 `.subscribe(` in main, 54 in renderApp).
- Base class `U$` (m@276803) holds a `canonicalStore` (server/DB truth) and a derived `store`. `run({optimisticUpdate, action, scheduler})` registers an `optimisticUpdate`, recomputes `store = fold(optimisticUpdates, canonical)`, runs the action, then replaces canonical with the action result and drops the overlay. Cancelled actions throw `AbortError`. Used by workspace and repo services (`t.run({scope:"local", optimisticUpdate:{apply}, commit:({source})=>...})`).
- Composer service has a second overlay: `Okt` (m@1926503, `O0()` factory m@1930138) keeps per-session `snapshotsBySessionId` that merges transcript turns with pending sends, plan feedback and queued rows for presentation. It is a pure projection, not a DB writer. The composer store also keeps `state` and `canonicalState` side by side (`gC`, `co` m@1217000 region).
- Write queues: class `Ns` (m@192626) has `type: "serial" | "concurrent"` and per-task `type: "barrier"`. Serial queues are used per session (composer locks, enqueue and turn-completion queues m@1810144), per database for navigation sections (`Ijn` r@276000), and for local-storage writes. `xan` (m@192900 region) takes a barrier across several queues. A separate per-session promise chain `Ka` (m@1402500) serializes cache.db transcript writes. `R$` is a 2-priority slot queue (foreground vs background).
- `.fireAndForget()` is a Promise prototype helper from the shared chunk `fireAndForget-B7hu45mb.js`. Used 306 times in main, 895 in renderApp. It marks a deliberate unawaited promise.
- Cloud push: class `tv`/`hWe` topic subscriptions (specs with `computeDesired`, `topicFor`, `onMessage`, `onSubscriptionReady`) feed either stores (`updateCloudState`, workspace summaries) or `invalidateQueries`/`setQueryData`.

#### 2.5.4 How the UI re-reads after a write

| Data | Re-read path after a write |
|---|---|
| Workspaces, repos, sessions | The service does the SQL write, then updates its own store (`updateWorkspaceStateForAction`, `refreshWorkspace(s)`, optimistic overlay then canonical swap). UI selectors re-render from the store. No query invalidation. |
| Transcript | Service writes the DB, then patches the in-memory transcript window (`Lc`, `markQueuedMessageAsSent` "cache promoted queued to sent"), reloading from DB only if the cached row is missing. Cloud: a feed batch writes cache.db and the store together. |
| Composer queue | Outbox write, then `republish`/`refreshStore(sessionId)` rebuilds the store snapshot. The drainer re-schedules itself. |
| Git, GitHub, file lists, config | Mutation or event handler calls `invalidateQueries` on a key subtree, or polling (`refetchInterval` 2 s to 1 h). |
| Cloud-owned lists (chat, artifacts, summaries) | Server push over Roundhouse topics, applied to store or query cache. |
| Polling summary | Query polls: 2 s (one cloud job view), 5 s (ports, mtime), 30 s (config, GitHub, previews), 60 s (stack info, PR links), 5 min and 1 h for slow data. Store polling: `remoteWorkspaceMonitor` poll config per workspace (`getPollConfig` m@1021492) for cloud workspaces that are not archived or unstarted. |

### 2.6 Cross-DB and sync

#### 2.6.1 Who writes where (VERIFIED unless noted)

- Local operations write `conductor.db` directly in SQL. There is no server call.
- Cloud (Roundhouse) operations are server-first, then local mirror. Example: `Flt` m@1123775 calls `createUnstartedWorkspace`, then `associate`, then imports the returned summary into cache.db. Session rename `Wqr.updateTitle` calls `updateSessionTitle` over HTTP, calls `recordWrite({sessionId, updatedAt})` (so the echo from the push channel is recognised), then writes the cache row (`hNt`). r@108343.
- Inbound server changes arrive as summaries or feed items and are applied with revision guards: a workspace summary older than the stored `revision` is ignored (m@976047); the multi-row `WITH updates` statement writes only changed columns (m@980318).
- The only durable queue toward the cloud is the message outbox (4.4) plus its asset outbox. Other cloud writes are request/response and fail visibly. No generic sync log was found. INFERRED: other failures are surfaced as toasts and not retried.
- `recordWrite` and `identity_associations` keep local ids and server ids consistent. Server ids are fetched on demand (`Ds.serverId` promise, `loadServerId` hits `identity_associations`).

#### 2.6.2 cache.db purpose (VERIFIED + INFERRED)

cache.db is the local mirror of everything that belongs to a remote (Roundhouse) host. Evidence: the `Dn` rule; the startup mover `prepare-cache-db` (r@12116059) copies cloud rows `repos`, `workspaces`, `sessions` (`INSERT OR REPLACE` for workspaces and sessions, `OR IGNORE` for repos) and `identity_associations` (only when cache has fewer rows) from conductor.db, then deletes them from conductor.db, including `session_messages` of those sessions, and all `port_forwards`. If the copy fails it keeps the data in conductor.db and does not delete. INFERRED: this is a one-time migration for installs that stored cloud rows in conductor.db before cache.db existed; it re-runs idempotently at every start.

The cloud transcript cache lives here too: `session_messages` (with `session_index` and `source_rowid`), `client_cache_session_state`, `client_cache_session_segments`, and `session_pending_messages(_state)`.

#### 2.6.3 Session feed offset and segments

| Piece | Meaning | Offset |
|---|---|---|
| `client_cache_session_state.feed_offset` | Last feed index applied for a cloud session (-1 when none). `sessions.feed_offset` exists too (default -1 on insert). | m@1407104, m@1408237 |
| `cache_version` (`wW = 1`) | If the stored version is not 1, `bW` deletes the session's messages, segments and state, then re-hydrates. | m@1402500 |
| `cache_revision` | Increments on every cache write (`sv`); readers use it as `transcript_revision` to detect change. | m@1403725, m@1530770 |
| `client_cache_session_segments` | Ranges `[start_index, end_index]` of history held locally. Open end means "up to the live tail". `rv` returns `[{0, open}]` when empty; `Bhe` merges and sorts overlapping ranges. | m@1405133 |
| Tail jump `yft` | If the feed jumps more than one past the offset, finalize closed segments up to the old offset, open a new segment at the new start, mark older assistant rows `compacted`, and set `feed_offset = start-1`. | m@1406980 region |
| History pages | `ingestSessionHistoryPage` / `loadSessionHistory` fill gaps on demand and call `wft` to add a segment. | m@1405820 |
| Per-session mutex | `Ka` serializes all cache writes for one (db, session). | m@1402500 |
| Best-effort | Cloud transcript cache writes are labelled best effort ("Best-effort session transcript cache write failed"), so the live store can be ahead of cache.db. | m@1755800 |

`pending messages` mirror: `session_pending_messages_state.generation` and `paused` track the server queue generation. A send passes `expectedGeneration`; a mismatch returns a 409 "conflict" with the new state, and `ng` rewrites the mirror. `dhe = 1` is its cache version; a mismatch clears the mirror (`zht`).

#### 2.6.4 DB version check (VERIFIED)

- Tauri command `get_db_version_warning` is called through query `["dbVersionWarning"]` (`iar.warning`, r@12034318). A non-null result is the warning payload `{dbVersion, appVersion, identifier, ...}`.
- On non-null the app renders the "Database from a newer version" screen: "This database (schema version N) was created by a newer version of Conductor than the one currently running (supports up to version M)". It fires analytics event `db_version_mismatch_detected` with `{db_version, app_version}` (r@12034863).
- Startup gate: `G1l` (r@12119789) does `mcl().then(e => { if (e !== null) return; ... })`. When there is a warning, frontend services do not start (`x1l` with `resetWorkingSessionsToIdle: true` is skipped) and no agents start. The router wrapper `Vcl` (r@12048397) also checks `r.data !== null` before kicking off warm-up calls.
- The frontend does not read a schema version table itself. The check, and all migrations, are in Rust.

### 2.7 Data lifetime and cleanup

#### 2.7.1 Persistent stores and what removes data

| Store | Keeps | Removed by | Offset |
|---|---|---|---|
| `workspaces` | all workspaces, archived ones included | explicit delete only; at startup local `failed` and `initializing` rows are deleted | m@1073201 |
| `sessions`, `session_events`, `session_state`, `session_messages` | forever | deleted with the workspace or session (`deleteWorkspaceSessions`, `M1t` both DBs m@2461967) | m@2457923 |
| `session_events.reverted_at` | reverted events are kept, only marked | never removed in the frontend | m@1549242 |
| `session_messages` rewind | rows after a watermark | `DELETE ... COALESCE(sent_at,cancelled_at) > ?` | m@1552063 |
| cloud transcript cache | per session | `bW` on cache version mismatch; deleted with session. No age cutoff found. `last_read_at` is written (`Nhe` m@1404409) but not read by any frontend statement, so INFERRED: Rust uses it for eviction, or it is unused. | m@1402500 |
| outbox rows | until acked, cancelled, or discarded; failed rows stay until the user retries or discards | `wV`, `Vl` | m@1219103 |
| `settings` | rows deprecated via `deprecated_at`, not deleted | explicit `DELETE FROM settings WHERE key=?` | m@369392, m@375020 |
| `terminal_sessions` | index rows | `DELETE WHERE session_id=?` | m@2970677 |
| `diff_comments` | until deleted, superseded or sync removes GitHub ones | m@2033320 | |
| `port_forwards` | per workspace | removed on archive or workspace delete | m@3843192 |
| Change root path | wipes `attachments, diff_comments, session_messages, session_events, session_state, sessions, workspaces, repos` from conductor.db, cancels runs and terminals | user action `changeRootPath` | r@10966250 |

The grep for time-based deletes found none. The only `DELETE ... > ?` is the rewind watermark above. `datetime('now')` appears only to stamp `updated_at`/`deprecated_at`.

#### 2.7.2 KV store limits (VERIFIED)

Eviction: when a write pushes `totalSize` over the limit, entries with the oldest `lastUpdatedAt` are removed until it fits (`$4e` m@244894, loop m@247400). If one entry alone exceeds the limit the write fails (`subsystemFull`).

| Subsystem id | Limit | Offset |
|---|---|---|
| `browser-local-storage` | 5 MB | m@242650 |
| `session-questions` | 512 KB | m@1710006 |
| `claude-context-windows` | 64 KB | m@1393476 |
| `git-service-pull-request-changes-v1` | 25 MB | m@817674 |
| `git-service-workspace-changes-v1` | 25 MB | m@759495 |
| `git-service-pr-v2` | 5 MB | m@723205 |
| `composer-drafts` | 5 MB | m@2003117 |
| `terminal-history` (encrypted) | 50 MB | m@2969688 |
| `run-script-history` | 5 MB | m@3035206 |
| file diff cache | 25 MB (26214400) | m@2057973 |
| hidden actions | 1 MB (`Vqe`) | m@389432 |

#### 2.7.3 Open items (not verified)

- The full DDL and migrations are in Rust and were not read. Column types, indexes and foreign keys are unknown.
- Whether `favorite_models`, `navigation_sections` and `navigation_section_memberships` sit in db or cache for each scope.
- Which database the cloud composer outbox uses. Both drainers take `dependencies.db`, so INFERRED conductor.db for both. The `prepare-cache-db` job does not move the outbox tables.
- Where `cancelled_at` is set. No frontend write exists, so it is a Rust or legacy column.
- Server-side eviction by `last_read_at`.
- The local "queued" rows in `session_messages` (`asQueued`) versus the outbox: both look like queues. The outbox is the pre-delivery queue. The transcript queue appears when a message is accepted while the agent is busy. Not traced end to end.
- Exact reader of the `xA = -1` sentinel (m@1713700). Writers set `queue_order = -1` when a queued user row is promoted to sent in a cloud batch, and `KW` NULLs rows still at -1. The consumer of -1 was not traced.



---

## Part 3. Every git and gh command


Scope: `main-BE1h_1MP.js` (m) and `renderApp-DeUrsznk.js` (r). Offsets are char offsets. VERIFIED means I read the code at that offset. INFERRED means reasoned from nearby code. Placeholders are in `<angle brackets>`. Secrets and keys are omitted (setting and secret names only).

Two files outside the bundles were also read, because the frontend only calls them: `/Applications/Conductor.app/Contents/Resources/bin/checkpointer.sh` and `git-busy-check.sh` (VERIFIED, read-only). The same `bin/` dir holds a bundled `gh`, `watchexec` and `spotlighter.sh`.

Big picture in five lines:
1. The frontend runs git itself, as shell strings, through one shell door (`executeZsh`). There is no libgit2 and no Rust git.
2. Almost all state is polled: file changes every 5 s, local branches every 5 s (foreground repo) or 60 s, PR info every 5 s (visible) or 300 s (sidebar), with a GraphQL rate-limit gate.
3. The app never commits, rebases, or resolves conflicts for the user. It hands those jobs to the agent as a chat message ("reconcile", "commit and push", "create a PR").
4. Turn checkpoints are real git commits under a private ref namespace, written by `checkpointer.sh` using a temp index. They drive turn diffs, revert, archive and Spotlight.
5. GitHub is reached only through the bundled `gh` binary (`gh api graphql`, `gh pr ...`, `gh stack ...`, `gh run rerun`). Graphite (`gt`) is read-only.

---

### 3.0 Plumbing: how a command is executed

#### 3.0.1 Shell doors (DI object `shell`, VERIFIED m@3709100)

`shell:{supportsLocalHost:true, executeGit:Fn, executeZsh:Je, shellEscape:he, executeZshWithGhToken:hr, executeZshWithHttpsGitFallback:iEe, executeGitAndReadStdout:grn, SHELL_TIMEOUT_EXIT_CODE:qR}`, `gitInfra:{branchNameIsTaken:oH, gitFetchUnlocked:FR, withRepoGitLock:p3, withWorktreeGitLock:cu}`, `paths:{getBundledGhPath:Fo}`.

| Door | Real command shape | Notes |
|---|---|---|
| `executeZsh` (`Je`, m@3826800) | Tauri `execute_shell_command {shell, command, noRcs, resourceCommand}` locally. For cloud hosts it is an HTTP call to the VM (`/shell/execute`) | On macOS the command is prefixed with `export PATH=<captured> && export K=V ...` from the captured login-shell env (`nEe`), with `noRcs:true`. Optional `timeoutMs` races a timer, then calls `cancel_shell_command` and returns `{code:-1, stderr:"executeZsh timed out after <ms>ms"}` |
| `executeGit` (`Fn`, m@3832495) | `cd "<cwd>" && git -c core.quotePath=false <gitArgs>` via `executeZsh` | Wrapped in `JI` retry (see 0.4) |
| `executeGit` for cloud auth (`rEe`, m@3832631) | `cd "<cwd>" && git -c core.quotePath=false -c credential.https://github.com.helper=<YT> <gitArgs>` via `executeZshWithGhToken` | `<YT>` is `!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f` (VERIFIED m@648141) |
| `executeGitAndReadStdout` (`grn`) | `executeGit`, throws `stderr` on non-zero, returns `stdout.trim()` | |
| `executeZshWithGhToken` (`hr`, m@3827200) | Injects a GitHub token, see section 9 | Retries up to 2 times on 401 |
| `executeZshWithHttpsGitFallback` (`iEe`, m@3833200) | Runs the command plain. If stderr matches an SSH-blocked pattern, retries with HTTPS config | See section 6.2 |
| `executeGitStreaming` (`pbn`, m@3829500) | Spawns `exec-zsh -c 'export GIT_TERMINAL_PROMPT=0 && export PATH="<DB>:$PATH" && <cmd>'` and streams stdout and stderr | Used for `git clone --progress` |
| `executeInternalScript` (`hrn`/`sEe`, m@3829000) | Writes `set -e\ncd "<wd>"\n<script>` to `<tmp>/conductor-script-<ts>-<rand>.sh`, runs `"<shell>" "<file>" < /dev/null > "<tmp>/conductor-<ts>-<rand>.log" 2>&1`, deletes the script, returns `{exitCode, stdout, stderr, logFilePath}` | Used only for `git worktree add` (so post-checkout hook output lands in a log file) |

`SHELL_TIMEOUT_EXIT_CODE = qR = -1` (VERIFIED m@3826500). The other sentinel `tEe = -2` means "shell command cancelled".

#### 3.0.2 Timeouts (VERIFIED)

| Constant | Value | Where |
|---|---|---|
| `Gm` | 10 000 ms | every `gh api graphql` PR query (PR fetch, PR ref, PR details) |
| `zm` | 10 000 ms | `git config --get branch.<b>.remote/merge` and `rev-parse --verify` and `branch --show-current`, only for remote (cloud) hosts |
| `RQe` | 30 000 ms | `gt state` |
| `Uce` | 10 000 ms | "warm timeout" of the git locks: only logs `[git-lock] Git operation exceeded warm timeout`, never aborts |
| checkpoint save (sidecar) | 60 000 ms, then SIGTERM, then SIGKILL after 5 s | `aCu`, `uCu` in sidecar.js |
| `Zle` | 60 000 ms | minimum gap between two background `git fetch` of the same (repo, branch) |
| `UJe` | 300 000 ms | negative cache for "this branch has no PR" |

#### 3.0.3 Locking model (VERIFIED m@665500, mutex store m@201190)

- `oo({key, operation, operationName, logger, timeoutMs?, warmTimeoutMs?})` is a named async mutex (`CWe(key)` keeps a `Map<key, mutex>`; `runExclusive`). It is in-process only. There is no lock file on disk.
- Key format: `<scope>:<hostPrefix><path>` where `hostPrefix` is empty for local and `<urlencoded hostingServerUrl>:<urlencoded vmId>:` for cloud.
- `withRepoGitLock = p3` has scope `repo` and path = `mainWorktreePath`. `withWorktreeGitLock = cu` has scope `worktree` and path = the worktree path, or `workspace:<localId>` for cloud hosts.
- Who takes which lock:
  - Worktree lock: push, pull, `git branch -m`, checkout (`att`), `gh stack sync`, "reconcile workspace with <remote>/<target>", the target-branch reset.
  - Repo lock (nested inside the worktree lock): `git push -u` (it writes branch config) and `gh stack sync` / auto "catch up stack branch".
  - No lock: `gitFetchUnlocked` (name says it), all read-only polling commands, file-diff reads.
  - A separate named mutex `checkout-branch:<localId>` serialises switch-branch.
  - Per-action dedupe (`Xn()`): rename, push, pull, syncStack, merge, approve, enableAutoMerge, disableAutoMerge, markReady, updatePrMetadata, updatePrBase, editReviewers.

#### 3.0.4 Retry on git's own lock errors (VERIFIED m@201700)

`JI(fn, {retryDelaysMs:[50,100,200]})` re-runs a git command when its output matches either of:
- `fatal: Unable to create '.../index.lock': File exists.`
- `error: cannot lock ref '<refs/remotes/...>': is at <sha> but expected <sha>`

It is applied to `executeGit`, the changed-files commands (`Vm`) and the HTTPS fallback shell.

#### 3.0.5 How output is parsed (VERIFIED m@743300-744600)

- Paths: `ua()` un-quotes C-style quoted paths (`"..."` with `\\`, `\"`, octal escapes). The changes pipeline does not pass `core.quotePath=false`, it decodes instead.
- `--name-status` parser `b0`: tab split. `A`, `D`, `M` map to added, deleted, modified. `R*` with two paths maps to renamed `{oldPath}`. Anything else (for example `C`, `T`) is ignored.
- `--numstat` parser `Jg`: `added<TAB>removed<TAB>path`. `-`/`-` means binary. Rename forms `{a => b}` and `/dev/null => x` are normalised to the new path.
- `status --porcelain` parser `det`: only conflict codes are kept (`U?`, `?U`, `AA`, `DD`) and marked `status:"conflicted"`.
- Commit list: `git log <range> --format="%H|%s|%an|%ae|%at"` split on `|` from the right (hash first, then message may contain `|`).
- Ahead and behind: `git rev-list --left-right --count A...B` as two ints.
- Worktree list: `git worktree list --porcelain`, lines `worktree <path>`, `branch refs/heads/<b>`, `detached` (detached becomes the sentinel `Yg`).
- `gt state` JSON: zod-parsed, branch names validated by `^[A-Za-z0-9._/@+-]+$`.

---

### 3.1 Workspace create

| Step | Command | Who and when |
|---|---|---|
| Empty-repo guard | `cd "<mainWorktreePath>" && git rev-parse HEAD`, and on non-zero: `git commit --allow-empty -m "Initial commit"` | `Ide`, always before a new worktree (VERIFIED m@1086700). This is the "empty HEAD" handling. |
| Resolve base revision (new branch from remote) | `git fetch --no-write-fetch-head --prune <remote> <branch>` then `cd <mainWorktreePath> && git rev-parse refs/remotes/<remote>/<branch>` | `Oct`, uses `gitFetchUnlocked` on the local host (VERIFIED m@1088600) |
| Fetch failure branches | stderr `'<remote>' does not appear to be a git repository` gives "Couldn't find remote `<remote>`. Use `git remote add <remote> <git_url>` to add it."; `couldn't find remote ref` gives "Couldn't find <remote>/<branch>"; `could not read Username for` or `Device not configured` falls back to the cached ref, or throws an auth error; port-22 style errors give the "network blocks SSH" message; `Could not resolve host` falls back to the cached `refs/remotes/<remote>/<branch>` via `git rev-parse` and calls `notifyOfflineFetchFallback` | VERIFIED |
| Local-only default branch fallback | `git -C <main> rev-parse --verify refs/heads/<branch>^{commit}` when the failure is "Couldn't find <remote>/<branch>" and branch is the default branch (also when a local-git repo has no remote at all) | `Ect` (VERIFIED m@1080500) |
| Create worktree, new branch | `git worktree add '<path>' -b '<newBranch>' '<sha>'` | via `executeInternalScript` in `mainWorktreePath` (VERIFIED m@1087102). The start point is a SHA, not a ref name. |
| Create worktree, reuse branch (unarchive) | `git worktree add '<path>' '<existingBranch>'` | same door |
| Hook failure tolerance | on non-zero exit: `cd <main> && git worktree list --porcelain \| grep -q "^worktree <path>$"`. If the worktree exists, the failure is downgraded to a warning "Worktree created at <path> but post-checkout hook failed" | VERIFIED m@1087380 |
| Error prettifier | regex on `fatal: cannot lock ref 'refs/heads/<a>/<b>': 'refs/heads/<a>' exists; cannot create ...` gives "Git won't let us create branch ... because ... already exists. Rename or delete ..., or change your git prefix in settings." | `Pct` |
| Worktree-level config | see section 12 | `Sde` |
| Copy ignored files | not git: `.worktreeinclude` plus `file_include_globs` setting, copied by a helper | VERIFIED m@1088000 |
| `.context` folder and exclude | `cd "<wt>" && git rev-parse --git-common-dir`, then `grep -qF ".context/" "<common>/info/exclude" \|\| echo ".context/" >> "<common>/info/exclude"` | `Mde.addDirectory` (VERIFIED m@1133831). `.context/` is excluded in the shared `info/exclude`, never in `.gitignore`. |
| File count for the UI | `cd "<wt>" && git ls-files \| wc -l` | stored in `initialization_files_copied` (VERIFIED m@1091000) |
| Branch name uniqueness | `git show-ref --verify --quiet refs/heads/<b>` OR `git show-ref --verify --quiet refs/remotes/<remote>/<b>` (`oH`, m@3682700); also a directory-name check on disk | suffix `-v1`, `-v2`, ... (`Nm`), up to 1000 tries (VERIFIED m@1076156) |
| "Is branch checked out elsewhere" | `cd <repo> && git worktree list --porcelain \| grep -qFx 'branch refs/heads/<b>'` | `xct` |
| New-branch-from-detached "Continue" | `git checkout -b "<newBranch>" "<sha>"` (local) or the same with the cloud credential helper | `gnn` (VERIFIED m@3760200). SHA comes from `resolveBranchRevision`. |
| Create from existing local branch | `git rev-parse <branch>` (local-git forge `VQe`) | |

Base-branch resolution for the GitHub forge is `git fetch ... <remote> <branch>` plus `rev-parse refs/remotes/<remote>/<branch>` (`WQe`, m@641500). For the local-git forge (no GitHub remote) it is simply `git rev-parse <branch>` (`VQe`). The forge is chosen by remote host: `github.com` and `ssh.github.com` only (`wj`, `l3`); every other host is treated as `local-git` (VERIFIED m@648000).

---

### 3.2 Initial setup

The setup script is not git. It runs in a PTY (see frontend.md). Git-related bits around it:
- Setup runs after `UPDATE workspaces SET state='setting_up'` (VERIFIED m@1091300).
- `git rev-parse HEAD`-based "context folder" and exclude handling is in section 1.
- User identity is read for the agent env: `git -C "<repo>" config --get "user.name"` and `"user.email"` (local only, `Ade`), and `pull.rebase`, `pull.ff` (`Rct`) (VERIFIED m@1085700). In the settings UI the global values are read with `git config --global --get user.name|user.email` (r@11125071).
- Add repository: `test -d <path>/.git` then `git init` (if missing), `git remote get-url <remote>`, `git clone --progress -- <url> <dest> 2>&1` (streaming), `git checkout <defaultBranch>` if default is not `main`, default branch detect (section 12), and `git remote set-url <remote> <canonicalUrl>` to normalise the saved URL (VERIFIED m@867400, m@872700).
- Create-a-new-GitHub-repo flow (r@1710400): `git init`, optionally `git remote rename origin upstream`, `gh repo create <owner/name> --description <d> --private --source=. --remote=origin`, `git -c credential.https://github.com.helper=<gh auth git-credential> push -u origin HEAD`, `git remote get-url origin`, `gh repo view <owner/name> --json url -q .url`. On failure it renames `upstream` back to `origin`.

---

### 3.3 Status and changes polling (the changed-file list and counts)

#### 3.3.1 Schedule (VERIFIED)

- Subscriptions per workspace: main (visible) workspace `{depth:"full", interval:5000}` (`iXe`), sidebar workspaces are subscribed but immediately cancelled (so no polling) (m@646000 and m@652000).
- `Uet` scheduler: `setTimeout` loop at `interval`, `maxStalenessMs = 0.9 * interval` so a fresh cached result is reused.
- Concurrency: 4 slots (`zet = 4`), foreground workspaces are promoted ahead of background ones.
- Depths: `metadata` (no file list), `uncommitted`, `full`. A cache of the last result is persisted (subsystem `git-service-workspace-changes-v1`, 25 MB cap).
- Refresh also runs after any git action (`handleWorkspaceGitChanged`) and after agent activity for cloud hosts.
- Repo-level branch list refresh (`gtt`): every 5 s for the foreground repo, 60 s for other tracked repos, only while the window is focused, plus a catch-up on focus loss (m@805866).

#### 3.3.2 Commands for one `full` refresh (`_et`, VERIFIED m@748000-756000)

All run via `cd <wt> && git <args>` inside `executeZsh` with the 50/100/200 ms lock retry.

1. Branch: `git branch --show-current` (empty means detached).
2. Diff target: stack parent if a Graphite stack says so, else open PR `baseRefName`, else the workspace `intendedTargetBranch` (`k3`). Target ref is `refs/remotes/<remote>/<branch>` for GitHub forge or the plain branch name when it is a local stack parent or local-git.
3. Merge base: `git merge-base <targetRef> <branch>` (`sC`). On failure the result carries `mergeBaseError` and the file list is empty.
4. Committed plus uncommitted file list, in parallel:
   - `git diff -M --no-ext-diff --no-textconv --name-status <mergeBase>`
   - `git diff -M --no-ext-diff --no-textconv --numstat <mergeBase>`
   - `git status --porcelain --untracked-files=no` (only to mark conflicts)
5. Untracked files: `git ls-files --others --exclude-standard` (cap 100 files, flag `isUntrackedFilesTruncated`). Line counts for each untracked file in batches (command length cap 200 000 bytes): `if [ -f <p> ] || [ -L <p> ]; then git diff --no-index --numstat -- /dev/null <p> 2>/dev/null || true; fi`. Files over 300 KB are not counted (reported as 501 added lines).
6. mtime and size for each changed file: `LC_NUMERIC=C stat -f "%Fm %z %N" -- <paths...>` on macOS, `stat -c "%.Y %s %n"` on Linux hosts, in chunks.
7. "Uncommitted only" (`Km`): the same three commands against `HEAD`: `git diff -M --no-ext-diff --no-textconv HEAD --name-status|--numstat`, `git status --porcelain --untracked-files=no`, plus untracked.
8. Upstream sync (`I3`): `git rev-parse HEAD '@{u}'` then `git rev-list --left-right --count <upstreamOid>...<headOid>`. Output gives `{branchExists, ahead, behind, localOid, upstreamOid}`. If there is no upstream, `branchExists:false`.
9. Target sync (`jle`): `git rev-parse HEAD`, `git rev-parse --verify --quiet <remote>/<target>`, `git rev-list --count <head>..<remoteTarget>`. Result is "behind target" plus the target OID.
10. Branch commits: `git log <target>..HEAD --format="%H|%s|%an|%ae|%at"` (`Kle`; target is `<remote>/<branch>` or the local stack parent).

#### 3.3.3 Cheaper polls

- Local branch of a workspace (`SZe`, m@717439): `git branch --show-current`. Writes are ignored if the stored branch changed while the read was in flight ("Skipped stale local branch write"). A branch change clears the stored PR info and changes.
- Repo branches (`dXe`): `git branch --format='%(refname:short)' --sort=-committerdate` and `git worktree list --porcelain` (builds `checkedOutBranches`).
- HEAD commit (`btt`): `git rev-parse HEAD`.

#### 3.3.4 When a fetch is triggered by staleness (`ktt`, m@811600)

After a changes refresh the app compares the PR's `baseRefOid` to the local `origin/<target>` OID. If they differ (and the diff target is not a local stack parent), or the PR `headRefOid` differs from the upstream OID, it runs `gitFetchUnlocked({remote, refspecs:[<branch>...]})`, then refreshes changes. Throttled to once per 60 s per `(repo, branch)` (local) or `(workspace, branch)` (cloud). Not run when the sandbox is unavailable.

---

### 3.4 Diffs

#### 3.4.1 View modes (`resolveComparison`, VERIFIED m@2075469)

| View mode | `fromRef` | `toRef` | Meaning |
|---|---|---|---|
| `all` | `<mergeBase>` | none (working tree) | whole branch against merge base |
| `uncommitted` | `HEAD` | none | working tree against HEAD |
| `commit` | `<hash>^` | `<hash>` | one commit |
| `range` | `<fromOid>` | `<toOid>` | PR range (stack diffs) |
| `turn` | `refs/conductor-checkpoints/session-<sessionId>-turn-<turnId>-start` | `...-end` (or none = working tree) | one agent turn |
| `tree` | none | none | file browser, no diff |

#### 3.4.2 File contents (local host, VERIFIED m@2071373)

- Old side: `git show --no-ext-diff --no-textconv '<fromRef>:<oldPath|path>'` (exit 128 means file missing).
- New side: if `toRef` is set, the same `git show` at `toRef`; otherwise the file is read from disk (not git).
- The diff itself is computed in the browser (`@pierre/diffs`).
- Guard counts: `git diff --no-ext-diff --no-textconv --numstat <from> [<to>] -- ':(literal)<oldPath>' ':(literal)<path>'` summed to decide if a large file may render.

#### 3.4.3 File patch (remote hosts, `preferPatchForRemoteDiffs`, VERIFIED m@808700)

`git diff --no-ext-diff --no-textconv --no-color [--ignore-all-space] <from> [<to>] -- ':(literal)<path>'`. For an untracked file: `git diff --no-ext-diff --no-textconv --no-color [--ignore-all-space] --no-index -- /dev/null <path>`; exit code 1 is treated as success.

#### 3.4.4 Commit diff (list) (`_tt`)

`git show --no-ext-diff --no-textconv <hash> --format="" --name-status` and `... --numstat`.

#### 3.4.5 PR and stack range diffs (`Ctt`, VERIFIED m@812500)

For each PR in a stack: check both OIDs exist locally with `git rev-parse --verify --quiet '<oid>^0'` (exit 0 present, exit 1 missing, other codes throw). Missing ones are fetched by branch name (`gitFetchUnlocked`, throttled 60 s). Then `fromOid = git merge-base <baseRefOid> <headRefOid>`. The range file list is `git diff -M --no-ext-diff --no-textconv --name-status|--numstat <fromOid> <toOid>` (`wtt`). Result states: `resolved`, or `unresolved` with reason `missing-head` or `missing-base`. Cached under `git-service-pull-request-changes-v1`.

#### 3.4.6 Agent-facing diff (MCP `GetWorkspaceDiff`, VERIFIED m@2691727)

`checkpointer.sh save --id conductor-getdiff --force`, then `git diff [--stat] "<mergeBase>" "refs/conductor-checkpoints/conductor-getdiff" [-- <path>]`. If exit 101 or 102 the tool returns "Cannot fetch diff: merge or rebase in progress".

---

### 3.5 Commit

The app has no commit button that runs `git commit`.
- UI action "Commit and push" (GitHub forge) or "Commit" (local-git) is an agent instruction: `commitAgentInstruction: "Commit and push all changes"` / `"Commit all changes"` (VERIFIED m@643300, m@645000). The agent runs git.
- The only direct `git commit` calls: `git commit --allow-empty -m "Initial commit"` (section 1) and the legacy-config migration `git -c core.hooksPath=/dev/null commit -m "Migrate conductor.json to .conductor/settings.toml"` after `git add -A` in a throwaway worktree (VERIFIED m@3013500-3015300).
- Migration flow (`git worktree add <p> -b <b> origin/<base>` after `git fetch origin`, commit, `git -c core.hooksPath=/dev/null -c credential.https://github.com.helper=<gh auth git-credential> push -u origin <b>`, `gh pr create --title ... --body ... --base <base> --head <b>`, then `git worktree remove --force <p>` and `git branch -D <b>`) is the only place where the app itself calls `gh pr create`. Before it, `gh pr list --head <b> --state open --json url --limit 1` checks for an existing PR (VERIFIED m@3012864).

---

### 3.6 Push, pull, fetch

#### 3.6.1 Push (`VXe`, VERIFIED m@667400)

Runs inside the worktree lock. If a remote and branch are known:
1. Look up the upstream: `cd "<wt>" && git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || true`.
2. If upstream is `<remote>/<name>`: `git push <remote> HEAD:<name>` (no `-u`).
3. Otherwise (first push) a small shell program under the repo lock:
   ```
   remote_name=<remote>; branch_name=<branch>
   configured_remote=$(git config --get "branch.$branch_name.remote" || true)
   configured_merge=$(git config --get "branch.$branch_name.merge" || true)
   remote_branch="$branch_name"
   if [[ remote matches && merge is refs/heads/* ]]; then remote_branch="${configured_merge#refs/heads/}"; fi
   git push -u "$remote_name" HEAD:"$remote_branch" \
     && git config "branch.$branch_name.remote" "$remote_name" \
     && git config "branch.$branch_name.merge" "refs/heads/$remote_branch" \
     && git fetch "$remote_name" "+refs/heads/$remote_branch:refs/remotes/$remote_name/$remote_branch"
   ```
4. With no remote info: plain `git push`.
- Local host: `git` as-is (user credentials/SSH), via the HTTPS fallback door. Cloud host: `git -c credential.https://github.com.helper=<YT> push ...` via the GH-token door.
- Never forces. Force-push appears only inside agent instructions ("then push --force-with-lease").
- Error text: SSH-blocked stderr is replaced with "Couldn't reach the Git remote: this network appears to block SSH, and HTTPS failed too ...".

#### 3.6.2 HTTPS fallback (tag `git-https-fallback`, VERIFIED m@3833200 and m@648437)

1. Run the git command normally (`executeZsh`).
2. If the exit is non-zero and stderr contains `port 22`, `ssh: connect to host` or `kex_exchange_identification` (`u3`), re-run through the token door with this env (`frn`):
   - `GIT_TERMINAL_PROMPT=0`
   - `GIT_CONFIG_COUNT=3` with keys `url.https://github.com/.insteadOf` = `git@github.com:` and `ssh://git@github.com/`, and `credential.https://github.com.helper` = either `<YT>` (when a stored token exists) or `!"<bundled gh>" auth git-credential`.
3. If the retry also fails, log `SSH to the remote is blocked; HTTPS retry also failed` and return the original SSH failure; otherwise log `HTTPS retry succeeded` and return the retry.

#### 3.6.3 Pull (`ZXe`, VERIFIED m@668600)

`cd "<wt>" && git pull` (or `git -c credential...helper=<YT> pull` on cloud) inside the worktree lock. It uses the user's own `pull.rebase`/`pull.ff` config. The result is not post-processed.

#### 3.6.4 "Pull latest from target" (`sZt`, VERIFIED m@3683300)

1. If the worktree is dirty (`Km` file count > 0): send the agent `reconcileAgentInstruction` (message below). No git is run.
2. `git fetch --no-write-fetch-head --prune <remote>` (only if the forge has a remote).
3. Re-check dirty under the worktree lock. Resolve target ref and compare with `I3` ahead/behind.
4. If behind and not ahead: `cd "<wt>" && git merge --ff-only <remote>/<target-sha-or-ref>` (toast "Pulled latest changes").
5. If diverged: send the agent the reconcile message. Rebase versus merge is decided by `git config --get pull.rebase` (true values: `true, yes, on, 1, merges, interactive, preserve`) (VERIFIED m@3705737).

Reconcile messages (VERIFIED m@641000):
- rebase, dirty: "Commit uncommitted changes, then rebase this branch onto <remote>/<target>. Then push --force-with-lease."
- merge, clean: "Merge <remote>/<target> into this branch. Then push."
- (local-git forge omits the push.)

#### 3.6.5 Fetch primitive (`FR` = `gitFetchUnlocked`, VERIFIED m@3674128)

`git fetch --no-write-fetch-head --prune <remote> [<refspec>...]`
- Local host: through the HTTPS-fallback door. Remote host: through the token door with the credential helper config.
- Uses `--no-write-fetch-head` so concurrent fetches do not fight over `FETCH_HEAD`.
- Refspec forms in use: a bare branch name `<branch>`, and `+refs/heads/<b>:refs/remotes/<remote>/<b>` (checkout).
- Strategy: on demand only. There is no periodic `git fetch` loop. Triggers: new workspace base, "pull latest", checkout of another branch, remote branch list, PR range missing OIDs, staleness vs PR OIDs (60 s per key), retarget.
- Offline: "Could not resolve host" falls back to cached remote refs (create flow and `HQe`).

#### 3.6.6 Remote branch list (`UQe`, VERIFIED m@641800)

`gitFetchUnlocked` then `cd "<main>" && git for-each-ref --sort=-committerdate --format='%(refname:short)' refs/remotes/<remote> | grep -v 'HEAD' | sed 's/^<remote>\///'`. Local list: `git for-each-ref --sort=-committerdate --format='%(refname:short)' refs/heads`.

---

### 3.7 Pull requests (GitHub forge only)

#### 3.7.1 Create

- UI "Create PR": sends the agent a message (prompt builder `cwe`, VERIFIED m@3147849). Steps given to the agent, in order:
  1. Invoke any PR-related skills.
  2. `git status`; if dirty, review with `git diff` and commit.
  3. `git push -u <remote> HEAD` if no upstream or unpushed commits (follow the existing upstream if it differs).
  4. Review the diff: Claude agents use the MCP tool `mcp__conductor__GetWorkspaceDiff`, others use ``git diff <remote>/<target>...``.
  5. `gh pr create --base <target> [--title <title>] [--body <description>]` (draft is mentioned in the prompt text). Title under 80 chars, description under five sentences. A PR template found in `pull_request_template.md`, `.github/pull_request_template.md` or `docs/pull_request_template.md` is attached.
- "Open on GitHub" button (`ZJt`, VERIFIED m@3683700): `git branch --show-current`, then `cd <wt> && "<bundled gh>" pr create --web --base <target> --head <branch>`.
- System prompt also tells the agent the target branch for diffs (``git diff <remote>/<target>...``) and `gh pr create --base <target>`.

#### 3.7.2 Read (the PR poll)

One batched GraphQL call per `(repo, authTarget)` through `gh api graphql` (`v3`, VERIFIED m@692000-695000):

```
"<gh>" api graphql -F owner=<owner> -F repo=<repo> \
  -f headRefName<i>=<branch> -F prNumber<i>=<n or 0> -F hasPrNumber<i>=<bool> ... \
  -f query='<Q>'
```
- Local addressing: `cd <wt> && ...` with the literal `{owner}` and `{repo}` placeholders that `gh` itself fills in from the cwd's remote. Cloud addressing: explicit `owner/repo`; for non-github.com hosts it exports `GH_HOST`.
- Query `Q` (`Zce`, m@679000): fragment `PrFields on PullRequest` requested per workspace, aliased `pr<i>ByBranch: pullRequests(first:5, headRefName:$headRefName<i>, states:[OPEN,MERGED], orderBy:{field:CREATED_AT,direction:DESC}) @skip(if:$hasPrNumber<i>)` and `pr<i>ByNumber: pullRequest(number:$prNumber<i>) @include(if:$hasPrNumber<i>)`, plus top-level `viewerPermission` and `rateLimit{cost}`.
- `PrFields` fields: `number url author{login avatarUrl} baseRefName baseRef{target{oid}} headRefName headRefOid [stackEntry{position stack{number size baseRefName}}] viewerDidAuthor viewerLatestReview{commit{oid}} createdAt updatedAt isDraft mergeable mergeStateStatus mergedAt reviewDecision reviewRequests(first:20){totalCount nodes{requestedReviewer{... on Actor{login avatarUrl} ... on Team{slug combinedSlug avatarUrl} [... on EnterpriseTeam{slug}]}}} latestReviews(first:20){nodes{author{login avatarUrl} state submittedAt}} state autoMergeRequest{enabledAt} mergeQueueEntry{state position enqueuedAt estimatedTimeToMerge headCommit{statusCheckRollup{contexts(first:100){...}}}} title body headRef{target{... on Commit{statusCheckRollup{contexts(first:100){nodes{... on CheckRun{conclusion status name checkSuite{workflowRun{workflow{name}}} detailsUrl startedAt completedAt} ... on StatusContext{state context targetUrl}}}} deployments(first:20, orderBy:{field:CREATED_AT,direction:DESC}){nodes{environment state createdAt updatedAt latestStatus{state environmentUrl createdAt updatedAt}}}}}}`.
- Optional fields `stackEntry` and `enterpriseTeam` are probed: if GitHub answers `undefinedField` or `undefinedType`, the call is repeated without them and the host is remembered (`$F` map keyed by remote host) (VERIFIED m@675300-676000).
- Detail query (`yJe`, on demand for the selected PR): `viewerPermission` and `pullRequest(number:$prNumber){headRefOid author baseRef viewerDidAuthor viewerLatestReview mergeable mergeStateStatus reviewDecision reviewRequests latestReviews autoMergeRequest mergeQueueEntry body headRef{...checks and deployments}}`.
- Single PR by reference (`ple`): same query with `count:1`, `-f headRefName0=` empty, `-F prNumber0=<n>`, `-F hasPrNumber0=true`.
- Derived state: checks status passing/pending/failing computed from `statusCheckRollup` contexts (`nle`): `mergeStateStatus === CLEAN` forces "passing"; pending = IN_PROGRESS/EXPECTED/QUEUED/PENDING; failing = FAILURE/ERROR/TIMED_OUT/ACTION_REQUIRED/STARTUP_FAILURE. Duplicate check runs are deduped by `check-run:<workflow>:<name>` keeping the newest. A single failing Vercel context yields `vercelUrl`.
- `viewerCanMerge = viewerPermission in {ADMIN, MAINTAIN, WRITE}`.
- A closed (unmerged) PR is only shown if the local branch still matches the PR head branch (`git branch --show-current`).
- Skip rule: if `git rev-parse --verify --quiet refs/remotes/<remote>/<headRef>` fails (branch never pushed) and no PR number is bound, no query is sent. "No PR found" is cached 5 min per workspace/branch (not for the requesting workspace).
- Head ref name: taken from the branch's configured upstream, not the local name: `git config --get branch.<local>.remote` and `branch.<local>.merge` (must be `refs/heads/...` and the same remote). This handles renamed local branches.
- Batch size adaptivity (VERIFIED m@681500): starts at 5 requests per query (`g3`). A timeout halves `mm` (min 1). A reported `rateLimit.cost > 1` halves `UF`. Each success adds `max(1, ceil(0.2*mm))` back up to 5. Effective size is `min(mm, UF)`.

#### 3.7.3 Poll cadence and the rate-limit gate (VERIFIED m@646000, m@713200, m@734800)

| Item | Value |
|---|---|
| Visible (main) workspace | 5000 ms, "aggressive" |
| Sidebar workspaces | 300 000 ms |
| Scheduler floor | 1000 ms (`Pj`) |
| Aggressive rate | 1000 ms while the PR has `mergeStateStatus == UNKNOWN` and is not merged (GitHub still computing mergeability) |
| Rate-limit probe | `"<gh>" api rate_limit`, reads `resources.graphql.remaining`. A GHE "rate limiting is not enabled" reply means unlimited. |
| Probe cache | 60 s when `remaining >= 1000`, 500 ms when below |
| `remaining < 500` | stop polling, recheck on the normal timer |
| `500 <= remaining < 1000` | poll only the main workspace, at least every 60 s, and fetch only the requested workspace instead of batching siblings |
| Skipped when | workspace inactive, sandbox unavailable, repo unlinked, forge has no remote (then `synthesizePrInfo` is used, see 7.7) |

#### 3.7.4 Review comments (sync into diff comments)

`gh api graphql -F owner -F repo -F prNumber [-F threadCursor|-F commentCursor|-F threadId] -f query=...` (`y3`). Queries:
- `reviewThreads(first:100, after:$threadCursor)` with `id isOutdated isResolved path line startLine originalLine originalStartLine startDiffSide diffSide comments{nodes{id body diffHunk author{login avatarUrl} createdAt updatedAt lastEditedAt url databaseId replyTo{id databaseId}} pageInfo}` plus `rateLimit{cost}`.
- Per-thread follow-up `node(id:$threadId){... on PullRequestReviewThread{comments(...)}}` for pages beyond the first.
- General comments: `pullRequest.comments(first:100, after:$commentCursor)`.
- Results are upserted into local `diff_comments` and GitHub-origin rows that vanished are deleted.
- Resolve a thread (`aZt`, m@3687016): `"<gh>" api graphql -F threadId="<id>" -f query='mutation($threadId: ID!) { resolveReviewThread(input: {threadId: $threadId}) { thread { id isResolved } } }'`.

#### 3.7.5 Write actions (all through `executeZshWithGhToken`)

| Action | Command | Notes |
|---|---|---|
| Merge | `"<gh>" pr merge <n> --<squash\|rebase\|merge> --match-head-commit <sha>` then (non-auto) `&& { "<gh>" pr view <n> --json state --jq .state \|\| true; }` | `Xle`, VERIFIED m@781192. `<sha>` is the local `git rev-parse HEAD` of the workspace, so the merge is pinned to what the user is looking at. If HEAD is unreadable or GitHub reports a head mismatch, a `MergeBlockedError` is raised ("Code in this workspace may be different from what's on GitHub"). Not pinned when the cloud sandbox is not running. `isMerged` comes from the `MERGED` line. |
| Enable auto-merge | same as merge with ` --auto` | |
| Disable auto-merge | `"<gh>" pr merge <n> --disable-auto` | |
| Mark ready | `"<gh>" pr ready <n>` | |
| Edit title or body | `"<gh>" pr edit <n> [--title '<t>'] [--body '<b>']` | |
| Reviewers | `"<gh>" pr edit <n> --add-reviewer <u> ... --remove-reviewer <u> ...` | |
| Change base | `"<gh>" pr edit <n> --base <branch>` | used by "change target branch" |
| Approve | `"<gh>" api repos/<owner>/<repo>/pulls/<n>/reviews -f event=APPROVE -f commit_id=<headRefOid>` | pinned to the head OID |
| Merge method | GraphQL `repository(owner,name){squashMergeAllowed rebaseMergeAllowed mergeCommitAllowed}` with `--jq '[.data.repository.squashMergeAllowed, .data.repository.rebaseMergeAllowed, .data.repository.mergeCommitAllowed]'`. Preference order: squash, rebase, merge. Cached per repo (`Gtt`). | `oJe` |
| Re-run failed checks | for each distinct run id parsed from `.../actions/runs/<id>/job/<id>` in `detailsUrl`: `cd "<wt>" && "<gh>" run rerun <id> --failed` | m@3698699 |
| Failed job log | `"<gh>" api repos/<o>/<r>/actions/jobs/<jobId>/logs --allow-escape-sequences 2>&1` (retries without the flag if gh says `unknown flag: --allow-escape-sequences`). Last 1000 lines kept. For unstarted jobs: `gh api repos/<o>/<r>/actions/jobs/<id> --jq 'if steps empty and runner_name empty then .check_run_url ...'`, then `gh api <check_run_url>/annotations --paginate --jq 'map(.message) \| join("\n\n")'` | m@3677900 |
| PR existence for a branch | `cd <wt> && "<gh>" pr list --head <branch> --state all --json state` (OPEN or MERGED counts) | used by branch-name availability, m@3189452 |

All `gh` commands use `hp()`: local addressing `cd <wt> && "<gh>" <subcommand>`, cloud addressing `"<gh>" <subcommand> --repo <owner/name>`.

#### 3.7.6 Conflict resolution and CI fixing

Done by the agent. Prompt types: `resolveMergeConflicts` ("Rebase your branch onto the remote branch (<target>) and resolve conflicts. Stage the resolved files and run `git rebase --continue`, then push --force-with-lease." or the merge variant), `fixChecks`, `renameBranch`. The app only detects conflicts (`mergeStateStatus == DIRTY` or conflicted files) and sends the prompt.

#### 3.7.7 Local-git forge (no GitHub remote), `synthesizePrInfo` (`KQe`, VERIFIED m@645800)

Pretends a PR exists for UI purposes:
- `git rev-list --left-right --count <target>...<branch> 2>/dev/null || echo "0\t0"`
- If ahead > 0: `git merge-tree --write-tree --no-messages <target> <branch>`. Non-zero exit or any `^\d{6} [0-9a-f]+ [123]\t` line means `mergeStateStatus:"DIRTY"`, else `"CLEAN"`.
- "Merge" is an agent instruction: "Merge the current workspace branch into "<target>" in the main worktree (use a fast-forward merge if possible, otherwise create a merge commit)."

---

### 3.8 Stacks, sync with base, Graphite

#### 3.8.1 Graphite `gt` (read-only plus checkout)

| Command | Who | Notes |
|---|---|---|
| `command -v gt >/dev/null 2>&1 && echo yes \|\| echo no` | install probe (m@3656600) | cached forever (`staleTime:Infinity`) |
| `cd <mainWorktree> && gt state 2>/dev/null \|\| echo "{}"` | `vj`, local host only, 30 s timeout (VERIFIED m@635508) | JSON map `{branch: {trunk, needs_restack, parents:[{ref, sha}]}}`. Polled every 5 s (`yj`) for the repo of the visible workspace, only if `graphite_disabled` is not `true` and the workspace is local. Failure returns `{branches:[]}`. |
| `cd <wt> && gt checkout <branch>` | `PQe.checkoutBranch` (m@638238) | the only mutating `gt` call; refuses when Graphite is disabled |

Graphite data feeds the diff target: when the current branch has a non-trunk parent in the stack, the merge-base and commit list are taken against that parent branch (a local branch), not against `origin/<target>` (VERIFIED m@748000, `k3`).

#### 3.8.2 GitHub native stacks (extension `gh stack`)

| Command | Who | Notes |
|---|---|---|
| `"<gh>" api repos/<owner>/<repo>/stacks/<n>` | `GXe` | stack member list with `pull_requests[]{number title html_url state draft merged_at head{ref sha} base{ref sha}}` |
| GraphQL `repository(owner:$owner,name:$name){ pr<N>: pullRequest(number:<N>) { number mergeable mergeStateStatus } ... }` | `FXe` | readiness per stack entry; readiness rules in `Qdn`/`UXe` |
| `cd <wt> && "<gh>" stack sync` | manual "Sync stack" (`ltt`, VERIFIED m@794500) | success is judged by exit 0 and no line starting with a cross mark and no "Sync aborted"; the error `needs GitHub's stack extension. Install it with `gh extension install github/gh-stack`` is raised when `gh` says unknown command |
| `cd <wt> \|\| GH_REPO=<owner/repo> "<gh>" stack merge <n> --yes --<method>` | merge a whole stack (`KXe`) | |
| Agent system prompt hint: "GitHub's PR stacking extension is installed ... run `gh stack`" | prompt `t4t` | |

#### 3.8.3 Automatic "catch up stack branch" (`iet` + `ctt`, VERIFIED m@740400-794500)

Runs without user action for a branch in a GitHub stack, when the local and upstream tips diverged only because GitHub rewrote the branch (for example after a lower PR merged). It is a heavily guarded rebase onto the upstream tip:
1. Preconditions: write permission, workspace changes say `ahead>0 && behind>0` (or equal OIDs), identity (branch, local OID, upstream OID) unchanged since evaluation.
2. `git symbolic-ref HEAD && git rev-parse HEAD '@{u}' && git rev-parse --symbolic-full-name '@{u}' && git config --get branch.<b>.remote`. Any mismatch skips.
3. Remote identity: `git remote get-url <remote>` hashed with `git hash-object --stdin`.
4. Baseline ref `refs/worktree/conductor/synced/<hash of [headRef, upstreamRef, remote, remoteIdentity]>` read with `git rev-parse --verify --quiet`. Written with `git update-ref --stdin` using `verify`/`update` lines (compare-and-swap). If the local tip is not the recorded baseline, `git reflog show --format=%H <upstreamRef>` must contain the local tip.
5. Clean-tree guard: `git status --porcelain=v1 --untracked-files=all` must be empty; none of `rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD sequencer` may exist under `git rev-parse --git-path`.
6. Ignored-file collision guard: `git ls-files --others --ignored --exclude-standard --directory -z` against `git diff-tree --no-commit-id --name-only --no-renames --diff-filter=A -r -z <local> <upstream>` (NFC lower-cased path compare).
7. The rebase: `GIT_SEQUENCE_EDITOR='sh -c "<asserts>" --' git rebase --interactive --no-autostash --no-update-refs --no-autosquash --no-rebase-merges --no-fork-point --onto <upstreamOid> <localOid>`. The "editor" is an assertion script that re-verifies orig-head, head-name, HEAD, upstream OID and remote identity before git is allowed to continue.
8. On success: `update-ref` baseline to the new tip (CAS).

---

### 3.9 gh authentication and token handling (names only)

- The binary: local `<Resources>/bin/gh` (`vp()` + `/gh`), cloud `/conductor/bin/gh` (`Fo`, VERIFIED m@959747). The app always calls the bundled `gh`, never PATH `gh`.
- Settings that choose the method: `gh_auth_method` (local) and `gh_cloud_auth_method` (cloud); values `cli`, `pat`, `conductor-app`. Resolution (`B3`/`Nue`): explicit value wins; otherwise a stored token with source `conductor-app` or an expiry means `conductor-app`; a plain stored token means `pat`; nothing stored means `cli` (local) or `conductor-app` (cloud). VERIFIED m@949000-952000.
- Secrets read through the platform keychain API under names `gh_token` (local) and `gh_cloud_token` (cloud). Companion settings: `gh_token_expires_at`, `gh_token_source`, `gh_token_app_client_id` (and the `gh_cloud_*` equivalents), `gh_pat_token` / `gh_cloud_pat_token`.
- `conductor-app` tokens are GitHub App user tokens refreshed through the Roundhouse API (routes `refreshGitHubToken` and `reportGitHubTokenFailure`), refreshed when less than a threshold of life remains, and with a forced refresh after a 401.
- `cli` method: no token is injected, so the bundled `gh` uses whatever `gh auth login` stored for the user.
- Injection (`Pte`, VERIFIED m@3827200): `unset GH_HOST && export GH_TOKEN=<token> && <command>`. Prepended only when a token exists. Optional per-call `env` is prefixed first.
- Non-github.com remote (local addressing only, `Xg`): `if (unset GH_TOKEN && "<gh>" auth token --hostname <host>) >/dev/null 2>&1; then export GH_HOST=<host> && unset GH_TOKEN; fi && <cmd>`.
- Retry: up to 2 retries when the output says `bad credentials`, `http 401` or `"status": "401"` (`Ksn`). Each retry fetches a new token (`forceRefresh` or reports `failedTokenSha256` for cloud) and stops if the token did not change.
- Other classified failures (for health UI): `saml enforcement` gives `saml-sso-required`; HTTP 403 with "scope" gives `missing-scope`. Rate limit text is logged `GitHub API rate limit hit:`.
- Health store `github-health` (`Vsn`): every local `hr` call updates `ok` or `broken`.
- Cloud targets with no token: returns `{code:1, stderr:"Not connected to GitHub for cloud workspaces. Connect GitHub in Settings."}`. If the VM supports it, a "githubAuth" token-exchange flag is used instead (`Zsn`, probes `GET /version` on the VM).
- Scrubbed env for sandboxed git (`zR`, cloud snapshot clone): `GH_TOKEN`, `GIT_TERMINAL_PROMPT=0`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, plus `GIT_CONFIG_COUNT` pairs: `url.https://github.com/.insteadOf` for both SSH forms, `credential.helper=""`, `credential.https://github.com.helper` reset then `<YT>`, `core.hooksPath=/dev/null`.
- Onboarding probes (VERIFIED m@3131800): `"<gh>" auth status` (looks for "Logged in"), `"<gh>" api user --jq '.login'`, `"<gh>" config get git_protocol`. Org list: `gh api user/orgs --paginate --jq '.[].login'`. Name availability: `gh repo view <o>/<n> --json name -q .name`.
- The branch prefix `github_username` comes from `gh api user --jq .login` (see frontend.md).

---

### 3.10 Archive and unarchive (VERIFIED m@1136900-1146500)

Archive (`hut` then `yut` then `mut`):
1. `cd "<wt>" && "<checkpointer>" save --id "conductor-archive-<localId>" --force`.
   - Exit 101 (merge or rebase in progress): throws unless mode is `discardGitOperationState`. In that mode `fut()` runs: list unmerged paths with `git diff --name-only --diff-filter=U -z > $paths_file`, `xargs -0 git add -u -- < $paths_file`, then deletes `MERGE_HEAD MERGE_MSG MERGE_MODE AUTO_MERGE SQUASH_MSG CHERRY_PICK_HEAD REVERT_HEAD REBASE_HEAD` and `rebase-merge rebase-apply sequencer` (all via `git rev-parse --git-path`), then retries the save.
   - Exit 102 (unmerged index entries): same list-and-`git add -u` repair, then one retry; a second 102 throws.
2. Cancel the setup process. `refreshLocalBranch` to get the branch. `git -C "<wt>" rev-parse HEAD` gives `archive_commit`.
3. `git -C "<wt>" update-ref "refs/conductor-archive-heads/<localId>" "<HEAD sha>"` (keeps the commit reachable). This ref is never deleted anywhere in the bundle (no `update-ref -d` for it).
4. DB: `UPDATE workspaces SET state='archived', branch=?, archive_commit=? WHERE local_id=?`.
5. Archive script (user script) runs, then `cd "<main>" && git worktree remove --force --force "<wt>"`. On failure: `rm -rf <wt>` then `git worktree prune` (`Hue`, VERIFIED m@959841).
6. If setting `delete_branch_on_archive` is `true` and the branch is not the default branch: `cd "<main>" && git branch -D "<branch>"` (force delete). Failures only toast.
7. Archive-on-merge archives only if no unmerged PR remains in the stack (membership read via `gh api repos/.../stacks/<n>`).

Unarchive (`_ut`, `but`, `wut`, `Dde`):
- Classification (`but`): `git show-ref --verify --quiet refs/heads/<b>` (missing gives `branchDeleted`); `git worktree list --porcelain` containing `branch refs/heads/<b>` gives `branchTaken`; `git rev-parse refs/heads/<b>` different from `archive_commit` gives `branchDiverged`; else `happy`.
- Same branch: re-check the branch is not checked out elsewhere, then `git worktree add '<path>' '<existingBranch>'`, then `cd "<wt>" && "<checkpointer>" restore "conductor-archive-<localId>"`. Restore failure is only a notification ("Uncommitted changes couldn't be recovered").
- New branch: `git rev-parse refs/heads/<b>` if no `archive_commit`; unique name via `show-ref` loop; `cd "<main>" && git branch "<new>" "<archiveCommit>"`; then worktree add and checkpoint restore as above.

---

### 3.11 Branch rename, checkout, retarget

- Rename (`zXe`, VERIFIED m@665573): under the worktree lock, `cd "<wt>" && git branch -m '<old>' '<new>'` (or `git branch -m '<new>'` when old is unknown). Then DB update, optional workspace directory rename (setting key `ret`), and `refreshLocalBranch`.
- Auto rename: the agent's first message triggers an LLM title with this prompt (`uwe`, m@3149922): lowercase hyphenated, under 30 chars, with prefix rule, and a `<none>` escape hatch. Availability loop `P6t`: while `show-ref` finds `refs/heads/<n>` or `refs/remotes/<remote>/<n>`, or `gh pr list --head <n> --state all --json state` shows an OPEN or MERGED PR, append `-v2` (local host and not already suffixed) or bump `-vN`. The system prompt tells the agent "Do not rename the current branch unless the user explicitly tells you to do so."
- Checkout (`att`, VERIFIED m@789089), under the worktree lock:
  1. `git fetch --no-write-fetch-head --prune <remote> +refs/heads/<b>:refs/remotes/<remote>/<b>` (a failure is fatal when `requireFetch`, otherwise warn and continue).
  2. `cd <wt> && git checkout <b>`.
  3. Fast-forward only: `&& test "$(git symbolic-ref --quiet --short HEAD)" = <b> && { if git merge-base --is-ancestor HEAD <remoteRef>; then git -c merge.autostash=false merge --ff-only <remoteRef>; else conductor_ancestor_status=$?; test "$conductor_ancestor_status" -eq 1; fi; }`.
- Change target branch (`T0n`, VERIFIED m@3765300): if an open PR exists it runs `gh pr edit <n> --base <branch>` and does nothing else. Otherwise it fetches the new target, and only if the worktree is clean and `HEAD` equals the old target ref and the new target ref resolves, it runs `git reset --hard <newTargetRef>`. This is the only `git reset` in the app.
- File revert (`wZt`, m@3692352): for a normal file `git cat-file -e <mergeBase>:<path>` then `git restore --source=<mergeBase> --worktree --staged <path>`, else `rm <path> && git restore --staged <path>`. For renames it restores the old path and removes the new one with `git rm --cached --force`. For a checkpoint ref it reads `git cat-file commit <ref>` for `worktree-tree` and `index-tree` and uses `git restore --source=<tree> --worktree` and `--staged` separately.
- Sparse checkout (workspace settings): `git config --get core.sparseCheckout`, `git sparse-checkout list|init --cone|set <dirs>|disable`, `git ls-tree -d --name-only HEAD[ <path>]`.
- External diff tool (r@2492418): `git -C <wt> diff --quiet HEAD`, then `git -C <wt> -c difftool.ksdiff.cmd='ksdiff --partial-changeset --relative-path "$MERGED" -- "$LOCAL" "$REMOTE"' difftool --tool=ksdiff --no-prompt HEAD` (Kaleidoscope).

---

### 3.12 Checkpoints, restore, Spotlight

#### 3.12.1 Where checkpoints are created

By the sidecar, not the frontend (VERIFIED sidecar.js@12251588). Around each agent turn it runs `"$CONDUCTOR_INTERNAL_BIN_DIR/checkpointer.sh" save --id session-<sessionId>-turn-<turnId>-<start|end> --force` with `cwd` = workspace. Exit codes 101 and 102 are logged as "skipped". The frontend learns about it through the `checkpointCreated` event (with `diff` summary, omitted above 200 files). The sidecar also computes the turn diff with `checkpointer.sh diff <startId> <endId> -- --name-status` and `-- --numstat`.

#### 3.12.2 `checkpointer.sh` subcommands (VERIFIED, read from the app bundle)

| Command | What it does |
|---|---|
| `save [--id <id>] [--force]` | Refuses if `git-busy-check.sh` says anything other than `clean` (exit 101: rebase, merge, squash-merge, cherry-pick, revert). Exit 102 if `git ls-files -u` is non-empty. Exit 103 if the git toplevel is not the cwd. Else: `index_tree=$(git write-tree)`; a temp index under `<git-dir>/conductor-checkpoint-tmp/chkpt-index.XXXXXX` is seeded with `git read-tree $index_tree` then `git add -A -- .`, giving `worktree_tree` (tracked plus untracked, honouring ignore rules). Writes a commit with `git commit-tree $worktree_tree` (author and committer `Checkpointer <checkpointer@noreply>`) whose message is `checkpoint:<id>\nhead <HEAD or 40 zeros>\nindex-tree <sha>\nworktree-tree <sha>\ncreated <iso>`. Then `git update-ref refs/conductor-checkpoints/<id> <commit>`. HEAD, index and files are untouched. Stale temp dirs (>60 min and owner pid dead) are pruned. |
| `restore <id>` | Reads the metadata from the commit message. If HEAD differs or there are unmerged entries or MERGE/CHERRY_PICK/REVERT HEAD exists: `git reset -q --mixed <head>`. Then `git read-tree --reset <head>`, `git add -A -- .`, `git read-tree --reset -u <worktree_tree>`, `git clean -fd` (keeps ignored files), `git read-tree --reset <index_tree>`, `git update-index -q --refresh`. Cannot restore a checkpoint taken with an unborn HEAD. Designed to rewrite only changed files (Spotlight reruns it on every file event). |
| `diff <id1> <id2\|current> [-- <git diff args>]` | `git -c core.quotePath=false diff refs/conductor-checkpoints/<id1> <refs/conductor-checkpoints/<id2> or a tree of the current working tree built from a temp index seeded with HEAD> <args>`. |

#### 3.12.3 Frontend uses (VERIFIED m@3617500-3623200)

- Exists: `git show-ref --verify --quiet refs/conductor-checkpoints/<id>`.
- Original HEAD of a checkpoint (for fork and revert): `git cat-file commit refs/conductor-checkpoints/<id>`, regex `^head (.+)$`; fallback `HEAD`.
- Turn changes: `cd "<wt>" && "<checkpointer>" diff "<startId>" "<endId>" -- --name-status` and `-- --numstat` (waits for both refs; throws "Checkpoint refs not ready"). Cached in `turn-changes-cache` (5 MB).
- "Files changed since checkpoint": `"<checkpointer>" diff <id> current -- --name-only -z`, count of NUL-separated names.
- Revert to checkpoint: `cd "<wt>" && "<checkpointer>" restore "<id>"`. Fails if exit non-zero or any stderr; message "No changes or conversation history have been reverted."
- Archive and unarchive: section 10. Agent diff: section 4.6.
- Pre-spotlight state: `save --id <BR> --force` (keyed under `refs/conductor-checkpoints/<BR>`), `rev-parse --verify` to test it, `restore <BR>` to undo, `update-ref -d refs/conductor-checkpoints/<BR>` to drop it. Spotlight start command: `CONDUCTOR_INT_CHECKPOINTER_PATH="<checkpointer>" CONDUCTOR_INT_WATCHEXEC_PATH="<bin>/watchexec" bash "<bin>/spotlighter.sh"`; the script watches the worktree and on each change does `checkpointer save` in the worktree then `checkpointer restore` of that id in `$CONDUCTOR_ROOT_PATH` (VERIFIED m@3087990 and the script header). Root repo is checked first: `git branch --show-current` plus rebase, merge and detached-HEAD warnings (m@3702242).
- Retention: checkpoint refs are not deleted by the frontend (only the pre-spotlight ref is). INFERRED: they accumulate until the repo is deleted.

---

### 3.13 Worktree-level config (VERIFIED m@1078000-1080500)

`Sde` runs after every worktree creation, if the repo setting for "auto upstream" (`sA`) is not `false`:
1. Read shared config: `git -C <main> config --local --get core.worktree` and `core.bare`.
2. If either is set (core.worktree present, or core.bare is `true`): do NOT enable worktreeConfig. If `git -C <wt> config --type=bool --get push.autoSetupRemote` is already `true`, stop silently; otherwise warn "Couldn't configure Git push upstream settings. PR info may be less reliable until this branch has an upstream. Skipped enabling git worktree config because core.worktree is set in shared Git config."
3. Else: `git -C <main> config extensions.worktreeConfig true`, then `git -C <wt> config --worktree push.autoSetupRemote true`.
4. A later "ensure" step (`_ct`) checks `git -C <wt> config --worktree --get push.autoSetupRemote` and re-runs `Sde` if missing.
5. The settings screen explains: "`git push` sets a branch upstream. Turning this off avoids writing Git worktree config, but PR info may be less reliable until branches have an upstream." (r@10978042.)

Why it matters: PR lookup keys on `branch.<b>.remote` and `branch.<b>.merge` (section 7.2), so an upstream must exist.

Default branch detection (`pSe`, VERIFIED m@3681900): `git symbolic-ref refs/remotes/<remote>/HEAD` (regex `^refs/remotes/<remote>/(.+)$`), else `git branch --show-current`. Remote URL: `git remote get-url <remote>`.

---

### 3.14 Cloud-only git (summary, VERIFIED unless marked)

- Cloud hosts run the same commands over HTTP to the VM; git there uses `-c credential.https://github.com.helper=<YT>` plus a `GH_TOKEN` injected by the token door.
- Settings file read from the shared clone (m@3770923-3772500): `git -C <clone> fetch --no-write-fetch-head origin refs/heads/<b>:refs/remotes/origin/<b>`, `git remote set-head origin --auto`, `git rev-parse --abbrev-ref refs/remotes/origin/HEAD`, `git ls-tree <ref> -- .conductor/settings.toml`, `git show <ref>:.conductor/settings.toml`, all via `git -C <clone> -c core.quotePath=false ...` with the scrubbed env.
- Local mirror of a cloud workspace snapshot (m@3061164): `git -C <clone> fetch --no-tags origin -- <commit>`, `cat-file -e <commit>^{commit}`, `update-ref <ref> <commit>`, `(git worktree remove --force <mirror> || rm -rf <mirror>)`, `git worktree add --force --detach <mirror> <ref>`, `git -C <mirror> apply --binary --whitespace=nowarn -- <patch>`. File-level reads: `git -C <clone> cat-file -s <commit>:<path>` and `git show <commit>:<path>`.
- Roundhouse PR state (INFERRED from `Qg` and class `ent`): for cloud hosts the server pushes a PR link snapshot (`state`, `head_sha`, `base_ref`, ...) and the client only calls GitHub for details when the PR is open.

---

### 3.15 What a remake needs: minimal command set

Core (everything else is optional):

| Need | Command |
|---|---|
| Shell door | one `run(cwd, command, timeout)` that returns `{code, stdout, stderr}`; prefix the user's login-shell env; per-call timeout returns a sentinel code |
| Safe retry | retry git when output matches `index.lock: File exists` or `cannot lock ref ... is at X but expected Y` (50/100/200 ms) |
| Locks | one in-process mutex per `worktree:<path>` and per `repo:<mainPath>`; log (do not abort) after 10 s |
| Create | `git rev-parse HEAD` (else `git commit --allow-empty -m "Initial commit"`), `git fetch --no-write-fetch-head --prune <remote> <branch>`, `git rev-parse refs/remotes/<remote>/<branch>`, `git worktree add <path> -b <new> <sha>` |
| Exclude `.context` | `git rev-parse --git-common-dir`, append to `<dir>/info/exclude` |
| Upstream config | `git config extensions.worktreeConfig true` (main) and `git config --worktree push.autoSetupRemote true` (worktree) unless `core.worktree`/`core.bare` is set |
| Branch name taken | `git show-ref --verify --quiet refs/heads/<b>` and `refs/remotes/<remote>/<b>`, suffix `-vN` |
| Changes poll (5 s) | `branch --show-current`, `merge-base <remote>/<target> <branch>`, `diff -M --no-ext-diff --no-textconv --name-status <mb>`, same with `--numstat`, `status --porcelain --untracked-files=no`, `ls-files --others --exclude-standard`, `rev-parse HEAD @{u}`, `rev-list --left-right --count <up>...<head>`, `rev-list --count HEAD..<remote>/<target>`, `log <remote>/<target>..HEAD --format="%H|%s|%an|%ae|%at"` |
| File diff | `git show <ref>:<path>` for the old side, read disk for the new side, diff in the UI; `git diff --no-color <from> [<to>] -- ':(literal)<path>'` if a patch is needed |
| Push | `git rev-parse --abbrev-ref --symbolic-full-name @{u}`, then `git push <remote> HEAD:<name>` or `git push -u <remote> HEAD:<name>` plus the two `git config branch.<b>.remote|merge` writes and a refspec fetch |
| Fetch | `git fetch --no-write-fetch-head --prune <remote> [<branch>]`, on demand, max once per 60 s per branch |
| Checkpoints | write `refs/conductor-checkpoints/<id>` commits from a temp index (`write-tree`, `read-tree`, `add -A`, `commit-tree`, `update-ref`), with `restore` as `reset --mixed`, `read-tree --reset -u`, `clean -fd`. Port `checkpointer.sh` almost verbatim, including exit codes 101, 102, 103 |
| Archive | checkpoint save, `git rev-parse HEAD`, `git update-ref refs/conductor-archive-heads/<id> <sha>`, `git worktree remove --force --force <wt>` (fallback delete dir and `git worktree prune`), optional `git branch -D` |
| Unarchive | `git show-ref`, `git worktree list --porcelain`, `git worktree add <p> <branch>` or `git branch <new> <archiveSha>` first, then checkpoint restore |
| PR read | `gh api graphql` with the `PrFields` fragment, batched by branch, with `rateLimit{cost}`; poll 5 s visible, 300 s others; gate on `gh api rate_limit` (<500 stop, <1000 main only) |
| PR write | `gh pr merge <n> --<method> [--auto] --match-head-commit <localHead>`, `gh pr ready`, `gh pr edit`, `gh api repos/<o>/<r>/pulls/<n>/reviews -f event=APPROVE -f commit_id=<oid>`, `gh run rerun <id> --failed` |
| PR create / commit / rebase / conflicts | do not implement as app code. Send the agent an instruction (commit, `git push -u`, `gh pr create --base`, rebase or merge, `--force-with-lease`) |
| Auth | bundle `gh`; run it with `unset GH_HOST && export GH_TOKEN=<token> && ...` when a token exists, else let it use the user's login; retry once on 401 after refresh; keep tokens in the OS keychain |
| SSH-blocked fallback | detect `port 22` / `ssh: connect to host` / `kex_exchange_identification`; retry with `url.https://github.com/.insteadOf` and a `gh auth git-credential` helper, `GIT_TERMINAL_PROMPT=0` |

Optional later: Graphite `gt state` / `gt checkout`, `gh stack sync|merge`, `catch up stack branch` rebase, local-git forge (`merge-tree --write-tree` mergeability), sparse checkout, `git clone --progress`, `gh repo create`, Spotlight (`watchexec` + checkpointer), cloud mirror.

### 3.16 Surprises worth keeping

1. The app does not rebase, merge, commit or resolve conflicts itself. It sends English instructions to the agent. The only autonomous history rewrite is the guarded interactive rebase for GitHub stack branches, using `GIT_SEQUENCE_EDITOR` as a runtime assertion script.
2. Agent turn history is stored as real git commits under `refs/conductor-checkpoints/*`, built from a temp index so HEAD and the user's index are never touched, and never garbage collected by the app. Archive also pins HEAD under `refs/conductor-archive-heads/*` forever.
3. "Sync stack" is `gh stack sync` (GitHub's stacked PR extension), not Graphite. Graphite is only read via `gt state` (every 5 s) and `gt checkout`.
4. Merges are pinned with `--match-head-commit <local HEAD>` and approvals with `commit_id=<headRefOid>`, so the app refuses to act on a PR that differs from the local worktree.
5. PR polling is an adaptive GraphQL batch (5 branches per call, halved on timeouts or high cost) behind a `gh api rate_limit` gate, and a missing `branch.<b>.merge` upstream degrades PR matching, which is why `push.autoSetupRemote` goes into per-worktree config.



---

## Part 4. Feature flags and settings keys


Build analysed: app version `0.92.1`, build type `production` (main @19220: `KB="0.92.1"`, `Wd="production"`, `une=!1`).
Files: `main` = `main-BE1h_1MP.js`, `r` = `renderApp-DeUrsznk.js`. `@N` is a character offset.
VERIFIED means the code was read at the cited offset. INFERRED means reasoned from names or neighbouring code.
Read-only analysis. Secrets, tokens and keys are not reproduced (only their key names).

### 4.0 Headline findings

| # | Finding | Status |
|---|---|---|
| 1 | There is exactly one flag source, PostHog (client side, `us.i.posthog.com`). There is no Roundhouse flag list. | VERIFIED |
| 2 | Only 15 PostHog flags are turned into app behaviour. Each one is projected onto a normal `settings` key and then read through the same hooks as user settings. All other PostHog flags are shown in the Internal page but do nothing. | VERIFIED |
| 3 | "Internal user" is not a role in the app. It is the PostHog flag `conductor-internal`, which sets the setting `internal_settings_enabled`. The `isDevMode` constant is hard coded `false` in this build. | VERIFIED |
| 4 | The "managed by your organization" lock comes from a local file `~/.conductor/settings.managed.toml` (or `.json`). It can only set 4 keys plus env vars. No network call is involved. | VERIFIED |
| 5 | A server side settings store exists on Roundhouse with five scopes (`user`, `org`, `org-personal`, `org-repo`, `org-personal-repo`). It holds org prompts, port forwarding strategy, git identity and credential selection. | VERIFIED |
| 6 | Every non file-backed DB setting write sends a `setting_updated` analytics event with key and value, except keys in the sensitive list. File-backed writes do not. | VERIFIED (main @374896, `TM`) |

### 4.1 Feature flags

#### 4.1.1 Mechanism (pipeline)

| Step | What happens | Where | Status |
|---|---|---|---|
| 1 | PostHog JS is initialised in the React root with `api_host: https://us.i.posthog.com`, `defaults: "2025-05-24"`, `autocapture: false`, `capture_exceptions: false`, `capture_pageview: true`. The project key is embedded (not copied here). | r @12120991 | VERIFIED |
| 2 | After sign-in the user is identified: `identify(userId, {email, github_username, name, app_version, test_user?})`. These become the person properties that flag targeting can use. | main @3137649 | VERIFIED |
| 3 | `ebn()` subscribes to `onFeatureFlags`. On every callback it reads each active flag key plus every key in the `TU` enum with `getFeatureFlag(key, {send_event:false})`. Only booleans and strings are kept. The map goes to `settings.updateFeatureFlags(map)`. `send_event:false` means no `$feature_flag_called` exposure events. | main @3818541 | VERIFIED |
| 4 | Reload triggers: once at start, every 5 minutes (`3e5`), on window focus, on visibility change. A 30 s throttle drops reloads that come sooner. | main @3818541 | VERIFIED |
| 5 | `recomputeFeatureFlags()` loops over the fixed map `RU` (raw flag name to settings key). Local override wins. Otherwise the value is `String(raw === true)`. A flag PostHog did not return produces no key at all. | main @412093 | VERIFIED |
| 6 | The result lands in `featureFlagsByKey`. The merged read order is `{...db, ...file, ...featureFlags, ...managed}`, so a flag beats every user or repo file value. | main @413612 | VERIFIED |
| 7 | `updateSetting` and `deleteSetting` refuse flag-driven keys ("Setting is controlled by a feature flag"). `source` for such a key is `{type:"feature-flag", label:"feature flag", system:true}` and `isLocked` is true. | main @408986, @383061 | VERIFIED |
| 8 | When a flag value changes after the first load, `Pl(service, key)` runs side effects (re-configure logging, internal user in sidecar, proxy, and so on). | main @378921, @379253 | VERIFIED |
| 9 | Hooks wait for `featureFlagsLoaded`. `Noe(key)` reports `isLoading` until flags arrive. Two inverted hooks (`_ln` codex goals, `wln` queued messages) return `false` until loaded, so those features are hidden at cold start. | main @435864, @436172, @436390 | VERIFIED |

Local override: Settings, Internal, "Feature flags" lists every flag PostHog returned and a switch per flag. Toggling calls `setFeatureFlagOverride(rawName, bool)`. It writes the settings row `feature_flag_override:<rawName>` (value `"true"`/`"false"`) and recomputes. "Reset" deletes the row (main @407886, r @11225655).
Overrides for flags outside `RU` are stored but have no effect, because `recomputeFeatureFlags` only iterates `RU` (INFERRED from the loop).
`hun()` (main @447324) writes the override for `claude-token-usage-tracking` from a UI toggle.

Data privacy: `disable_external_logging` or `enterprise_data_privacy` call `_d.opt_out_capturing()` and tell the sidecar to stop external logging (main @3819180, `tbn`). Whether PostHog still fetches flags while opted out is INFERRED (posthog-js normally does).

#### 4.1.2 The 15 mapped flags

Map is `TU` (enum) and `RU` (map) at main @370924. Hook names are minified. Offsets for hooks are in main. "UI use" offsets are in r.

| Group | Raw PostHog flag | Settings key | Hook (main @) | Read at | Default when unset | What it gates | Status |
|---|---|---|---|---|---|---|---|
| sessions/composer | `queue-messages-disabled` | `queue_messages_disabled` | `wln` @436390 | r @9388592 (chat composer), r @11118002 (Follow-up behaviour setting), r @11747237 (prompt overrides) | queue is off until flags load, then on unless flag is `true` | Queued follow-up messages and the "Follow-up behavior" row (`default_message_send_mode`: `queued` or `steering`). Flag true removes queueing. | VERIFIED |
| sessions/composer | `codex-goals-disabled` | `codex_goals_disabled` | `_ln` @436172 | r @9388559 (chat composer) | goals off until flags load, then on unless flag is `true` | Codex "goal" objective feature in the composer (`codexGoalSet/Clear/Get`). | VERIFIED hook, INFERRED purpose |
| sessions/composer | `user-message-footer` | `user_message_footer_enabled` | `Eln` @437158 | r @9549997 (user message component) | false | A footer on user message bubbles. | INFERRED (purpose) |
| sessions/composer | `read-aloud` | `read_aloud_enabled` | `gln` @435726 | r @9575051 | false | "Read aloud" speaker button on assistant text. It also needs an org entitlement (`cloud.premium`, `conductor.pro`, `conductor.teams` or `conductor.enterprise`). | VERIFIED |
| sessions/composer | `claude-subscription-sign-in` | `claude_subscription_sign_in_enabled` | `mln` @435588 | r @11578154 (provider credentials card) | false | Offers "subscription" sign-in next to API key for Claude credentials in Providers settings. | VERIFIED hook, INFERRED purpose |
| git/PR | `pr-roundhouse-state` | `pr_roundhouse_state_enabled` | no hook, `roundhousePrStateGate.isEnabled()` | main @3710137 | false | PR state is taken from Roundhouse instead of local `gh` polling. | INFERRED (gate name and wiring are verified, effect is not traced) |
| git/PR | `local-repositories-without-github` | `local_repositories_without_github_enabled` | `A9e` @436608, `Aln` @437346 | main @3821052 (`abn`), r @1717702 (`addLocalRepository`), r @11108280 | false | Add a local repo with no GitHub remote (git forge `local-git`). `Aln` = this flag OR user setting `local_git_forge_enabled`. When the flag is on, the experimental toggle is hidden. | VERIFIED |
| cloud | `cloud-in-data-privacy-mode` | `cloud_in_data_privacy_mode_enabled` | `I9e` @436883 | main @421446 (`n9e`), @3136612 | false | `isCloudRestrictedByDataPrivacy = enterprise_data_privacy === "true" && flag !== "true"`. So the flag lets cloud hosting work while data privacy is on. | VERIFIED |
| cloud | `kill-switch-presence` | `kill_switch_presence_enabled` | `bln` @436745 | r @1873250 (`Qws`) | false | Presence heartbeats to Roundhouse (`presence.update` with idle time, typing, viewed workspace and session). Flag `true` means "stop sending". | VERIFIED |
| cloud | `routine-webhook-triggers` | `routine_webhook_triggers_enabled` | `Sln` @437020 | r @11989985 (routine editor) | false | Webhook trigger type for Routines. | INFERRED (purpose) |
| remote | `remote-control-settings` | `remote_control_settings_enabled` | `vln` -> `Noe` | r @11162104 (`EQe`) | hidden | Master switch for the Remote control UI. Not in the settings registry `tU` (see 2.3). | VERIFIED |
| remote | `remote-control-out-of-experimental` | `remote_control_out_of_experimental_enabled` | `yln` -> `Noe` | r @11162112 (`EQe`) | hidden | Placement. Both flags true gives a full "Remote control" page. First flag only gives a toggle in Experimental. Needs `internal_desktop_remote_access` true, `enterprise_data_privacy` not true, and a local org. | VERIFIED |
| terminal/logging | `disable-external-logging` | `disable_external_logging` | direct (`$sn`) | main @3819180 | false | Server side kill for telemetry: PostHog opt-out, sidecar `setExternalLoggingDisabled`, Sentry off. | VERIFIED |
| internal-only | `conductor-internal` | `internal_settings_enabled` | `Gd` @427112 (hook), `RT` @378990 (service) | r: 15 uses via alias `Z4`; main @3819776 | false | "Internal user". Shows the Internal tab, turns on internal defaults (see 1.4), tells sidecar and Rust `internalUser = true`. | VERIFIED |
| internal-only | `claude-token-usage-tracking` | `internal_claude_token_usage_tracking` | `xcn` @428531 | r @12069000 (`Sqt`) | on for internal users unless `"false"` | Track Claude token usage, show it in context usage, log turn totals to Honeycomb. | VERIFIED |

#### 4.1.3 Other flag-like gates (not in the 15)

| Gate | Source | Read at | Effect | Status |
|---|---|---|---|---|
| `conductor-release-holdout-v<version>` | PostHog (read with `getFeatureFlag(name,{send_event:false})`). Name is built from the update version, channel suffix kept (`alpha`, `alpha-chromium`, `beta`, `funhouse`, `patch`). | r @10622958 (`sNa`, wait 1.5 s for flags) | If `true`, the app skips auto update for that version ("Skipping auto update due to release holdout flag"). This is the only direct PostHog read in the UI. | VERIFIED |
| Organization entitlements | Server: `organization.entitlements[]`. Values: `cloud.premium`, `conductor.pro`, `conductor.teams`, `conductor.enterprise`. | main @3131044 (names), @921792 (`chn`), r @9575254, r @10375208 | Plan tier label (FREE, PRO, TEAM, ENTERPRISE) and read-aloud. | VERIFIED |
| Settings pages gates | local state | r @11309899 (`nsr`), @11311525 (`uGa`) | Tab visibility: `internal` needs internal user; `terminal` needs `experimental_big_terminal_mode`; `remote-control` needs remote placement; `organization*` needs org settings; `organization-mcp-servers` also needs internal user. | VERIFIED |
| `internalOnly:true` on a settings item | registry | r @11311525 | Hidden from search and pages when not internal. | VERIFIED |
| `Zqe` rule | local | main @420494 | `value === "true" \|\| (internal && value !== "false")`. Used for `experimental_show_agent_cost`. Internal users get it on by default. | VERIFIED |

#### 4.1.4 How "internal user", "dev mode", "experimental" and flags relate

| Concept | Definition | Evidence | Status |
|---|---|---|---|
| Dev mode (`isDevMode`) | Constant `une=!1` in this build. When true it would act as internal user. Dev builds (`appType === "dev"`) also use `appDataDir/.conductor` instead of `~/.conductor` and skip the keychain. | main @19220, @360626, @374544 | VERIFIED |
| Internal user | `isDevMode \|\| settings.internal_settings_enabled === "true"`. The setting is driven by PostHog flag `conductor-internal` (users cannot set it, it is locked as a flag setting). | main @378990 (`RT`), @427112 (`Gd`) | VERIFIED |
| Internal tab (`/settings/user/internal`) | Route guard `qnl` renders it if internal user, else redirects to `/settings/user/general`. | r @11730750 | VERIFIED |
| Internal settings | Keys named `internal_*`, plus `unstarted_workspaces_enabled`, `experimental_agent_progress` (listed on the Internal tab), `garry_mode`, `sidecar_inspect*`. Plain DB settings, user editable once the tab is visible. | r @11210722-@11223658 | VERIFIED |
| Experimental tab | Always visible. Holds `experimental_*` and other opt-in features. Plain DB settings, each default `false`. | r @11102988-@11110796 | VERIFIED |
| `internal_settings_use_defaults` | Meta switch ("Use default internal and experimental settings"). When `"true"`, `Ad()` returns the value from the table `Bz` for any key in that table, ignoring saved values. Only shown to internal users. | main @377231, @378650 | VERIFIED |
| `Bz` defaults | All `"false"` except `experimental_show_agent_cost=true`, `graphite_disabled=true`, `internal_claude_token_usage_tracking=true`, `internal_remote_local_execution_mcp=true`, `internal_codex_initial_permission_config="inherit"`, `internal_claude_initial_permission_mode="inherit"`, `internal_tauri_http_proxy_url=""`. | main @377231 | VERIFIED |
| Flags vs settings | Flags are a read-only overlay on settings. A flag cannot be set by the user except through the local override, which only internal users can reach. | main @408986 | VERIFIED |
| Reach of internal user | `Me.isDevMode \|\| internal_settings_enabled` also drives: app logger persistence and forwarding, sidecar `setInternalUser`, `configure_sidecar_internal_user` (Rust), verbose logging, session event logging, Sentry-type tools in the Internal tab (crash test, error reporting test, log viewer, build commit, onboarding replay, agent binary failure injection). | main @378952, r @11225655 | VERIFIED |

#### 4.1.5 Experimental and internal switches (user-editable, not flags)

Titles come from the settings page registry (`Ii({tab:...})`, r @11095760-@11301491).

| Tab | Key | Title | What it does | Status |
|---|---|---|---|---|
| experimental | `experimental_auto_permission_mode` | Auto permission mode | Claude auto mode. | VERIFIED |
| experimental | `experimental_big_terminal_mode` | Big terminal mode | Big terminals in the centre pane (Cmd+Shift+T). Also unhides the Terminal settings tab. | VERIFIED |
| experimental | `experimental_new_workspace_page` | New workspace page | Full-screen workspace creation. | VERIFIED |
| experimental | `experimental_tab_freak_mode` | Tab Freak Mode | Up to 10 chat and terminal tabs per workspace. | VERIFIED |
| experimental | `experimental_configurable_center_panel` | Split tabs | Split the centre panel, move tabs between panes. Persists `workspace-center-panel-layout-v1`. | VERIFIED |
| experimental | `experimental_fork_to_new_tab` | Fork chat to new tab | Fork mid-turn from the tab menu or Cmd+Option+Enter. | VERIFIED |
| experimental | `experimental_in_app_browser_preview` | In-app browser preview | Preview button opens an in-app browser tab with annotation overlay. | VERIFIED |
| experimental | `experimental_legacy_file_preview_and_editing` | Use legacy file preview and editing | Old file preview and editor. | VERIFIED |
| experimental | `experimental_show_agent_cost` | Show agent cost | Estimated agent cost for cloud workspaces. | VERIFIED |
| experimental | `experimental_sidebar_transparency` | Sidebar transparency | macOS vibrancy behind the sidebar. Needs restart. | VERIFIED |
| experimental | `internal_workspace_status_matrix` | Workspace status matrix | Matrix style status indicator for local workspaces. | VERIFIED |
| experimental | `local_git_forge_enabled` | Add projects without GitHub | Same feature as flag `local-repositories-without-github`. | VERIFIED |
| experimental | `auto_run_after_setup` | Auto-run after setup | Runs the default action after setup finishes. Also a `settings.toml` key. | VERIFIED |
| experimental | `dashboard_enabled` | Dashboard | Dashboard and workspace sidebar. | VERIFIED |
| experimental | `voice_mode` | Voice mode | Speech to text in the composer (Ctrl+Shift+D). | VERIFIED |
| experimental | `sidebar_resource_usage` | Show sidebar resource usage | CPU and memory in the sidebar footer. | VERIFIED |
| experimental | `pokes_enabled` | Pokes | Poke teammates in cloud orgs. | VERIFIED |
| experimental | `graphite_disabled` | Graphite stack support | Naming is inverted: the key says disabled, the toggle says support. Detects Graphite stacks in the git panel. | VERIFIED |
| experimental / remote-control | `internal_desktop_remote_access` | Allow remote control | Pairing and remote control of this Mac. Blocked by `enterprise_data_privacy`. | VERIFIED |
| remote-control | `remote_control_keep_awake` | Keep this Mac awake | Prevents sleep while a device is connected. Default `true`. | VERIFIED |
| internal | `internal_workspace_tabs` | Use workspace tabs | Browser style workspace tabs (team orgs only). | VERIFIED |
| internal | `unstarted_workspaces_enabled`, `internal_pull_requests_page`, `internal_principals`, `internal_workspace_chat`, `internal_native_fork`, `internal_prompt_snippets`, `internal_team_artifacts`, `experimental_agent_progress` ("Agent pizza tracker") | Unstarted workspaces, Pull requests page, Principals, Workspace chat, Native fork, Prompt snippets, Team artifacts, Agent progress | Feature previews, all `internalOnly`. Titles have no description in the bundle. | VERIFIED titles, INFERRED behaviour |
| internal | `internal_pic_agent_enabled`, `internal_muse_code_enabled` | Piccolo agent (cloud), Muse Code (cloud) | Extra cloud agents. Models `pic-opus-5-5` (status `gated`) relate to Piccolo. | VERIFIED titles |
| internal | `internal_developer_metrics` | Developer metrics bar | Metrics overlay. | VERIFIED title |
| internal | `internal_terminal_render_debug_log`, `internal_frame_drop_logging`, `internal_verbose_logging`, `internal_sidecar_exp_session_log`, `internal_request_metadata`, `internal_tauri_http_proxy_url`, `internal_cloud_workspaces_independent_of_local_repos`, `internal_claude_token_usage_tracking` | Debug log toggles, request metadata, proxy URL, cloud independence, token tracking | Debugging aids. Frame drop logger flags frames over 200 ms. | VERIFIED |
| internal | `internal_claude_initial_permission_mode`, `internal_codex_initial_permission_config` | Initial permission modes | Default `inherit`. | VERIFIED defaults |
| internal | `internal_remote_local_execution_mcp` | Remote execution MCP | Cloud agents may request one-shot commands on this Mac with approval. Default on (`!== "false"`). Also under Advanced. | VERIFIED |
| internal | page items by id: `internal:build-commit`, `internal:log-viewer`, `internal:onboarding`, `internal:new-member-simulation`, `internal:crash-test`, `internal:error-reporting-test`, `internal:agent-binaries`, `internal:feature-flags` | Tools | Not settings. | VERIFIED |

Other settings page tabs seen in the registry: general (13 items), git (10), appearance (8), advanced (5), models (5), account (3), remote-control (3), actions (3), misc (1), providers (1). Repo pages use scope `workspace` (`/settings/repos/$repoId/{scripts,actions,misc}`).

### 4.2 Settings keys

#### 4.2.1 Layers and precedence

Storage layers (VERIFIED unless marked):

| Layer | Location | `source` object | Notes |
|---|---|---|---|
| Registry default | `tU` array, `WE(key,raw)` returns `defaultValue` when raw is undefined | none | main @303964 |
| Legacy database row | table `settings (key, value, deprecated_at)` in `conductor.db` | `{type:"database", label:"legacy database", system:false}` | After the file migration only non-file-backed keys are loaded (main @375456 `vqe`). |
| User file | `~/.conductor/settings.toml` (dev build: `<appData>/.conductor`) | `{type:"file", scope:"user", locality:"shared", label:"user shared"}` | main @360626, @363298 |
| Remote default branch copy | `git fetch <remote> <default>` then `git show <remote>/<default>:.conductor/settings.toml`, cached per repo | label `repository shared` | main @3770645 (`Gnn`), @383333 |
| Repo shared | `<mainWorktree>/.conductor/settings.toml` (legacy `settings.json`) | `scope:"repo", locality:"shared", label:"repository shared"` | committed to git |
| Workspace shared | `<workspaceWorktree>/.conductor/settings.toml` | label `workspace shared` | only when a workspace is selected |
| Repo local | `<mainWorktree>/.conductor/settings.local.toml` (legacy `.json`) | `scope:"repo", locality:"local", label:"repository local"` | git-excluded, symlinked into every worktree |
| Feature flag | in memory | `{type:"feature-flag"}` | 15 keys only |
| Managed | `~/.conductor/settings.managed.toml` or `.json` | `{type:"managed", label:"managed", path}` | 4 keys only |

Effective order, lowest to highest (VERIFIED main @413612, @363298, @383333):

`registry default` < `legacy DB` < `user file` < `remote default-branch settings.toml` < `repo shared` < `workspace shared` < `repo local` < `feature flag` < `managed file`.

Rules:
- JSON is read first for all layers, TOML second, so any TOML layer beats any JSON layer (main @360835, loop `for s of ["json","toml"]`).
- Repo and workspace layers only apply keys with `workspaceConfigurable !== false` (main @361909). Model keys, `tool_approvals_enabled` and `codex_tool_approval_policy` are user-file only. INFERRED: a non-configurable key in a repo file is not applied (it is also not reported as unknown, since it is a known file key).
- Only the user layer is writable for user keys. Repo writes go to repo shared (committed file) or repo local (default for personal edits). Env var writes to repo shared are refused: "Shared repository settings are read-only in Conductor. Edit the settings file directly." (main @462900).
- `isLocked` is true only if the key is managed or flag-driven. File layers set `isLocked:false` (main @362479, @388805, @382800).
- Dropped entries are collected, never thrown: reasons `unparseable-file`, `unknown-key`, `wrong-type`, `unsupported-value` (main @361909, @372380).
- Optimistic writes: file-backed user writes show in the store immediately and are retired on completion (main @413500).
- Invalid TOML on write shows "Can't save setting because your settings file is invalid" with the parse error's first six lines (Uz, main @389730). The toast has an "Overwrite file" action (@389976) only when the save was not already forced and the writer holds a last-known-good parse of that file (mutateSettingsFile, @416065). That parse is kept per file path whenever a save reads the file and it parses (an absent file counts as empty), and only then: the periodic reload does not keep one, and a service reset clears them (readSettingsFileDataForWrite, @416200; @395092). Pressing the button repeats the same save forced, with no confirmation and no backup copy: it skips reading the file, writes the kept parse with the change applied over whatever the file holds, then reads every layer again (@416164). With no kept parse a forced save throws "Cannot force-overwrite …" (@416344), told as "Failed to save setting". A forced save that fails is told with no button. Every file-backed save passes the action: settings, their reset, actions, environment variables (@409754, @411783, @405835, @406304). The writer returns false after it has toasted, so a caller's own failure toast shows only when the call throws: "Failed to reset setting" (renderApp @8701178), "Failed to save script", "Failed to save files to copy" and "Failed to save custom prompt" (the editable field's catch, @10903526), "Failed to update spotlight testing" (@11265790) and "Failed to update env files" (@10691073). Because the parse is the one read before the last save, an overwrite drops that last save's own change; Conducted keeps the file as the last save wrote it instead (D142).
- Writes serialise sorted keys (except `scripts.run` order), add `$schema`, and strip unknown keys (`D8e`, main @358156, @290816).
- `$schema` values: `https://conductor.build/schemas/settings.schema.json` (user) and `https://conductor.build/schemas/settings.repo.schema.json` (repo) (main @366330).
- Git exclusion: Conductor writes `/.conductor/*` and `!.conductor/settings.toml` into the repo's git exclude, so `settings.local.toml` stays local while `settings.toml` stays trackable (main @358156, @358759).
- Cloud workspaces read the same files through the `host` file system abstraction (main @362200, `platformFs` with `host`).

#### 4.2.2 `source` and scope vocabulary

| Field | Values | Status |
|---|---|---|
| `source.type` | `file`, `managed`, `feature-flag`, `database` | VERIFIED |
| `source.scope` | `user`, `repo` | VERIFIED |
| `source.locality` | `shared`, `local` | VERIFIED |
| `source.label` | `user shared`, `repository shared`, `workspace shared`, `repository local`, `managed`, `feature flag`, `legacy database` | VERIFIED |
| UI configuration levels | `user`, `repo-shared`, `repo-local` (each with `isConfigured`, `isLocked`, `setValue`, `resetToInherited`) | VERIFIED main @425165 |
| Settings page scopes | `["user"]`, `["user","workspace"]`, `["workspace"]` | VERIFIED |
| Write options | `{debounce}`, `{optimistic}`, `{force}` | VERIFIED main @408614 |

Read API on the service class `OU` (main @390796): `getUserSetting`, `getUserSettingWithSource`, `getSetting`, `getSettingForRepo`, `getSettingForRepoV2`, `getSettingForWorkspace`, `getSettingForWorkspaceV2`, `getSettingForUserV2`, `getTasksForRepo`, `updateSetting`, `deleteSetting`, `setFeatureFlagOverride`, `updateFeatureFlags`, `isSettingManaged`, `isSettingFromFeatureFlag`, `reloadSettingsFromDisk`, `refreshFileBackedSettings`. A file refresh timer runs while repo resolution has errors (retries 250 ms, 1 s, 3 s).

#### 4.2.3 Registry of all 192 keys (`tU`, main @303964)

Total keys: 192. File-backed: 43. Types: `str`, `bool`, `enum`, `num`, stored as strings in SQLite (`"true"`/`"false"`).
"repo-level" is `Y` when a repo or workspace file may set the key, `N` when only the user file can, `-` when the key is not file-backed.
"m @" and "r @" are the first literal use outside the registry. `-` means the key is read through a named constant (for example `ioe`) or only appears in the registry. Defaults listed are registry defaults. Real call site defaults differ (see 2.3.1).
Two flag settings are not in the registry: `remote_control_settings_enabled` and `remote_control_out_of_experimental_enabled` (read via `st(poe)` and `st(foe)`).

##### 4.2.3.1 Call site defaults seen in hooks (main @426975-@446108)

| Key | Behaviour when unset |
|---|---|
| `left_panel_visible`, `right_panel_visible` | true |
| `left_panel_width` | 256 |
| `terminal_font_size` | 12 |
| `mono_font` | `Geist Mono` |
| `file_ligatures_enabled` | true |
| `auto_convert_long_text` | true unless `"false"` |
| `zoom_level_v2` | 1 |
| `onboarding_step` | 0 |
| `first_time_onboarding_step` | 1 |
| `sidebar_group_by` | `repo`; other values `status`, `section` |
| `default_message_send_mode` | `steering`; other value `queued` |
| `sound_type` | `default` |
| `internal_remote_local_execution_mcp` | true unless `"false"` |
| `experimental_show_agent_cost` | internal users true unless `"false"` |
| `claude_executable_path`, `codex_executable_path`, `opencode_executable_path`, `conductor_api_token`, `gh_token`, `gh_pat_token`, `gh_cloud_token` | empty string |
| `run_script_mode` | `concurrent`; other value `nonconcurrent` (main @3020912) |
| `branch_prefix_type` | `github_username` -> `<ghuser>/`; `custom` -> `branch_prefix_custom`; `none` -> no prefix (main @3140494) |

##### 4.2.3.2 Tables

Models and providers

| key | type | default | settings.toml key | repo-level | m @ | r @ |
|---|---|---|---|---|---|---|
| `default_model` | str | - | `models.default` | N | 372105 | 122719 |
| `review_model` | str | - | `models.review` | N | 432195 | 11261602 |
| `default_fast_mode` | bool | false | `models.default_fast_mode` | N | 2467407 | 123599 |
| `review_fast_mode` | bool | - | `models.review_fast_mode` | N | 3700297 | 11260898 |
| `default_plan_mode` | bool | - | `models.default_plan_mode` | N | 443403 | 123292 |
| `default_codex_thinking_level` | str | - | `models.codex.default_thinking_level` | N | 443557 | 121322 |
| `review_codex_thinking_level` | str | - | `models.codex.review_thinking_level` | N | 443970 | 11261821 |
| `default_codex_personality` | str | - | `models.codex.personality` | N | 443765 | 140716 |
| `default_claude_personality` | enum | default ; default, proactive, concise, explanatory, learning | `models.claude_code.personality` | N | 2445475 | 11262490 |
| `default_claude_effort_level` | str | - | `models.claude_code.default_effort_level` | N | 457497 | 121193 |
| `review_claude_effort_level` | str | - | `models.claude_code.review_effort_level` | N | 457704 | 11261728 |
| `visible_provider_models` | str | - | `models.visible_provider_models` | Y | 430871 | 313263 |
| `tool_approvals_enabled` | bool | false | `tool_approvals_enabled` | N | 451736 | 9293626 |
| `codex_tool_approval_policy` | enum | default ; default, always_approve | `models.codex.tool_approval_policy` | N | 3101742 | 11097226 |
| `claude_executable_path` | str | - | `claude_code_executable_path` | Y | 372053 | 8052932 |
| `codex_executable_path` | str | - | `codex_executable_path` | Y | 434838 | 314884 |
| `opencode_executable_path` | str | - | `opencode_executable_path` | Y | 372078 | 316220 |
| `claude_provider` | str | - | `claude_provider` | Y | 3171750 | 10997887 |
| `codex_provider` | str | - | `codex_provider` | Y | 440106 | 314842 |
| `bedrock_region` | str | - | `bedrock_region` | Y | - | - |
| `vertex_project_id` | str | - | `vertex_project_id` | Y | - | - |
| `default_thinking_enabled` | bool | - | - | - | - | - |
| `model_catalog_cache` | str | - | - | - | 382351 | 72375 |
| `review_thinking_enabled` | bool | - | - | - | - | - |

Repository behaviour

| key | type | default | settings.toml key | repo-level | m @ | r @ |
|---|---|---|---|---|---|---|
| `setup_script` | str | - | `scripts.setup` | Y | 3013807 | 11025607 |
| `run_script` | str | - | `scripts.run` | Y | 152504 | 11025688 |
| `archive_script` | str | - | `scripts.archive` | Y | 3013899 | 11025767 |
| `run_script_mode` | str | - | `scripts.run_mode` | Y | 3013951 | 11025850 |
| `auto_run_after_setup` | bool | false | `scripts.auto_run_after_setup` | Y | 376994 | 11108493 |
| `environment_variable_files` | str | - | `environment_variable_files` | Y | 291172 | 10689935 |
| `enterprise_data_privacy` | bool | false | `enterprise_data_privacy` | Y | 372027 | 11095789 |
| `file_include_globs` | str | - | `file_include_globs` | Y | 1088089 | 11272940 |
| `spotlight_testing` | bool | - | `spotlight_testing` | Y | 3018436 | 4994817 |
| `custom_prompt_code_review` | str | - | `prompts.code_review` | Y | 163038 | 11266350 |
| `custom_prompt_create_pr` | str | - | `prompts.create_pr` | Y | 163069 | 11266542 |
| `custom_prompt_fix_errors` | str | - | `prompts.fix_errors` | Y | 163098 | 11266731 |
| `custom_prompt_resolve_merge_conflicts` | str | - | `prompts.resolve_merge_conflicts` | Y | 163128 | 11266924 |
| `custom_prompt_rename_branch` | str | - | `prompts.rename_branch` | Y | 163171 | 11267156 |
| `custom_prompt_general` | str | - | `prompts.general` | Y | 163011 | 11267363 |
| `conductor_root_path` | str | - | - | - | 860602 | - |
| `default_open_in` | str | - | - | - | 432566 | - |
| `open_url_template` | str | - | `preview_urls` | Y | 444685 | 11269202 |
| `open_in_mru_order` | str | - | - | - | 432384 | - |

Auth, network, identity (the `gh_*`, `conductor_api_token`, `codex_api_key`, `opencode_provider_api_keys` and `roundhouse_credentials` values are secrets, see 2.8)

| key | type | default | settings.toml key | repo-level | m @ | r @ |
|---|---|---|---|---|---|---|
| `ssh_key_path` | str | - | `ssh_key_path` | Y | 458692 | 11099536 |
| `client_instance_id` | str | - | - | - | 553691 | - |
| `codex_api_key` | str | - | - | - | 374339 | 9101471 |
| `codex_base_url` | str | - | - | - | - | - |
| `conductor_api_token` | str | - | - | - | 230643 | 261479 |
| `opencode_provider_api_keys` | str | - | - | - | 335115 | - |
| `gh_auth_method` | str | - | - | - | 441001 | - |
| `gh_pat_expires_at` | str | - | - | - | 441647 | - |
| `gh_pat_token` | str | - | - | - | 374383 | - |
| `gh_token` | str | - | - | - | 374355 | - |
| `gh_token_app_client_id` | str | - | - | - | 453727 | - |
| `gh_token_expires_at` | str | - | - | - | 440973 | 262057 |
| `gh_token_source` | str | - | - | - | 441330 | - |
| `gh_cloud_auth_method` | str | - | - | - | 442386 | 11059338 |
| `gh_cloud_pat_expires_at` | str | - | - | - | 441621 | - |
| `gh_cloud_pat_token` | str | - | - | - | 374398 | - |
| `gh_cloud_token` | str | - | - | - | 374366 | - |
| `gh_cloud_token_app_client_id` | str | - | - | - | 454945 | - |
| `gh_cloud_token_expires_at` | str | - | - | - | 442352 | 263462 |
| `gh_cloud_token_source` | str | - | - | - | 442721 | - |
| `http_proxy` | str | - | - | - | - | - |
| `roundhouse_client_url_override` | str | - | - | - | 376920 | - |
| `roundhouse_client_user_id` | str | - | - | - | 464881 | - |
| `roundhouse_credentials` | str | - | - | - | 230668 | - |

Git and workflow

| key | type | default | settings.toml key | repo-level | m @ | r @ |
|---|---|---|---|---|---|---|
| `delete_branch_on_archive` | bool | false | `git.delete_branch_on_archive` | Y | 451483 | 11140106 |
| `archive_on_merge` | bool | - | `git.archive_on_merge` | Y | 439831 | 11131536 |
| `worktree_push_auto_setup_remote` | bool | - | `git.worktree_push_auto_setup_remote` | Y | 376956 | 11101137 |
| `branch_prefix_type` | str | github_username | `git.branch_prefix_type` | Y | 452649 | 11137838 |
| `branch_prefix_custom` | str | - | `git.branch_prefix` | Y | 452718 | 11138074 |
| `always_allow_local_execution` | bool | false | - | - | 3197856 | 9316197 |
| `auto_sync_files_in_new_cloud_workspaces` | bool | true | - | - | 983512 | 11100349 |
| `auto_rename_new_branches` | bool | true | - | - | 1085162 | 11139338 |
| `auto_rename_workspace_on_branch_name_set` | bool | true | - | - | 740367 | 11139688 |
| `automerge_enabled` | bool | - | - | - | - | 2126500 |
| `treat_optional_checks_as_blocking` | bool | - | - | - | - | 2126553 |
| `github_stacked_prs_enabled` | bool | true | - | - | 445253 | 11143234 |
| `default_message_send_mode` | str | - | - | - | 3816011 | 11117768 |
| `last_clone_directory` | str | - | - | - | 435147 | 10967160 |
| `pull_request_open_target` | enum | github ; github, linear, graphite | - | - | 440610 | 2180565 |
| `pr_activity_sort_order` | enum | newest-first ; newest-first, oldest-first | - | - | - | 2126639 |

UI, layout and appearance

| key | type | default | settings.toml key | repo-level | m @ | r @ |
|---|---|---|---|---|---|---|
| `always_show_context_wheel` | bool | - | - | - | 440301 | 11121340 |
| `auto_convert_long_text` | bool | - | - | - | 435301 | 11120620 |
| `auto_restart_on_update_when_idle` | bool | false | - | - | 451389 | 10624450 |
| `artifacts_tab_enabled` | bool | true | - | - | 437321 | 11123152 |
| `manual_workspace_order` | bool | - | - | - | - | 2126737 |
| `big_terminal_custom_commands` | str | - | - | - | 438267 | - |
| `big_terminal_preset` | str | - | - | - | 439416 | - |
| `caffeinate_while_agents_running` | bool | false | - | - | 376851 | 11121718 |
| `remote_control_keep_awake` | bool | true | - | - | 376889 | 11194270 |
| `chrome_mode_enabled` | bool | - | - | - | 3205304 | 10995201 |
| `code_theme` | enum | default ; catppuccin-latte, catppuccin-macchiato, catppuccin-mocha, dracula, nord, tokyo-night, gruvbox-dark, solarized-dark | - | - | 453189 | 367446 |
| `color_vision` | enum | default ; default, protanopia-deuteranopia, tritanopia | - | - | 453094 | 367340 |
| `colored_sidebar_diffs` | bool | false | - | - | 453250 | 10420566 |
| `file_ligatures_enabled` | bool | - | - | - | 434023 | 10670729 |
| `hide_whitespace_changes` | bool | false | - | - | 451151 | 2663563 |
| `keybinding_overrides_v1` | str | - | - | - | 3808977 | - |
| `left_panel_visible` | bool | - | - | - | 433125 | 11397341 |
| `left_panel_width` | str | - | - | - | 433304 | - |
| `low_contrast_dark_mode` | bool | false | - | - | 453333 | 367290 |
| `markdown_style` | enum | default ; default, tufte | - | - | 452954 | 8133220 |
| `message_send_key` | enum | enter ; enter, cmd-enter | - | - | 3815836 | 11116906 |
| `mono_font` | str | - | - | - | 433872 | 10668488 |
| `notifications_enabled` | bool | true | - | - | 2688904 | 11118515 |
| `mention_notifications_enabled` | bool | true | - | - | 3718785 | 11118817 |
| `right_panel_visible` | bool | - | - | - | 432959 | 11397151 |
| `sidebar_group_by` | str | - | - | - | 444177 | - |
| `sidebar_repo_filter` | str | - | - | - | 458064 | 10488684 |
| `sidebar_sort_by` | str | - | - | - | 444423 | - |
| `sound_type` | str | - | - | - | 432810 | 11119131 |
| `terminal_font_family` | str | - | - | - | 433552 | - |
| `terminal_font_size` | str | - | - | - | 433706 | - |
| `terminal_max_buffered_lines` | num | - | - | - | 2971877 | - |
| `terminal_scrollback_limit_bytes` | num | 1e7 | - | - | 2971839 | 11101513 |
| `using_split_view` | bool | false | - | - | 451073 | 9970707 |
| `wrap_lines` | bool | true | - | - | 451236 | 9962905 |
| `zoom_level_v2` | str | - | - | - | 435461 | 10663078 |

Flag-driven (see 1.2). `disable_external_logging`, `claude_subscription_sign_in_enabled` and the others in this group are locked while PostHog supplies a value.

| key | type | default | settings.toml key | repo-level | m @ | r @ |
|---|---|---|---|---|---|---|
| `claude_subscription_sign_in_enabled` | bool | - | - | - | - | - |
| `codex_goals_disabled` | bool | - | - | - | - | - |
| `cloud_in_data_privacy_mode_enabled` | bool | - | - | - | 1098210 | - |
| `queue_messages_disabled` | bool | - | - | - | - | - |
| `routine_webhook_triggers_enabled` | bool | - | - | - | - | - |
| `pr_roundhouse_state_enabled` | bool | - | - | - | - | - |
| `user_message_footer_enabled` | bool | - | - | - | - | - |
| `read_aloud_enabled` | bool | - | - | - | - | - |
| `disable_external_logging` | bool | - | - | - | 379005 | - |
| `kill_switch_presence_enabled` | bool | - | - | - | - | - |
| `local_repositories_without_github_enabled` | bool | - | - | - | - | - |

Migration and onboarding markers. The four `*_migration_complete` markers with offsets are used in 2.5. `conductor_config_repo_root_migration_complete`, `conductor_json_migration_dismissed_repos`, `repo_conductor_config_file_migration_complete` and `onboarding_workspace_id` have no other literal in either bundle (VERIFIED by search), so they are legacy or Rust-side (INFERRED).

| key | type | default | settings.toml key | repo-level | m @ | r @ |
|---|---|---|---|---|---|---|
| `conductor_config_repo_root_migration_complete` | bool | - | - | - | - | - |
| `conductor_json_migration_dismissed_repos` | str | - | - | - | - | - |
| `first_time_onboarding_step` | str | - | - | - | 434364 | - |
| `local_env_vars_import_banner_dismissed` | bool | false | - | - | - | 10681807 |
| `last_seen_announcement` | str | - | - | - | 450516 | 10368857 |
| `onboarding_step` | str | - | - | - | 434192 | - |
| `onboarding_workspace_id` | str | - | - | - | - | - |
| `repo_conductor_config_file_migration_complete` | bool | - | - | - | - | - |
| `repo_conductor_config_file_migration_v2_complete` | bool | - | - | - | 3017765 | - |
| `repo_custom_prompt_file_migration_complete` | bool | - | - | - | 3016847 | - |
| `repo_local_settings_file_migration_complete` | bool | - | - | - | 3018315 | - |
| `sample_project_onboarding_seed_status` | str | - | - | - | - | - |

Experimental (see 1.5)

| key | type | default | settings.toml key | repo-level | m @ | r @ |
|---|---|---|---|---|---|---|
| `dashboard_enabled` | bool | - | - | - | 445318 | 11108899 |
| `experimental_agent_progress` | bool | false | - | - | 3205384 | 9388628 |
| `experimental_auto_permission_mode` | bool | false | - | - | 3210762 | 11103470 |
| `experimental_big_terminal_mode` | bool | false | - | - | 451979 | 2088005 |
| `experimental_configurable_center_panel` | bool | false | - | - | 376721 | 120786 |
| `experimental_new_workspace_page` | bool | false | - | - | - | 1713295 |
| `experimental_fork_to_new_tab` | bool | false | - | - | - | 10073985 |
| `experimental_in_app_browser_preview` | bool | false | - | - | 452160 | 2088051 |
| `experimental_legacy_file_preview_and_editing` | bool | false | - | - | - | 2663602 |
| `experimental_show_agent_cost` | bool | false | - | - | 445479 | 11107088 |
| `experimental_sidebar_transparency` | bool | false | - | - | - | 367238 |
| `experimental_tab_freak_mode` | bool | false | - | - | 452071 | 120717 |
| `graphite_disabled` | bool | - | - | - | 3820681 | 11110830 |
| `local_git_forge_enabled` | bool | - | - | - | 437389 | 11107965 |
| `pokes_enabled` | bool | false | - | - | 429530 | 11109991 |
| `sidebar_resource_usage` | bool | false | - | - | 451895 | 10365847 |
| `voice_mode` | bool | - | - | - | 445116 | 11109187 |
| `unstarted_workspaces_enabled` | bool | false | - | - | 429473 | 11213330 |

Internal and debug (see 1.5)

| key | type | default | settings.toml key | repo-level | m @ | r @ |
|---|---|---|---|---|---|---|
| `garry_mode` | bool | false | - | - | 448300 | 1874241 |
| `internal_codex_message_log` | bool | - | - | - | 3208271 | - |
| `internal_desktop_remote_access` | bool | false | - | - | - | 10639151 |
| `internal_developer_metrics` | bool | false | - | - | 376766 | - |
| `internal_codex_initial_permission_config` | str | - | - | - | 427500 | 11212579 |
| `internal_frame_drop_logging` | bool | - | - | - | 428764 | 11220713 |
| `internal_session_transcript_prefetch_disabled` | bool | false | - | - | 376799 | - |
| `internal_claude_token_usage_tracking` | bool | - | - | - | 428573 | 11222077 |
| `internal_claude_initial_permission_mode` | str | - | - | - | 427322 | 11211852 |
| `internal_cloud_workspaces_independent_of_local_repos` | bool | false | - | - | 429836 | 11221190 |
| `internal_pull_requests_page` | bool | false | - | - | 429572 | 11213664 |
| `internal_principals` | bool | false | - | - | 429628 | 11214034 |
| `internal_workspace_chat` | bool | false | - | - | 429676 | 11214243 |
| `internal_native_fork` | bool | false | - | - | 429728 | 11214606 |
| `internal_verbose_logging` | bool | - | - | - | 379079 | 11222503 |
| `internal_sidecar_exp_session_log` | bool | - | - | - | 379123 | 11223688 |
| `internal_terminal_render_debug_log` | bool | - | - | - | 428206 | 11220136 |
| `internal_remote_local_execution_mcp` | bool | - | - | - | 429927 | 11099772 |
| `internal_request_metadata` | bool | - | - | - | 428394 | 11221679 |
| `internal_prompt_snippets` | bool | - | - | - | 429197 | 11214956 |
| `internal_team_artifacts` | bool | - | - | - | 429250 | 11215271 |
| `internal_pic_agent_enabled` | bool | false | - | - | 429302 | 11217952 |
| `internal_muse_code_enabled` | bool | false | - | - | 429357 | 11218294 |
| `internal_settings_enabled` | bool | - | - | - | 378952 | - |
| `internal_settings_use_defaults` | bool | - | - | - | 377240 | 11103022 |
| `internal_tauri_http_proxy_url` | str | - | - | - | 376686 | 11222852 |
| `internal_workspace_tabs` | bool | - | - | - | 429145 | 11211061 |
| `internal_workspace_status_matrix` | bool | false | - | - | 429412 | 11107498 |
| `not_absolutely_right` | bool | false | - | - | 451569 | 9531266 |
| `react_profiler_enabled` | bool | - | - | - | - | - |
| `sidecar_inspect` | bool | false | - | - | 3819706 | - |
| `sidecar_inspect_brk` | bool | false | - | - | 3819739 | - |

Non-registry rows stored in the `settings` table or the same service (VERIFIED):

| Key | Purpose | Where |
|---|---|---|
| `file_backed_settings_migration_complete` | One-shot marker for moving DB settings into `~/.conductor/settings.toml` | main @368845 |
| `feature_flag_override:<rawFlag>` | Local flag override, value `"true"`/`"false"` | main @370924 (`moe`), @407886 |
| `cached_organizations`, `cached_organizations_2`, `cached_user_data` | Cached account data, treated as secrets (keychain on macOS prod builds) | main @374237, @3124245 |
| `conductor_api_token`, `roundhouse_credentials`, `gh_*` | See 2.8 | main @374237 |

Settings with sensitive handling (value redacted in logs, no analytics event): `claude_executable_path`, `conductor_api_token`, `codex_api_key`, `codex_executable_path`, `opencode_executable_path`, `opencode_provider_api_keys`, `gh_cloud_token`, `gh_cloud_pat_token`, `gh_token`, `gh_pat_token`, `cached_organizations`, `cached_organizations_2`, `cached_user_data`, `roundhouse_credentials`, `roundhouse_client_user_id`, `client_instance_id`, `internal_tauri_http_proxy_url` (main @3775379, `isn`).

#### 4.2.4 `settings.toml` schema

Source of truth is the registry `hie` (main @305393) plus the task parser (`SU`, `Hie`) and the env parser. Top-level `$schema`, `environment_variables`, `environmentVariables` and `tasks` are known non-registry keys (`AU`, main @358068).

The 43 file-backed keys. "Where" is `U` (user file only) or `U,R` (user file and repo or workspace files).

| TOML key | Settings key | Type / values | Where |
|---|---|---|---|
| `models.default` | `default_model` | model id | U |
| `models.review` | `review_model` | model id | U |
| `models.default_fast_mode` | `default_fast_mode` | bool | U |
| `models.review_fast_mode` | `review_fast_mode` | bool | U |
| `models.default_plan_mode` | `default_plan_mode` | bool | U |
| `models.codex.default_thinking_level` | `default_codex_thinking_level` | `none`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra` | U |
| `models.codex.review_thinking_level` | `review_codex_thinking_level` | same | U |
| `models.codex.personality` | `default_codex_personality` | `pragmatic`, `friendly`, `none` | U |
| `models.codex.tool_approval_policy` | `codex_tool_approval_policy` | `default`, `always_approve` | U |
| `models.claude_code.personality` | `default_claude_personality` | `default`, `proactive`, `concise`, `explanatory`, `learning` | U |
| `models.claude_code.default_effort_level` | `default_claude_effort_level` | `low`, `medium`, `high`, `xhigh`, `max`, `ultracode` | U |
| `models.claude_code.review_effort_level` | `review_claude_effort_level` | same | U |
| `models.visible_provider_models` | `visible_provider_models` | string | U,R |
| `tool_approvals_enabled` | `tool_approvals_enabled` | bool | U |
| `scripts.setup` | `setup_script` | shell string | U,R |
| `scripts.run` | `run_script` | string, or table of named actions (below) | U,R |
| `scripts.archive` | `archive_script` | shell string | U,R |
| `scripts.run_mode` | `run_script_mode` | `concurrent`, `nonconcurrent` | U,R |
| `scripts.auto_run_after_setup` | `auto_run_after_setup` | bool | U,R |
| `environment_variable_files` | `environment_variable_files` | array of paths (string with newlines also accepted) | U,R |
| `enterprise_data_privacy` | `enterprise_data_privacy` | bool | U,R |
| `file_include_globs` | `file_include_globs` | string (newline list) | U,R |
| `spotlight_testing` | `spotlight_testing` | bool | U,R |
| `prompts.code_review` | `custom_prompt_code_review` | string | U,R |
| `prompts.create_pr` | `custom_prompt_create_pr` | string | U,R |
| `prompts.fix_errors` | `custom_prompt_fix_errors` | string | U,R |
| `prompts.resolve_merge_conflicts` | `custom_prompt_resolve_merge_conflicts` | string | U,R |
| `prompts.rename_branch` | `custom_prompt_rename_branch` | string | U,R |
| `prompts.general` | `custom_prompt_general` | string | U,R |
| `claude_code_executable_path` | `claude_executable_path` | path | U,R |
| `codex_executable_path` | `codex_executable_path` | path | U,R |
| `opencode_executable_path` | `opencode_executable_path` | path | U,R |
| `claude_provider` | `claude_provider` | string (`custom` is checked in code) | U,R |
| `codex_provider` | `codex_provider` | string (`custom` is checked in code) | U,R |
| `bedrock_region` | `bedrock_region` | string | U,R |
| `vertex_project_id` | `vertex_project_id` | string | U,R |
| `ssh_key_path` | `ssh_key_path` | path | U,R |
| `git.delete_branch_on_archive` | `delete_branch_on_archive` | bool | U,R |
| `git.archive_on_merge` | `archive_on_merge` | bool | U,R |
| `git.worktree_push_auto_setup_remote` | `worktree_push_auto_setup_remote` | bool | U,R |
| `git.branch_prefix_type` | `branch_prefix_type` | `github_username`, `custom`, `none` | U,R |
| `git.branch_prefix` | `branch_prefix_custom` | string | U,R |
| `preview_urls` | `open_url_template` | array of `{name?, url}` (a plain string becomes `[{url}]`) | U,R |

Not in `settings.toml`: `auto_rename_new_branches` and `auto_rename_workspace_on_branch_name_set` are DB only (non file-backed, defaults true). Their rows live in the `settings` table.

Value rules (VERIFIED main @351196-@356000, @293747): values are coerced to string for storage. A wrong type reports `wrong-type`, a bad enum reports `unsupported-value`. The sentinel `<conductor_default>` is skipped when reading repo layers. A model id in `models.default` must exist in the catalog.

Named actions (`scripts.run.<name>` tables, formerly `[tasks.<name>]`). Allowed fields (zod `Hie`, main @351420):

| Field | Type |
|---|---|
| `command` | string |
| `args` | string array |
| `options.cwd` | string (only `cwd` is allowed under `options`) |
| `default` | bool (the action started by Run) |
| `icon` | string (the legacy single run script gets `play`) |
| `hide` | bool |
| `available_in` | `"local"`, `"cloud"` or an array of both |

Other rules: an action id is normalised (trim, spaces to `-`, case-insensitive match). A flat `scripts.run = "cmd"` string becomes action `run` with `default:true, icon:"play", available_in:"local"` (main @355001, `EU`). `O8e` (main @357654) migrates a legacy `[tasks]` table into `scripts.run`. UI "hidden" actions are stored in encrypted local storage subsystem `settings-service-hidden-run-scripts-v1`, not in the file.

Env vars (TOML):

```toml
environment_variable_files = [".env"]      # dotenv files, read per layer
[environment_variables]
FOO = "all contexts"                        # top level scalar applies to local and cloud
[environment_variables.local]
BAR = "local only"
[environment_variables.cloud]
SECRET = "conductor-keychain"               # sentinel: value is in the keychain
UNSET = "<none>"                            # sentinel: remove inherited value
```

Name rule `^[A-Za-z_][A-Za-z0-9_]*$` (main @293747, @372380). `environmentVariables` (camelCase) is accepted and rewritten to snake case on write (main @368185). Dotenv parsing: `export ` prefix, `#` comments, single or double quotes, `\n \r \t` escapes (main @296000). Dotenv path resolution: absolute, `~`, relative to the settings directory, then to the repo root (main @295448).

#### 4.2.5 Legacy `conductor.json` and migrations

| Item | Detail | Status |
|---|---|---|
| Format | Parsed as JSON5 (`cR = {parse: QBt}`). Fields read: `scripts.setup`, `scripts.run`, `scripts.archive` (strings), `runScriptMode` (`concurrent` or `nonconcurrent`), `enterpriseDataPrivacy` (bool or `"true"`/`"false"`). Writer `dgn` emits 4-space JSON. | VERIFIED main @3020912, @3021474 |
| Location | `<repo root>/conductor.json`, also a copy in the home directory (`~/conductor.json`, polled every 30 s and watched). | VERIFIED main @3023752, @3027495; purpose of the home copy INFERRED |
| Live use | Not a live settings layer. Current reads go through `getSettingForRepo` (`S$t`, main @3022757), which never opens `conductor.json`. The file is only read by migration code and the "team"/"home" config queries. | VERIFIED |
| Repo status values | `completed`, `not-needed`, `completed-pull-recommended`, `pr-open`, `not-started` (`cgn`, main @3012084). | VERIFIED |
| Migration PR | Branch `conductor/migrate-to-settings-v2-<repo>`; temporary worktree `conductor-migration-<ts>` from `origin/<default>`; writes keys `setup_script`, `run_script`, `archive_script`, `run_script_mode`, `enterprise_data_privacy` into `.conductor/settings.toml`; deletes `conductor.json`; `git add -A`; commit `Migrate conductor.json to .conductor/settings.toml` with hooks disabled; `gh pr create`. | VERIFIED main @3013239 (`ugn`) |
| Startup migrations (`lgn`) | Run once each, guarded by a `settings` marker, then `reloadSettingsFromDisk`. | VERIFIED main @3013125 |

Startup migrations in order:

| Marker key | Moves | From | To |
|---|---|---|---|
| `file_backed_settings_migration_complete` | all file-backed keys | DB `settings` rows (rows get `deprecated_at = now`) | `~/.conductor/settings.toml` |
| `repo_conductor_config_file_migration_v2_complete` | `setup_script`, `run_script`, `archive_script`, `run_script_mode`, `enterprise_data_privacy` | `repos` columns and `repos.conductor_config` JSON | repo local `settings.local.toml`. Columns are not cleared. |
| `repo_custom_prompt_file_migration_complete` | six `custom_prompt_*` | `repos.custom_prompt_*` | repo local file. Columns set NULL. |
| `repo_local_settings_file_migration_complete` | `file_include_globs`, `spotlight_testing` | `repos.file_include_globs`, `repos.spotlight_testing` | repo local file. Columns set NULL. |

Legacy `repos` columns (SQL @3018811): `custom_prompt_code_review`, `custom_prompt_create_pr`, `custom_prompt_fix_errors`, `custom_prompt_resolve_merge_conflicts`, `custom_prompt_rename_branch`, `custom_prompt_general`, `file_include_globs`, `spotlight_testing`, `setup_script`, `archive_script`, `run_script`, `run_script_mode`, `conductor_config`. `repos.conductor_config` is still read (`Pnt`, main @863191, parsed by `sanitizeConfig`=`lR`) and written (`setRepoConductorConfig`, main @878000, `buildConfigJson`=`dgn`). The renderApp passes `config:{sanitizeConfig:lR, buildConfigJson:dgn}` into the repo service (r @12113635). `getConductorConfigOrDefault(workspace)` returns `{setupScript, runScript, archiveScript, runScriptMode, enterpriseDataPrivacy}` by calling `getSettingForRepo`/`getSettingForWorkspace` for the five keys (`S$t`, `k_e`). `E_e` defaults `runScriptMode` to `concurrent` and `enterpriseDataPrivacy` to `"false"`. Whether `repos.conductor_config` still feeds any live path is INFERRED unlikely.

#### 4.2.6 Managed (organization) settings file

| Item | Detail | Status |
|---|---|---|
| File | `~/.conductor/settings.managed.toml`, else `settings.managed.json` (dev build: appData) | VERIFIED main @372014-@372226 |
| Allowed settings keys | only `enterprise_data_privacy`, `claude_executable_path`, `opencode_executable_path`, `default_model` (model must be in the allowed model list `rqe`) | VERIFIED |
| Env vars | `environment_variables.local` and `.cloud`, same name rule | VERIFIED |
| Behaviour | Highest precedence. Keys are locked in UI ("Setting is managed by your organization"). Env vars override stored ones and show `source:"managed"`. Unknown keys are dropped with `unknown-key`. | VERIFIED |
| Delivery | There is no network fetch. `fetchManagedSettings` reads the local file only. An MDM or admin must place it. | VERIFIED code, INFERRED intent |
| UI checks | `uGe` also asks `isSettingManaged` for `default_claude_effort_level`, `default_codex_thinking_level`, `default_fast_mode`. Those can never be managed in this build because the allow list has only 4 keys. | INFERRED |

#### 4.2.7 Server side scoped settings (Roundhouse)

Endpoints (main @898800-@904200): `GET /settings?organizationId&gitRemoteUrl`, `GET /settings/scope`, `POST /settings/scope`, `GET /settings/value`, `POST /settings/value`, `GET/POST /settings/run-scripts` (cloud actions: shared plus personal, hidden shared ids, `canEditShared`), `POST /settings/cloud-agent-credential-selection`.
Scope union `kd` (main @169831): `{type:"user"}`, `{type:"org", organizationId}`, `{type:"org-personal", organizationId}`, `{type:"org-repo", organizationId, repo:{gitRemoteUrl}}`, `{type:"org-personal-repo", organizationId, repo:{gitRemoteUrl}}`.
Value type `ou`: string, number, bool, array or object, nullable. Writes are `set-setting` or `delete-setting`. Sync message `sync_required`.

Known server keys (VERIFIED main @1093446):

| Key | Scope (seen) | Meaning |
|---|---|---|
| `gitIdentity` | `user` | `{name, email}` for commits |
| `automatic_workspace_api_key_provisioning_enabled` | `org-personal` | bool, default true |
| `exclusive_port_forwarding_enabled` | `org-personal` | bool, default false |
| `port_forwarding_strategy` | `org-personal` | port forwarding mode |
| `local_port_range` | `org-personal` | local port range for forwards |
| `port_mappings` | `org-personal` | explicit port mappings |
| `personalCloudEnvVars` | org-personal (INFERRED) | personal cloud env vars |
| `prWorkspaceLinkEnabled` | org (INFERRED) | PR to workspace link |
| `automergeEnabled`, `treatOptionalChecksAsBlocking`, `prActivitySortOrder`, `manualWorkspaceOrder` | org-personal (INFERRED) | cloud mirrors of the local keys `automerge_enabled`, `treat_optional_checks_as_blocking`, `pr_activity_sort_order`, `manual_workspace_order` |
| `cloudClaudeCredentialSelection`, `cloudCodexCredentialSelection`, `cloudCursorCredentialSelection` | credential selection API | which credential cloud agents use |
| `general`, `codeReview`, `createPR`, `fixErrors`, `resolveMergeConflicts` | `org` / `org-personal` | org prompts, mapped to `custom_prompt_general`, `custom_prompt_code_review`, `custom_prompt_create_pr`, `custom_prompt_fix_errors`, `custom_prompt_resolve_merge_conflicts` (`fHt`, `mHt`, main @3212568) |

Organization tabs in settings: organization, members, computer, environment, prompts, mcp-servers (mcp-servers also needs internal user). They are server data, they do not use the local `settings` table. Precedence between server prompts and local `prompts.*` files is not traced (open item).

#### 4.2.8 `env_vars` table and secrets

`env_vars (key, scope, context, value)`, unique on `(key, scope, context)` (SQL @460831-@463220, VERIFIED).

| Column | Values seen | Notes |
|---|---|---|
| `scope` | `shared` only (all calls pass `scope:"shared"`) | VERIFIED r, main |
| `context` | `local`, `cloud` | VERIFIED |
| `value` | NULL when the secret lives in the keychain (release builds), else plaintext | VERIFIED main @462334 |

Read merge for a workspace (main @459668, `Ndn`, `jz`): rows from `env_vars` (secret fetched from keychain for release builds), then file layers (dotenv files and `environment_variables`), then managed env vars last. File defined entries mark `fileSource`. A repo local file can show `localOverrideSource`. Provider keys are stripped unless provider is `custom`: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` (claude) and `CODEX_API_KEY`, `AI_GATEWAY_API_KEY`, `OPENAI_BASE_URL` (codex) (main @463412, `WU`).
Credential env names handled specially: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `CODEX_API_KEY`, `CODEX_ACCESS_TOKEN`, `OPENAI_API_KEY`, `CURSOR_API_KEY` (`n7e`). A table of about 80 OpenCode provider env names also exists (for example `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `XAI_API_KEY`) (main @340000).

Secrets store (`ean`, main @3901005):
- Release builds on macOS (`appType` in `alpha`, `alpha-chromium`, `beta`, `funhouse`, `native`, `production`) use the OS keychain through Tauri commands `get_keychain_setting`, `set_keychain_setting`, `delete_keychain_setting`.
- Other builds (dev, non macOS) fall back to storing the value as a normal `settings` row.
- Keychain key names (names only):

| Keychain key | Holds | Where |
|---|---|---|
| `cached_organizations`, `cached_organizations_2`, `cached_user_data` | account caches | main @374237 |
| `conductor_api_token` | Roundhouse API token | main @230639 |
| `roundhouse_credentials` | per-host Roundhouse credentials (JSON map) | main @230665 |
| `codex_api_key`, `opencode_provider_api_keys` | provider keys | main @374237 |
| `gh_token`, `gh_pat_token`, `gh_cloud_token`, `gh_cloud_pat_token` | GitHub tokens (local and cloud) | main @374237, @950166 |
| `codex_chatgpt_local_proxy_tokens` | Codex ChatGPT proxy tokens | main @3119672 |
| `desktop_browser_authorizations` | pending desktop sign-in requests | main @3133973 |
| `local-storage-entry-encryption-key-v1` | key for encrypted local storage (also `get_or_create_local_storage_encryption_key` in Rust) | main @240354 |
| `env:<context>:<scope>:<KEY>` | env var secret from the `env_vars` table | main @459514 |
| `file-env:<settingsDir>/<basename>:<KEY>` | env var marked `conductor-keychain` in a `settings.toml` | main @295448 (`lie`) |

On startup `vqe` migrates leftover secret rows from SQLite to the keychain and deletes the SQLite row (main @375456).

#### 4.2.9 UI persistence (zustand `persist` and local storage)

The `persist` middleware is `pHe` (main @274751, alias `Xw` in main, `aQ` in r). Two storage backends:
- `window.localStorage` (default `cT(() => localStorage)`): used when no `storage` option is given.
- Conductor "local storage" service (`ds()`, main @253900): a file backed key/value store under the app data directory, split into subsystems, with a metadata file `local-storage.metadata.json`, a per-entry size limit and optional AES-GCM encryption. The key comes from the keychain. Adapter `s6({subsystem,sizeLimit})`. Browser `localStorage` access is also shimmed (`ip()`, subsystem `browser-local-storage`, 5 MB) for the Rust-side caches below.

zustand `persist` stores (VERIFIED):

| Persist `name` | Backend / limit | What it stores | Where |
|---|---|---|---|
| `main-tabs-v2` | localStorage | main terminal tab list (workspace id, cwd, flags) | main @2958113 |
| `terminal-panel-tabs-v1` | subsystem `terminal`, 100 MB | terminal panel tabs, workspace terminal ids, active tab per workspace, last tab kind | main @2964340 |
| `run-script-history-v1` | subsystem `run-script-history`, 5 MB | active task id and per-workspace action run history | main @3036700 |
| `workspace-tab-state-v2` | localStorage | browser tabs per workspace, annotation-disabled URLs, recent workspaces, last workspace route per org | main @3613687 |
| `workspace-tabs-v2` | subsystem `workspace-tabs`, 1 MB | open workspace tabs (the internal "workspace tabs" feature) | main @3718463 |
| `workspace-center-panel-layout-v1` | localStorage | split pane layouts per workspace | r @2076950 |
| `route-user-state-v1` | subsystem `route-user-state`, 5 MB | per-route UI state (zod validated) | r @2522700 |
| `viewed-files-storage` | localStorage | viewed-file marks per workspace (diff review) | r @2545848 |
| `dispatcher-state-v1` | subsystem `dispatcher-state`, 1 MB | create-workspace dispatcher: last repo (also per org), target branch, draft, `createFromTab`, hosting target | r @5551633 |
| `code-snippet-runs-storage` | localStorage | last runs of code snippets (non-running only, capped list) | r @8053406 |
| `file-drafts` | custom `BJi.storage` | unsaved editor drafts and their base versions | r @9950691 |

Other local-storage subsystems used directly (names, VERIFIED; contents INFERRED from names): `settings-service-hidden-run-scripts-v1` (hidden actions), `git-service-pr-v2`, `git-service-workspace-changes-v1`, `git-service-pull-request-changes-v1` (git caches), `claude-context-windows`, `session-questions` (persisted pending questions), `composer-drafts`, `terminal-history`, `acp-model-config-options-v1`, `acp-session-config-options-v1`, `turn-changes-cache`, `active-organization`, `model-picker-favorites-v1`, `opencode-model-discovery-v1`, `acp-model-picker-configs-v1`, `model-picker-configs-v1`, `pre-workspace-completions-v1`, `lottie-sprite-cache`, `claude-token-usage-v1`, plus `roundhouse-session-feed-snapshot:*` (legacy, cleared) in the browser shim.
PostHog also writes its own `localStorage+cookie` persistence (`ph_*`, `$stored_*`) and `ph_debug`.

### 4.3 Open items and caveats

| Item | State |
|---|---|
| Exact effect of `pr-roundhouse-state`, `user-message-footer`, `routine-webhook-triggers`, `claude-subscription-sign-in`, `codex-goals-disabled` | Gate wiring VERIFIED. Behaviour behind the gate not traced. |
| Whether Roundhouse can push flags | No evidence. Only PostHog is read. Roundhouse does serve `/settings` scopes. |
| Which PostHog flags exist beyond the 15 | The Internal page lists whatever PostHog returns. Names cannot be known from the bundle. |
| Precedence of org prompts (server) against local `prompts.*` | Not traced. |
| `repos.conductor_config` live use | Reads and writes exist; whether any UI still writes it is not traced. |
| Rust side readers of settings (for example `http_proxy`, `codex_base_url`, `onboarding_workspace_id`) | Unseen in the bundles, so probably read by Rust or the sidecar. |



---

## Part 5. Feature subsystems

Part 5A covers local and process subsystems. Part 5B covers PR, cloud and platform subsystems.


### Part 5A. Local and process subsystems


Scope: how run scripts, Spotlight, ports, terminals, files, attachments, diff comments, agent binaries and shell env work, end to end.

Sources and conventions:
- `m@N` = offset in `main-BE1h_1MP.js`. `r@N` = offset in `renderApp-DeUrsznk.js`. `s@N` = `.context/conductor-re/sidecar.js`.
- `app` = files read straight from the installed app (`/Applications/Conductor.app/Contents/Resources/bin/*`, or `~/Library/Application Support/com.conductor.app/`, called `AppData`). Only names and sizes of AppData files were listed. No database content was read.
- `bin` = `strings` on the Mach-O binary (crate names, SQL in migrations). This is evidence of presence, not of use.
- VERIFIED = read in code at the cited place. INFERRED = reasoned from names or nearby code.
- Minified aliases are given where I traced them. The same function has different aliases per bundle (finddef resolves them).
- No secrets are quoted. Four env keys are named only because the code strips them (section 8).

Contents: 1 Run scripts and action stores, 2 Spotlight, 3 Ports, 4 Terminals, 5 Files and search, 6 Attachments, 7 Diff comments, 8 Agent binaries and shell env, 9 Open items.

---

#### 5A.1 Run scripts, setup scripts and the action/process stores

##### 5A.1.1 Three different things share the word "script"

| Thing | Where it is defined | Runs when | Store |
|---|---|---|---|
| Setup script | `scripts.setup` in settings, legacy `setup_script` | Once, after workspace creation (state `setting_up`) | `SetupProcessStore`, alias `lv` in main and renderApp (m@3034098) |
| Actions (a.k.a. tasks, "run" scripts) | `[scripts.run.<id>]` tables, legacy single `scripts.run` string | User presses Run, or auto after setup | `ActionProcessStore`, main alias `ur`, renderApp alias `Wz` (m@3076758, finddef) |
| Archive script | `scripts.archive` | On archive, via `executeUserScript` (m@1143742) | none (one-shot) |

##### 5A.1.2 SetupProcessStore (`lv`), m@3034098 (VERIFIED)

Created by `U$t(...)` with injected deps: `writeTextFile`, the terminal runtime (`ln`), the setup session id builder `B$t`, `localHost`, a logger.

State (zustand `create`, all `Map`s keyed by `WorkspaceId`):

| Field | Value |
|---|---|
| `processes` | `{sessionId, workspaceId, startedAt}` while running |
| `states` | `idle` (default) / `running` / `completed` / `failed` / `cancelled` |
| `exitCodes` | number per workspace |
| `logBuffers` | final transcript text per workspace |
| `runPromises` | the pending promise returned by `startSetup` |

Methods:
- `startSetup({workspaceId, workspacePath, workspaceHost, setupScript, logFilePath, env})`
  - Returns `{exitCode:-1}` at once if already `running`.
  - Destroys any old session `setup:<localId>`, sets state `running`.
  - Creates a PTY session: `kind:"setup"`, `cwd=workspacePath`, 80x24, `envMode:"user-shell"`, `envOverlay=env`, `persistence:"none"`, `execution:{mode:"direct_script", script}`.
  - For a remote (cloud) host it prepends `set -euo pipefail`. Local scripts run as written.
  - Metadata: `workspaceId`, `terminalId`, `hostingServerUrl` (cloud) or `localDirectScript:true` (local).
  - Listens with `terminal.onSessionChange`. `spawn_error` means state `failed`, exit 1. `exited` or `disposed` means `completed` if exit code 0, `cancelled` if the user cancelled, else `failed`.
  - On finish it takes the transcript (`terminal.getTranscript`), writes it to `logFilePath` (`writeTextFile`, fire and forget), stores it in `logBuffers`, destroys the session.
  - `transport-disconnected` exit reason adds the text "Connection to the workspace was lost while the setup script was running. It may not have completed."
- `cancelSetup(id)`: sets `cancelled`, kills the session, awaits the run promise.
- `markSetupInterrupted(id)`: sets `failed`, exit 1, log "Setup script was interrupted because Conductor quit."
- Readers: `getSetupState`, `getExitCode`, `getLogBuffer`, hook `useLogBuffer`, and a selector "any workspace running" (`fgn`).

Who starts it (m@1098500, `Rde`): VERIFIED.
- Log file path = `<tempDir>/conductor-setup-<localId>.log` for local, `<workspace>/.context/tmp/conductor-setup-<localId>.log` for cloud. Stored in `workspaces.setup_log_path` (SQL `UPDATE workspaces SET setup_log_path = ?`).
- Env = `QI({...})` base (below) + user env vars from `MT(Me,{scope:"shared",context:"local",...})` + `CONDUCTOR_PATH_PREFIX` = bundled bin dir (`AppData/bin`).
- Base env `QI` (m@195678): `CONDUCTOR_WORKSPACE_NAME`, `CONDUCTOR_WORKSPACE_PATH`, `CONDUCTOR_ROOT_PATH` (repo main worktree for local, workspace path for cloud), `CONDUCTOR_DEFAULT_BRANCH`, `CONDUCTOR_PORT`, optional `CONDUCTOR_USER_ID`, `CONDUCTOR_IS_LOCAL` ("1"/"0"). Cloud variant `Tre` has `CONDUCTOR_BASE_DIR` and no port.
- After setup, the workspace goes `setting_up` to `ready` (`workspaceEvents.emitStateTransition`).

##### 5A.1.3 ActionProcessStore (`ur`), m@3073334 to m@3088200 (VERIFIED)

Identity: processes are keyed by an interned object `Ai(workspaceId, taskId)` (map `IZ`) so `Map` lookup works by reference. Default task id is `legacy-run` (`xw`) for the old single run script, or `spotlight` (`lI`) for Spotlight.

State (zustand):

| Field | Meaning |
|---|---|
| `processes` | live process per key: `{actionRunId, sessionId, workspaceId, repositoryId, taskId, taskLabel, taskIcon, command, executionTarget, startedAt, isSpotlight, mainWorktreePath, localhostUrl?}` |
| `processStates` | `starting` / `waiting_for_setup` / `running` / `stopping` / `stopped` (anything absent reads as `stopped`) |
| `startAttemptIds` | monotonically increasing id per key. Stale async continuations compare it and bail out (guards races) |
| `waitingProcesses` | start requests parked until setup finishes |
| `lastRunIds` | last `actionRunId` per key |
| `retainedRunMetadata` | `{executionTarget, isSpotlight, taskLabel, command}` of the last run |
| `retainedRunOutcomes` | `"stop-unconfirmed"` or `"connection-lost"` per run id |
| `logBuffers` | run id to raw transcript text |
| `renderedLogBuffers` | run id to rendered screen text |

Run ids are small counters (`P3t`), the PTY session id is `run:<actionRunId>` (`uR`).

`startProcess({workspaceId, workspacePath, repositoryId, allowActionConcurrency, taskId, taskLabel, taskIcon, command, cwd, executionTarget, isSpotlight, mainWorktreePath})`:
1. Fails with a string error if Spotlight lacks `mainWorktreePath`, Spotlight is combined with `local-mirror`, or a non-Spotlight call has no command.
2. Always calls `killProcess(workspaceId)` (all tasks of this workspace) and `clearWorkspaceRuns(workspaceId)`. So a workspace has at most one action process at a time. Starting a task stops the previous one.
3. If the workspace state is `setting_up`: state `waiting_for_setup`, request stored in `waitingProcesses`, returns success. A global `workspaceEvents.onStateTransition` hook later starts it (m@3088400).
4. Else sets `starting` plus a fresh `startAttemptId`.
5. Spotlight only: `private_prepareSpotlightStart` (section 2), whose result replaces the command.
6. `private_startProcessImpl`:
   - `allowActionConcurrency === false` kills all processes of other workspaces in the same repository ("due to concurrency setting"). This is how `run_script_mode` works (below).
   - Resolves `executionTarget`: `workspace-host` (default) or `local-mirror` (cloud workspace, action marked local; runs on the synced local mirror dir, see 5.4). Cloud stopped VM gives "Cloud workspace is stopped. Start it before running a cloud action."
   - Env: `GBt` (m@2983377) builds `QI` env with `CONDUCTOR_PORT` from the port store plus `CONDUCTOR_DEEP_LINK_TARGET` ("prod") and `CONDUCTOR_WORKSPACE_ID`. Merge shared env vars (`MT`), `CONDUCTOR_PATH_PREFIX`, then `TERM=xterm-256color`, `COLORTERM=truecolor`. `cwd` of the task may contain `$VAR` or `${VAR}`, expanded from this env (`D3t`).
   - Creates PTY: `kind:"run"`, `envMode:"user-shell"`, `persistence:"none"`, `execution:{mode:"direct_script", script:command}`, metadata `{workspaceId, repositoryId, terminalId, localDirectScript?/hostingServerUrl?}`.
   - Records history (`recordRun`, 1.5), then state `running`. Spotlight also opens the repo terminal (`getOrCreateRepoTerminal`).
   - Output watcher `onSessionData`: keeps a 4096-char tail, finds the last `http(s)://localhost|127.0.0.1|0.0.0.0|[::]...` URL (regex `H$t`), rewrites 0.0.0.0 and [::] to `localhost`, stores it as `process.localhostUrl` (powers the "open localhost" button).
   - Exit: state `stopped`; `logBuffers[runId]` = transcript, `renderedLogBuffers[runId]` = screen text; `connection-lost` outcome if exit reason is `transport-disconnected`. `spawn_error` does the same and logs the transcript.

`killProcess(workspaceId, taskId?)`:
- No taskId: kills every task of that workspace. No process: `{success:false,"No process to stop"}`.
- Sets `stopping`. `waiting_for_setup`: just becomes `stopped`. `starting`: kills the session, drops entry.
- Running: `terminal.kill(sessionId)`, then a 20 s watchdog (`Q_e=2e4`). If no exit event arrives, the run is settled as `stopped` with outcome `stop-unconfirmed` ("Stop not confirmed, the process may still be running.").
- Spotlight: after kill it restores the pre-spotlight state (2.3).

Other methods: `isProcessBusy` (starting, waiting_for_setup, running or stopping), `getProcessState`, `getLastRunId`, `killAllProcesses` (app quit: kill every session, wipe all maps; does NOT restore Spotlight), `clearWorkspaceRuns`, `killProcessesForRepository` (calls `clearWorkspaceRuns` for each workspace; called from repo delete at m@869947).

Auto-run after setup (m@3089600, `F3t`): on `setting_up` leaving to `ready`, if repo setting `auto_run_after_setup` is set and a default action exists and (setup completed, or no setup script), it calls `startProcess` with the default task. If `spotlight_testing` is on it starts Spotlight instead.

Agent tool bridge `getTerminalOutput` (`H3t`, m@3092700): source `spotlight` / `run_script` / `terminal` / `auto`, `maxLines` default 1000. Reads the live screen (`ln.getScreenTextAsync`) and falls back to `renderedLogBuffers`/`logBuffers`. Errors: "No spotlight process active", "No action process active", "No terminal found for this workspace".

##### 5A.1.4 `run_script_mode` (VERIFIED)

- Stored per repo: setting key `run_script_mode`, file key `scripts.run_mode`. Values `concurrent` (default, m@863131) or `nonconcurrent` (settings reader accepts only those two, m@3021153).
- Used as `allowActionConcurrency: runScriptMode === "concurrent"` (r@5008100, m@3090313).
- Effect: not concurrent means starting a task kills the action processes of every other workspace in the same repository. Concurrent leaves them. Within one workspace there is always exactly one.
- Spotlight always passes `allowActionConcurrency:false`.

##### 5A.1.5 Run history

Zustand `persist` store `Eh` (m@3036000), exported helper object `h6` (renderApp alias `WB`). Persist key `run-script-history-v1`, storage subsystem `run-script-history`, limit 5 MiB, stored through the encrypted local-storage layer `s6`/`ds()`. VERIFIED.

State: `activeTaskId`, `hasHydrated`, `workspaceHistories: Map<WorkspaceId,{taskIds[], activeTaskId}>`. `recordRun` moves the task id to the front, de-duplicates, keeps at most 20 (`T_e`). `clearWorkspaceHistory`, `clearAll`. It only remembers which tasks were run (for ordering/selection in the UI). Run output is NOT persisted to disk: PTY `persistence:"none"`, buffers live in memory only. VERIFIED by absence.

##### 5A.1.6 Actions feature: user-defined scripts (VERIFIED unless marked)

Task shape in TOML (`Hie` zod, m@352300): `[scripts.run.<id>]` with `command`, `args[]`, `options.cwd`, `default` (bool), `icon`, `hide` (bool), `available_in` (string or array of `"local"|"cloud"`). A top-level `tasks` table is read as an alternative key (`SU`). Unknown keys are reported (`unknown-key`) and can be stripped (`C8e`).

Id rules: `Bm` normalizes (strip leading `-`, replace `-` with space, drop non-alphanumerics, collapse spaces, spaces to `-`), `pa` lowercases for comparison. Comparison is case-insensitive. Labels come from the id (`Gie`: dashes to spaces, capitalised).

Layers (`Jie`, m@360885): each settings layer is read in order and merged with `IT` (patch merge per id; later layers override earlier ones; options merge field-wise). A legacy `run_script` string becomes task `run` with `default:true, icon:"play", available_in:"local"` (`EU`).

Files (VERIFIED m@358274, m@384708, m@400089):
- Shared, committed: `<mainWorktree>/.conductor/settings.toml` (also a legacy json). Read-only in the UI ("Shared repository settings are read-only in Conductor. Edit the settings file directly.").
- Personal, git-excluded: `<mainWorktree>/.conductor/settings.local.toml`. Conductor adds `/.conductor/*` plus `!.conductor/settings.toml` to the git exclude and symlinks `settings.local.toml` into every worktree.
- `updateTask(id, task|undefined, target, {position, replaceId})` rewrites the chosen file (`M8e`).
- "Hide" for shared actions is per user: `updateActionHidden` stores hidden ids in local storage (`Vqe` subsystem), not in the file (m@404347). `Wz(tasksById, hiddenSet)` (main, m@390216) filters `hide:true` plus locally hidden ids.

Cloud/org shared scripts (server API, m@168956, m@888982) (VERIFIED schema, INFERRED exact transport):
- Script `Fm` = `{id,name,command,args?,cwd?,icon?,availableIn?,default?}`. Resolved script adds `source:"shared"|"personal"`.
- Response `{canEditShared, shared[], personal[], hiddenSharedScriptIds[], resolved[]}`.
- Mutation union: destination `shared`|`personal` with `save{script,create}` / `delete{id}` / `set-default{id}` / `import{scripts,replace}`; destination `hidden-shared` with `set-hidden{id,hidden}`. Keyed by `{organizationId, gitRemoteUrl}`.
- Resolution `ust`: hidden shared ids removed, personal then shared, defaults fill `availableIn=["local","cloud"]`, `default=false`. The single default is the first personal default, else the first default, else the first script.
- Cloud scripts are mapped into local task shape by `kgn` with `idNamespace:"cloud:<source>"`.

Task expansion for the UI (`A3t`, m@3072841):
- A task with `availableIn` containing both `local` and `cloud` becomes two tasks with id suffix `:local` / `:cloud` (`useTargetSuffix`).
- Local workspace: only tasks with `local`; plus the legacy `run` task (unless a task already has id `run`); plus Spotlight if enabled.
- Cloud workspace: tasks with `local` or `cloud`. `local` ones get `executionTarget:"local-mirror"` (run on the synced mirror), `cloud` ones `workspace-host`.
- Default = first `default:true` task else first (`I3t`). Command = `command` plus shell-quoted `args` (`T3t`).

---

#### 5A.2 Spotlight testing

Purpose: run the workspace's code under the main repo directory (so dev servers, tools and IDE pointed at the root see the worktree's changes). It keeps the root in sync with the worktree while a process runs. VERIFIED from the bundle (m@3086900, m@3702760) and from the installed scripts (`app`: `bin/spotlighter.sh`, `bin/checkpointer.sh`, `bin/git-busy-check.sh`).

##### 5A.2.1 Gating
- Setting `spotlight_testing` (repo-level bool, file key `spotlight_testing`, DB column `repos.spotlight_testing`). Effective value must be `"true"`.
- And `IRi()`: the user has no organization, or an organization of type local (r@4629797). So Spotlight is hidden for org/cloud users.
- Local workspaces only: `Ne.getWorkspace(...).host !== F` gives "Spotlight is only available for local workspaces". `local-mirror` target is refused.
- When enabled, a synthetic task `{id:"spotlight", label:"Spotlight", icon:"lamp-desk", kind:"spotlight", availableIn:["local"]}` is appended (m@3072000).

##### 5A.2.2 Start sequence (`private_prepareSpotlightStart`, m@3087600)
1. If a leftover checkpoint ref `refs/conductor-checkpoints/pre-spotlight` exists in the repo root (`KZt`), restore it (`cte`) and delete the ref (`lte`). This is the crash/quit recovery path.
2. Preflight on the root (`GZt`): not mid-merge (`MERGE_HEAD`), not mid-rebase (`rebase-merge|rebase-apply`), and on a branch (`branch --show-current` non-empty). Errors tell the user to run `git merge --abort`, `git rebase --abort`, or check out a branch in the root. The UI offers "Open terminal" for errors containing "root repository".
3. Save the root: `cd <root> && checkpointer.sh save --id pre-spotlight --force` (`jZt`).
4. Returns the command to run in the workspace PTY:
   `CONDUCTOR_INT_CHECKPOINTER_PATH="<AppData/bin/checkpointer.sh>" CONDUCTOR_INT_WATCHEXEC_PATH="<AppData/bin>/watchexec" bash "<AppData/bin>/spotlighter.sh"`.
5. Runs as a normal action process (kind `run`, `isSpotlight:true`) with `cwd` = the worktree and env `CONDUCTOR_ROOT_PATH` = repo root.

##### 5A.2.3 The sync loop (`spotlighter.sh`, app, 111 lines)
- Logs to `/tmp/conductor-spotlight-$$.log` (tee).
- Checkpoint id `cp-spotlight-<epoch>-<pid>`.
- `watchexec --quiet --color=never --shell=none --watch . --project-origin . --emit-events-to=environment --ignore '*.tmp.*' --ignore '.context/**' -- bash -c <runner>`. watchexec runs one job at a time and queues the latest event.
- Runner: print which paths triggered it (`WATCHEXEC_*_PATH`), then in the worktree `checkpointer.sh save --id <id> --force`. Exit 101 (merge/rebase in progress) is skipped. Then `cd $CONDUCTOR_ROOT_PATH && checkpointer.sh restore <id>`. Failures are warnings, never crash.

##### 5A.2.4 Checkpointer (`checkpointer.sh`, app, 323 lines)
- `save`: refuses mid-merge/rebase/cherry-pick/revert/conflicted squash (exit 101, via `git-busy-check.sh`), unmerged index (102), repo root that is an ancestor of cwd (103). Builds a temp index under `<gitdir>/conductor-checkpoint-tmp/` (stale ones pruned after 60 min when the owner pid is dead), `read-tree <index tree>`, `add -A`, `write-tree`. Creates a commit with `commit-tree` (identity "Checkpointer"), message lines `checkpoint:<id>`, `head <oid>`, `index-tree <oid>`, `worktree-tree <oid>`, `created <iso>`. Writes ref `refs/conductor-checkpoints/<id>`. No HEAD move, no file change.
- `restore <id>` (run in the ROOT):
  - `git reset -q --mixed <saved head>` only if HEAD differs or merge state exists. This moves the root's current branch to the worktree's HEAD commit.
  - `read-tree --reset <head>`, `add -A`, `read-tree --reset -u <worktree-tree>`, `git clean -fd` (ignored files kept), `read-tree --reset <index-tree>`, `update-index --refresh`.
  - Designed so a repeat restore of an identical tree rewrites nothing, to avoid waking file watchers.
- `diff <a> <b|current>` compares snapshots (used elsewhere for checkpoints/turn diffs).

##### 5A.2.5 Stop and restore
- `killProcess` for a Spotlight process: `ln.kill`, 20 s watchdog, then `cte(root)` (restore `pre-spotlight`) and, on success, `lte(root)` (delete the ref). A failed restore only logs "Failed to restore pre-spotlight state" and leaves the ref for next-start recovery.
- App quit: `killAllProcesses` does not restore. Recovery happens at the next Spotlight start (step 1 above).
- Side effect worth knowing: because `restore` resets the root's branch tip, a Spotlight session rewrites the root's branch ref to the worktree commit until stopped. The objects are shared, so nothing is lost.

##### 5A.2.6 State fields and neighbours
- No separate store. Spotlight state is `processes[...].isSpotlight`, `mainWorktreePath`, `retainedRunMetadata.isSpotlight`.
- Agent output source `spotlight` in `getTerminalOutput`.
- Unused (INFERRED): zod types `spotlightSyncRequest {checkpointId}` and response `{synced, remoteRoot, remoteBranch, remoteHead, pushedRef, pushedOid, remoteStatus, checkpointTree, patchBase64} | {skipped, reason: merge-rebase-in-progress|checkpoint-save-failed}` (m@1198822) exist but are not assigned to a name. They look like an unfinished remote Spotlight over Roundhouse.

---

#### 5A.3 Port allocation and port forwarding

##### 5A.3.1 `CONDUCTOR_PORT` allocation (VERIFIED m@2973650)
- Store: zustand `r6` (injected into services as `usePortAllocationStore`). State `{allocations: Map<string,number>, highestPort}`; no persistence.
- `highestPort` starts at `55000 - 10`. `getPorts(repoId, workspaceId)` returns the cached port for key `"<repoId>:<workspaceId.localId>"`, or allocates `highestPort + 10`. So the first workspace gets 55000, the next 55010, and so on. Each workspace owns a block of 10 ports (`CONDUCTOR_PORT` .. `+9`).
- No availability check, no upper bound, no DB. After an app restart the map is empty, so a workspace gets a port based on the order of first request, not a stable number.
- Used for setup (`Rde`), actions (`GBt`), archive, and cloud setup (m@1112722 reads it too). Cloud env builder `Tre` omits the port.
- Docs prompt text tells agents to use `CONDUCTOR_PORT` in `scripts.run` (m@3141896).

##### 5A.3.2 Localhost URL detection (local run output) and listening ports
- Output regex (1.3) sets `process.localhostUrl`. `mgn` parses a URL into `{url, port, displayPort}`, `ggn` maps a remote URL to `http://localhost:<localPort>`.
- Sidecar request `listLocalhostPorts {workspacePath, rootProcessId?}` (m@3117070, s@12358854): scans listening TCP ports of processes in the workspace (or the process tree under `rootProcessId`) and returns `{ports[], processes[{port,pid,parentPid,command,executablePath,appName}], applications[]}` with macOS app info and icons. 10 s timeout. VERIFIED request/response; scan method (lsof-like) INFERRED.

##### 5A.3.3 Port forwarding for cloud workspaces (VERIFIED, m@3719195 to m@3875500)

Tables (DB migration in binary, `bin`): `port_forwards(id, workspace_id, remote_port, local_port, protocol 'tcp', label, enabled 1, created_at, auto_detected 0)`. Unique indexes: `id`, `(workspace_id, remote_port)`, and `local_port` globally. So each local port is owned by one forward on the whole machine.
Related `workspaces` columns: `port_forwarding_enabled`, `auto_forward_enabled`, `hosting_server_url`, `permission_level` (`write`/`read`), `organization_id`, `state`.

Org-scoped settings (server `getScopeSetting` with scope `org-personal`; keys at m@1093500):

| Key | Meaning | Default |
|---|---|---|
| `port_forwarding_strategy` | `match` (use same local port as remote if free and >= 1024) or `range` (always pick from range) | `match` |
| `local_port_range` | `{start,end}`, 1024..65535 | 20000..29999 |
| `port_mappings` | explicit `{remotePort,localPort}` overrides, unique both ways, remote 22 not allowed | `[]` |
| `exclusive_port_forwarding_enabled` | only one workspace per org+server may forward at a time | false |

Allocation algorithm (`vin`, `_in`, `IEe`, `TH`):
1. Pinned mapping for the remote port wins; if the local port is busy it errors ("Local port X is mapped to remote port Y but is already in use").
2. Else if strategy is `match` and remote port >= 1024 and not a mapped local port and bindable: use the remote port. If another forward holds it but that forward is disabled auto-detected or belongs to a workspace with forwarding off, it is moved (`WB`).
3. Else `find_available_local_port{preferredPort, excludedPorts, rangeStart, rangeSize}` (Rust). The preferred start is `range.start + hash(workspaceLocalId) % rangeSize`, where hash is `h=5381; h = h*33 ^ c` (djb2 xor). Excluded set = all `local_port`s in the table plus mapped ports.
4. All allocation runs under named serial queues: `port-forwards:allocation` (global) and `port-forwards:workspace:<id>` (per workspace), plus `port-forwards:transition` for toggles (`oo({key,...})`).
5. On "Failed to bind port" it retries up to 5 times (`Bte`), 3 fast retries (200 ms) for auto-detected forwards that matched the remote port, and reassigns a new local port (`_in`) and regenerates the SSH config if it was the SSH forward.

Tunnel start (Rust commands): `start_port_forward {forwardId, localWorkspaceId, localPort, remotePort, sandboxUrl}`, `stop_port_forward {forwardId}`, `list_port_forwards`, `find_available_local_port`. Tauri event `port-forward-event {forwardId, kind: error|stopped|...}` (logged; also triggers SSH keepalive updates `Ern`).

Token handshake (m@3869780, event `port-forward-token-request {requestId, forwardId}`):
1. JS loads the forward from the DB (`ob`), the workspace's hosting URL (`YR`), checks write permission (else "Missing write access to workspace").
2. For remote port 22 (SSH): waits for the sandbox state `running` (`/workspaces/<serverId>/state`, calls `keepAliveWorkspace` once, polls every 2 s), then authorizes the local SSH public key (`authorizeWorkspaceSshPublicKey`, cached 10 minutes per workspace+sandbox+key).
3. `POST /workspaces/<serverId>/ws-token {scopes?, refreshPublicUrl}`; scopes are `["ssh:connect"]` only for port 22. Returns `{token, endpoint}`. The sandbox URL for Rust is the endpoint rewritten to ws(s).
4. Answers Rust with `resolve_port_forward_token {requestId, token}` or `reject_port_forward_token {requestId}`.

SSH forwards: remote port 22 is reserved, label "SSH", auto-created per cloud workspace (`Zin`). JS regenerates an SSH config (`SH`/`Sv`: files `conductor_config` and `conductor_config.d`, host names `<directory-or-branch>.conductor`, `ssh <name>.conductor`, KEX `sntrup761x25519-sha512@openssh.com`) from the SQL join of `port_forwards` and `workspaces`. Active SSH forwards ping `keepAliveWorkspace` on a timer so the sandbox does not sleep. Exact config file location INFERRED (probably `~/.ssh`).

Discovery of remote listening ports (m@3719195 to m@3724000):
- Multiplexed WebSocket `…/direct/mws` (token scopes `terminal:connect`, `terminal:write`; class `xC`), topic `port-forwards:changed`. Payload `{ports[<=32], processes[{port, command[<=16 args, <=200 chars each]}]}`, validated and de-duplicated (`Aen`).
- Process commands are summarised to a friendly name (`G_n`: node/bun/python scripts, `node_modules/.bin/<tool>`).
- Snapshot stored in TanStack Query key `["port-forward-discovered", localId]` and a plain map. Max 4 concurrent discovery subscriptions (`$en=4`).
- `RH({workspaceId, ports})` reconciles: only if `port_forwarding_enabled` and `auto_forward_enabled`. Missing ports: stop + delete auto-detected forward. New ports: create a forward `autoDetected:true` and start it. Disabled-by-user auto forwards stay disabled (`xbn` sets `enabled=0` rather than delete).
- User toggles: `Oin` (forwarding on/off, honouring exclusive mode which first turns off every other forwarding workspace of the same org+server), `Sbn` (auto-forward on/off). Cleanup on archive: `Jin`, `Pbn` at startup (`e1` deletes orphan rows, `fin` deletes rows of archived workspaces).
- Archived workspaces, and workspaces that became read-only for this user, have their forwards stopped (`xEe`, `PEe`).

---

#### 5A.4 Terminals

##### 5A.4.1 Layers (all VERIFIED unless marked)

| Layer | Name / alias | Offset | Role |
|---|---|---|---|
| Runtime singleton | `TerminalRuntime` (`zNt`), instance `ln` (renderApp `Ul`) | m@2930000, m@2983000 | owns sessions, persistence, events |
| Session controller | `TerminalSessionController` (`VJ`) | m@2910260 | one per session: state machine, screen state, transcript, command tracking, cold restore |
| Backend choice | `UBt` | m@2983100 | `metadata.hostingServerUrl` set gives cloud backend, else Tauri backend |
| Local PTY transport | `TauriPtyTransport` (`ADt`/`IDt`) | m@2705212 | Rust `pty_*` commands and events |
| Cloud PTY transport | multiplexed PTY (`A2t`/`k2t`) | m@2951900 | JSON-RPC over `/direct/mws` plus a local Rust mirror |
| Environment provider | `BBt` (`resolveLaunch`) | m@2978900 | picks shell, args, env, writes direct scripts |
| History store | `TerminalHistoryStore` (`HNt`) + persistence coordinator (`pye`) | m@2925075 | write-behind store of screen snapshots |
| History backend | `ConductorTerminalHistoryStoreBackend` (`X2t`) | m@2970836 | SQLite table + encrypted file entries |
| Headless screen | `Tw` in main (`TerminalScreenState`) | m@2900812 | headless xterm + SerializeAddon + Unicode 11, JS fallback |
| UI terminal | xterm.js in renderApp | r@4364004 | what the user sees |
| UI stores | `vs` (right panel), `Si` (main panel), facades `Va`, `hu` | m@2956970, m@2960642 | tabs, ids, persistence of tab lists |

Note on `Tw`: in renderApp `Tw` is an unrelated logging no-op (r@12057567). The terminal "Tw" is only in main.

##### 5A.4.2 Session launch request (what callers pass to `createSession`)
- `id`, `kind`: `interactive` | `setup` | `run`.
- `cwd`, `cols`, `rows`.
- `execution`: `{mode:"interactive_bootstrap", bootstrapCommand?}` or `{mode:"direct_script", script}`.
- `envMode`: `user-shell` or `controlled`. `envOverlay` map.
- `persistence`: `none` or `warm_and_cold`. In the code only `interactive` terminals use `warm_and_cold` (others use `none`). The `capabilities.persistence` flag is `persistence !== "none"`.
- `metadata`: `workspaceId`, `terminalId`, `title`, `hostingServerUrl`, `localDirectScript`, `allowColdRestore`, `commandDetection`.

Callers (renderApp): workspace terminal tab (`warm_and_cold`, `allowColdRestore` from tab restore flag, r@11685398), one-shot embedded terminals such as a "Database rollback" console and command runner cards (`persistence:"none"`, `allowColdRestore:false`, r@9275293, r@12038812). Setup and run use direct scripts (section 1).

##### 5A.4.3 `resolveLaunch` (m@2978900)
- Shell: direct script runs `/bin/zsh` (mac) or `/bin/bash` (linux and every cloud host). Interactive uses the user's shell from `get_user_shell` (Tauri command, cached forever as query `["userShell"]`, fallback `/bin/zsh` or `/bin/bash`).
- Args: direct script is `[scriptPath]` (local) or `["-l", scriptPath]` (cloud). Interactive is `["-l"]` (`["-i"]` on linux local). `controlled` env mode uses no args.
- Env order: captured login-shell env (only for direct scripts, `i6`, see section 8) then `TERM=xterm-256color`, `COLORTERM=truecolor`, `SHELL`, `LANG=<locale>.UTF-8`, `PWD`, then mac-interactive `PATH=""` (so the login shell rebuilds PATH from scratch), zsh `DISABLE_AUTO_UPDATE=true`, then the caller's `envOverlay`.
- Direct script file: `~/.conductor/projects/<workspace path with "/" replaced by "--">/setup-<sessionId>.sh` or `run-<sessionId>.sh` (local), or `/tmp/conductor/projects/<same>/` on cloud hosts. Written with `writeTextFile`, deleted by `cleanupDirectScript` when the session reaches `disposed`, `exited` or `spawn_error`.
- Interactive overlay built by `idi/Jtl` in renderApp: Conductor env (`k$e`), shared env vars, shell-integration overlay `IVt` (OSC 633 command detection; sets `commandDetection` metadata), and `CONDUCTOR_PATH_PREFIX` from `Mzi` (PATH shim dir for the `claude_executable_path` / `codex_executable_path` overrides, via Tauri `sync_agent_path_overrides`; see 8.3).

##### 5A.4.4 Local PTY transport (`TauriPtyTransport`, m@2705212)
- Pre-checks cwd with `plugin:fs|stat` ("Terminal working directory is unavailable/not a directory").
- `pty_spawn {id, terminalId, options:{shell, args, cols, rows, cwd, env, enableFlowControl:true, maxBufferedBytes}}`.
- Events (zod validated): `pty-ready {id,pid}`, `pty-data {id, data(base64), byteLength}`, `pty-exit {id, exitCode, signal?}`. Data is base64 decoded with a streaming `TextDecoder`.
- Commands: `pty_write {id,data}`, `pty_resize`, `pty_kill`, `pty_ack_bytes {id,byteCount}`, `pty_screen_snapshot`, `pty_screen_text {id,maxLines}`, `pty_write_mirror`, `pty_persist_terminal_history {id, localWorkspaceId, sessionId, startedAt, endedAt, hasReceivedUserInput}`. Also `pty_create_mirror`, `pty_resize_mirror`, `pty_delete_mirror`, `pty_load_terminal_history {sessionId}`.
- Flow control: the UI acks consumed bytes in batches of 5000 (`ByteCountAckSize`, microtask-coalesced, `RDt`). The Rust side pauses reads when too many bytes are unacked.
- Rust crates present (`bin`): `portable-pty` 0.9, `alacritty_terminal` 0.26, `vte`. INFERRED: PTY via portable-pty, screen mirror via alacritty_terminal.

##### 5A.4.5 Cloud transport and screen mirror (m@2951900)
- `A2t.createSession` requires `workspaceId` and `hostingServerUrl`; read-only workspaces fail with "Terminal unavailable in read-only workspaces". Requests use a multiplexed client (`JJ`) with JSON-RPC methods `pty.create`, `pty.write`, `pty.resize`, `pty.kill`, `pty.ack`, plus event subscription.
- Writes are queued and flushed in chunks (`ZJ`). Kill is retried (`fE` attempts, delay `b2t`).
- Reconnect loop: new `ptyId` each attempt, backoff `2000 * 1.5^(n-1)` ms capped at 30 s, emits "--- Sandbox reconnected ---"; output during reconnect is buffered.
- Local mirror (`GNt`): remote output is also written to a Rust-side mirror (`pty_create_mirror`, `pty_write_mirror`, `pty_resize_mirror`, `pty_delete_mirror`) so `getScreenSnapshot`, `getScreenText` and history persistence work the same as for local PTYs.

##### 5A.4.6 Session controller (`VJ`, m@2910260 to m@2925000)
- `snapshot` fields: `id`, `kind`, `connectionState` (`launching` | `running` | `exited` | `disposed` | `spawn_error`), `restoreState` (`none` | `cold_restored`; the renderer also uses `restoring`), `hasReceivedUserInput`, `cwd`, `title`, `isInputEnabled`, `canStartShell`, `capabilities {replay, flowControl, persistence, cwdTracking, commandDetection}`, `pid`, `error`, `exitCode`, `exitReason`, `runningProgram`, `completedCommandMarkerId`.
- Pieces: transcript (full text, stats), JS screen state (`Tw`), replay recorder (`BNt`), data batcher (`wLt`), ack buffer, optimistic input, command tracking via OSC 633 markers (active and completed commands, with a warning "Shell integration enabled but no OSC 633 prompt marker observed after N bytes ..."), queue of controller tasks.
- Engine modes: the runtime always builds controllers with `engineMode:true`. A controller sets `engineActive = engineMode && backend has getScreenText && getScreenSnapshot`. When active, the Rust mirror is the source of truth for text/snapshots (`xDt` prefers `backend.getScreenText`), UI-only writes go to `writeMirror`, and `kind:"run"` is excluded from mirror writes. Otherwise the headless JS xterm and the transcript are used.
- Restart: `restartInteractiveShell` re-spawns after a divider line; text constants: "--- Previous terminal session restored. Starting new shell... ---", "--- Shell exited with status N. ---", "--- Connection to workspace lost. The process may still be running. ---".
- Cold restore auto-restart: first time a `cold_restored` interactive session is shown, `maybeAutoRestart` starts a fresh shell once (`hasAutoRestarted`).
- Alternate-screen handling: sequences `?1049h/l`, `?47h/l` are tracked (`isInAlternateScreenBuffer`).

##### 5A.4.7 History persistence and cold restore (VERIFIED)
- Eligible: `kind==="interactive"`, `persistence==="warm_and_cold"`, `metadata.workspaceId` set.
- Trigger: after every change or data event, `schedulePersistence` debounces with `requestIdleCallback` (timeout 1000 ms). On `exited` it flushes immediately with `markEnded`.
- `persistSession`: first tries the backend (Rust) `persistBackendTerminalHistory` (command `pty_persist_terminal_history`); returns "backend". Else if the transcript has persistable activity it takes `getScreenSnapshot` and saves it to the client history store ("client"). Sessions with no activity clear their record.
- Record shape: `{sessionId, localWorkspaceId, startedAt, endedAt?, hasReceivedUserInput?, snapshot:{snapshotAnsi, rehydrateSequences, cwd?, cols, rows, modes:{alternateScreen, bracketedPaste}}, text?}`. `text` is hydrated lazily from the snapshot on idle.
- Storage (`X2t`): SQLite `terminal_sessions(session_id PK, workspace_id, started_at, ended_at, cwd, cols, rows, rehydrate_sequences, alternate_screen, bracketed_paste, has_received_user_input)` plus the ANSI text as an encrypted entry file in subsystem `terminal-history` (limit 50 MB, `entryStorage:"entryFile"`, `protection:"encrypted"`) through the local-storage service `ds()`. On disk: `AppData/local-storage.entries/terminal-history` (app, name only). Startup cleanup removes entries with no DB row.
- Size cap per record: `getMaxPersistedSessionBytes` = the scrollback limit; the oldest lines are trimmed to fit (`WNt`). Default fallback constant 100 KiB.
- Cold restore: at `createSession`, `getColdRestoreRecord` requires interactive + `warm_and_cold` + `metadata.allowColdRestore===true`, flushes the store, loads the record, then `restoreFromHistory` replays the snapshot and sets `restoreState:"cold_restored"` and `isInputEnabled:false` until the shell is restarted. `clear` and `clearWorkspace` delete records.
- Handoff session: if the workspace cwd changes and the user never typed, the UI creates `<id>:handoff` in the new cwd, swaps it in and destroys the old one (r@11686600, helper `aR`). INFERRED purpose: change-root-path.

##### 5A.4.8 Scrollback limit (m@2971788, VERIFIED)
- Setting `terminal_scrollback_limit_bytes`. Default 10,000,000 bytes (10 MB), clamp 1e6 to 1e9. Legacy `terminal_max_buffered_lines` converts at 80*64 = 5120 bytes per line.
- It feeds three things: PTY `maxBufferedBytes`, xterm `scrollback` lines = `floor(bytes / 160)`, and the per-record persistence cap.

##### 5A.4.9 Kinds of terminals as the user meets them

| Terminal | Store | Runtime kind | Persistence |
|---|---|---|---|
| Setup tab | `bd.SETUP="setup"` virtual tab | `setup` | none |
| Run tab | `bd.RUN="run"` virtual tab | `run` | none |
| Ports tab | `bd.PORTS="ports"` | n/a | n/a |
| Workspace terminal tabs (right panel) | `vs` (persist key `terminal-panel-tabs-v1`, subsystem `terminal`, 100 MB) | `interactive` | `warm_and_cold` |
| Main-panel terminals | `Si` (persist key `main-tabs-v2`) | `interactive` | `warm_and_cold` |
| Repo terminal | `vs.repoTerminalId: Map<repoId,id>`, created lazily; Spotlight opens it; a destroyed one is re-created with a new id | `interactive` | `warm_and_cold` |
| Move between panels | `ngn`, `sgn` adopt/destroy | | |

`vs` state: `terminals`, `workspaceTerminals: Map<ws,id[]>`, `activeTabPerWorkspace`, `repoTerminalId`, `lastTabKind` (default `"spotlight"`; run/ports map to different kinds). Terminals are created with an optional `startingCommand` (+ `startingCommandRan`) which becomes the `bootstrapCommand`.

##### 5A.4.10 Renderer (renderApp, r@4364004)
- xterm.js `Terminal` with `convertEol`, blinking block cursor (outline when inactive), `lineHeight 1.2`, `allowProposedApi`, Unicode 11 addon, serialize-style addon, link addon: Cmd-click opens a link only after a confirm dialog "Open this terminal link?"; `allowNonHttpProtocols:false`. No WebGL addon was found in the bundle (INFERRED: DOM renderer). Terminals are pooled per terminal key (`LJs.register`). Custom key handler maps shortcuts (`terminal.moveLineStart/End`, `moveWordLeft/Right`). Copy handler normalises selection text.

---

#### 5A.5 File tree and search

##### 5A.5.1 Transport pattern (`bp`, m@2087766)
Every file operation takes `{target:{workspacePath, host}}`. Local host (`F`) runs the Tauri command in-process. A cloud host sends `POST <endpoint>/files/<route>` with scope `files:read` (writes use `files:write`), body path rewritten to workspace-relative (`yTt`), with request dedupe `in-flight`. Missing routes return 404 which becomes `RemoteWorkspaceRouteUnsupportedError` ("The cloud workspace does not support files/<route> yet"). Paths outside the workspace throw "Can only access files inside the workspace".

| Feature | Local Tauri command | Cloud route |
|---|---|---|
| Directory listing | `list_file_tree {directoryPath, standardFilters, maxDepth}` | `files/list` |
| Fuzzy file search | `fuzzy_filter_files {query, workspacePath, excludeDirectories}` | `files/search` |
| Content search | `grep_workspace {query, workspacePath, isRegex, caseSensitive, wholeWord}` returns `{matches, truncated, files_searched}` | `files/grep` |
| Artifacts (`.context` files) | `list_workspace_artifacts {exclusions, workspacePath, cursor}` | `files/artifacts` (falls back to a node script on the VM that walks `.context` with `node-ignore`, `wIt`) |
| Bounded read | n/a | `files/read-text-bounded {path,maxBytes,prefix}` |
| Read / stat / write | `plugin:fs` plus `get_file_metadata`, `write_file_async` | `files/read`, `read-text`, `stat`, `write-text`, `write-stream` |

Related: `fuzzy_match_files {query, files, excludeDirectories}` ranks an already listed tree (used by the shell/agent `fileSearch` adapter, m@3905205). Min grep query length 2 (`pTt`). Bad regex errors start with "Invalid pattern: " and map to `WorkspaceGrepPatternError`.

##### 5A.5.2 Rust side (`bin`, INFERRED from crates)
`ignore` 0.4.25 (gitignore-aware walker, `standardFilters:true` presumably enables `.gitignore`, `.ignore`, hidden filtering), `nucleo-matcher` 0.3.1 (fuzzy scoring), `grep-regex` / `grep-searcher` / `grep-matcher` (ripgrep core, for `grep_workspace`), `globset`, `walkdir`, `notify` 7 and 8 plus `notify-debouncer-full` (watching). The Rust arg schema `standardFilters` and the `ignore` use are not visible in JS. No offsets, crate presence only.

##### 5A.5.3 UI queries (TanStack Query, key factory `du`, m@2087900)
- Workspace tree: `["workspace-files", localId, path, host]`, `list` depth 1, `staleTime 15 s`, `refetchInterval 30 s`, background polling off. So the file tree is polled, not watched.
- Fuzzy search key `["fuzzy-file-search", {id,path,host}, query, opts]`, `staleTime` 0 for local, 15 s for cloud. Grep key `["workspace-grep", ...]`, stale 15 s, `retry:false`.
- Git-side helpers: sparse checkout directories (`ls-tree -d --name-only HEAD`, `sparse-checkout list/set/disable`), `config pull.rebase`, `core.sparseCheckout`.

##### 5A.5.4 Watching (`fs.watch`, m@3893898, VERIFIED)
- Local: `plugin:fs|watch {paths, options:{recursive:false, delayMs:2000}, onEvent}` (`nke`, debounced) or `delayMs:null` (`Nbn`, immediate); returns an unwatch function.
- Cloud: a no-op that logs "Remote workspace file watching is not supported".
- CEF runtime (`is_cef_runtime` command): both watchers are replaced by a no-op. So under CEF no file watching happens in the UI layer.
- Consumers found: the user-level `~/conductor.json` (invalidates the settings query) and `.conductor` settings files. The worktree itself is not watched from JS.
- Cloud changes arrive differently: the `file-sync:changed` topic on the `/direct/mws` socket (below), and polling (5.3).

##### 5A.5.5 Workspace mirror and remote file sync (cloud)
- Workspace mirror (m@2077473): server snapshot `GET getWorkspaceMirror(workspaceId)` returns `{captureId, completedAt, coverage{filesComplete}, files[], assets[{assetId,path,sha256,contentMd5,contentType,byteLength,tracked}], delta{baseline{remoteUrl,commit}, patchAssetId}, changes{full{files[]}}, git{repositoryRoot, workspaceRoot}}`. Used to list files and render diffs while the VM is stopped (`tTt`: remote status not `running` or not known to Roundhouse). File content over `td`/`cg` size limits is hidden with reason `FileTooLarge`; other hide reasons: `NoChanges`, `FetchError`.
- Remote file sync (`remote-workspace-file-sync*`, m@3040000 to m@3070000): zustand store `jt` `{statuses, engaged, syncRequestedByLocalUse, cleanupTargets}`. Statuses `idle | syncing | synced | failed`. Rust commands `start_remote_file_sync`, `stop_remote_file_sync`, `trigger_remote_file_sync`, `cleanup_remote_file_sync`, `set_remote_file_sync_foreground`, events `remote-file-sync-status`, `remote-file-sync-direct-info-request`. Direction `bidirectional | localToRemote`. Local trigger loop every 5 s plus push signal `file-sync:changed`. Mirror folder `<mirrors dir>/<repo>/<localId>` with a `.sync` metadata folder and friendly symlink aliases (`ln -s`). Stopped VMs: the snapshot patch (max 64 MiB) is applied with `git worktree add --detach` + `git apply --binary` at ref `refs/conductor-remote-sync/<id>/head` ("materialize"). Used by `local-mirror` actions (1.6) and local terminals on cloud workspaces.
- Files to copy: `.worktreeinclude` (gitignore syntax) in the repo root plus setting `file_include_globs`. Ignored files are listed with `git ls-files --others --ignored --exclude-standard --directory --full-name`, filtered by a JS `ignore` engine (`node-ignore` is bundled, m@2047000), default pattern `.env*`, size cap 256 KiB (`fte`). m@3729312.

---

#### 5A.6 Attachments

##### 5A.6.1 Kinds and classification
- Types: `image`, `pdf`, `text`, `review` (diff comment), `file` (m@2000500 schema). `Jfe(name)` classifies by extension: image (`png jpg jpeg gif webp tif tiff avif bmp`), `pdf`, `text` (about 60 code/config/text extensions, list `aAt`), else `file`.
- Composer paste rule (r@9065962): text over 90 lines or 5000 characters becomes a `pasted_text_<ts>.txt` attachment.
- Image processing (`JRt`, m@2436000): max pixel dimension 7800 and max size 4.5 MiB (`VRt`). If larger it rescales (canvas) and re-encodes JPEG at quality 0.85, then 0.7. Local file path variant is done in Rust via `materialize_local_path_attachment {sourcePath, destinationPath, resizeImage?}`.

##### 5A.6.2 Local pipeline
1. Draft: bytes or a picked file are written to a staging dir `AppData/draft-attachments/<workspaceLocalId>/<6-char-id>/<name>` (`pge`, `fge`; dir exists in app). Row inserted into `attachments(id, type, original_name, path, is_loading, is_draft=1, session_id, session_message_id, comment_id, created_at)`.
2. Send (`materializeDraftAttachments`, m@2441400): waits until the workspace is initialised, resolves the workspace path (local or remote base dir), copies each staged file to `<workspace>/.context/attachments/<id>/<name>` (`materializeLocalPathAttachment`, `pme`; for a remote host Rust streams to `files/write-stream` with `remoteUpload`), then removes the staging dir. Upload tracking per key `workspace:<localId>:<relativePath>` (`NC`).
3. Message commit flips `is_draft=0` and sets `session_message_id`. The agent gets the file by path mention (`attachment:` prefix, `@⟦name⟧(path)` token regex `vu()` m@1188000).
4. Sweep: staging dirs older than 720 h (30 days) are removed (`s1t`, `n1t`).
5. Preview: text read as UTF-8, image as data URL (MIME from extension, default png), pdf as base64 (`Rfn`).
6. Excluded from "artifacts" listing: `.context/todos.md`, `.context/conductor`, `.context/pull-requests`, `.context/attachments/comments`, plus names like `PR instructions.md`, `Review request.md`, `Fix errors instructions.md`, `[GITHUB]-N.md`, `[LINEAR]-X-N.md`, `terminal-output-*.txt` (m@2044896).

##### 5A.6.3 Cloud pipeline (`fAt`, m@1998364, VERIFIED)
- Draft keeps bytes in the local staging dir and a DB row. Statuses `staged | uploading | uploaded | failed`.
- Upload: `POST /workspaces/<wsServerId>/sessions/<sid>/attachments {attachmentId, originalName, byteSize, contentType}` returns `{attachment{id,originalName,path}, upload:{url, headers}}`. Roundhouse must return the same path the client planned or the upload throws. The upload is a PUT to the presigned URL through Tauri `native_http_upload_file {url, method, headers, path, proxyUrl, uploadId}` (streams from disk, progress channel, cancel via `native_http_upload_cancel`). A failure with an expired URL is retried through `POST …/attachments/<id>/upload-url`.
- Download: `GET …/attachments/<id>/download-url` then fetch. Verify existing: HEAD-like call, 404 means missing. Clone to another session: `POST …/attachments/clone {attachmentIds, sourceSessionId}`. Delete: `POST …/attachments/<id>/delete`.
- Ids tie to the server through `identity_associations` (`associate({withServerId})`).
- Outbox tables `session_assets_outbox` (joined with `attachments.comment_id`) hold retry state (INFERRED from SQL, m@1218314).
- Composer drafts are persisted in local storage subsystem `composer-drafts`; size limit constant 5 MiB (`vAt`).

##### 5A.6.4 Review-comment attachments (VERIFIED m@2098238)
- A diff comment added to chat is written as a file `.context/attachments/comments/<encodeURIComponent(commentId)>.md` in the workspace (local or remote host) by `BTt`. Mention path = `dC(id)`. Content from `Che(comment)`:
  - lines: `GitHub review comment ID: <id>` or `Conductor local comment ID: <id>`, `File:`, `Lines: a-b`, location text ("left on the base branch", "...modified branch", "...on a file", "...on the pull request itself"), origin ("left on GitHub by @author", "left locally by <model>", "created locally in Conductor by the user"), thread info, `Remote URL:`, `Outdated: yes|no`, `Resolved: yes|no`.
  - then `## Comment` and the body.
- Writes are serialised per mention key (`GS` promise chain) and tracked by `beginAttachmentUpload`. `waitForMessageAttachmentUploadsDone` blocks the send until the comment files exist; failure throws `AttachmentUploadFailedError("Attachment upload failed for: ...")` and the comment is removed from the composer with a toast.
- Edits after commit rewrite the file (`refreshCommittedCommentAttachments`).

---

#### 5A.7 Diff comments

##### 5A.7.1 Store (VERIFIED, class `aIt`, m@2027404; singleton `Sr`)
Plain vanilla store (not zustand middleware): state `{isLoading:true, error, commentsById: Record, commentsByWorkspace: Map<WorkspaceId, Comment[]>}`. `start()` hydrates once with `SELECT * FROM diff_comments ORDER BY workspace_id, created_at`. Every mutation hits SQLite first, then re-reads the workspace rows (`refreshWorkspaceComments`). `pendingCreates` serialises anchor updates after inserts.

Table `diff_comments` (migration in `bin`, plus columns used in SQL): `id PK, workspace_id, file_path, line_number, end_line_number, body, state, location, created_at, updated_at, remote_url, author, author_avatar_url, thread_id, reply_to_comment_id, is_outdated, is_resolved, suggestion_base_code, edited_at`. Index by workspace.

Comment fields: `id, workspaceId, filePath?, lineNumber?, endLineNumber?, body, state, location (original|modified|file), createdAt, updatedAt?, remoteUrl?, author?, authorAvatarUrl?, threadId?, replyToCommentId?, isOutdated?, isResolved?, suggestionBaseCode?, editedAt?`.

States and meaning:

| State | Meaning |
|---|---|
| `draft` | being typed in the diff UI (`persistDraftBody` only writes while still `draft`) |
| `pending` | saved, visible in the diff panel, not in chat |
| `ready_for_review` | added to chat/composer (`addCommentToChat`) |
| `reviewed` | the message carrying it was sent (set in SQL when a message with a comment attachment or mention commits, m@1871203) |
| `hidden` | dismissed by user (`hideComment`; `unhideComment` returns it to `pending`) |
| `superseded` | frozen, never updated or deleted (`supersedeWorkspaceComments`; no caller found under that name, INFERRED unwired or aliased) |
| NULL | legacy rows |

Methods: `getComment`, `getWorkspaceComments`, `upsertComments`, `createComment`, `deleteMissingGithubComments`, `updateCommentText`, `updateCommentAnchors` (line numbers follow edits), `updateCommentState`, `markCommentReadyForReview` (also resets `created_at`), `markReadyCommentsReviewed`, `addAllGithubCommentsToChat` (pending, not outdated, not resolved), `removeCommentFromChat`, `markGithubThreadResolved`, `deleteComment`, `hideComment`, `unhideComment`.

`upsertComments` rules (merge with GitHub or agent input):
- New id: `INSERT OR IGNORE`, fall back to an UPDATE with a change-detect `WHERE`.
- Existing `superseded`: skipped. Existing `hidden`/`reviewed`: skipped, except a remote comment whose body changed upstream is resurfaced to `pending` (`resurfaceEditedGithubComment`, body must still equal the old body).
- Otherwise updates body, anchors, location, avatar, outdated/resolved, suggestion base code, edited time, only for rows not in `hidden|reviewed|superseded`. A body or anchor change triggers `refreshCommittedCommentAttachments` (rewrites the `.md`).

##### 5A.7.2 Agents read and write via MCP (VERIFIED m@3102374, sidecar `Fa/oh` request names)
These are sidecar-to-frontend JSON-RPC requests, exposed to the agent as Conductor MCP tools `GetDiffComments` and `DiffComment` (tool cards `get-diff-comments`, `diff-comment`):
- `getDiffComments {sessionId, file?}`: handler `mDt`. Optional file is resolved against the workspace path. Returns `{comments:[{id, filePath, lineNumber, endLineNumber, body, source: "remote"|"agent-local"|"user-local"}], error?}`. Filter `kpt`: has a file path, state `ready_for_review` or `pending`, not outdated, not resolved. `source` from `khe`: `remoteUrl` set means remote, `author` set means agent-local, else user-local.
- `diffComment {sessionId, comments:[{file, lineNumber, body}]}`: creates comments with `id=crypto.randomUUID()`, `state:"pending"`, `location:"modified"`, `createdAt=now`, `author = session model or "Claude Code"`, then `upsertComments`. Returns `{success:true}`. The agent cannot set end line, thread or resolve state.
- `getDiff {sessionId, file?, stat?}` and `getTerminalOutput` are siblings (see 1.3).

##### 5A.7.3 GitHub sync (VERIFIED m@659944 to m@705000, `gh` is the bundled binary)
- Review threads: GraphQL `repository.pullRequest.reviewThreads(first:dA, after)` through `gh api graphql` (fields id, isOutdated, isResolved, path, line, startLine, originalLine, originalStartLine, diffSide, startDiffSide, comments{databaseId, body, url, author, createdAt, updatedAt, lastEditedAt, replyTo, diffHunk}). Mapper `fle`: id `github-<threadId>-<databaseId>` (or `github-<nodeId>`), `state:"pending"`, `location` `original` for LEFT side else `modified`, `endLineNumber` when a range, `threadId`, `replyToCommentId` with the same id scheme, `isOutdated`, `isResolved`, `suggestionBaseCode` computed from the diff hunk (`KJe`).
- General PR conversation comments: mapper `mle`, id `github-general-<databaseId>`, `location:"file"`, no file path.
- Cloud workspaces: the server stores synced items; mapper `Xdn` turns `issue_comment`/review kinds with `githubId`, `threadResolved` into the same shape.
- Sync function (m@703700): requires an owner/name GitHub remote ("Skipping PR comment sync" otherwise), fetches both lists in parallel, `upsertDiffComments`, then `deleteMissingGithubComments` for ids that disappeared: scope `review_threads` deletes `github-%` except `github-general-%`; scope `general` deletes `github-general-%`; never rows in `superseded`. A failed fetch (undefined) skips deletion for that scope. Log "Synced GitHub PR comments".
- Resolve on GitHub: `gh api graphql ... resolveReviewThread(threadId)` then `UPDATE diff_comments SET is_resolved = 1 WHERE workspace_id = ? AND thread_id = ?` (m@3686789). Toast "Comment resolved on GitHub".

##### 5A.7.4 Attaching comments to chat messages
`addCommentToChat` sets `ready_for_review`, the composer adds a review attachment (`type:"review"`, `comment_id`), `scheduleReviewCommentAttachmentUpload` writes the `.md` (6.4), and the message text carries a mention token. Inactive comments (outdated or resolved) cannot be added ("Cannot add an inactive review comment to chat", `Rhe`). On commit the attachments become `is_draft=0` and the comments `reviewed`. A cloud workspace routes the file write through a separate upload hook (`WTt`). Cloud caches also clear: `DELETE FROM diff_comments` appears in a renderApp reset (r@10966814).

---

#### 5A.8 Agent binary management and shell environment

##### 5A.8.1 AgentBinaryStore (VERIFIED m@3583505, store `Hbe`)
zustand `{statuses: Record<"agent:kind", Status>, initialized, _unlisten}`; only `claude` and `codex` are managed (ACP providers like opencode live in `AppData/agent-binaries/acp-providers`). Key `agent:current` is the version in use (other `kind` values exist, e.g. a staged next version; INFERRED).

Status = `{agent, kind, state, version, bytesDownloaded, bytesTotal?, error?, nextAttemptUnixMs?, attempt?}`. States seen in the UI (r@11203600): `pending`, `started`, `downloading` (with percent), `retrying (attempt N)`, `failed: <error>`, `ready`.

Flow:
- `initialize()`: subscribe to Tauri event `agent_binary_progress`, hydrate with command `get_agent_binary_state`, then auto-retry every `current` binary in `failed` via `request_agent_binary_download {agent}`.
- `requestDownload`, `retry` (user) use the same command. Other commands: `redownload_agent_binary`, `remove_agent_binary`, `prefetch_agent_binaries_from_updater_endpoint` (called after an update check, r@10623398), debug `set_agent_binary_failure_injection {agent,count}`.
- Send gate (`eYt`, VERIFIED predicate): true when the agent's `current` binary is not `ready` and no custom executable path is set. `tYt` fires a callback when the binary becomes `ready` or a path override appears. INFERRED: queued sends wait on this (log tag `binaryAwaitDequeue`).
- Rust side (`bin`, INFERRED): the download code reports "Native HTTP download stalled / timed out"; the endpoint template uses `{{target}}` and `{{current_version}}` like the Tauri updater, which matches the `prefetch_agent_binaries_from_updater_endpoint` command name. Downloaded files live at `AppData/agent-binaries/<agent>/<version>/` (app: `claude/2.1.308`, `codex/0.164.0`). Env `CONDUCTOR_AGENT_BINARIES_DIR`, `CONDUCTOR_INTERNAL_BIN_DIR` are passed to the sidecar.

Verification (VERIFIED strings, mechanism INFERRED):
- Bundled helper binaries (`AppData/bin/*`: `gh`, `watchexec`, `claude`, `codex`, scripts) are copied from `Contents/Resources/bin`. `AppData/.bin-source-markers.json` records `{created_ms, modified_ms, size}` per file. Rust emits event `binary_verification_errors` with agent names when `binary_metadata_verification_failed`; command `get_binary_verification_errors` returns the list at startup. The UI shows a persistent toast `<agent> failed to start`, "The bundled <agent> binary could not be verified. Try restarting" (r@629369) and, for Xcode license problems, a "Run for me" action running `sudo xcodebuild -license accept`. A quarantine clear (`xattr -d com.apple.quarantine`) is also in the binary.
- Codex auth check `check_codex_auth` returns `{is_authenticated, auth_method}`.

##### 5A.8.2 Path overrides
- Settings `claude_executable_path` / `codex_executable_path` (`kw`, m@2680400). Trimmed; empty means unset.
- Sidecar `query` options only get a custom executable when set; otherwise Rust resolves the bundled/downloaded binary via the `agent` field of `rpc_to_sidecar` (see frontend.md).
- Terminals: `Mzi` calls Tauri `sync_agent_path_overrides {claudeExecutablePath, codexExecutablePath}` which creates a shim dir `AppData/bin-overrides/<16-hex hash>/` containing `claude` and/or `codex` (symlinks or wrapper scripts, app: a symlink there) and returns the dir. It is prepended through `CONDUCTOR_PATH_PREFIX` so `claude` in a Conductor terminal resolves to the override. Failures log "Failed to stage agent PATH override shims" and fall back to the plain prefix.

##### 5A.8.3 Shell environment capture (VERIFIED)
Two implementations of the same shared package `@shared/shellEnvCapture` (main m@2973300 and sidecar s@1297436).

Algorithm (`p_e`):
1. Pick flags by shell basename: bash `-ilc`, zsh `-ilc`, fish `-i -l -c`. Unknown shells fall back to `zsh -lc`.
2. Command string: `cd "$CONDUCTOR_CWD"; printf '%s\n' <DELIM>; env; printf '%s\n' <DELIM>; exit` with delimiter `_CONDUCTOR_SHELL_ENV_DELIMITER_`.
3. Env passed to the shell: base env plus `DISABLE_AUTO_UPDATE=true` plus `CONDUCTOR_CWD=<cwd>`.
4. Timeouts: 5 s primary (`yBt`), 3 s for the `zsh -lc` fallback (`_Bt`).
5. Parse the text between the delimiters (strip ANSI), split `KEY=value` lines, drop `BASH_FUNC_*` and "stripped keys". Default stripped keys (names only): `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `CODEX_ACCESS_TOKEN`, `CODEX_API_KEY`, `CURSOR_API_KEY`, `OPENAI_API_KEY`, `CONDUCTOR_CWD`.

Callers:
- Sidecar `getShellEnv {cwd, strippedKeys?}` (`mT`): process-wide `Map` cache keyed by `{cwd, strippedKeys}` (value is the in-flight promise; failures delete the entry). Spawns `$SHELL` (default `/bin/zsh`) with `execFile`, SIGKILL on timeout. On failure it sends notification `shellEnvCaptureNotification {cwd, kind, message}` to the UI.
- Sidecar `warmShellEnv {cwd, host?}` (`L2r`): fire and forget `mT(cwd)`; skipped when `host.hostingServerUrl` is a remote host. Called by workspace creation (`sidecar.warmShellEnv`, m@3737340).
- Main-side `i6({cwd, host, shell, strippedKeys})` (m@2973300): local host asks the sidecar (`getShellEnv`, 6 s RPC timeout `IBt`); remote hosts run the same command over `executeZsh` on the VM. A second cache `WD` holds in-flight promises per `local:<cwd>:<keys>` or `remote:<host>:<shell>:<cwd>:<keys>`. On error it logs and returns `{}`, so the PTY uses the plain launch env ("falling back to the base launch environment").
- Used by `resolveShellEnvironment` for `direct_script` launches (setup and run scripts) when `envMode==="user-shell"`. Interactive terminals do not use it; they start a real login shell (`-l`, `PATH=""` on mac).
- The Rust command `get_path_env` and `execute_shell_command {shell, command, noRcs, resourceCommand}` (frontend.md) prepend the captured PATH for all `executeZsh` git calls (m@3827770).

---

#### 5A.9 Surprising findings and open items

Surprising:
1. Spotlight moves the root repo's branch ref: `checkpointer restore` runs `git reset --mixed <worktree HEAD>` in the root on every sync. A crash leaves `refs/conductor-checkpoints/pre-spotlight` as the only way back, and it is only healed on the next Spotlight start.
2. `CONDUCTOR_PORT` is an in-memory counter (55000 plus 10 per workspace, first-request order). It is neither persisted nor checked for free ports, so numbers change across restarts and collide with anything already on 55000+.
3. Under the CEF runtime (`is_cef_runtime`) the JS file watchers do nothing, and worktree file trees are polled every 30 s anyway. Cloud workspaces cannot be watched at all.
4. Run output is never written to disk. Only the setup log goes to a file (`conductor-setup-<id>.log`). Run history keeps only task ids.
5. The shell env capture explicitly strips provider API keys and OAuth tokens from the login-shell environment before handing the rest to scripts.

Not traced:
- Rust internals: the real `standardFilters` list, `find_available_local_port` bind probing, `pty_*` flow-control thresholds, and the verification algorithm for `binary_metadata_verification_failed`. Needs the Rust source or a disassembly, not the JS bundle.
- Who calls `supersedeWorkspaceComments` (probably an aliased import in renderApp).
- `kind` values of agent binary statuses other than `current`.
- Exact `~/.ssh` placement of `conductor_config`.
- Whether `warm` is a third persistence mode: only `none` and `warm_and_cold` appear as literals in both bundles.


### Part 5B. Cloud, PR and platform subsystems


Scope: `main-BE1h_1MP.js` (m) and `renderApp-DeUrsznk.js` (r). Offsets are character offsets (`m@N`, `r@N`).
VERIFIED = read in the code at the cited offset. INFERRED = reasoned from names or neighbouring code.
Embedded secrets (PostHog project key, Sentry DSN, Virtuoso licence, GitHub App client id) are present in the bundle and are not copied here.
Time units: ms unless stated. Minified identifiers are given once so the code can be re-found.

Two backends exist, and they are easy to confuse:

| Name | Base URL | Used for |
|---|---|---|
| Roundhouse | `https://api.conductor.build` (default; setting `roundhouse_client_url_override` replaces it) VERIFIED m@376905 | orgs, cloud workspaces, sessions, feed, models catalog, automations, MCP servers, min client version |
| Conductor proxy / web app | `https://app.conductor.build` (`conductorProxyUrl`) VERIFIED m@933731 | `/v1/me`, desktop sign-in, provider API keys, GitHub App oauth |
| Legacy name | `https://app.chorus.sh` (`meltyProxyUrl`) VERIFIED m@933731 | still in config, usage not traced |

Other build channels have their own web app hosts (`stage-app`, `funhouse-app`). VERIFIED by string count in m.

---

#### 5B.1 PR status, checks, merge, automerge, approve, Graphite

##### 5B.1.1 Architecture (all in `m`, local workspaces)
All GitHub work for local workspaces goes through the **bundled `gh` CLI** (`paths.getBundledGhPath`) run in a login shell with a token injected (`shell.executeZshWithGhToken`). There is no direct REST/GraphQL client for PR state. VERIFIED m@667141, m@711915, m@672265.

Cloud workspaces run the same `gh` command on the VM via `/shell/execute` with `githubAuth:true` (`Qsn`/`ZSe` m@3822400). When the Roundhouse PR-state gate is on, cloud PR state comes from Roundhouse instead (1.6).

The GitService (`class` at m@844147, field names below) owns these parts:
- `prInfoPollingScheduler` = `XZe` @734816, per-workspace subscription timers.
- `prInfoPollingRateLimitGate` = `mZe` @713162, GitHub GraphQL budget gate.
- `visibleWorkspaceSync` = `oXe` @650555, decides which workspaces to poll.
- `graphitePoller` = `PQe` @636395, Graphite stack state.
- `prInfoPersister` = `HZe`, disk persistence.
- `workspaceChangesController` = `Get` @764712, diff/changes poller (not PR state).
- `workspaceActionsController` = `ftt` @798454, all write actions.
- `autoStackSync` = `iet` @741268, `roundhousePrState` = `ent` @836300, `repoBranchWatcher`, `workspaceLifecycleSync` = `kZe` @719989.

##### 5B.1.2 Polling policy (VERIFIED)
| Constant | Value | Where |
|---|---|---|
| Main (selected) workspace PR poll | 5000 ms, `useAggressivePolling:true` ("direct load for visible workspace") | `sXe` m@650274 |
| Sidebar workspaces PR poll | 300000 ms (5 min), not aggressive ("load for workspace in sidebar") | `rXe` |
| Workspace changes (diff) poll | `depth:"full"`, 5000 ms, only for the main workspace; sidebar change subscriptions are cancelled right after creation | `iXe`, `syncWorkspaceChanges` |
| Aggressive floor | `Pj` = 1000 ms. Used when the stored PR has `mergeStateStatus==="UNKNOWN" && isMerged===false` (GitHub is still computing mergeability) | m@734739, `shouldUseAggressivePolling` m@847418 |
| Graphite state poll | `yj` = 5000 ms per repo, refcounted subscription; fetch deduped; `gt state` timeout 30000 | m@636382, m@635500 |
| PR page list refetch | 60000 ms | r@12018800 |

`updatePolling(ws)` picks `min(interval)` over active subscriptions, clamps to at least `Pj`, asks the gate, then fires a poll immediately when the last update is older than the allowed interval and schedules the next one with `setTimeout`. VERIFIED m@735100-736800.

`updatePrInfoFromPoll` skips: archived or inactive local workspaces, workspaces whose sandbox is unavailable (it refreshes sandbox state instead), unlinked repos, and forges without a remote (`local-git` forge synthesizes PR info from git, m@725xxx `KZe`). VERIFIED m@846449.

Who is visible: `oXe.sync()` reads `visibilityStore.workspace.{mainWorkspaceId, sidebarWorkspaceIds}`, subscribes main at 5 s and the sidebar ones at 5 min, cancels the rest.

##### 5B.1.3 GraphQL rate-limit gate (`mZe`, VERIFIED m@713162)
- Budget source: `gh api rate_limit`, field `resources.graphql` only. Ghes-style "rate limiting disabled" stderr returns an unlimited budget.
- Constants: `QM=1000`, `dZe=500`, `hZe=60000`, `pZe=60000`, `fZe=500`.
- Policy by `remaining`:
  - unknown: poll at the requested interval.
  - `< 500`: poll nothing; recheck at the requested interval (the recheck timer calls `refreshRateLimitAndUpdatePolling`).
  - `< 1000`: only the main workspace polls, at `max(requested, 60000)`; sidebar workspaces are paused. `shouldFetchOnlyRequestedPrInfo()` also stops piggy-backing other workspaces.
  - otherwise normal.
- Budget cache TTL: 60 s when `remaining >= 1000`, 500 ms when lower. In-flight fetch is shared.
- Each PR fetch can report `rateLimit{cost}`; `_3` logs when `cost>1`.

##### 5B.1.4 Fields fetched (VERIFIED m@676200-680300)
One batched GraphQL query via `gh api graphql -F owner -F repo -f query=...`. Per workspace alias `pr<i>ByBranch: pullRequests(first:5, headRefName, states:[OPEN,MERGED], orderBy CREATED_AT DESC) @skip(if:$hasPrNumber)` or `pr<i>ByNumber: pullRequest(number) @include(...)`, with fragment `PrFields`:
- identity: `number url author{login avatarUrl} baseRefName baseRef.target.oid headRefName headRefOid title body createdAt updatedAt isDraft state mergedAt`
- review: `viewerDidAuthor viewerLatestReview{commit{oid}} reviewDecision reviewRequests(first:20){totalCount nodes{requestedReviewer{Actor|Team|EnterpriseTeam slug}}} latestReviews(first:20){nodes{author state submittedAt}}`
- merge: `mergeable mergeStateStatus autoMergeRequest{enabledAt} mergeQueueEntry{state position enqueuedAt estimatedTimeToMerge headCommit.statusCheckRollup...}`
- checks: `headRef.target.statusCheckRollup.contexts(first:100)` with `CheckRun{conclusion status name checkSuite.workflowRun.workflow.name detailsUrl startedAt completedAt}` and `StatusContext{state context targetUrl}`
- deployments: `deployments(first:20, orderBy CREATED_AT DESC){environment state createdAt updatedAt latestStatus{state environmentUrl createdAt updatedAt}}`
- optional fields: `stackEntry{position stack{number size baseRefName}}` and `EnterpriseTeam{slug}`. If GitHub answers `undefinedField` or `undefinedType`, the client records the missing feature per remote host (`$F` map, `Kce`) and retries without it. This is how it works against GitHub Enterprise.
- `viewerPermission` on the repository.

Batching: `g3=5` PRs per query. `mm` (success batch size) halves on failure and grows +20% (min 1) on success. `UF` halves on another condition (cost or timeout). Effective size is `min(mm, UF)`. VERIFIED m@681xxx (`_Je`, `wJe`, `bJe`, `SJe`). A single-PR variant `yJe()` exists for "PR details" with `Gm` timeout (m@832072 `jtt`).

Derived checks status (`nle` m@680860): `passing` if `mergeStateStatus==="CLEAN"`; else pending if any rollup is `IN_PROGRESS|EXPECTED|QUEUED` or state `PENDING|EXPECTED`; failing if any `FAILURE|ERROR|TIMED_OUT|ACTION_REQUIRED` or state `FAILURE|ERROR|STARTUP_FAILURE`. Rollups are de-duplicated by `check-run:<workflow>:<name>` or `status-context:<context>`, newest `completedAt||startedAt` wins. A single Vercel status with a `targetUrl` becomes `vercelUrl`.
An UNKNOWN merge state never overwrites a known one for the same PR and head OID (`Mle`).

##### 5B.1.5 State and persistence
Zustand store `MQe` (m@639102): `prInfo{ "<repoId>:<prNumber>" : PrInfo }`, `workspacePrInfo Map`, `workspacePrInfoUpdatedAt`, `workspacePrNumber`, `workspaceRepositoryId`, `roundhousePrStateEnabled`, `prInfoFetchState`, `localBranch`, `workspaceActionState`, `allLocalBranches`, `checkedOutBranches`, `graphiteRepoState{ [mainWorktreePath] }`, `workspaceChanges`, `pullRequestChanges`, `pullRequestRangeChanges`. Lookup: `Ho(state,{workspaceId})` = `workspacePrInfo.get(ws)` else `prInfo[key]` via repo+number.
`PrInfo` zod shape `FZe` (m@720000): the fields above plus transient flags `isMerging isApproving isEnablingAutoMerge isDisablingAutoMerge isMarkingReady` (stripped before storage by `Ile` and re-applied from `pendingPrActionState`), `viewerCanMerge`, `reviewers[]`, `stack{number,size,position,baseRefName}`, `prTitle/prBody/prAuthorLogin/prAuthorAvatarUrl`.
Persistence: `HZe` writes entries to the local-storage subsystem **`git-service-pr-v2`** (old `git-service-pr-v1` is removed), one entry per workspace `{prInfo, repositoryId, localBranch, observedAt}`, file-backed, size limit 5 MiB, only when changed (JSON compare), hydrated before the roundhouse PR state starts. VERIFIED m@724xxx-725xxx.
Forge capabilities `VT("github")` (m@640xxx): remote requests, create, update, draft, mark ready, merge, auto merge, reviewer requests, review thread resolution, checks, check logs, check retry, issue picker, repo create. `local-git` has all false.

##### 5B.1.6 Roundhouse PR state for cloud workspaces (VERIFIED m@836300-838800)
`ent` watches `roundhousePrStateGate.isEnabled()` (feature `pr-roundhouse-state` / setting `pr_roundhouse_state_enabled`). When on and the workspace host is cloud: links come from Roundhouse workspace summaries (`/workspaces/:id/pull-requests...`), and the client still asks GitHub for details only for the shown PR (`jtt`), merged with `Vj({link, githubDetails, shownPrInfo})`. Local pollers skip such workspaces (`Qg(state, host)`). Action paths are labelled "Roundhouse workspace summary" and "PR poll settled from Roundhouse workspace summary".

##### 5B.1.7 Write actions (all through `gh`, VERIFIED m@667000-675300, m@780300-787000)
| Action | Command | Notes |
|---|---|---|
| merge | `gh pr merge N --<squash|rebase|merge> [--auto] --match-head-commit <workspace HEAD>`; afterwards `gh pr view N --json state --jq .state` | `Xle`. Head pinning. If the HEAD cannot be read or differs, `T3` error "Merge blocked: PR head isn't the workspace's HEAD" with a "Merge on GitHub" link. Skipped when the sandbox is not running. |
| merge method | GraphQL `repository{squashMergeAllowed rebaseMergeAllowed mergeCommitAllowed}`; preference squash, then rebase, then merge | `oJe`, cached per repo in `repoMergeMethodCache` |
| auto merge on | same merge command with `--auto` | event `git_automerge_enabled` |
| auto merge off | `gh pr merge N --disable-auto` | `git_automerge_disabled` |
| approve | `gh api repos/{owner}/{repo}/pulls/N/reviews -f event=APPROVE -f commit_id=<headRefOid>` | `aJe`, `git_pr_approved` |
| mark ready | `gh pr ready N` | `git_pr_marked_ready` |
| edit title/body | `gh pr edit N --title --body` | |
| reviewers | `gh pr edit N --add-reviewer X --remove-reviewer Y` | |
| change base | `gh pr edit N --base B` | `git_pr_base_changed` |
| resolve review thread | GraphQL `resolveReviewThread(input:{threadId})` | m@3687016 |
| rerun failed checks | `gh run rerun <runId> --failed` per run | m@3698699, `git_rerun_failed_checks` |
| fix checks | sends the agent a prompt (`Fix errors instructions.md`, custom prompt `prompts.fix_errors`) | `git_fix_checks` |
| create PR | agent-driven: writes `PR instructions.md`, sends "Create a PR..." (custom `prompts.create_pr`) | `git_create_pr` |
| push / pull | `git push -u` with remote tracking config / `git pull`; both emit `git_push`/`git_pull` | |
| stack sync | `gh stack sync` (GitHub CLI stack extension); abort markers `^✗` or "Sync aborted" throw | `ltt` m@794627. Auto variant "catch up stack branch" when the remote was rebased (`iet`). Gated by setting `github_stacked_prs_enabled` (default true) |

Each action has its own dedupe map in `ftt` (`mergePrDedupe`, `approvePrDedupe`, `enableAutoMergeDedupe`, `disableAutoMergeDedupe`, `markPrReadyDedupe`, `updatePrMetadataDedupe`, `updatePrBaseDedupe`, `editPrReviewersDedupe`, `pushDedupe`, `pullDedupe`, `syncStackDedupe`, `renameBranchDedupe`). Optimistic UI uses `pendingPrActionState` layered over fetched data by `Tle`.

##### 5B.1.8 Graphite (VERIFIED m@634328-638300)
- Read only plus checkout: `cd <mainWorktree> && gt state 2>/dev/null || echo "{}"` parsed into `{branches:[{name,trunk,parentBranch}]}`; `gt checkout <branch>` then refresh branches. No `gt submit`, `gt sync` or `gt restack` found.
- `a3()` turns that into `stackState{isInStack, branches, parentBranch}` for the current branch; cloud workspaces never show it.
- Off switch: setting `graphite_disabled` (disabled only when the value is `"true"`; while settings load it is also treated as disabled). A react-query key `["graphite","installed"]` probes the CLI.
- The settings enum `pull_request_open_target` is `github | linear | graphite` (where "open PR" goes). `dT` m@~303.
- Stack readiness uses a GraphQL query via `gh` (m@667141) and `github_stacked_prs_enabled` for GitHub native stacks.

##### 5B.1.9 archive_on_merge hook (VERIFIED m@732927 `S3` and `VZe`)
Trigger: store update where `previousPrInfo.isMerged===false` and new `isMerged===true` for the same PR number.
Conditions: local workspace only (cloud returns), repo setting `archive_on_merge==="true"` (setting file key `git.archive_on_merge`, toggled in general settings), `archiveCommit===undefined`.
Stack rule: if the PR has `stack`, fetch stack details (`fetchStackDetails`) and skip when other PRs in the stack are still open. Toast "PR #N merged. Workspace kept for the rest of the stack.".
Otherwise `workspace.archiveWorkspace`, toast "PR #N merged and workspace archived" with actions "Open PR" and "Unarchive". Errors: running agents (`WorkspaceHasRunningSessionsError`), corrupted workspace (`WORKSPACE_CORRUPTED`), generic.
Related: `delete_branch_on_archive`.

##### 5B.1.10 "pull-requests" page (VERIFIED r@12018236)
Route `/pull-requests`, shown only with internal flag `internal_pull_requests_page` (m@429531). Data source is Roundhouse, not GitHub: infinite query key `["organization-pull-requests", baseUrl, orgId]`, `GET /organizations/:org/pull-requests?limit&cursor`, pages merged and de-duplicated by `<githubRepositoryId>:<prNumber>`, `workspaceIds` mapped to local ids (`CNt`), `refetchInterval 60000`. Detail panel shows `PR ref` for the first workspace. Sort setting `pr_activity_sort_order` = `newest-first|oldest-first`. Per-workspace Roundhouse PR routes (`/workspaces/:id/pull-requests[/:repoId/:n[/snapshot|/close]]`, `POST` link, `DELETE` unlink) back the cloud flow.
Repo PR picker for new workspaces uses GitHub REST directly (`api.github.com/repos/:r/pulls?state=open&per_page=50`, `search/issues?q=repo:... is:pr state:open ...`, `user/repos?...per_page=8`) with the user's GitHub token (r@264660-265700).

##### 5B.1.11 GitHub health check (VERIFIED m@3821706)
- Logger `github-health`. Store `W_` = `{status:"unknown"|"ok"|"broken", reason, authMethod, lastSuccessAtMs, lastFailureAtMs}`.
- Every `gh` command result goes through `Vsn`: exit 0 records "ok"; otherwise stderr/stdout is classified by `XSe`/`Ksn`: `unauthorized` ("bad credentials", "http 401"), `saml-sso-required` ("saml enforcement"), `missing-scope` (403 plus "scope"). **Only `unauthorized` sets status to broken.**
- Auth method from `gh_auth_method`: `cli` (gh auth), `pat` (`gh_pat_token`), `conductor-app` (GitHub App via Roundhouse `/github/token`). On first break it logs a warning and captures `github_health_broken{reason, auth_method}`. An epoch counter drops stale results after sign-out.
- A rejected PAT shows a persistent error toast with "Open account settings" (m@952xxx `Pit`).

---

#### 5B.2 Notifications, sounds, dock badge, keep-awake

##### 5B.2.1 Settings (VERIFIED m@302827-303900)
`notifications_enabled` (default true), `mention_notifications_enabled` (default true), `sound_type` (default `"default"`), `caffeinate_while_agents_running` (default false), `remote_control_keep_awake` (default true).
Settings copy: "Prevent your Mac from sleeping while an agent is actively working. Shuts off below 10% battery." r@11121719.

##### 5B.2.2 When a notification fires (all through `Fh` m@2688367)
`Fh({sessionId, message, attentionPolicy="always"|"whenNotViewingSession"})`. Callers (VERIFIED):
| Trigger | Message | Policy | Side effect |
|---|---|---|---|
| Turn settled, success | "Agent finished. Click to view session." | whenNotViewingSession | from `notifySettled` m@3236655 |
| Turn settled, failure | "Agent failed. Click to view session." | whenNotViewingSession | same |
| Plan ready (`exitPlanMode` request) | "Plan ready. Click to review and approve the plan." | whenNotViewingSession | status `needs_plan_response`, mark unread. m@3099705 |
| Question (`askUserQuestion`) | "Agent has a question. Click to answer it." | whenNotViewingSession | status `needs_user_input` |
| Codex MCP elicitation | "`<server>` needs information" | whenNotViewingSession | status `needs_user_input` |
| Codex permission approval | "`<server>` requests permission" | whenNotViewingSession | status `needs_user_input` |
| Tool approval | "`<tool>` requires your permission" | always | status `needs_user_permission` |
| Local command approval | "Approve local command: `<command>`" | always | `Mwe` m@3204346 |
| Mention | "`<actor>` mentioned you" with body = workspace display name | not when that workspace page is open and the window is focused | `wen` m@3718786, needs `mention_notifications_enabled` |

Suppression rules in `Fh`: skip when the session is hidden, the workspace is archived, or the user is not the workspace creator, assignee or a watcher (`aOt`). With `whenNotViewingSession`, skip when that session is the selected one **and** the window is focused (`fOt`).
Order: sound first (if `sound_type !== "disabled"`), then native notification (if `notifications_enabled` and a workspace exists). Both are fire-and-forget. The sound plays even when native notifications are off.
Title: session title unless it is the default placeholder, else the workspace-derived name; trimmed to 50 characters with an ellipsis (`pOt`, `pJ`, `hJ=50`).
Native call: Tauri command `send_native_notification {title, body, deepLink}` after `Notification` permission check/request (m@2687508). Permission API: `window.Notification` plus `plugin:notification|is_permission_granted`.
Errors that are not "failed turns" (queryError etc.) are not notified; no separate error toast path was found for notifications. INFERRED.

##### 5B.2.3 Delay and throttle (VERIFIED m@1767099 `Tfe`, `Hbt=2000`)
- When a live state goes `idle`, `schedule()` starts a **2000 ms** timer per session, unless background tasks exist. `cancel()` clears it on new activity; `reestablish()` moves `idle` to `waiting` again when background tasks reappear.
- On timer fire `settle()` flips `waiting` to `idle` (compare and set via `recordStatusIfCurrent`). It notifies only if: no background tasks, `notifyFinished` is true (no error in the live state), the session is not in `finishedNotifiedSessionIds`, and the session has **zero queued messages** (`getQueuedMessageCount===0`).
- `finishedNotifiedSessionIds` prevents double "finished" notifications for the same turn.
- The status model includes `waiting` between `working` and `idle`.

##### 5B.2.4 Sound catalog (VERIFIED m@2683083-2684400; ids only)
Files are bundled assets, played with Web Audio at gain 0.5 (`dOt`, `hOt`).
| Group | ids |
|---|---|
| none | `disabled` (label "No sound") |
| Classic | `default` (Chime), `choo-choo` |
| Novelty | `odysseus-pluck`, `fahhhh`, `quack` |
| SF Muni | `sf-muni-inbound-train-chime`, `sf-muni-new` (file `sf-muni-gong.mp3`) |
| NYC MTA | `nyc-metro-door-chime`, `nyc-subway-door-chime`, `nyc-subway` |
| Paris Metro | `paris-metro-chime`, `paris-metro-pickpockets` |
| SNCF | `sncf-jingle` |
Group logos: `muni.svg`, `mta.svg`, `metro-de-paris.svg`, `sncf.svg`.

##### 5B.2.5 Deep links on click (VERIFIED)
- URL built by `N3`: `<scheme>://workspace?id=<serverWorkspaceId>&session=<sessionId>`. Schemes by build (`ait` m@940821): `conductor`, `conductor-alpha`, `conductor-alpha-chromium`, `conductor-beta`, `conductor-funhouse`, `conductor-patch`, `conductor-dev`.
- Click path: Rust emits event `notification-deep-link-click`; the UI then calls `take_pending_notification_deep_links` and routes each. On cold start only the newest link is used; older ones are logged and dropped (r@11630293). Plugin `deep-link` also feeds `deep-link://new-url`.
- Full deep-link host list (parser m@943000-946200): `auth` (token or code+state), `settings-enable`, `gh-auth` (token, app_client_id, state, nonce, expires_at), `async` (repo, base64 plan), `cloud-collab-onboarding`, `join-organization-onboarding`, `github-connected` (organizationId, status=pending), `settings`, `workspace`, `loadout`, `dev`, `automation`. Parsed types: `open-workspace`, `dev-open-workspace(s)`, `equip-loadout`, `open-automation`, `open-settings`.
- Web URLs: routines `https://app.conductor.build/routine/<orgSlug>/<automationId>`; other addresses via `lit()` with optional `?session=`.

##### 5B.2.6 Dock badge (VERIFIED r@11643094)
React component calls `set_dock_badge {count: n>0 ? n : null}` when the number changes. `n` is the **count of distinct workspaces** (not sessions) that have at least one session with `unread` and not `isHidden`, filtered to non-archived workspaces (`sR`, imported as `TVr`) the user participates in (`aOt`). Unread is `sessions.unread_count===1` in SQLite (m@2451466, `zfn` sets it). Rule is set by `markUnreadIfNotViewing`.

##### 5B.2.7 Keep-awake (CORRECTED by the lead: the logic IS in the web bundle, renderApp)
- Class `mul` (renderApp @12057500-@12062000, log tag `caffeinate`), started by `gul({settings, sessions, remoteAccess})` at the end of the runtime start (@12120354). VERIFIED.
- It spawns a long-lived child through the Tauri shell plugin: `zsh -c "exec caffeinate -i"`. It kills the child when it no longer wants to stay awake, and restarts it if it closes while still wanted. VERIFIED.
- It stays awake when either rule holds. Rule 1: setting `caffeinate_while_agents_running` is `"true"` and any session has status `working` or `waiting`. Rule 2: the `remote_control_keep_awake` setting is on, at least one remote-control device is connected, and the Mac is not on battery. VERIFIED.
- Battery guard: on battery at 10 percent or less (`pul=10`), it does not caffeinate. Battery state comes from `pmset -g batt` (a watcher, `wul`). VERIFIED @12063683.
- Session scan is throttled to once per 10 s (`tCt=1e4`). It subscribes to the settings store, the sessions store and `remoteAccess.connectedDeviceIds`. VERIFIED.
- The sidecar notification `keepAwake` has an empty UI handler (`Ve.addMethod(Ui.KEEP_AWAKE,()=>{})` m@3103285), so the sidecar does not drive this.

---

#### 5B.3 Speech

##### 5B.3.1 Dictation (VERIFIED m@3240757-3250500, class `y5t`, singleton `Avn`)
States: `idle -> connecting -> recording -> processing -> idle`. Listeners notify on state and live transcript changes. A `recordingAttemptId` makes older attempts drop their results.
Path choice at `startRecording`: Tauri `on_device_speech_available` (checked each time). If true, on-device; if the Rust side reports `unavailable` (language unsupported), fall back to Deepgram. Setting `voice_mode` gates the feature (internal flag, default false).

On-device (macOS Speech framework in Rust):
- `start_on_device_speech {session, onEvent: Channel}`, `stop_on_device_speech`, `cancel_on_device_speech`.
- Channel events: `recording`, `transcript {text}` (live), `levels {values[]}`, `finished {transcript}`, `failed {message}`, `unavailable`, `microphoneDenied`.
- Stop waits at most **5000 ms** (`p5t`) for `finished`, then uses the live transcript.

Deepgram (cloud):
- Key from Rust command `get_deepgram_api_key` (keychain/setting store; value not visible in the bundle).
- WebSocket `wss://api.deepgram.com/v1/listen?endpointing=false&keyterm=conductor&keyterm=claude&keyterm=codex&smart_format=true&language=en&model=nova-3&encoding=linear16&sample_rate=16000`, subprotocol `["token", <key>]`.
- Audio: `getUserMedia({audio:true})`, `AudioContext` at 16 kHz, `ScriptProcessor(4096)` converted to Int16 PCM (`g5t`) and sent as binary.
- Messages: `Metadata` (request id), `Error`, `Results` where `is_final` transcripts are joined with spaces into `transcriptBuffer`.
- Stop: wait up to **500 ms** (`f5t`) for one more audio chunk, then send `{"type":"CloseStream"}` and wait up to **5000 ms** (`h5t`) for the socket to finish.
- Levels: analyser every **20 ms** (`JZ`), dBFS mapped to 0..1 with `(db+55)/40`, kept for 5000 ms (`m5t`) for the waveform.
- User-visible failures: "Microphone access denied.", "Speech-to-text failed. Try again.", "Speech-to-text timed out. Try again.", "Recording ended without a transcript. Try again."

##### 5B.3.2 Text-to-speech ("read aloud", VERIFIED m@3565702-3568200, class `wVt`, singleton `Ivn`)
There is TTS. It is server-side: `POST /organizations/:orgId/read-aloud/speech` on Roundhouse, body `{text}`, response `audio/mpeg` blob (`bVt`). Request kind `read-aloud.speech`, not idempotent, 403 allowed.
Text is cleaned (`oVt`) and chunked by `gVt`: first chunk max **250** chars (`_Vt`) for fast start, later chunks max **4000** (`yVt`). The next chunk is prefetched while one plays. Playback uses an `Audio` element with `playbackRate = 1.25` and `preservesPitch`.
States: `idle | loading | playing` per `{sessionId, turnId}`; `stopSession` stops when a session is closed. Feature flag `read-aloud` (m@370286).

---

#### 5B.4 Updater, version checks, DB version warning

##### 5B.4.1 Auto update (VERIFIED r@10621132-10626400)
- Uses `tauri-plugin-updater` (`plugin:updater|check`, `download`, `install`; class `Kon` m@3898618). The endpoint is configured in Rust (not in the bundle).
- React Query keys: `latestUpdate`, `autoEligibleUpdate`, `downloadUpdate(version)`.
- Version filter by build channel: alpha, alpha-chromium, beta, funhouse, patch builds accept only versions containing `-alpha.`, `-beta.` etc. ("Skipping un-stamped update").
- Eligibility poll `refetchInterval`: **60000 ms** when the window is focused, **300000 ms** when not (`QRa`, `JRa`), also in background.
- **Release holdout**: PostHog flag `conductor-release-holdout-v<version-with-channel>`; the client waits up to **1500 ms** for flags to load. If the flag is `true`, auto update is skipped.
- **Stagger**: per new version a random delay `0..180000 ms` (`ZRa`) before the download starts, so clients do not hit the CDN together.
- Prefetch: on a new version the app calls `prefetch_agent_binaries_from_updater_endpoint`.
- Download retries: 2, `retryDelay` 60000. After download an update toast shows release notes (`body`). Setting `auto_restart_on_update_when_idle` enables restart when no session is running (`rnr()` counts running sessions via process states). Install: `n.install()` then relaunch.
- Errors: toasts "Update download failed", "Update install failed".

##### 5B.4.2 Manual update and menu
- Rust commands `check_for_updates` (menu "Check for updates", r@10628629 `kNa`) and `get_installed_manual_update` (returns `{update}` for a manually installed build, shown on start `_Na`). Tauri event `manual_update_status` feeds toast state.
- Menu events open docs: `open_changelog_url` etc. Changelog URL `https://www.conductor.build/changelog` (m@2690447). Release notes in the toast are the updater manifest `body`.

##### 5B.4.3 Minimum client version (VERIFIED r@12042300-12043900)
- `GET <roundhouseBase>/minimum-client-version` returns `{minimumVersion}` (zod `Icl`). Timeout **10000 ms** (`sar`). Query `["minimumClientVersion", baseUrl]`, `staleTime` and `refetchInterval` **300000**, background refetch on, `retry 2`, delay 1000. Also refetched 2000 ms after a `network-changed` Tauri event.
- Result states: `checking`, `allowed`, `update_required {minimumVersion}` (semver compare `nWr(X6e, min) === -1`), `region_blocked` (HTTP 403 with a `cf-ray` header and no `cf-mitigated` header, which means a Cloudflare geo block).
- `update_required` renders a full-screen "Update required: This version of Conductor is no longer supported." with a download/install button. Events: `region_blocked`.

##### 5B.4.4 App and DB version warning (VERIFIED r@12034318)
`get_db_version_warning` (Rust) returns null or `{dbVersion, appVersion, identifier, repoDir?}`. Non-null shows a blocking screen "Database from a newer version: This database (schema version N) was created by a newer version of Conductor than the one currently running (supports up to version M)". Event `db_version_mismatch_detected`. With internal settings enabled it offers a rollback terminal ("Database rollback", r@12038744). Another guard: `arch_mismatch_detected` (r@12042283).

---

#### 5B.5 Model catalog and favorites

##### 5B.5.1 Catalog (VERIFIED)
- Source: `GET <roundhouseBase>/models/catalog` (`mcn` m@381426; a second fetcher `OOr` r@72376). Cached as JSON `{baseUrl, catalog}` in setting **`model_catalog_cache`**; ignored if `baseUrl` differs from the current one.
- Refresh: on start, on base-URL change, and every **3600000 ms** (`AGr`, r@72700). Failure just logs a warning.
- Schema `Ere` (m@148400-191100): `schemaVersion:1`, `harnesses{claude,codex,cursor}` each `{label, effortAxisLabel:"Effort"|"Thinking", effortLevelLabels, effortLevelDescriptions?, configs[]}`, `presets[{harness,model,effortLevel?,fastMode?}]`, `cloudHarnessVersions{claude,codex,cursor?}`.
  - `configs[]`: `{minHarnessVersion, defaultModel, forkModel?, defaultEffortLevel, thinkingBudgets?, discoveredModelDefaults?, models[]}`. Config is chosen per harness by `_ie({catalog, harness, harnessVersion})` (best `minHarnessVersion` that fits the installed CLI version).
  - model: `{id, label, shortLabel?, isNew?, status: picker|gated|hidden|deprecated, aliasOf?, wireName, providerFamily: fable|opus|sonnet|haiku, wireLabels?, effortLevels[], defaultEffortLevel?, effortLabelOverrides?, adaptiveThinking, rejectsThinkingDisabled, liveEffortSwitch, supportsFastMode, defaultsToFastMode, thinkingReadableBy?, contextWindow?, providerOverrides{bedrock,vertex,foundry:{envVar,contextWindow}}, requiredArtifacts?: ["codexCodeModeHost"]}`.
- **Sync registry** (`Dqe` m@382090, wired in settings service `OU` m@390897): on every settings change it rebuilds two registries via `Iie`: host `"local"` (harness versions from the sidecar, `Coe()`) and host `"cloud"` (versions from `catalog.cloudHarnessVersions`). If the catalog lacks a config for a harness, it keeps the old registry and logs. A bundled fallback catalog `eA` is used when no cache exists.
- Forwarding to the agent: `Cdl()` (r@12091000) subscribes to settings, resolves the catalog (cache or bundled `Sdl`), and sends `setModelCatalog` as a JSON-RPC **notification** to the sidecar only when the JSON changed (dedupe by string compare). This lets the sidecar know model ids and wire names without its own fetch. VERIFIED m@3109925.
- Model lists for the picker (`Ioe`): per harness, `status:"picker"` goes to `models`, `gated` to `gated`, `isNew` into `newModels`; hidden and deprecated are dropped.
- Cloud: `GET /available-models?organizationId&workspaceId` (`getHarnessModels`) returns what the sandbox can run (m@894914).

##### 5B.5.2 Default model per agent
Settings (m@297796): `default_model`, `review_model`, `default_fast_mode`, `review_fast_mode`, `default_plan_mode`, `default_codex_thinking_level`, `review_codex_thinking_level`, `default_claude_effort_level`, `review_claude_effort_level`, plus `visible_provider_models`. File keys `models.default` and `models.review` in `.conductor/settings.toml`, not workspace-configurable. The picker value is a tagged union: built-in `{id,type:"built-in",model,effortLevel,fastMode}` or ACP `{type:"acp", acpAgentId}`.

##### 5B.5.3 Favorite models (VERIFIED r@238200-241000, m@894155-895500)
- Local table `favorite_models(id, position, configuration JSON, created_at)` plus scope columns `hosting_server_url?, organization_id, user_id`. Write is a diff: update by id, insert if missing, then `DELETE ... AND id NOT IN (...)`. Serialised through `oMn` keyed by scope.
- Remote: `GET /organizations/:org/favorite-models`, `PUT` same path with `{favorites, expectedUserId}`, `POST .../favorite-models/initialize`, and member views `GET /organizations/:org/members/:uid/favorite-models`. The `sync_required` realtime item carries `items:["sections","favorite_models"]`.
- First run migrates from the old local-storage subsystem `model-picker-favorites-v1` entry `ordered`.
- Remote-control relay exposes `remoteControlGetFavoriteModels`.

##### 5B.5.4 Codex, ACP, Cursor lists (sidecar RPC, VERIFIED m@3111778-3112630)
Requests: `listAcpModels` (timeout 120000), `fetchAcpSessionConfigOptions` (10000), `syncAcpSessionModel`, `setAcpSessionConfigOption` (30000, or 120000 with `warmAgent`), `listCodexModels` (120000, `agentType:"codex"`), `acpOneShotPrompt`, `cursorOneShotPrompt`. Remote control relay: `remoteControlListCodexModelIds`. Models discovered this way get the catalog's `discoveredModelDefaults` (`Aie`). ACP agents are validated by `IN(acpAgentId)`.

---

#### 5B.6 MCP management

- **Per-session availability** (VERIFIED m@1690018): sidecar request `fetchAvailableMCP` (local) or, for cloud, `POST /workspaces/:id/mcp-servers {agentType, sessionId?}`. Result `getMcpServersResponse{mcpServers[{name, status: connected|failed|needs-auth|pending|disabled, serverInfo{name,version}, error, scope, tools[]}], warning}`.
- **Org-level cloud MCP servers** (settings page `/settings/organization/mcp`, r@10720508 and following): Roundhouse routes `GET /mcp-servers?organizationId=`, `POST /mcp-servers`, `PATCH /mcp-servers/:id`, `POST .../connect`, `.../connect/cancel`, `GET .../connect/status?state=`, `POST .../disconnect`, `GET /organizations/:org/member-mcp-servers`. Server shape `{id, name, url, authType: none|static_headers|oauth, credential: static_headers | oauth_tokens{status: active|needs_reauth|revoked, lastRefreshedAt, accessTokenExpiresAt}, oauthClientId, oauthClientSecretConfigured}`. UI auth modes: none, bearer (stored as header `Authorization: Bearer ...`), custom headers, OAuth (optional client id and secret; the OAuth callback URL is shown).
- **Curated catalog** in the UI (r@10757664): well-known remote MCP servers (for example posthog, amplitude, hex, sentry, datadog, notion, stripe, supabase, vercel, linear, asana) with `url`, `authType`, `alternativeUrls`, `oauthSetup`.
- **Local import scanner** (r@10753496-10756800): reads existing configs and offers them as cloud candidates. Sources: Claude Code (`~/.claude.json` plus `.mcp.json` in project roots, depth 5, skipping `.git` and `node_modules`), Claude Code plugins (`plugin.json`/`.mcp.json`), Claude Desktop, Cursor (`.cursor/mcp.json`), OpenCode (`opencode.json`). Only servers with a `url` are importable. Each source has a timeout; outcomes counted `readable|unreadable|timedOut|error`.
- **Where configs live**: local agents read their own native config files (Claude/Codex/Cursor/OpenCode). Conductor stores nothing for local MCP except what the sidecar injects. Cloud MCP configs live in Roundhouse (credentials server-side); `session/mcpServers` and `cloudEnv` revision objects are synced to the sandbox (m@148279).
- **Conductor's own MCP tools** (server name `conductor`, shown as `mcp__conductor__*`): `GetWorkspaceDiff`, `DiffComment`, `GetDiffComments`, `GetTerminalOutput`, `RunLocalCommand`, `SetTargetBranch`, `AskUserQuestion`, `UpdateProgress` (names VERIFIED by string in m, r and sidecar.js). The sidecar forwards tool calls to the UI through sidecar-to-frontend requests (`getDiff`, `getDiffComments`, `diffComment`, `getTerminalOutput`, `askUserQuestion`). `RunLocalCommand` requires user approval ("Do you want to run this command on your Mac?") unless `always_allow_local_execution`.
- **Codex MCP consent/elicitation** (VERIFIED m@3100197-3101500, m@1567846): sidecar requests `codexMcpElicitation {sessionId, interactionId, serverName, ...}` and `codexPermissionApproval`. UI shows a card (`Mf.showElicitation` / `showPermissionApproval`), stores a pending promise per session, sets status `needs_user_input`, marks unread, notifies. If the sidecar cannot deliver, it sends `codexMcpConsentDeliveryFailed {sessionId, interactionId, outcome: interaction_unavailable|timeout}` and the UI dismisses the card. Agent events `codex.mcpConsentOutcome` (`user_declined|user_canceled|interaction_unavailable|timeout`) become a non-terminal error line `[codex-mcp-consent] <outcome>`.
- Tool card keys in the chat: `context7-mcp`, `linear-mcp` (prefix match on `mcp__context7__`, `mcp__linear__`).

---

#### 5B.7 Routines (automations)

All server side; no local scheduler found. VERIFIED m@164600-168000 (schemas), m@905772-908330 (routes), r@12017xxx (UI).
- Entity `automation`: `{id, organizationId, ownerUserId, name, prompt, repositoryId, repoUrl, agentType, model?, thinkingLevel?, currentVersion, enabled, archivedAt?, createdAt, updatedAt, runCount, lastRunAt?, triggers[]}`.
- Triggers (max 20 per routine): `cron {cronExpression ≤256 chars}`, `github {githubEvent: pull_request_opened|pull_request_pushed|pull_request_merged, githubAuthor?, filters[{field: label|author|base_branch, operator: is|is_not, value}]}`, `webhook {reservation?}`. Each trigger has `nextFireAt` and `enabled`; webhook triggers return `webhookUrl` and `webhookSecret` (rotatable). Webhook triggers are behind feature flag `routine-webhook-triggers`.
- Schedule representation: standard 5-field cron strings; the UI converts to presets (daily, weekly, etc.) using the browser time zone offset (`pqt`, `bol`). Built-in templates: `weekly-report` (`0 17 * * 5`), `system-health-check` (`0 9 * * *`), `daily-herald` (`0 9 * * *`).
- Runs: `{id, automationId, incomingEventId, automationVersion, state: pending|workspace_creating|running|completed|failed, workspaceId?, sessionId?, error?, createdAt, startedAt?, finishedAt?}`. Each run creates a cloud workspace and session; the run links to the workspace.
- Versions: every edit bumps `currentVersion`; `GET .../versions` lists history with full config snapshots; `POST .../revert {version}` restores one.
- Routes (all `/organizations/:org/automations`): `GET` list (optional `?userId=`), `POST` create, `POST /webhook-reservations`, `GET/PUT/DELETE /:id`, `GET /:id/runs`, `POST /:id/run` (manual, returns `eventId`), `POST /:id/triggers/:tid/rotate-secret`, `POST /:id/revert`, `POST /:id/archive`, `POST /:id/restore`, `GET /:id/versions`. Update body has `operation` plus either full config or `{operation:"set_enabled", enabled}`.
- Web URL `https://app.conductor.build/routine/<orgSlug>/<id>`; deep link host `automation` opens it. Client routes `/routines`, `/routines/new`, `/routines/$automationId`.

---

#### 5B.8 Linear and GitHub issue context

##### 5B.8.1 Linear (VERIFIED m@2657408-2664200)
- Direct GraphQL from the client: `POST https://api.linear.app/graphql` with header `Authorization: <linearOauthToken>` (token taken as is, no "Bearer").
- The token is part of the Roundhouse user object (`GET /v1/me` on the web app proxy returns `linear_oauth_token`; Linear OAuth itself is done by Conductor's backend). On HTTP 401 the client calls `refreshUserData()` once and retries with the new token (`GMt`, deduped per failed token).
- Queries: `viewer{id}`, `MyActiveIssues` (assigned to the viewer, not completed), `GetUserTeamIds`, `SearchIssuesWithTeamFilter` (`searchIssues(term, first:30, filter state not completed/canceled)`), `GetIssueById`, `GetIssueRepositorySuggestions` (`issueRepositorySuggestions(issueId, candidateRepositories)` picks which repo fits an issue). Issue fields (`wD`): `id identifier title description url createdAt updatedAt branchName state{id name type color} assignee priority priorityLabel labels team comments{nodes{id body createdAt user{name}}}`.
- React Query keys `["linearIssues", token, ...]`: `userTeamIds` stale 600 s, `myActive` 15 s, `search` 15 s, `byId` 60 s. An identifier like `ABC-123` (regex `^(\w{1,7})-(\d{1,9})$`) triggers `byId` plus search together.

##### 5B.8.2 GitHub issues
- Direct REST from the UI with the user's GitHub token (`NC()` yields it; methods `cli`, `pat`, `conductor-app`): `GET https://api.github.com/repos/:repo/issues?state=open&per_page=50&sort=updated&direction=desc`, filtering out items with `pull_request`. r@267925. Repo access check `GET /repos/:repo` (r@98557), installations `GET /user/installations?per_page=100`.
- "githubIssuesUnavailable" disables the tab when the repo has no GitHub remote or token.

##### 5B.8.3 How an issue becomes context in a new workspace (VERIFIED r@11481000-11481400, m@2044470)
Selecting an issue in the new-workspace panel (`MYa`, tab "issues") produces file attachments:
- Linear: filename `[LINEAR]-<identifier>.md`, content from `Tpi(issue)`.
- GitHub: filename `[GITHUB]-<number>.md`, content from `L1i(issue)`.
- Path inside the workspace: `.context/attachments/<sanitized issueKey>/<filename>` where `issueKey` is `linear:<id>` or `github:<id>` (non `[A-Za-z0-9._-]` replaced by `-`).
These names are on the allowlist of "context" files that the app treats as its own (`gme` patterns in m@2044470: `^\[GITHUB\]-\d+\.md$`, `^\[LINEAR\]-<KEY>-\d+\.md$`, plus transcripts and terminal output files) so they are not committed or diffed. Paths `.context/conductor`, `.context/pull-requests`, `.context/attachments/comments`, `.context/todos.md` are also reserved. PR context goes to `.context/pull-requests/<n>.md` (m@3573764 `Tvn`).
The selected issue's branch name (`branchName` in Linear) can feed `branch_from_remote` style naming (INFERRED from `iqt`).

---

#### 5B.9 Roundhouse client

##### 5B.9.1 Transport and auth
Core request: `qT` (m@560383) wraps `platform.http.fetch` (Tauri HTTP plugin). Default method GET. Headers: `Authorization: Bearer <accessToken>`, `X-Conductor-Client-Type: mac-desktop`, `X-Conductor-Client-Version`, `X-Conductor-Routed-Local-Execution: 1`, `X-Conductor-Client-Instance-Id` (random uuid saved in setting `client_instance_id`), JSON bodies get `Content-Type`. `Idempotency-Key` is used on message sends. Callers pass `sensitiveBody:true` to keep bodies out of logs; `allowNotFound`, `allowForbidden`, `allowSessionNotRegistered` (409 with code `SESSION_NOT_REGISTERED`) turn those statuses into normal results.
Wrappers: `el` (m@596703) checks the signed-in user (`expectedUserId`) and short-circuits with a synthetic 503 "Workspace is in a failed state; client request not sent" when a workspace remote state is `deleted` and the path is not one of `state|archive|unarchive|mirror|sessions/:id/feed` (m@586592). `s3`/`Nr`/`ace` resolve typed routes from the registry with zod response parsing.

Token handling ("roundhouse-tokens", m@230605-235300):
- Names only: secret `conductor_api_token` (long lived), secret `roundhouse_credentials` (JSON map baseUrl to `{apiToken, accessToken, accessTokenExpiresAtMs, refreshToken}`), setting `conductor_api_token` and `cached_user_data` in the user service.
- Flow: `POST <rh>/auth/exchange` with `Authorization: Bearer <apiToken>` returns `{accessToken, accessTokenExpiresAt, refreshToken}`; `POST <rh>/auth/refresh {refreshToken}` returns new access token. Access token reused while more than **60000 ms** from expiry (`qWe`); otherwise refresh, then fall back to exchange. Each call has a **10000 ms** timeout. 401/403 on refresh means fall back to exchange; 401/403 on exchange returns "no token".
- A changed `apiToken` invalidates the stored credentials. Dev builds that talk to localhost always re-exchange.
- Epochs: `zL` (global, bumped by `ZWe` on sign-out, throws `SignedOutError`) and a per-origin credential epoch (bumped by `tT` on 401, throws `InvalidatedCredentialsError`). Requests in flight when either changes fail cleanly. On a 401, `r4e` calls `tT` (forces expiry, waits at most 5000 ms for in-flight refresh) and retries once.
- Desktop sign-in: web `GET https://app.conductor.build/desktop-auth` (PKCE), callback via deep link `auth?code&state`, then `POST /api/desktop-auth/token {code, code_verifier}`; older `auth?token=`. WorkOS SSO: `/auth/workos?organization=`; `/users/log_in`. User: `GET /v1/me` (header `Conductor-Token: Bearer <apiToken>`). Provider keys: `GET /api/me/provider-api-keys?credentials=all&include=bedrock_credentials,claude_oauth_auth,claude_user_managed,codex_chatgpt_auth,codex_chatgpt_oauth,codex_user_managed,cursor_login_auth,muse_api_key,openrouter_api_key,vercel_ai_gateway_api_key[&organizationId=]` (m@3598924). GitHub App oauth: `POST /github-conductor-build-app/oauth-start`, callback `/github-conductor-build-app/callback`.

Request coordinator ("request-coordinator", m@555059-558500, VERIFIED):
- Per call options: `key`, `kind`, `transport`, `scopeKey`, `idempotent`, `dedupe` ("in-flight" shares one promise), `backoff`, `retry`, `circuit`.
- Roundhouse default: retry **5** times on status **502** with backoff base 500 / max 8000; idempotent = GET or PUT unless overridden; for calls that pass `request` options: failure backoff base 500, max 30000, reset after 60000, and a **circuit breaker** (threshold **10** failures within **30000** ms opens for **15000** ms) keyed by `roundhouse:<base>:workspace:<id>` or `roundhouse:<base>`. Open circuit throws `CircuitOpenError` for idempotent calls only. 400, 401, 403 do not count as failures. `Retry-After` on 429/503 is honoured up to **60000** ms, plus jitter.
- `tYe` clears coordinator state for a workspace when it changes.

##### 5B.9.2 Endpoint inventory
All paths are relative to the Roundhouse base. Method comes from the registry (`qt`/`fr`, 157 typed routes, m@893934-918600) unless marked "(call site)". `:x` are URL-encoded ids.

**Auth and identity**
- `POST /auth/exchange`, `POST /auth/refresh` (m@231738)
- `GET /me`; `POST /organizations/:org/me/profile-photo`; `PUT /organizations/:org/me/profile`
- `GET /organizations`; `GET /organizations/:org/members`
- `POST /organizations/:org/onboarding/complete`; `POST /organizations/:org/new-member-onboarding/complete`
- `POST /organizations/:org/presence`; `POST /organizations/:org/members/:uid/poke`; `GET /organizations/:org/members/:uid/activity?since=`
- `GET /minimum-client-version` (r), `GET /models/catalog` (m@381426)

**Repos and settings**
- `GET /organizations/:org/repositories[?includeStoredRepositories=true]`; `GET .../repositories/branches?repo=&query=`; `.../labels?repo=`; `.../collaborators?repo=`; `.../slash-commands?repo=&agentType=`; `.../pull-requests?repo=&query=&includeNonOpenExactMatch=`; `POST .../repositories/settings`
- `GET /settings?organizationId&gitRemoteUrl`; `GET|POST /settings/scope`; `GET /settings/value?...&key=`; `POST /settings/value`; `GET /settings/resolved?organizationId&key[&gitRemoteUrl]`
- `GET|POST /settings/run-scripts` (cloud actions); `POST /settings/cloud-agent-credential-selection`
- `GET|PUT /organizations/:org/environment`; prompt snippets: `GET|POST /me/prompt-snippets`, `PUT|DELETE /me/prompt-snippets/:id`, `GET|POST /organizations/:org/prompt-snippets`, `PUT|DELETE .../prompt-snippets/:id`

**GitHub**
- `GET /github/app-variants`; `POST /github/token`; `POST /github/token/report-failure`; `POST /github/token/disconnect`; `POST /github/credential`; `POST /github/installation/state`
- `GET /organizations/:org/github/installation`; `.../installations`; `.../linkable-installations`; `POST .../installation/link`; `.../installation/disconnect`; `.../installations/:id/disconnect`

**Workspaces**
- `GET /workspaces?organizationId&limit&cursor&afterWorkspaceRevision&beforeWorkspaceRevision&workspacePartition`; `GET /workspaces/revisions`; `POST /workspaces/reconcile`; `POST /workspaces/batch`; `GET /workspaces/:id`; `GET /workspaces/:id/mirror`; `GET /workspaces/base-dir?workspaceId=` (call site)
- `POST /workspaces` (create; body has clientId, organizationId, repoUrl, machine, branchInfo, forgeAuth, remoteSetupContext, provider, gitIdentity, sshPublicKey, filesToSync, access) (call site m@1114939)
- `POST /workspaces/unstarted`; `PUT /workspaces/unstarted/:id`
- `POST /workspaces/:id/{archive,unarchive,restart,keepalive,presence,rename,watch,unwatch,delete,clear-setup-script-failure-reason}`; `POST /workspaces/:id/watchers`; `POST /workspaces/:id/assignee`
- `GET /workspaces/:id/state` (call site, also `workspace-state:<id>` topic); `GET /workspaces/:id/setup-logs`; `GET|POST /workspaces/:id/access`
- `GET|POST|DELETE /workspaces/:id/preview`; `POST /workspaces/:id/ssh-public-key`; `POST /workspaces/:id/ws-token {scopes}`
- `GET|POST /workspaces/:id/chat-messages`
- Pull request links: `GET /workspaces/:id/pull-requests`; `POST` same (link); `GET /workspaces/:id/pull-requests/:repoId/:n`; `.../snapshot`; `DELETE .../:repoId/:n`; `POST .../:repoId/:n/close`
- Artifacts: `GET /workspaces/:id/artifacts[/:aid[/data]]`, `DELETE /workspaces/:id/artifacts/:aid`; team artifacts and templates under `/organizations/:org/artifacts`, `/artifact-templates`, `/artifact-marketplace[/:id/add]`
- Mirror assets: `GET /workspaces/:id/mirror/assets/:a/:b` (call site)

**Sessions, feed, messages**
- `POST /workspaces/:id/sessions/register`; `POST /workspaces/:id/sessions` (create/config; body `{sessionId, agentType, config}`) (call sites, method inferred as POST from the `post` helper)
- Session feed: REST `GET /workspaces/:id/sessions/:sid/feed?after=&limit=500[&before=&turns=&fillLimit=50]`; `GET /workspaces/:id/sessions/feed-offsets`; live via websocket topic `session:<sid>`
- `POST /workspaces/:id/sessions/:sid/messages` (body `{id, message, agentMessage, displayMessage...}`, `Idempotency-Key`); `POST .../stop {destroySession | expectsTerminalResponse}`; `POST .../respond-to-plan {approved, feedback, feedbackMessageId}`; `POST .../answer-question {answers}`; `POST .../rollback {numTurns, threadId}`; `POST .../context-usage {agentType, externalSessionId, model}`; `POST .../slash-commands {agentType}`; `POST /workspaces/:id/mcp-servers {agentType, sessionId?}`; `POST /workspaces/:id/auth` (claude auth output); `POST .../title`; `GET .../turn-outline`
- Pending (queued) messages: base `/workspaces/:id/sessions/:sid/pending-messages` with `get`, `send` (`/send`), `/:mid/update`, `/:mid/cancel`, `/:mid/promote`, `/:mid/edit-hold/acquire`, `/:mid/edit-hold/release`, `/reorder`, `/pause`, `/resume` (m@1857698; verbs not inspected, INFERRED POST except get); live topic `session-pending-messages:<sid>`
- Frontend RPC: `POST .../sessions/:sid/frontend-rpc/:requestId/claim` and `/resolve`
- Attachments: `POST .../sessions/:sid/attachments` (allocate), `POST .../:aid/upload-url`, `GET .../:aid/download-url`, `POST .../attachments/clone`, `POST .../:aid/delete`
- Mobile and live activities: `GET /mobile/builds/ios?channel&cursor`, `GET /mobile/builds/ios/:id/install?channel`; `POST /organizations/:org/live-activities/running-workspaces`, `DELETE .../running-workspaces/:id`

**Navigation sections, pins (sync of sidebar)**
- `GET|POST /organizations/:org/navigation-sections`; `PUT|DELETE .../:sid`; `POST .../:sid/reorder`; `PUT /organizations/:org/workspaces/:wid/section`; `PUT .../pinned`; `PUT .../pinned/position`

**Models and favorites**
- `GET /available-models`; favorites routes in section 5.3

**Routines**: section 7. **MCP**: section 6.
**Pull requests (org view)**: `GET /organizations/:org/pull-requests`.

**Computers / machines (the "billing and computers" area; no billing endpoints found)**
- `GET|POST /organizations/:org/default-machine`; `GET /organizations/:org/machine`; `POST .../machine/{active-version,color,build}`; `POST /organizations/:org/machines/:mid/rebuild`; `POST .../machines/:mid/versions/:vid/{build,cancel-build}`; `GET .../versions/:vid/logs`
- Workspace templates: `GET|POST /organizations/:org/workspace-templates`; `POST /workspace-templates/:id`, `/recreate`, `/cancel-build`; `GET /workspace-templates/:id/logs[?buildId]`
- Standby sandbox: `POST /organizations/:org/standby-sandboxes {machineId}` (403 tolerated; "Roundhouse did not pre-provision a cloud sandbox") (m@1120669)
- Mentions: no REST route; mentions arrive in the workspace summary stream (`handledMentionIds`, m@1035268) and become notifications. Pokes: `POST .../members/:uid/poke` (flag `pokes_enabled`).

**Read aloud**: `POST /organizations/:org/read-aloud/speech`. **Codex proxy**: `POST /me/codex-chatgpt-oauth/{start,cancel}`, `GET /me/codex-chatgpt-oauth/status?state`, `POST /me/codex-chatgpt-proxy/local-token`.

**Direct to the sandbox (host = workspace public URL, authorised with a ws token)**
- `POST /shell/execute {shell, command, githubAuth?}`; `GET /version` (`supportsSandboxUserTokenExchange`); `POST /files/{stat,list,read,read-text,write-text,write-stream}`; websocket paths `/direct/mws` (multiplexed, scopes e.g. `files:read`) and `/direct/desktop` (scope `desktop:connect`). Fallback proxy: `/workspaces/<vmId>/<path>` through Roundhouse (`YEe`, default POST).
- Direct info (`KEe`): endpoint plus http token negotiated per `{hostingServerUrl, vmId, scopes}`, cached, refreshed before expiry, "refresh public URL after 404", unreachable-host circuit with backoff `min(2000, 100*2^(n-1))` ms.

##### 5B.9.3 Multiplexed websocket (VERIFIED m@1812000-1860000)
- Roundhouse URL `<base ws>/ws?accessToken=<token>&clientType=mac-desktop&clientVersion=<v>[&routedLocalExecution=1]` (`Hre`, `rEt="/ws"`), plus `uplinkId` and `lastReceivedUplinkOffset` for reconnect/replay. The same client class also speaks to the sandbox `/direct/mws`.
- Frames, client to server: `subscribe {topic, afterOffset?, wsSessionId?, localWorkspaceIds?, subscribeId?}`, `subscription.probe {requestId}`, `rpc.request {requestId, method, params?}`, `ack {offset}`, `uplink.close {reason}`, `connection.ready {wsSessionId?, protocolVersion, clientType, clientVersion}`, `ping {pingId}`.
- Server to client: `connected {wsSessionId, uplinkId?, capabilities[], protocolVersion?, sandboxRunnerGitSha?, sandboxRunnerVersion?, sandboxRunnerAssetFingerprint?, runtimeManifestError?}`, `message {topic, offset?, payload}`, `subscribed {topic, subscribeId?}`, `unsubscribed`, `subscription.probe.result {requestId, topics}`, `rpc.response`, `rpc.error`, `pong`, `error {message, topic?, payload?}`.
- Capability seen: `subscription-health` (enables periodic probes). Protocol version mismatch throws `MultiplexedWebSocketProtocolMismatchError`; a mismatch with a sandbox yields user text about an incompatible runtime. Client version constant `SY` (m).
- Timers (VERIFIED m@1824233): ping interval 15000, pong timeout 5000, reconnect delay 1000 up to 30000 (max 5 attempts), subscribe ack timeout 5000, connect timeout 15000, session handshake timeout 10000, health probe every 300000 with 10000 timeout. Close codes: 1000, 1011, 1012, 4000 heartbeat failed, 4001 uplink gap, 4002 connection assumed broken, 4003 authentication changed. Re-auth triggers: close codes 1008, 4003, 4401, 4403, error codes `AUTH_FAILED|UNAUTHORIZED|FORBIDDEN`, or two consecutive failures. Then the endpoint resolver forces a token refresh (`tT`) and rebuilds the URL.
- Reconnect policy default `reuse-uplink`. Operations (subscribe, rpc) run through a serial queue; subscriptions are keyed by topic and fan out to many subscribers; unsubscribe frames are queued while offline.
- Topics (VERIFIED): `workspace-deltas` (org workspace list deltas with revisions), `workspace-state:<id>`, `workspace-presence?workspace=<id>`, `organization-liveness?org=<id>`, `sessions?workspace=<id>`, `session:<sid>` (feed, with `afterOffset`), `session-pending-messages:<sid>`, `pty:<ptyId>` (direct), `file-sync:changed` (direct, payload type `file-sync.changed`).
- RPC: `rpc.request` with an optional required capability; `HSt` error if the server lacks it. Method names were not found in the client (they are chosen by callers elsewhere).

##### 5B.9.4 Session feed sync (`RoundhouseCloudSessionFeedSync`, m@1580099-1600000, VERIFIED)
Per watched session a watcher keeps `lastOffset`, `feedMode: idle|backfill|push`, `eventQueue` (serial), `seenEventIds`. Steps: fetch `feed-offsets` (30000 timeout) to see which sessions advanced; backfill pages via `GET .../feed?after=<offset>&limit=500` (page timeout 30000); then subscribe to topic `session:<sid>` with `afterOffset`. Items have `kind: sessionEvent|liveState|config`. Duplicates are skipped by watermark (`sessionIndex <= lastOffset`), by `eventId` and by lifecycle key. `frontendRpcResponse` events are tracked. Subscribe readiness timeout 30000. Reconnect backoff base 1000, cap 30000. Snapshots of `liveState` and `config` are kept in local storage `roundhouse-session-feed-snapshot:<sid>:*`. Ingest into SQLite goes through the per-session queue (frontend.md section 3).

##### 5B.9.5 Standby sandboxes and providers
- Only provider literal found: `vercel` (`v$=b("vercel")`, workspace field `sandboxProvider`, sandbox home `/home/vercel-sandbox`). VERIFIED m@155615, m@560800 (`aYe`).
- Remote workspace status enum `initializing|running|restarting|stopped|unresponsive|deleted`; lifecycle step `building_snapshot|preparing|setting_up|updating`; failure fields `failureReason, failurePhase, setupScriptFailureReason`; `estimatedCostUsd`, `credentialsStale`, `staleCredentialAgents`.
- Pre-provisioning: `Clt` calls `POST /organizations/:org/standby-sandboxes {machineId}` ahead of workspace creation so the sandbox is warm. Caller conditions not traced (INFERRED: on the new-workspace screen).
- Keepalive: `POST /workspaces/:id/keepalive` (call site m@1158736) for running remote workspaces.

---

#### 5B.10 Remote file sync and remote control relay

##### 5B.10.1 Remote file sync (VERIFIED m@3037891-3065500)
Purpose: keep a local mirror of a cloud workspace so local tools (editor, `Open in`) can use it. Direction default `remoteToLocal` with scope `files:read` (`AUt`); `bidirectional` with `files:read, files:write` is the default argument of `RUt`.
Rust commands (all via `invoke("..",{args})`): `start_remote_file_sync`, `stop_remote_file_sync`, `trigger_remote_file_sync {localWorkspaceId}`, `cleanup_remote_file_sync {localWorkspaceId, mirrorPath, metadataPath}`, `set_remote_file_sync_foreground {localWorkspaceId, foreground}`, `resolve_remote_file_sync_direct_info {requestId, endpoint, httpToken, githubToken?}` and `reject_remote_file_sync_direct_info`.
Start args (`RUt`): `{localWorkspaceId, mirrorPath, metadataPath, localRepoPath (a clone), syncRef: refs/conductor-remote-sync/<sanitized id>/head, baseUrl (sandbox endpoint), authToken (http token), scopes, direction, foreground}`. Waits up to **120000 ms** (`vZ`) for the workspace to become syncable (`ready`, or `setting_up` with running remote state known to Roundhouse). Needs the repo's `remoteUrl`; clones into `clonePath` first (`DC`).
Events: Tauri `remote-file-sync-status` (`{localWorkspaceId, status}`; states include `syncing`, `synced`, `failed`, `stale`) and `remote-file-sync-direct-info-request` (Rust asks the UI for endpoint and tokens; the UI answers via resolve or reject, so Rust never holds Roundhouse credentials).
Foreground mode: the UI marks the selected workspace as foreground when the app window is focused (`B_e`); Rust syncs the foreground workspace more eagerly. Switching or blur sets the previous one to false.
Triggers: (1) UI loop every **5000 ms** calling `trigger_remote_file_sync` while engaged (`YUt`); (2) push signal: a multiplexed websocket to `/direct/mws` (scope `files:read`) subscribed to topic `file-sync:changed`; a message with payload type `file-sync.changed` triggers a sync; disconnects release the engagement and retry.
Mirror bookkeeping persisted per workspace: `{mirrorPath, metadataPath, visibleMirrorPath, symlinkPaths, lastSyncedAt, snapshotCaptureId, snapshotCapturedAt, snapshotMaterializedAt, snapshotDeletedPaths}`. Symlinks: the visible folder uses symlinks (`symlinkPaths`) created or removed by `N_e`; file metadata from the sandbox carries `kind: file|directory|symlink` and `symlinkTarget`. After the first successful sync, the repo setup script runs on the mirror once, guarded by marker file `setup-script-after-first-sync-completed` in the metadata dir (`runWorkspaceSetupScriptForSyncedMirror`).
Settings: `auto_sync_files_in_new_cloud_workspaces` (default true), `file_include_globs` (what local files are uploaded when creating a cloud workspace, `filesToSync`).

##### 5B.10.2 Remote control and `frontendRelay` (VERIFIED m@2692500-2698714, r@10635300-10638950)
Sidecar request `frontendRelay {operation, params}` is dispatched by registry `fDt` (class `pDt`): handler results are `{ok:true,result}` or `{ok:false,error:{code: unknown_operation|invalid_params|handler_failed, message}}`. Params are zod-validated per operation; some operations carry their own timeout.
Operations and what the UI does (`UNa`):
| Operation | Effect |
|---|---|
| `remoteControlGetSecret/SetSecret/DeleteSecret` | read, write, delete a secret in the app's secret store (used for pairing keys) |
| `remoteControlGetRelayHostUrl {expectedUserId, roundhouseBaseUrl, path, refreshAccessToken}` | checks the signed-in user matches, optionally invalidates the access token, returns a signed `wss://` Roundhouse URL for the relay |
| `remoteControlCreateSession` | create a session in a workspace with agent type and model |
| `remoteControlUpdateModelConfiguration` | change model, thinking level, fast mode (rejects models this Mac cannot run) |
| `remoteControlStopSession` | cancel the running session |
| `remoteControlBackfillSessionEvents` | rebuild session events from stored messages; returns `insertedCount` |
| `remoteControlComposerSend/Cancel/Steer/SetPaused` | drive the composer: send a message, cancel a queued one, steer, pause the queue |
| `remoteControlCreateWorkspace` (timeout 300000) | create a local workspace with setup plus an initial session |
| `remoteControlArchiveWorkspace` (timeout 120000) | archive and stop agents |
| `remoteControlListRemoteBranches` (timeout 120000) | list branches for a repo |
| `remoteControlGetFavoriteModels`, `remoteControlGetBranchPrefix`, `remoteControlListCodexModelIds` | read-only lookups |
| `remoteControlSearchWorkspaceFiles {workspaceDir, query, excludeDirectories}` | file search |
| `remoteControlExecuteShellWithGitHubAuth {command, cwd, timeoutMs}` (timeout 150000) | run a shell command with the GitHub token (`cd <cwd> && <cmd>`) |
Control plane (sidecar RPC): `remoteControlStart/Stop/Status/CreatePairingOffer/ClearPairingOffer/ListPairedDevices/RemovePairedDevice`; notifications `remoteControlState`, `remoteControlPairedDevicesChanged`; `remoteControlChanges` flows from UI to sidecar. Gates: setting `internal_desktop_remote_access` (default false), flag `remote-control-settings`, keep-awake `remote_control_keep_awake`. Events `remote_control_enabled`/`remote_control_disabled`. Query `desktopRelayPairedDevices`. Enterprise data privacy disables it.
Consequence: a paired phone drives the Mac through Roundhouse and the sidecar; the sidecar uses these handlers to reach the UI-owned DB, composer and workspace services.

---

#### 5B.11 Analytics (PostHog) and Sentry

##### 5B.11.1 PostHog setup
- Init in the React root (r@12121448): `api_host https://us.i.posthog.com`, `defaults:"2025-05-24"`, `capture_exceptions:false`, `autocapture:false`, `rageclick:false`, `capture_dead_clicks:false`, `capture_pageview:true`, `debug:false`; `loaded` registers super properties `$app_version`, `$app_build_type`. Project key embedded, not copied. Main-side instance `_d` (class `tR` m@2621541), capture helper `yn` (imported in r as `p1`): `yn(name, props, opts)` is a no-op when external logging is disabled (m@2647435).
- No explicit `session_recording` config: recording depends on the PostHog default and remote config (posthog-js includes the recorder). INFERRED: default off unless the project enables it.
- Identify (m@3137105-3137700): on authenticated user: `_d.identify(user.id, {email, github_username, name, app_version, test_user:"true" if tellPostHogIAmATestUser})`; sidecar gets `setPostHogDistinctId {distinctId: user.id, email}`; Rust gets `set_posthog_user_context {userId, email}`; Sentry user `{email,id}`. On sign-out: `_d.reset()`, user context cleared, Sentry user cleared. So events are keyed to the Conductor user id with the email as a person property.
- Opt-out: settings `disable_external_logging` or `enterprise_data_privacy` equal to `"true"` call `Gve(true)` (m@2647354): `_d.opt_out_capturing()`, Sentry `beforeSend` returns null, `yn` stops, sidecar gets `setExternalLoggingDisabled {disabled}`, Rust gets `configure_sentry_external_logging_disabled` and `configure_app_logger_external_logging_disabled`. The state re-applies on each settings change and after initial load.
- PostHog feature flags also drive update holdout (4.1) and the local UI flags.

##### 5B.11.2 Event catalogue (string-literal first argument only; VERIFIED by scan of `yn(`, `p1(`, `captureEvent(`, `metrics.capture(`)
Dynamic names would not appear here. Properties are the keys visible in the call.
| Event | Properties |
|---|---|
| `app_initialized` | webkit_version |
| `arch_mismatch_detected` | none |
| `region_blocked` | none |
| `db_version_mismatch_detected` | app_version, db_version |
| `sign_in_button_clicked` | auth_method |
| `sign_in_initiation_failed` | auth_method |
| `auth_login_clicked` | none |
| `auth_idle_sessions_stopped` | reset_count |
| `github_oauth_started`, `github_oauth_cancelled`, `github_oauth_success` | none |
| `github_oauth_error` | error_message, error_type |
| `github_cli_setup_success` | none |
| `github_cli_setup_failure` | error, error_name, error_stack, error_type, is_authenticated, path, stderr, stdout |
| `github_health_broken` | reason, auth_method |
| `onboarding_step_completed` | action, completion_method, step |
| `onboarding_finished` | completion_method |
| `repository_created` | default_branch, has_setup_script, repository_id, repository_name |
| `repository_deleted` | none |
| `workspace_created` | machine_id, repository_id, workspace_id, workspace_runtime, plus spread |
| `workspace_ready` | exit_code, from_state, had_setup_script, ready_latency_ms, repository_id, setup_outcome, workspace_id, workspace_runtime |
| `workspace_archived` | pr_status, workspace_id |
| `workspace_archive_failed` | workspace_id |
| `workspace_unarchived` | new_branch_name, restore_type, workspace_id |
| `workspace_status_changed` | is_manual, status, workspace_id |
| `workspace_page_loaded` | workspace_page_blocking_phase, _has_next, _import_ms, _is_initial, _is_refresh, _load_ms, _request_ms, more |
| `workspace_page_load_failed` | error_name, workspace_page_blocking_phase, _is_initial, _is_refresh, _load_ms |
| `fork_chat` | new_workspace_id, old_workspace_id, repository_id |
| `fork_chat_to_new_tab` | is_native_fork, new_session_id, old_session_id, workspace_id |
| `export_and_create_new_chat` | new_session_id, session_id |
| `session_created` | session_id, workspace_id |
| `session_hidden`, `session_unhidden` | session_id, workspace_id |
| `session_cleared` | new_session_id, old_session_id, workspace_id |
| `session_system_interrupt` | agent_type, reason, session_id |
| `session_state_error` | error_code, error_message, error_name, error_stack, error_tree, location, session_id |
| `user_message_sent` | `$set`, agent_type, delivery_mode, model, permission_mode, session_id, workspace_id, workspace_runtime |
| `ai_turn_completed` | session_id, workspace_id |
| `cancel_attempt` | method, session_id |
| `cancel_succeeded` | agent_type, session_id |
| `error_displayed` | agent_type, error_message, error_type, session_id |
| `new_workspace_prompt_composed` | none |
| `next_unread_used` | method |
| `keyboard_shortcut_used` | keybinding_id (plus spread) |
| `open_in_app` | app, method, type, workspace_id |
| `run_button_clicked` | execution_target, is_spotlight, repository_id, run_availability, task_definition_id, task_id, workspace_id |
| `git_diff_file_selected` | list_mode, workspace_id |
| `git_create_pr` | method, success, workspace_id |
| `git_create_review_session` | method, session_id, success, workspace_id |
| `git_fetch_rebase`, `git_file_reverted`, `git_fix_checks`, `git_rerun_failed_checks`, `git_push`, `git_pull`, `git_stack_sync`, `git_pr_merged`, `git_pr_approved`, `git_pr_marked_ready`, `git_pr_base_changed` | success, workspace_id |
| `git_resolve_conflicts` | workspace_id |
| `git_automerge_enabled`, `git_automerge_disabled` | workspace_id |
| `remote_control_enabled`, `remote_control_disabled` | none |
| `resource_usage_high_memory` | exceededThreshold, includeTerminals, resourceUsageSummary, sortDirection, sortKey, thresholdCpuPercent, thresholdKb, totalCpuPercent, totalMemoryKb, treeMode, triggeredBy, window... |
| `user_shell_env_capture` | capturedPathLength, durationMs, flags, mergedPathEntryCount, outcome, shell |
| `setting_updated` | setting_key, setting_value (via `captureAnalyticsEvent`, m@375352) |
Notes: `session_state_error` and `github_cli_setup_failure` send error text, stack and CLI stdout/stderr (the logger redaction in 11.4 does not apply to PostHog properties). `setting_updated` sends the value. `workspace_page_*` and `workspace_ready` are timing events sent via the metrics dependency.

##### 5B.11.3 Sentry
- Init `Wdn` (exported to r as `bGr`, called in r@12121045 before render) VERIFIED m@553300:
  - `release: "conductor@<appVersion>"`, `environment` and `dist` = build type (`production`, `alpha`, `beta`, `funhouse`, `patch`, `dev`, ...), `sendDefaultPii:false`, DSN embedded and not copied.
  - No `tracesSampleRate`, no `sampleRate`, no `ignoreErrors`, no replay: defaults only (default integration set `RVe` incl. global handlers and breadcrumbs; default `ignoreErrors` list `pje` is on).
  - `beforeSend`: drops everything when external logging is disabled; otherwise scrubs `message`, each `exception.values[].value` and `extra` through the log redactor (`FE`), then applies a **rate limiter** (`BVe`): per message key (first 200 chars) one event per **600000 ms**, at most **20 events per hour** (`DVe`, `LVe`), at most 1000 tracked keys (`NVe`).
- Capture sites are few: `qVe(error, extra)` wraps `captureException(error,{extra})` (exported helper; one visible caller: a failed shell command with `reportFailureToErrorTracking`, m@3827870, which sends `new Error("Shell command failed")` without extra). Context goes in `extra`, not tags. User set by `Vae({email,id})` after login. Most errors reach Sentry through automatic handlers or the Rust side (`configure_sentry_external_logging_disabled`), not through explicit calls. INFERRED.
- The Rust shell also runs Sentry (commands `configure_sentry_external_logging_disabled`, `set_posthog_user_context`).

##### 5B.11.4 Redaction (logger and Sentry, VERIFIED m@126200-128620, `i_`/`XFe`)
Applied to every log record forwarded to the app logger and to Sentry messages. String replacements: `cond_[a-f0-9-]+` to `cond_[REDACTED]`; `sk-...` to `sk-[REDACTED]`; GitHub tokens `gh[pousr]_...{20,}` and `github_pat_...{20,}` to `[REDACTED_GITHUB_TOKEN]`; `Bearer ...` to `Bearer [REDACTED]`; AWS keys (`AKIA|ASIA` + 16); Stripe-style `sk|rk_(live|test|org)_`; `whsec_`; `crsr_`; `key_` (32+); Slack (`xox*`, `xapp`, `xwfp`); Google `AIza...`; `npm_...`; `glpat-`; Fly (`fo1_`, `fm1_`, `fm2_`); `cond(w|mcp)_...`; JWT-shaped `eyJ...`. Object keys matching `access_token|id_token|refresh_token|api_key|secret_access_key|session_token|client_secret|authorization|password` (any case, dash or underscore) are replaced by `[REDACTED]`; keys named `auth` or `credentials` are redacted recursively and `token` under them. Depth is capped (`PFe`) and cycles become `[Circular]`. Websocket endpoints are redacted by replacing the `accessToken` query param with `[REDACTED]` (`BS`).

---

#### 5B Cross-cutting findings and open items
- Many PR actions are executed by the **bundled gh** with a Conductor-managed token, so the GitHub App, CLI and PAT modes all converge on one code path; health detection is based on `gh` stderr text.
- The cloud side is a thin client over one typed route registry (157 routes) plus one websocket. All realtime state is topic-based with offset replay.
- Not verified: method verbs of the pending-messages routes; the `rpc.request` method names; the Rust side of `send_native_notification`, Deepgram key origin, updater endpoint URL; what the sidecar does with `setModelCatalog` internally (check `sidecar.js`).
- Candidate follow-up: cross-check the sidecar for `keepAwake`, `setModelCatalog` and the MCP tool server (`sidecar.js`, `mcp__conductor__` strings).


---

## Part 6. App startup sequence

All VERIFIED unless marked. Offsets: main = `m`, renderApp = `r`.

**Phase 0: Rust shell and HTML.** Tauri loads `index.html`, which loads `main-*.js` and the preloaded chunks (INFERRED from frontend.md).

**Phase 1: main bundle top level** (m @3901665, @3906449).
1. `nan()` runs in parallel: open `conductor.db` (`get_db_uri`, WAL), open `cache.db` (WAL), read app name and version.
2. It builds the Platform object (secrets, fs, http, pty, shell, git, window, sidecar, ...).
3. `Fxe(platform)` publishes it. Setting it twice, or after a failure, throws.

**Phase 2: renderApp top level** (r @12119000-@12121500).
1. `bGr` initialises Sentry (build type, version; DSN embedded, not copied).
2. `await $1l()` runs the synchronous bootstrap (below).
3. Sets `data-platform` on `<html>`, then `createRoot(...).render(StrictMode > PostHog provider > app)` with React 19 error handlers (`onCaughtError`, `onUncaughtError`, `onRecoverableError`) that log to the `react-root` logger.

**Phase 3: `$1l()` bootstrap, once** (r @12116000):
1. `RGr()` wires query error capture to Sentry; `Qcl()` installs the slow-invoke logger on `__TAURI_INTERNALS__.invoke`; `Mha()` forwards `console.error` to Sentry; `e1l()` registers window events for toasts (`conductor:toast`, `conductor:toast-dismiss`, workspace toast, unknown-error toast, rare-city toast).
2. `v1l()` builds `{db, cacheDb, metrics, notifications}` from the platform.
3. `L1l()` is `prepare-cache-db`: move cloud rows from `conductor.db` to `cache.db`, and copy `identity_associations` if the cache has fewer rows.
4. `O1l()` -> `y1l()` builds all 14 services in order: workspace, workspaceFiles, checkpoint, repo, git, fileDiff, settings, sessionsV2, sessions, user, organization, favoriteModels, sections, composer. No I/O happens here except constructors.
5. `rGr.start()` starts the diff-comments store (`Sr`, class `aIt` @2027404, which has `start` and `hydrate`).
6. `sGr(...)` preloads all `settings` rows (`SELECT key, value FROM settings WHERE deprecated_at IS NULL`) as a promise.
7. `B1l()` starts the sidecar tunnel (`ypi.ensureStarted()`), the Tauri focus bridge (`tauri://focus`, `tauri://blur`), the network-change listener (refetches `minimumClientVersion`), the agent binary store (`AgentBinaryStore.initialize`, listens to `agent_binary_progress`), and a high-memory resource logger on an interval.
8. `dul()` registers the settings-navigation handler, `xsl(router)` subscribes to the router's `onResolved` event, the workspace service store and the sessionsV2 store, to repair or redirect routes when a workspace or session disappears (the exact fix-ups are INFERRED), `W1l()` logs app type and version, `D1l()` installs global handlers: it logs unhandled promise rejections and cancels some default browser behaviour (drag and drop, some key combinations).
9. `G1l(settingsPreload)` is the gated runtime start:
   - `mcl()` asks Rust `get_db_version_warning` (query key `["dbVersionWarning"]`). If the DB was written by a newer app, **nothing below runs** and the UI shows a mismatch screen (event `db_version_mismatch_detected`).
   - Else `x1l(services, {resetWorkingSessionsToIdle:true, preloadedSettings})` starts the services **strictly in this order** (each awaited; abort if the lifecycle generation changed):
     1. `settings.start` then `waitForInitialLoad`
     2. optional `beforeUserStart`
     3. `organization.start` (failure logged, not fatal)
     4. `user.start`
     5. `favoriteModels.start` (failure logged)
     6. `repo.start`, then `workspace.start`
     7. `sections.start` (failure logged)
     8. `git.start`, `sessionsV2.start({resetWorkingSessionsToIdle})` (marks sessions left "working" as idle and emits `session_system_interrupt` with reason `app_restart`), `sessions.start`, `composer.start`
   - Then the sidecar: `z1l()` waits for the tunnel, runs `sbn` (reads settings `sidecar_inspect`, `sidecar_inspect_brk`, `internal_settings_enabled`, `internal_verbose_logging` and calls `configure_sidecar_internal_user` and `configure_sidecar_inspect`), starts the port-forward token listener, status logger and existing port forwards, and finally invokes `ensure_sidecar_started` (Rust spawns the Bun sidecar).
   - After the sidecar is up: harness version sync (`onHarnessVersionsNotification`, `getHarnessVersions`) and push of the model catalog (`setModelCatalog`).
   - Then settings-driven wiring, each subscribed to the settings store: feature-flag sync from PostHog into settings (`ebn`), model catalog API fetcher, external-logging-disabled switch (`setExternalLoggingDisabled`, PostHog opt-out), terminal render debug log, internal-user bootstrap, Graphite disabled flag, the local-git forge switch (`QQe`, driven by settings `local_repositories_without_github_enabled` and `local_git_forge_enabled`), port-forward SSH command loader, a one-time check for a ChatGPT plan connection that sets the `codex_provider` default (`Wja`), remote control attach/start tied to the signed-in user (`ZNa`), pinned-section migration (`Tdl`, key `pinned_section_migration_complete:<user>:<org>`), and the keep-awake manager (`gul`, uses `caffeinate`, watches settings, sessions and remote access, and reads battery state).

**Phase 4: routing.** TanStack Router mounts. The workspace route id is `/auth-guard/main-layout/repository/$repositoryId/workspace/$localWorkspaceId` (main @3732900, constant `_tn`), so the main layout sits under an `auth-guard` layout route. `beforeLoad` hooks only redirect (for example `/settings/user` -> `/settings/user/general`, `/settings/user/ports` -> `connections`, `/settings/organization` -> `computer`, `/settings/repos` -> first repo). Extra user settings pages seen here: `appearance`, `key-bindings`, `terminal`, `advanced`, `environment`, `remote-control`, `internal`.

**Ordering facts worth copying:**
- Settings load first because every other service reads settings.
- Sessions reset to idle before any UI sees them, so a crash never leaves a spinner.
- The sidecar starts only after the stores exist, so the first `persistedSessionEvent` ack has somewhere to land.
- A DB written by a newer app version blocks the entire runtime (data safety).


---

## Appendix: gaps and unverified items

Collected from the parts above. Nothing here is hidden elsewhere.

| Gap | Why it is open | How to close it |
|---|---|---|
| Full SQLite schema | `CREATE TABLE` is not in the JS. It sits in Rust sqlx migrations (`_sqlx_migrations`). Column lists here are the columns the frontend touches. | `strings` or a hex dump of the Mach-O for the migration SQL, or open a copy of `conductor.db` read-only (`sqlite3 .schema`). |
| Who sets `session_messages.cancelled_at` | No frontend statement writes it. | Search the sidecar and Rust side. |
| Rust-side behaviour | `send_native_notification`, PTY internals, the `ignore` filter list for file trees, port bind probing, binary verification, updater endpoint, Deepgram key origin. | Disassembly or `strings` on the binary. Marked INFERRED where used. |
| Sidecar side of `setModelCatalog`, `keepAwake`, the MCP tool server | Not in the web bundle. | Cross-check `.context/conductor-re/sidecar.js` (`mcp__conductor__` strings). |
| HTTP verbs of the pending-messages routes; `rpc.request` method names | Not traced end to end. | Read the Roundhouse route table (Part 5B section 9) and the session feed code. |
| Org prompt precedence | Not traced. | Follow the organization prompts settings page. |
| Five of the 15 flag purposes and some Roundhouse key scopes | Marked INFERRED in Part 4. | Read each hook's call sites. |
| Worktree file watching | Under the CEF runtime the JS `fs.watch` is a no-op, so trees are polled every 30 s (Part 5A). Whether Rust watches natively is unknown. | Check `watchexec` use in the bundled `bin/`. |

## Appendix: what a remake should copy, in order

1. The Platform interface and the host value (Part 1.1, 1.2).
2. SQLite with WAL and an append-only event table with an idempotent insert (Part 2).
3. The service container with lazy getters and an explicit start order (Part 6).
4. A per-session serial queue and an ack-after-persist protocol with the agent runner (see `sessions-and-chats.md`).
5. The minimal git command set (Part 3, last section) and checkpoint commits on a private ref namespace.
6. The `.conductor/settings.toml` precedence chain (Part 4).
7. Everything else (Spotlight, port forwarding, cloud, routines, speech) can wait.

# Test quality review: desktop core (without services), platform, test kit

Snapshot read: commit `808d632` of `slice2/step-1` (slice 1 on main plus slice 2 step 1, CI not run).
Area: `apps/desktop/src/core/` except `core/services/`, plus `src/platform/` and `src/test/`.
Nothing was run. All claims below come from reading the code, `rg`, `jq` and `gh`.

## 1. Summary

Files read: 81 test files (15,735 lines) and the source each one tests. Verdicts:

| Verdict | Count |
| ------- | ----- |
| REAL    | 59    |
| WEAK    | 21    |
| THEATER | 1     |

The THEATER file is `platform/system.plat-32.test.ts` (half of it; see M6). The WEAK files are listed in section 4.

The three worst problems:

1. **The stand-ins are not proven to behave like the real thing.** The platform contract (`platform/contract.ts`) has never run against the Tauri platform. It only runs on the in-memory stand-in, so it proves the stand-in agrees with itself. About 15 of its 58 cases assert only what the test scripted on the stand-in. The test database (`test/sqlite.ts`) has no statement queue, while the real wrapper (`platform/tauri.ts:419`) queues every statement. Code that hangs in the app passes in every test (M1, M2).
2. **The composition root is tested with the unbuilt parts removed.** `container.start()` reaches two placeholders today (`runDataLifetimeJob`, and `platform.notifications.onClicked` on the Tauri platform). The container tests replace the first with `vi.mock` and use the memory platform for the second. No test starts the real container over the real Tauri adapters (M3).
3. **Migrations are only tested on an empty database.** Migration 0004 rebuilds `attachments` and `terminals` by copying rows. Nothing migrates a database that already holds rows (M4).

Judgement of the area. The inside of core is well tested: the async helpers, the database layer, the git parsers, the status rules, ingest, resume and the tunnel are mutation-resistant, use injected time and ids, and mostly use real SQLite. The weak spots sit on the seams: Platform to Tauri, test database to the real database wrapper, container to real adapters, and scripted git to real git. Those are the same seams where the slice-1 bugs lived (the deadlock, the unmounted dispatcher), and the test kit currently makes it easy to stay on the safe side of each one.

## 2. Coverage

Measured on main (slice 1 only) from `coverage/files.tsv` and `summary.md` (PR #298, desktop Vitest: 220 files, 2,853 tests, v8). The report covers every desktop test, so a file counts as covered when any test in the repo, including UI tests, runs it. Slice 2 files (`fuzzy.ts`, `snippets.ts`, `provider-keys.ts`, `backlog-workspaces.ts`, `lifetime.ts`) show low numbers only because their tests are not on main yet; I judged those by reading.

| Folder          | Files | Lines | Branches | Functions | Uncovered lines |
| --------------- | ----: | ----: | -------: | --------: | --------------: |
| core/async      |     6 | 97.6% |    89.6% |    100.0% |               3 |
| core/status     |     3 | 98.2% |    99.0% |    100.0% |               1 |
| core/registries |     2 | 99.3% |    97.7% |    100.0% |               1 |
| core/git        |     8 | 93.6% |    81.8% |     77.6% |              43 |
| core/sidecar    |     4 | 93.4% |    76.8% |     87.7% |              20 |
| core/db         |    22 | 90.6% |    61.7% |     82.2% |              61 |
| core (root)     |    10 | 86.0% |    55.5% |     81.9% |              66 |
| platform        |     5 | 86.7% |    72.0% |     75.5% |             161 |
| core/hooks      |    15 | 80.2% |    59.3% |     56.8% |              50 |

Least covered files that matter (lines, branches, uncovered lines):

| File                         | Lines | Branches |                                                                 Uncovered |
| ---------------------------- | ----: | -------: | ------------------------------------------------------------------------: |
| `core/hooks/terminals.ts`    | 48.0% |    18.8% |                                                                        13 |
| `core/hooks/commands.ts`     | 63.6% |     100% |                                                                         4 |
| `core/hooks/github.ts`       | 64.3% |       0% |                                                                         5 |
| `core/hooks/workspaces.ts`   | 68.2% |    46.0% |                                                                        21 |
| `core/container.ts`          | 73.8% |    46.2% |                                                                        60 |
| `platform/tauri.ts`          | 73.9% |    78.5% |                                                                        93 |
| `core/git/gh-commands.ts`    | 78.6% |    61.5% |                                                                        12 |
| `core/db/terminals.ts`       | 78.6% |    50.0% |                                                                         6 |
| `core/db/attachments.ts`     | 81.3% |    45.5% |                                                                         6 |
| `platform/memory.ts`         | 87.6% |    68.0% |                                                                        53 |
| `core/sidecar/handlers.ts`   | 60.9% |     100% | 9 (the four `notImplemented` stubs and unused branches; slice-2 handlers) |
| `main.tsx` (outside my area) | 39.1% |    23.5% |                                                                        42 |

What the numbers say:

- The numbers agree with my reading where I could compare. `tauri.ts` at 73.9% is the untested adapters (section 2). `core/hooks/terminals.ts` and `commands.ts` are the hooks with no core test. `core/container.ts` has 46% branch coverage: the failure branches of `wireAfterStart`, the quit prompt errors and the stop-during-start paths are the uncovered part.
- The numbers do not see the main problems. `platform/contract.ts` shows 97.1% lines and `platform/memory.ts` 87.6%, yet the contract proves only the stand-in (M1). `core/async` is 97.6% and also mutation-strong, but `createOptimisticStore` at 100% has no caller (M12). `core/db` reaches 90.6% lines with 61.7% branches, and still has no upgrade test (M4). High line coverage here comes from tests that run the code on the stand-in, not from tests that check it against the real thing.
- Branch coverage under 62% in `core/db` (and 45 to 54% in `attachments.ts`, `sections.ts`, `workspaces.ts`, `favorite-models.ts`, `repair.ts`) points to error and "row not found" branches of the repositories. `repositories.test.ts` tests "missing row from every setter" for workspaces, repos, chats and others; the UI tests do not reach the rest.
- No coverage number exists for `src/test/` (the report leaves it out by design).

| File                                                                                               | What is untested                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform/tauri.ts` adapters for attachments, http, keychain, menu, notifications, speech, updater | No test file calls them. Keychain, notifications and http are `notImplemented` placeholders (tauri.ts:864, 873, 1030), so the container and PR-01 (token in Keychain) rest on the stand-in.                                                                                |
| `platform/tauri.ts` window, app info, opener, programs                                             | Only focus, quit, `openUrl` and `verificationErrors` are tested. `setZoom`, `setVibrancy`, `setTrafficLightPosition`, `setTheme`, `toggleInspector`, `health`, `writeLog`, `exportLogs`, `resourceUsage`, `openWith`, `installedApps`, `statuses`, `install` have no test. |
| `core/db/lifetime.ts`                                                                              | Statements are tested in `schema.test.ts`. `runDataLifetimeJob` and all five steps are placeholders (DATA-02 `stub`).                                                                                                                                                      |
| `core/async/optimistic.ts`                                                                         | Tested well, but no production code calls `createOptimisticStore` (M12).                                                                                                                                                                                                   |
| `core/hooks/*`                                                                                     | `useRunState`, `useRepoTerminals`, `useModels`, `useCommands`, `useFullDiskAccess`, `useAgentPrograms`, `useTerminalConnection` have no test in core. `useTerminals` and `useAgentInstalls` have none in core either.                                                      |
| `core/sidecar/tunnel.ts`                                                                           | The inbound request success path, invalid inbound params, bad inbound results and a send failure are untested (M14).                                                                                                                                                       |

## 3. Findings

### MUST

**M1. The platform contract never runs against Tauri, and about a quarter of its cases test the script.**
`platform/contract.ts:1-24` admits it: "until that job runs the contract proves the stand-in alone". `runPlatformContract` has one caller, `memory.test.ts:62`, with `{ controls: true }`. The backlog item "contract also runs against the Tauri implementation" is open (`docs/plans/items/system.tsv`, PLAT-01 and PLAT-02, status `missing`).
What is wrong, with lines:

- The five shell cases (`contract.ts:718-821`) call `scriptShell` with the exact answer they then assert. On the stand-in they check the script. The same holds for `pty.exit-code` (queued exit code 5, then asserts 5, line 990), `dialogs.*` (1183-1216), `notifications.badge` and `.click`, `clipboard.write-text`, `sidecar.line-roundtrip` and `window.focus-events`.
- Cases the stand-in passes by construction: `http.invalid-url` (the stand-in's `http.fetch` returns Err for every URL, memory.ts:867), `updater.check` (always `ok(null)`), `opener.installed-apps` (always `[]`), `speech.available`, `system.*`, `programs.*`.
- Counts: 58 cases, 17 marked `os`, 8 marked `controls`. Of the 91 methods on the Platform interface, 31 are never called by any case (for example `pty.resize`, `pty.screenSnapshot`, `fs` symlinks, `fileSearch.grep` success path, `opener.openWith`, `programs.redownload`, `http.download`, `app.exportLogs`).
- `contract.test.ts` checks that each of the 20 groups has one case. It does not check methods. A group with one case counts as covered.
  Mutation missed: change `memory.ts` `shell.run` to return a different but still scripted-looking value for every command; make `http.fetch` succeed for everything except the literal "not a url". No contract test fails. Change `createTauriKeychain` from a placeholder to anything; no test calls it.
  Fix: run the contract over `createTauriPlatform` with fake bindings that are backed by Node: `fs` commands by `node:fs` in a run-owned folder, `sql.load` by `node:sqlite`, `shell_run` by `execFile`, `listen` by an in-process emitter. That honestly covers fs, db, shell (run, cwd, env, stdin, no shell string, timeout), sidecar ensure/send, app and window cases. Skip only the `os` cases that need Rust (pty, keychain, trash, dialogs), and print their count in the test output. Add a method-level check: every method of every Platform group must be named by at least one case or by an explicit `uncovered` list with a reason. Replace each "asserts what the test scripted" case on the stand-in with a case that asserts a property the stand-in has to compute (for example, the stand-in's `listTree` ignoring rules against a `.gitignore` with wildcards, negation and a nested file, to be compared with the Rust `ignore` crate once the contract runs there).

**M2. The test database is a third, weaker database wrapper.**
There are three: `test/sqlite.ts:54` (`NodeDatabase.transaction`), a private copy in `platform/memory.test.ts:12-42` (which has a promise chain but does not hold outside statements), and the app's `createTauriDatabase` (`platform/tauri.ts:419-540`), which runs every statement through one queue, refuses nested transactions, and rejects a handle used after commit. `openTestDatabase` backs `createTestContainer` and about 35 test files.
Consequences:

- A function that calls the outer `db.select` inside a `transaction(work)` callback works in every test (no queue) and hangs in the app (the select waits behind the transaction that waits for it). This is the shape of the slice-1 deadlock.
- Two overlapping transactions throw "cannot start a transaction within a transaction" in tests, but queue in the app. `ingest.test.ts:293` ("lets another chat through in parallel") avoids this by holding the first chat before it opens a transaction, so overlapping transactions are never exercised.
- `tauri-platform.test.ts` tests the wrapper against a hand-written `fakeSql` that records strings. The wrapper has never run on a real SQLite.
  Mutation missed: in `sidecar/ingest.ts`, inside `runInTransaction`, call `this.#deps.repositories().sessions.get(sessionId)` (the outer repositories) instead of `repos.sessions.get(...)`. Every ingest test passes on `NodeDatabase`. The app deadlocks on the first event.
  Fix: build `openTestDatabase` on the real wrapper: `createTauriDatabase({ sql: { load: async () => nodeSqlAdapter } })`, where the adapter implements `SqlDatabase` over `node:sqlite`. Delete the copy in `memory.test.ts`. Add a test in `sqlite.test.ts` that an outer `select` started inside a transaction callback does not complete until commit (assert by order, with the usual timeout as the only hang guard). Add an ingest test with two chats whose transactions really overlap.

**M3. Real startup is never run; the tests remove the parts that would fail.**
`core/container.ts:547` runs `runDataLifetimeJob` as a start step. `core/db/lifetime.ts:222` is `notImplemented("DATA-02")`, which throws, so `start()` rejects (it is not a failed `Result`). `container.ts:594` calls `platform.notifications.onClicked(openLink)`, and the real Tauri `onClicked` is also a placeholder (`platform/tauri.ts:873`). `container.app-01.test.ts:20` and `sidecar/resume.container.chat-18.test.ts:18` both `vi.mock("./db/lifetime.ts")` to return `ok`. Both also spy on every service `start`. `stubStartup` replaces eight service starts, `sidecar.start` and `SessionResume.resume`, so the order test (`container.app-01.test.ts:158`) checks the container's step list, not the services behind it.
Mutation missed: none needed. The defect is live in this snapshot and no test shows it.
Also: the APP-01 row is `done` while its issue (#228) lists about twelve open `missing` items, among them "After start, wire deep link handling", "update checks", "quit handler", "heal Spotlight" (these four are now wired and tested, the items are stale) and "Startup passes the TOML codec and the git runner into settings" (half tested, see L7).
Fix: add one integration test, `container.start-tauri.test.ts`: `createTauriPlatform(fakeBindings)` (the bindings from M1), `createContainer` over it, `await container.start()`. The test must fail on any `NotImplemented` error. Give it an allow-list built from the backlog's `stub` rows, so each placeholder reached shows up by name and the list shrinks as features land. Remove both `vi.mock` of `lifetime.ts` (or make the container skip the step while DATA-02 is a stub, and say so in a warning).

**M4. No migration is tested on a database that holds data.**
`migration-0004.test.ts` opens a fresh database through `openTestDatabase()` (all four files applied to an empty DB). Migration 0004 renames `attachments` and `terminals`, creates new tables and copies rows (`0004...sql:23-70`). 0002 and 0003 also use `ALTER` and `INSERT`. The prior audit (`s2-1-core-1.md:22`) said the same; it is still open.
Mutation missed: remove `is_draft` from the `INSERT INTO attachments (...) SELECT ...` list at 0004:39. Every test passes. A user's draft attachments would lose their draft flag on upgrade. The same applies to dropping `exit_code` in the terminals copy.
There is a second gap. sqlx runs each migration inside a transaction. In SQLite `PRAGMA foreign_keys` is a no-op inside a transaction, and `ALTER TABLE ... RENAME` rewrites foreign keys that point at the renamed table. The test kit runs `raw.exec(sql)` outside a transaction, so it cannot show either effect.
Fix: add `openTestDatabase({ upTo: n })` to the kit (apply files up to n, return the handle, let the test apply the rest). Test: seed rows at 0003 (repo, workspace, session, attachment with `is_draft = 1`, terminal with `exit_code`, diff comment), apply 0004 inside `BEGIN ... COMMIT` with foreign keys on, and compare every column of every copied row. Do the same for 0002 and 0003.

**M5. Migration files, the Rust migration list and the kit can disagree.**
The kit reads every `*.sql` in `src-tauri/migrations` (`test/sqlite.ts:21-24`). The app uses the explicit list `db::migrations()` in `src-tauri/src/db.rs:43`. `scripts/guards/migrations.ts` only checks the hash lock. A new `0005_*.sql` that is missing from `db.rs` is applied in every test and never in the app.
Fix: a guard (script test) that the set of `include_str!("../migrations/...")` names in `db.rs` equals the set of files and the set in `migrations.lock`. Include a sample that must be flagged.

**M6. `platform/system.plat-32.test.ts:5-35` tests the stand-in (THEATER).**
The first two tests call `memory.controls.setSystemInfo(info)` and read `memory.platform.system.info()`; the second makes `failSystemInfo` throw and expects a throw. No product code runs. The prior audit flagged it (`s2-1-rust-2.md:30`) and it is unchanged. The hook test `hooks.system.plat-32.test.tsx` already uses the same controls through the real hook and service, so the two tests add nothing.
Mutation missed: any change in product code. Fix: delete the two tests; keep the Tauri pair at line 41 onward.

**M7. Real size is not tested where the rule says it must be.**
`docs/engineering.md` asks for "a chat with 20,000 events". `sidecar/ingest.ts` `#turnHasEnded` runs `listByTurn` (all columns, JSON-parsed, `session-events.ts:98`) for every event it ingests. For a turn with N events the app reads about N squared / 2 rows, inside a transaction that the wrapper holds on the single queue. A tool-heavy turn of 3,000 events reads about 4.5 million rows. No test ingests more than a handful of events (`ingest.test.ts`: 15 tests, longest list is 3 events). `repositories.test.ts` and `schema.test.ts` also never use more than a few rows. Only `serial-queue.test.ts:246` (5,000 keys), `fuzzy.test.ts:157` and `status.test.ts:325` (10,000 paths) are sized.
Fix: ingest 3,000 events of one turn through `EventIngest` and assert the rows read by counting `select` calls and returned rows on a wrapping `Database` (a count, not a time). Then change `#turnHasEnded` to `SELECT 1 ... WHERE type = 'turn_ended' LIMIT 1`. Add a 20,000-event `listFrom` paging case in `repositories.test.ts`.

**M8. `actions.test.ts` cannot see a swapped or wrong action.**
`actions.test.ts:111-135` ("reaches exactly one service or platform call from every action") only asserts `calls.length === 1` for each of more than 100 actions. Only one action per group has its target path checked (lines 70-107).
Mutation missed: in `actions.ts`, swap `markRead` and `markUnread` (`workspaces.markRead: services.sessions.markAllRead` and `markUnread: services.sessions.markWorkspaceUnread`), or `archive` and `unarchive`. Both have identical signatures, so the types accept it, and the leaf test still sees one call.
Fix: record the path per leaf and compare with an explicit table (or an `toMatchInlineSnapshot` of `leaf -> service.method`) that reviewers read once. Forward-check the arguments: call with distinct sentinel values and assert they arrive in order.

**M9. `registries/consumption.test.ts` is a time bomb.**
Line 91: `expect(statusOf("RUN-01")).toBe("stub")`. When RUN-01 ships (slice 2), this fails for a good reason and wastes a fix round. Lines 94-110 pin exact lists: 14 settings and 20 commands (the terminal, review and chat.question commands, `dialog.confirm`, `view.toggleTerminalPanel`) of features marked `done` that no code names. Every feature that flips to `done` can break the lists, and the suite reads `docs/plans/backlog.md` by a relative path.
Fix: test `statusOf` with a small backlog string passed in, not the real file. Keep the lists but make each entry name the owning feature, so removing a gap and shrinking the list happens in the PR that wires it. (The lists do show a real hole: 20 registered commands have no handler in `done` features; see the checklist map.)

**M10. The test kit's seed helpers are not deterministic and `close` does not stop the container.**
`test/container.ts:86-135`: `seedRepo` and `seedWorkspace` use `FIXED_CLOCK` and `crypto.randomUUID()`, not the clock and ids the test passed in (`createTestContainer({ ids, clock })` only reaches the container). Two workspaces seeded in one test get the same `createdAt` and random ids; `useWorkspaces` sorts by `createdAt` then `id.localeCompare` (`hooks/workspaces.ts:~90`), so their order is random. About 8 test files seed two or more workspaces (for example `SectionList.nav-04`, `HomeScreen`, `sessions.nav-11`). `close()` only closes the database; it neither awaits `container.stop()` nor checks `memory.controls.dispose()`, although `engineering.md` requires "release what you hold". `container.test.ts` ("close releases the database") proves only the SQLite handle.
Mutation missed: none. This is a flake source and a leak that no test sees.
Fix: store `ids` and `clock` on the `TestContainer` and use them in the seed helpers; give the default clock a strictly increasing value; make `close` async: `await container.stop()`, then assert `memory.controls.dispose() === 0` (throw if not), then close the database. `createTestContainer` also needs the option to start with `container.start()` for integration tests.

**M11. Scripted git is the only proof for workspace creation, archive and rename.**
`worktree.test.ts` (21 tests), `worktree.ws-05.test.ts`, `rename.test.ts` and `commands.test.ts` use hand-built `GitRunner`s (a fifth copy of `makeRunner` and `fakeFs` lives in `worktree.test.ts:36-108`) that answer with text the author wrote. They assert call order (`worktree.test.ts:165`: `["rev-parse","fetch","rev-parse","worktree","rev-parse"]`) and exact arrays. The only real-git test is `status.real-git.test.ts` (one test). Nothing checks that git accepts the flags, that `rev-parse HEAD` on an unborn branch prints what `createWorktree` expects, that `worktree add --detach` and `--git-path` behave as assumed, or what `checkpointer.sh` exits with (WS-05 reads exit codes 101 and 102 from a script the test never runs).
Mutation missed: change `--no-write-fetch-head` to a flag git does not know in `commands.ts` and in `commands.test.ts`'s expectation (the author copies one into the other); change the unborn-HEAD stderr match in `createWorktree`. Scripted tests pass.
Fix: one real-git test file (`worktree.real-git.test.ts`), in the style of `status.real-git.test.ts` but with a local bare repository as `origin`: create, prepare (check `.git/info/exclude`, worktree config), branch-name checks, rename, remove, plus "every command in the catalogue parses under real git" (run each read-only command in a fixture repo, assert exit code is in `okExitCodes`). Run it with `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_SYSTEM=/dev/null` so it does not depend on the user's git config (`status.real-git.test.ts` does not set them).

**M12. `createOptimisticStore` is tested, but nothing uses it (APP-11).**
`rg createOptimisticStore` finds no caller outside `core/async/`. The APP-11 item "Service stores apply an optimistic overlay that rolls back on failure" is covered by a helper test that would pass if no store ever used it. `settings.ts` has its own private optimistic write.
Fix: either wire it into the settings, workspace and repo stores (the services-map says they use it) or delete the helper and mark the item as moved. Do not keep nine green tests over dead code.

**M13. The tunnel's inbound side has no success or validation test (CHAT-18).**
`tunnel.chat-18.test.ts` covers outbound requests, timeouts, restart, reconnect backoff, ordering, and two inbound errors (-32601, -32603). It does not cover: a valid inbound request that gets its result back (`#registerHandlers` at `tunnel.ts:~330`); inbound params that fail the schema (-32602); a handler result that fails its result schema; a sidecar error response mapped to `rpc_error_<code>`; `transport.send` failing (`rpc_failed`); a late answer after a timeout being dropped; `stop()` failing pending requests.
Mutation missed: in `#registerHandlers`, return `output` instead of `validated.data`; or skip `spec.params.safeParse`. No test fails.
Fix: add those seven tests in the same harness (the fake transport and fake timers are already there). The resume container test already shows the happy path for `deliverEvent` through the real handlers, so one of them can be an `it.each` over methods of `sidecarToAppRequests` that sends a valid, an invalid and a failing-handler case.

**M14. Duplicate rule: the git state mapping lives twice.**
`core/hooks/workspaces.ts:55` `gitStateOf` and `core/services/git.ts:577` `GitService.stateOf` build the same `GitState` from the same snapshot and PR entry, line for line. `hooks.workspace-status.test.tsx` proves the first, `hooks/git.git-04.test.tsx` the second. If one changes, the other is not noticed (D049 lists duplicated logic as MUST).
Fix: `useWorkspaceStatus` calls `services.git.stateOf`; keep the GIT-04 tests as the proof.

**M15. Checklist items with no failing test (summary; details in section 5).**
PLAT-01 and PLAT-02 (contract on Tauri), APP-11 (optimistic store use), APP-01 (TOML codec half; startup over real adapters), DATA-08 (upgrade), GIT-01 (flags valid in git), NAV-07 (`project.add` flow, handlers for the 20 commands), CHAT-18 (inbound validation), PLAT-02 (web inspector, window setters, app info commands).

### LATER

- **L1. `fuzzy.test.ts:39-50`** does not test word-start or camelCase boundary scoring that the file header claims (APP-15). Mutation missed: delete the word-boundary bonus in `fuzzy.ts`; "xapp" versus "App" still ranks as the test expects. Add "Open Settings" with "os" against "Hostname" and "fooBarBaz" with "fbb".
- **L2. `platform/tauri*.test.ts` use the production `COMMANDS` and `EVENTS` constants for the expected names** (40 uses). Renaming `fsReadText: "fs_read_text"` to a typo passes. Only `EVENTS.windowFocus` is pinned to a literal. Add one literal table test per group, then a guard comparing `COMMANDS` to `generate_handler!` in `src-tauri/src/lib.rs` and to `docs/plans/tauri-commands.md`. Today that guard would flag 20 TypeScript names with no Rust handler (all of them belong to `stub` rows: `http_fetch`, `http_download`, `http_cancel`, `program_install`, `program_redownload`, `program_remove`, `programs_prefetch`, `programs_state`, `programs_sync_path_overrides`, `programs_verification_errors`, `search_list_artifacts`, `set_quit_handler_ready`, `updater_installed_update`, `window_set_traffic_lights`, `window_set_vibrancy`, `window_toggle_inspector`, `network_status`, `full_disk_access_check`, `full_disk_access_open_settings`, `log_set_level`) and one Rust name no TypeScript calls (`notification_take_pending`). The guard needs an allow-list read from the backlog.
- **L3. Seven Tauri adapters have no test at all** (attachments, http, keychain, menu, notifications, speech, updater) and four have partial tests (see section 2). The first three are placeholders today; test them when their features land, in the contract run from M1.
- **L4. `git/locks.test.ts`** repeats three tests of `serial-queue.test.ts` (`KeyedMutex` is a wrapper over `createKeyedQueue`). Keep the key-builder test and the one test that the repo lock is taken inside the worktree lock (already in `runner.test.ts:460`).
- **L5. Hand-built containers in hook tests** break the `engineering.md` rule "screens are tested over the real container": `hooks.chats`, `hooks.repos`, `hooks.repo-config`, `hooks.rev-01`, `hooks.rev-02`, `hooks/github.pr-11`, `context.test`. `rev-02` and `pr-11` also assert the error text and values the test passed into a `vi.fn`. Move them to `createTestContainer` and set store state through the real services.
- **L6. Helpers copied between test files**: `const bind` in 12 files, `const must` in 24, `deferred` in 10, `flush` in 7. Export `rawRun`, `rawRows`, `must`, `deferred`, `flush` from `src/test/`. The kit currently makes the raw `node:sqlite` route (the one that skips the Database interface) the easy one.
- **L7. `container.app-01.test.ts`**: the "TOML codec and git runner" test (line ~143) asserts only that a `git` shell call happened; the memory file system is empty, so the codec is never called and removing `toml: inputs.toml` is not caught. `SERVICE_NAMES` is a hand list, copied in `test/container.test.ts` too, so a new service goes unnoticed (derive it from the `Services` type via a satisfies-check). The "resets chat live state" test finds the statement by the substring `UPDATE session_live_state`.
- **L8. `core/git/xcode-license.test.ts:42-52`** asserts the args against the exported constant `XCODE_LICENSE_CHECK_ARGS`; a wrong flag passes. Pin the literal.
- **L9. `status.real-git.test.ts`** uses `os.tmpdir()` and the user's git config. Use the run folder and the two `GIT_CONFIG_*` variables from M11. It also tests only branch scope; add uncommitted-only and a rename with spaces.
- **L10. `sidecar/handlers.chat-10.test.ts` and `chat-11`** assert only that a `vi.fn` was called with its own argument. Merge them into the `handlers.chat-18.test.ts` style, and add the stub handlers' behaviour (`getDiffComments`, `addDiffComments`, `progress` and `goalChanged` throw `NotImplemented` and the tunnel answers -32603; one test that the tunnel survives it).
- **L11. `async/serial-queue.test.ts`**: add a failing barrier task (later work on the same keys still runs) and two overlapping barriers. The title "runs a task even when its caller stops waiting" (line 255) does not stop waiting for anything. `async/backoff.test.ts`: `checkBackoffPolicy` throws `RangeError` (violates "no hidden throws" in the architecture notes); the NaN and `jitter > 1` branches are untested.
- **L12. `memory.ts` pty `kill` ends with 143 and `write` after exit is silently ignored**; the Tauri contract case says "write returns without error". Check what Rust does, and make the stand-in match the case.
- **L13. `registries/settings.test.ts` and `commands.test.ts`** pin incidental data ("left panel width 256", `app.toggleTheme` shortcut `Cmd+Alt+T`). Change of a default is a product decision; keep the invariants (unique, parseable, in range) and drop the pinned values except where the research file is the source.
- **L14. `status/git-header.test.ts:63`** is one 225-line `it` over a table of 12 states. A failure names no row. Use `it.each`.
- **L15. Contract self-test** (`contract.test.ts`) imports `PLATFORM_CONTRACT_CASES` and a helper written in the same file. It proves the group check works but not that the step table has no group without a case in `STEPS` (`runPlatformContract` throws, which a test of the harness covers only by running a case). Fine; add the method-level check from M1 next to it.

## 4. Per-file verdicts

REAL: the test fails if the named behaviour breaks. WEAK: real in part. THEATER: green with the feature removed.

### core root and async

| File                                 | Verdict | Reason                                                                                                                      |
| ------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| `core/actions.test.ts`               | WEAK    | Counts calls only; a swapped action passes (M8).                                                                            |
| `core/app-paths.test.ts`             | REAL    | Exact paths are the contract with scripts and Rust.                                                                         |
| `core/async/backoff.test.ts`         | REAL    | Fake clock and `random`; cap, jitter, reset window, bad policy. Mutation: drop the cap `Math.min` and the 8,000 case fails. |
| `core/async/fire-and-forget.test.ts` | REAL    | Caller continues first; async and sync failures reported.                                                                   |
| `core/async/latest-wins.test.ts`     | REAL    | Late ticket, invalidate, keys, settle; the counter never revives an old ticket.                                             |
| `core/async/optimistic.test.ts`      | REAL    | Overlap, late older result dropped, push wins, rollback. The helper has no caller (M12).                                    |
| `core/async/serial-queue.test.ts`    | REAL    | Order, failure, barrier, idle-key cleanup at 5,000 keys. See L11.                                                           |
| `core/async/single-flight.test.ts`   | REAL    | Shared result and failure, fresh run after, sync throw.                                                                     |
| `core/container.app-01.test.ts`      | WEAK    | Mocks the lifetime job, spies every service start; codec half untested (M3, L7).                                            |
| `core/container.github.test.ts`      | REAL    | Keychain token reaches `gh` env; settings choice reaches `GH_TOKEN`. Drop `keychain:` in the container and it fails.        |
| `core/container.nav-07.test.ts`      | REAL    | Each context flag read from the right store.                                                                                |
| `core/container.stop.app-01.test.ts` | REAL    | Gated database; stop waits for an event being stored, ends a start in progress, runs every step.                            |
| `core/context.test.tsx`              | REAL    | Small and sufficient.                                                                                                       |
| `core/fuzzy.test.ts`                 | WEAK    | Boundary scoring claim untested (L1).                                                                                       |
| `core/lookups.test.ts`               | REAL    | Error values for unknown ids, remote from config, no guessing before load.                                                  |
| `core/workspace-open.test.ts`        | REAL    | Every state and the archived date.                                                                                          |

### core/db

| File                                 | Verdict | Reason                                                                                                 |
| ------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------ |
| `core/db/schema.test.ts`             | REAL    | Every statement prepared against the real migrations; round trips; idempotent append; compare-and-set. |
| `core/db/rows.test.ts`               | REAL    | Row codec both ways, bad JSON as `Err`.                                                                |
| `core/db/repositories.test.ts`       | REAL    | Real SQLite; ids and time injected; missing rows from every setter. No real size (M7).                 |
| `core/db/repair.test.ts`             | REAL    | Crashed database fixture, second run is a no-op, atomic on failure.                                    |
| `core/db/backlog-workspaces.test.ts` | REAL    | Mapping errors, ordering, cascade.                                                                     |
| `core/db/provider-keys.test.ts`      | REAL    | Empty-string agent, Keychain reference rule.                                                           |
| `core/db/snippets.test.ts`           | REAL    | Duplicate keyword rules, case-insensitive listing.                                                     |
| `core/db/migration-0004.test.ts`     | WEAK    | Fresh database only (M4).                                                                              |

### core/git

| File                               | Verdict | Reason                                                                                          |
| ---------------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `core/git/runner.test.ts`          | REAL    | Retries at 50, 100 and 200 ms with an injected `sleep`, HTTPS fallback, lock order, warm timer. |
| `core/git/status.test.ts`          | REAL    | Parsers and failure paths on a scripted runner.                                                 |
| `core/git/status.real-git.test.ts` | REAL    | The only real-git test; one scenario (L9).                                                      |
| `core/git/diff.test.ts`            | REAL    | Comparison rules.                                                                               |
| `core/git/refs.test.ts`            | REAL    | Ref names are a contract with `checkpointer.sh`.                                                |
| `core/git/rename.test.ts`          | REAL    | Scripted, covers failed checks.                                                                 |
| `core/git/locks.test.ts`           | REAL    | Three of four tests duplicate `serial-queue.test.ts` (L4).                                      |
| `core/git/commands.test.ts`        | WEAK    | Argument arrays copied from the source; never run under git (M11).                              |
| `core/git/gh-commands.test.ts`     | WEAK    | Same. The "pins to the head commit" cases are good but unproven against `gh`.                   |
| `core/git/worktree.test.ts`        | WEAK    | Scripted answers, call-order pins, own `GitRunner` and `FileSystem` copies (M11).               |
| `core/git/worktree.ws-05.test.ts`  | WEAK    | Exit codes 101 and 102 of `checkpointer.sh` are assumed (M11).                                  |
| `core/git/xcode-license.test.ts`   | REAL    | One tautological assertion (L8).                                                                |

### core/hooks

| File                                   | Verdict | Reason                                                                                        |
| -------------------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `core/hooks.chats.test.tsx`            | REAL    | Re-render isolation is asserted by render count; hand-built container (L5).                   |
| `core/hooks.repos.test.tsx`            | REAL    | Hand-built container (L5).                                                                    |
| `core/hooks.repo-config.test.tsx`      | REAL    | Hand-built container; `vi.fn` for load.                                                       |
| `core/hooks.nav-07.test.tsx`           | REAL    | Real settings service, rebinding changes the hint.                                            |
| `core/hooks.settings.test.tsx`         | REAL    | Default before load, follows the store.                                                       |
| `core/hooks.system.plat-32.test.tsx`   | REAL    | Real hook and service over the stand-in; error message is the service's own.                  |
| `core/hooks.workspace-status.test.tsx` | REAL    | Real services, status follows each store (M14).                                               |
| `core/hooks.rev-01.test.tsx`           | WEAK    | `vi.fn` service, hand-built container, result is what the mock returned.                      |
| `core/hooks.rev-02.test.tsx`           | WEAK    | Asserts the error text the test supplied ("nope"). The whitespace argument assertion is real. |
| `core/hooks/git.git-04.test.tsx`       | REAL    | Real test container, real `stateOf`.                                                          |
| `core/hooks/github.pr-11.test.tsx`     | WEAK    | Hand-built container, `vi.fn` services; the "no request without a remote" cases are real.     |
| `core/hooks/sections.nav-04.test.tsx`  | REAL    | Thin but correct.                                                                             |

### core/registries, status, sidecar

| File                                            | Verdict | Reason                                                                                                                              |
| ----------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `core/registries/commands.test.ts`              | REAL    | Shortcut parsing, conflicts, overrides, fixed commands. Some pinned data (L13).                                                     |
| `core/registries/settings.test.ts`              | REAL    | Table invariants and coercion. Some pinned data (L13).                                                                              |
| `core/registries/consumption.test.ts`           | WEAK    | Fails when RUN-01 ships; exact lists (M9).                                                                                          |
| `core/status/git-header.test.ts`                | REAL    | One huge `it` (L14).                                                                                                                |
| `core/status/pull-request-status.test.ts`       | REAL    | Closed or merged never reads as failing or ready.                                                                                   |
| `core/status/workspace-status.test.ts`          | REAL    | Full priority order.                                                                                                                |
| `core/sidecar/tunnel.chat-18.test.ts`           | WEAK    | Strong outbound and reconnect tests; inbound validation missing (M13). Kept WEAK because the protocol boundary is the named focus.  |
| `core/sidecar/ingest.test.ts`                   | WEAK    | Real SQLite and strong on order, idempotence, rollback, logger failure; never overlaps transactions (M2) and has no real size (M7). |
| `core/sidecar/resume.chat-18.test.ts`           | REAL    | Real repositories and sessions service; stale status answer dropped; reconnect re-run.                                              |
| `core/sidecar/resume.container.chat-18.test.ts` | REAL    | Real container, real handlers, restart then interrupted turn stored. (Mocks the lifetime job, M3.)                                  |
| `core/sidecar/handlers.chat-18.test.ts`         | REAL    | `persisted: false` on failure; thrown errors for the tunnel to log.                                                                 |
| `core/sidecar/handlers.git-08.test.ts`          | REAL    | Both result shapes.                                                                                                                 |
| `core/sidecar/handlers.rev-01.test.ts`          | REAL    | Failed diff becomes text.                                                                                                           |
| `core/sidecar/handlers.run-07.test.ts`          | REAL    | Arguments and text fallback.                                                                                                        |
| `core/sidecar/handlers.side-20.test.ts`         | REAL    | Stored and thrown.                                                                                                                  |
| `core/sidecar/handlers.chat-10.test.ts`         | WEAK    | Forwarding check against a `vi.fn` (L10).                                                                                           |
| `core/sidecar/handlers.chat-11.test.ts`         | WEAK    | Same.                                                                                                                               |

### platform

| File                                  | Verdict | Reason                                                                                                                              |
| ------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `platform/contract.test.ts`           | WEAK    | Group-level check only; contract never run on Tauri (M1).                                                                           |
| `platform/memory.test.ts`             | WEAK    | Runs the contract on the stand-in; its own database copy differs from the app's (M1, M2). The eight stand-in tests are real.        |
| `platform/system.plat-32.test.ts`     | THEATER | Two stand-in tests test the stand-in (M6); two Tauri tests are pass-through.                                                        |
| `platform/tauri-platform.test.ts`     | REAL    | The database wrapper queue, merge, nested and closed-handle rules are tested with ordering and gates. Scripted `fakeSql` only (M2). |
| `platform/tauri-pty.test.ts`          | REAL    | Exit before the spawn answer, foreign exit ignored, listener released.                                                              |
| `platform/tauri-sidecar.test.ts`      | REAL    | Unsubscribe before listen resolves, failed listen.                                                                                  |
| `platform/tauri-window.test.ts`       | REAL    | Focus events only (section 2).                                                                                                      |
| `platform/shell.test.ts`              | REAL    | `done` event routing, failed listen retried.                                                                                        |
| `platform/tauri.test.ts`              | REAL    | Error mapping, `invokeResult`, health.                                                                                              |
| `platform/tauri.verification.test.ts` | REAL    | Error is thrown, not turned into an empty list.                                                                                     |
| `platform/tauri-file-search.test.ts`  | WEAK    | Returns what the test handed it; command names from the constants (L2).                                                             |
| `platform/login-env.test.ts`          | WEAK    | Same (L2).                                                                                                                          |

### test kit

| File                            | Verdict | Reason                                                                          |
| ------------------------------- | ------- | ------------------------------------------------------------------------------- |
| `test/sqlite.test.ts`           | REAL    | Foreign keys, rollback, isolation. Does not compare with the real wrapper (M2). |
| `test/container.test.ts`        | WEAK    | Hand list of services, `toBeDefined` (L7); seed ids not deterministic (M10).    |
| `test/container.jsdom.test.tsx` | REAL    | The container renders a seeded workspace under jsdom.                           |
| `test/setup.test.tsx`           | REAL    | The polyfills load without a manual import.                                     |

Counts check: REAL 59, WEAK 21, THEATER 1 (81 files, one row each).

## 5. Checklist map gaps

Source: issue checklists (`gh issue view`: PLAT-01 #7, APP-11 #238, APP-01 #228, DATA-03 #86, DATA-04 #87, CHAT-18 #141, PLAT-02 #8, GIT-01 #177, DATA-01 #84, WS-09 #106, NAV-07 #115, SET-01 #215) and `docs/plans/items/system.tsv`. Items with a failing test are not listed.

| Feature | Item                                                                                                                     | Gap                                                                                                                                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PLAT-01 | The Platform contract runs against the real Tauri implementation                                                         | no test (M1)                                                                                                                                                                                                               |
| PLAT-02 | The Platform contract test also runs against the Tauri implementation, in the end-to-end job                             | no test (M1)                                                                                                                                                                                                               |
| PLAT-02 | Open the web inspector from the app                                                                                      | no test (`window.toggleInspector` untested; command `window_toggle_inspector` has no Rust handler)                                                                                                                         |
| PLAT-02 | Window setters, app info commands (`health`, `writeLog`, `exportLogs`, `resourceUsage`) through the Tauri adapter        | no test                                                                                                                                                                                                                    |
| PLAT-02 | A SQLite call slower than 1000 ms is written to the log                                                                  | test exists, but items file still says `missing`; refresh the item status                                                                                                                                                  |
| PLAT-02 | Identical concurrent select calls are merged                                                                             | test exists; same stale status                                                                                                                                                                                             |
| PLAT-01 | Platform stand-in "passes the contract"                                                                                  | test would pass for the 15 script-echo cases without the feature (M1)                                                                                                                                                      |
| APP-11  | Service stores apply an optimistic overlay that rolls back on failure                                                    | test would pass without the feature: no store uses the helper (M12)                                                                                                                                                        |
| APP-11  | Writes are queued serially per chat, per database and per local file write                                               | database: no test of a shared per-database queue (the wrapper's queue is tested, but the services' own queues are in `core/services`); local file write: no test in my area                                                |
| APP-11  | An exponential backoff counter spaces retries of polls                                                                   | test exists; used only by the tunnel; polls (git, PR) have no backoff use                                                                                                                                                  |
| APP-01  | Startup passes the TOML codec and the git runner into settings                                                           | git half tested; TOML half test would pass without it (L7)                                                                                                                                                                 |
| APP-01  | A container test proves settings load first                                                                              | test exists but with stubbed starts; the real `settings.start` is wrapped, not replaced, so it is acceptable                                                                                                               |
| APP-01  | Services start in order, with the sidecar last; data lifetime step                                                       | the final step is a mocked placeholder (M3)                                                                                                                                                                                |
| APP-01  | Mutation cache logs errors with variables redacted; React root error handlers; unhandled rejections; drag and drop guard | not in my area (app/), listed `missing`                                                                                                                                                                                    |
| APP-01  | Start with the real Tauri adapters                                                                                       | no test (M3)                                                                                                                                                                                                               |
| DATA-03 | The repair report acts on workspaces left in archiving                                                                   | `repair.test.ts:358` reports them; the container acts through `workspace.recoverArchiving`. No container test runs that path against a real database (container tests use `recordingDatabase` whose `select` returns `[]`) |
| DATA-03 | Order guarantee: chat live state is reset before any screen reads it                                                     | `container.app-01.test.ts:206` checks the order against a SQL substring on a recording database. The reset itself is proven in `repair.test.ts`. Adequate; use a real database to prove both in one test                   |
| DATA-04 | Inbound events persisted, then acknowledged, through one serial queue per session                                        | tested; transaction overlap across chats not tested on a realistic database (M2)                                                                                                                                           |
| DATA-04 | The sidecar never writes the database                                                                                    | no test (architecture rule; the guard is the import boundary)                                                                                                                                                              |
| DATA-08 | Migration 0004 columns, kinds and flags                                                                                  | fresh database only (M4)                                                                                                                                                                                                   |
| GIT-01  | Fetch does not write FETCH_HEAD; Discard changes; Diff scopes; read `user.name` and `user.email`                         | argument arrays only; never run under git (M11)                                                                                                                                                                            |
| GIT-01  | A git call returns stdout on success and fails with stderr text                                                          | tested on a scripted shell; real-git test covers refresh only                                                                                                                                                              |
| NAV-07  | Connect `project.add` to the add-project flow                                                                            | `container.nav-07.test.ts:42` proves the picker is asked and an empty answer fails; no test adds a project from a picked folder                                                                                            |
| NAV-07  | Missing registry commands (loadouts, snippet, goal, sidecar logs, forward ports)                                         | registered and tested as table entries; 20 commands of `done` features have no handler (`consumption.test.ts` KNOWN list)                                                                                                  |
| NAV-07  | Key-cap hint reads the live binding                                                                                      | tested (`hooks.nav-07.test.tsx`)                                                                                                                                                                                           |
| CHAT-18 | The app handler is `notImplemented("CHAT-18")` (moved from SIDE-10)                                                      | status `missing` in items file; handlers are real and tested; refresh the status                                                                                                                                           |
| CHAT-18 | Per-method timeout, tunnel, restart, resume                                                                              | tested                                                                                                                                                                                                                     |
| CHAT-18 | Inbound validation and success path of the tunnel                                                                        | no test (M13)                                                                                                                                                                                                              |
| SET-01  | A container test proves settings load first (moved)                                                                      | covered by the APP-01 test above                                                                                                                                                                                           |
| DATA-01 | Query option preset and `gcTime`                                                                                         | in `app/query-options.ts`, other reviewer                                                                                                                                                                                  |
| DATA-01 | Add one repository call that applies favourite-model changes in a single transaction                                     | no test (`missing`)                                                                                                                                                                                                        |
| DATA-01 | Every SQL statement is tested against a real SQLite database                                                             | covered (`schema.test.ts` prepares every statement and runs the main ones). Real size missing (M7)                                                                                                                         |
| WS-09   | Workspace status as a pure function                                                                                      | tested at three levels (rule, predicates, hook)                                                                                                                                                                            |

Backlog rows marked `done` whose issue still lists unbuilt items: APP-01 (about 12 items), DATA-03 (2), PLAT-01 (1), PLAT-02 (7), DATA-01 (6). The rows are `done` because the open items were moved to other features by D041, but the target features (for example the `project.add` flow, `Retry` and `Recover` buttons) have no row that carries a test for them yet. Confirm each moved item landed on a feature row with a test, or the item is silently dropped.

## 6. Missing test layers

| Layer                                       | What it covers                                                                                                               | Why it matters here                                                                                                                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract on Tauri with Node-backed bindings | The 58 contract cases over `createTauriPlatform` with `node:fs`, `node:sqlite` and `execFile` behind the bindings.           | The only way the stand-in is checked against the adapter before an end-to-end job exists (M1).                                                                                        |
| Test database on the real wrapper           | `openTestDatabase` built on `createTauriDatabase` over `node:sqlite`.                                                        | Makes the slice-1 deadlock shape fail in tests (M2).                                                                                                                                  |
| Container over the Tauri platform           | `createContainer` + `createTauriPlatform(fakeBindings)` + `start()` + `stop()`.                                              | Finds placeholders and missing bindings on the start path (M3).                                                                                                                       |
| Upgrade migration                           | Seed at N-1, apply N inside a transaction with foreign keys on, compare rows.                                                | Data-shape changes (M4).                                                                                                                                                              |
| Migration list parity                       | `db.rs` list = files = lock.                                                                                                 | Kit versus app (M5).                                                                                                                                                                  |
| Real git                                    | Create, prepare, rename, remove, archive snapshot, command catalogue under git, with a local bare `origin`.                  | Scripted git cannot find wrong flags (M11).                                                                                                                                           |
| Tunnel against the real sidecar             | A tunnel connected to the Bun sidecar over a pipe: `getSessionStatus`, a `deliverEvent` round trip, a restart.               | Both ends of the schemas are in different packages; this is the cheapest check that they agree. It belongs to the sidecar reviewer's area; listed here because the tunnel is in mine. |
| Real size                                   | 3,000 events in one turn through ingest; 20,000 events through `listFrom`; 300 workspaces through `useWorkspaces`.           | Engineering rule; M7.                                                                                                                                                                 |
| Overlap                                     | Two chats' transactions at once; two `resume` runs with a reconnect between; a hook unmounting while its query is in flight. | The latest-wins and single-flight helpers are well tested alone; their use under the real wrapper is not.                                                                             |

Seams only an integration test covers, and whether one exists today:

- Container start over real services: partly (`resume.container.chat-18.test.ts`, which mocks the lifetime job and spies seven service starts).
- Tunnel + handlers + ingest + database: yes (`resume.container.chat-18.test.ts` "stores a replayed event once").
- Container + real Tauri adapters: no.
- Wrapper queue + services' transactions: no.
- Migration + stored data: no.
- Command names TS + Rust: no.

## 7. Rules and guards

Rules worth adding to `docs/engineering.md`:

1. **A stand-in and the thing it replaces share their tests.** Any adapter, queue or wrapper that the app depends on is used in tests as the real code over a fake lower layer (here: the Tauri database wrapper over `node:sqlite`), not as a second implementation.
2. **A start path test uses no `vi.mock` of a source file.** The container start is tested over the real adapters, with unbuilt features named in a visible allow-list.
3. **A data-shape change comes with an upgrade test.** Seed old shape, migrate, compare.
4. **A test never imports the constant it checks.** Expected wire names, flags and paths are literals, written from the research file.
5. **A time bomb is a bug.** A test may not assert the status of a backlog row; it receives the text.
6. **Seed helpers use the container's clock and ids.**

Deterministic checks a script could run (guards), with what each flags today in this area:

| Check                                                                                                                                                                                           | What it flags in this area today                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A test file with no `expect(`, `assert` or `toThrow`                                                                                                                                            | Nothing (every file has assertions).                                                                                                                                                                                                                                  |
| A test whose only assertions are `toHaveBeenCalled*` on a `vi.fn` it created                                                                                                                    | `handlers.chat-10`, `handlers.chat-11`; partly `hooks.rev-01`, `hooks.rev-02`, `hooks/github.pr-11`.                                                                                                                                                                  |
| `vi.mock(` of a source module in a test whose subject imports that module                                                                                                                       | `container.app-01.test.ts:20` and `resume.container.chat-18.test.ts:18` (both mock `lifetime.ts`).                                                                                                                                                                    |
| `as never`, `as unknown as Container` or `{ services: ... } as ...` where a `Container` is passed to `ServicesProvider`                                                                         | `hooks.chats`, `hooks.repos`, `hooks.repo-config`, `hooks.rev-01`, `hooks.rev-02`, `hooks/github.pr-11`, `hooks.settings`, `hooks.nav-07`, `hooks.workspace-status`, `context.test` (10 files; the last three build real services with `{}` deps and are acceptable). |
| An expected value in a test that is an import of a constant also used by the code under test (a quick check: `expect(...).toEqual(...)` whose right side is an `export const` from the subject) | `xcode-license.test.ts:42-52`, `platform/*.test.ts` (`COMMANDS.*`, 40 uses).                                                                                                                                                                                          |
| A test file that reads `docs/plans/backlog.md`                                                                                                                                                  | `registries/commands.test.ts`, `registries/settings.test.ts`, `registries/consumption.test.ts` (the last asserts a status).                                                                                                                                           |
| `COMMANDS` values versus `generate_handler!` versus `tauri-commands.md`                                                                                                                         | 20 TypeScript names without a Rust handler (all `stub` rows), `notification_take_pending` unused in TypeScript.                                                                                                                                                       |
| `db.rs` `include_str!` list versus migration files versus `migrations.lock`                                                                                                                     | Nothing today (they agree).                                                                                                                                                                                                                                           |
| An exported function with no non-test importer                                                                                                                                                  | `createOptimisticStore`. Also all of `core/db/lifetime.ts` steps (placeholders).                                                                                                                                                                                      |
| A `notImplemented(` call reachable from `container.start()`                                                                                                                                     | `runDataLifetimeJob`, `createTauriNotifications().onClicked`, and others behind it. Implement as the M3 test.                                                                                                                                                         |
| More than N copies of a helper name across test files (`const bind`, `const must`, `const deferred`, `const flush`)                                                                             | 12, 24, 10, 7 copies.                                                                                                                                                                                                                                                 |
| `rmSync` or `rm` in a test                                                                                                                                                                      | `status.real-git.test.ts` `afterAll` (acceptable: it is the run's own temp folder, per the hard limits).                                                                                                                                                              |
| Each guard ships a sample it must flag (engineering.md rule "A guard proves it can fail")                                                                                                       | Needed for every guard above.                                                                                                                                                                                                                                         |

## 8. Coverage wait

`coverage/files.tsv` and `summary.md` appeared at 16:03 on 2026-11-05, after I had read the area. They are used in section 2. They measure main (slice 1), so slice 2 files in my area were judged by reading only.

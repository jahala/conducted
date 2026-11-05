# Test quality review: desktop service layer

Area: `apps/desktop/src/core/services/` in the snapshot commit `808d632` of `slice2/step-1`.
Method: five sub-reviewers each read a cluster of test files and the source they test. I then re-read the source for every top finding below and marked what I checked. Nothing was run. Where a finding rests on a command a sub-reviewer ran (real `gh` 2.94, real `git`), I say so.

## 1. Summary

Files read: 75 test files (about 16,000 lines) and their 34 source files. Seven source files have no test file at all: `linear.ts`, `mcp.ts`, `spotlight.ts`, `workspace-files.ts`, `git-cache.ts`, `local-git-forge.ts`, `review.ts` (one method tested). All of them are placeholders that throw `notImplemented`, so that is correct.

Verdicts: REAL 33, WEAK 42, THEATER 0 whole files. Theater lives inside files: nine single tests (listed in finding L1).

The three worst problems:

1. The container and the tests disagree. Every service test injects the dependencies the container leaves out, and no test builds the real container and uses the service. So: no chat can send a message (`SessionsService` gets no `launchFor`), the repo's `remote_name` and file globs are ignored when a workspace is made, a merged PR never archives its workspace (`onMerged` is never called), Git and GitHub polling never start (`watch` has no caller), removing a project throws (`WS-10` is a placeholder), and a terminal's saved screen throws (`PLAT-08`). This is the same class of bug as slice 1's worst ones.
2. Fakes drift from what they replace, and nothing compares them. There are about 22 hand-written git runner fakes, six of them in the GitHub tests with four different rules. Real `git` and real `gh` output break assumptions the tests make: `gh` invalid-token and offline output is not classified, `git restore --staged` fails on an untracked file, and the terminal fake lets the screen be read after exit while the Rust side forgets the session first. Several fakes return `ok` for methods whose real body throws (`queue.enqueue`, `composer.materializeForSend`).
3. Backlog rows marked `done` have checklist items with no failing test, and several DB-backed tests assert only the in-memory store. Examples: the SQL guard of the config compare-and-set (CHAT-02), the `interrupted` outcome (CHAT-18), the 25 MB diff cache limit (REV-02), settings rewrite of actions and env vars (DATA-05), the file count after copy (WS-03), restart persistence of the active tab and sections (NAV-02, NAV-04).

My judgement: the pure logic and the single-service tests are good. The state-machine and race tests (sessions interactions, interactions, repo config reloads, settings write order, git fetch/pull/rename) show real care, and `repo.config.test.ts`, `keep-awake.test.ts` and `sessions.chat-05.test.ts` are the standard to copy. The suite is weak exactly where the owner was hurt in slice 1: the joints between services, the container and the outside world (git, gh, the PTY, the file system). It also tests some features that no live path calls.

One prior audit claim is false today: `settings.test.ts` does not use a JSON stand-in for TOML. It imports the real `tomlCodec` (lines 29, 197, 548, 672, 786, 854). What it fakes is the file system (finding M18).

## 2. Coverage

Source: `coverage/summary.md` and `files.tsv`, which measure main (slice 1 only). Folder `core/services`: 35 files, 83.9% lines, 73.3% branches, 69.9% functions, 543 uncovered lines.

Least covered files:

| File               | Lines | Branches | Uncovered | Note                                                         |
| ------------------ | ----: | -------: | --------: | ------------------------------------------------------------ |
| chat-titles.ts     |  0.0% |      n/a |         4 | slice 2, tested now, and not constructed anywhere in the app |
| keep-awake.ts      |  0.0% |      n/a |         8 | slice 2, tested now, and not constructed in `container.ts`   |
| workspace-files.ts |  9.1% |      n/a |        10 | placeholder                                                  |
| checkpoint.ts      | 10.0% |      n/a |         9 | only `exists` and listing built                              |
| review.ts          | 12.5% |      n/a |        14 | placeholder except `requestAiReview`                         |
| system.ts          | 33.3% |      n/a |        12 | placeholder except two methods                               |
| sections.ts        | 40.0% |      n/a |         6 | slice 2                                                      |
| terminals.ts       | 62.4% |    52.3% |        94 | worst file that matters: 94 lines, half the branches         |
| follow-up-queue.ts | 74.4% |    81.0% |        11 | most methods are placeholders                                |
| sessions.ts        | 85.1% |    64.5% |        75 |                                                              |
| settings.ts        | 85.8% |    74.3% |        75 |                                                              |
| workspace.ts       | 87.7% |    70.3% |        51 |                                                              |
| repo.ts            | 88.9% |    67.6% |        29 |                                                              |

Two cautions on the numbers. First, 84% line coverage sits beside every MUST finding below. Lines run is not behaviour checked: `watch`, the `onMerged` hook and the whole PR polling wiring show as covered because tests call them directly. Second, branch coverage in `terminals.ts` (52%) and `sessions.ts` (64%) points at the same gaps the findings name (close, openForRepo, cancel overlap, start failure branches).

## 3. Findings

Verified means I read the cited source and it matches. "Reviewer ran" means a sub-reviewer ran `git` or `gh` and I read the code that agrees.

### MUST

**M1. No test sends a chat message through the real container.** (verified)
`core/container.ts:344-358` builds `SessionsService` with no `launchFor`. `sessions.ts:608-616` then refuses every send with `chat_launch_missing`. `rg launchFor` finds no other wiring. The 73 sessions tests all inject `launchFor`; `sessions.chat-02.test.ts:217` even asserts the refusal code, but nothing asserts the container supplies the dependency. `sessions.nav-11.test.ts` uses the real container and never sends. `createFirstChat` (`sessions.ts:1102`) has no test against the real service: `workspace.ws-05.test.ts:212` and `workspace.setup.test.ts:216` stub it with `vi.fn()`.
Features: CHAT-02 (done), CHAT-18 (done), WS-01 (done), the first message of every workspace.
Mutation missed: the missing wiring is itself the bug; no test fails for it. Any change to the launch settings is also uncaught.
Fix: one test over `createTestContainer`. Seed a workspace, call `services.sessions.send`, assert `ok` and that the memory sidecar received a request with a `launch` object. Add `createFirstChat` in the same file, ending with one visible turn and the pending entry cleared.

**M2. WorkspaceService is built without `repoConfig`.** (verified)
`container.ts:376-387` passes neither `repoConfig` nor `defaultConfig`; `workspace.ts:36-37` admits the wiring is "a later wiring change". `workspace.ts:406,422,641-643,1480,1517` then skip the repo's `remote_name`, its `file_include_globs` and the default chat config. `workspace.test.ts:402-409` injects them, so the tests pass.
Features: WS-01 (done), WS-03 (done), PRJ-04 (done).
Mutation missed: remove every use of `repoConfig` in `#remoteFor` and `copyIncludedFiles`; production behaviour changes, tests stay green.
Fix: container test. Write `.conducted/settings.toml` with `remote_name = "upstream"` and `file_include_globs = ["*.local"]`, call `workspace.create`, assert the fetch remote and that the `.local` file was copied. Or mark the rows not done.

**M3. A merged PR never archives the workspace.** (verified)
`github.ts:833` declares `onMerged` and the container wires it (`container.ts:416`), but `rg onMerged github.ts` finds only the declaration. Neither `merge()` nor a poll that sees MERGED calls it. Every GitHub test passes `() => {}` (github.test.ts:109, 493, 539; git-08:73; pr-02:97; pr-03:154; pr-11:125; prj-02:59). The container then discards the result with `void workspace.onPullRequestMerged(...)`, so the Err cases that `workspace.ws-05.test.ts:354-376` asserts ("running chat", "corrupted workspace") reach nobody.
Features: PR-01 (done), WS-05.
Mutation missed: none can fail; there is no call.
Fix: a service test that makes the poll return MERGED (and one where `merge()` succeeds) and asserts the injected `onMerged` got `(workspaceId, 12)`. Then a seam test with the real `WorkspaceService`: merged PR, `archive_on_merge` on, workspace archived; running chat, user sees a warning.

**M4. Git and GitHub polling never start.** (verified)
`GitService.watch` (`git.ts:444`) and `GithubService.watch`/`pollNow` (`github.ts:1142,1159`) have no caller outside tests. `rg "\.watch\("` over `src` minus tests finds nothing. `core/hooks/git.ts:51` runs its own `refetchInterval: 5_000` beside the four-slot limiter. So the 5 s poll, the 0.9 reuse, the limiter, the rate-limit gate and the PR status in the header and sidebar are tested and never run. `useGitState` shows `loading` for the PR half.
Features: GIT-02 (done), GIT-13, PR-03.
Mutation missed: delete `watch` entirely; only the tests that call it fail.
Fix: one container-level test. Select a workspace, advance fake time 5 s with a scripted shell, assert the store holds the changed files and the PR, and that `useWorkspaceStatus` reads "PR open". Add a guard (section 7) that fails when a public service method has only test callers.

**M5. Removing a project throws in the real app.** (verified)
`repo.ts` `remove` calls `removeWorkspacesOf`, wired to `workspace.removeWorkspacesOf` (`container.ts:374`), which is `notImplemented("WS-10")` and throws. `repo.test.ts:212,454` use a `vi.fn` removal. The "removal fails, so the row stays" path (`repo.ts:753`) has no test.
Features: PRJ-01 (done, checklist "Delete a repo with its workspaces").
Mutation missed: none; the tests never see the real dependency.
Fix: container test that creates a repo and a workspace and removes the repo. Until WS-10 lands, mark that checklist item as not done. Add the failing-removal test.

**M6. Fakes answer `ok` where the real method throws.** (verified)
`FollowUpQueue.enqueue` is `notImplemented("CHAT-04")` (`follow-up-queue.ts:99-106`); `ComposerService.materializeForSend` is `notImplemented("COMP-07")` (`composer.ts:283-285`). The sessions tests fake both with `vi.fn(async () => ok(...))`: sessions.chat-02:104-109, chat-27:82-89, chat-05:113, rev-05:57-62, sessions.test:52-53 (9 sites in 5 files). In the real app, `send` rejects when it queues behind a running turn and when the draft has an attachment. RUN-06 (done) attaches a terminal selection as a file, so that path is live. "Queues a steer for an agent that cannot steer" (chat-02:345) and the attachment assertion (chat-02:202) pass on the fakes.
Features: CHAT-02, CHAT-05, RUN-06 (all done).
Mutation missed: none; the fakes cannot fail.
Fix: two seam tests with the real parts: real `ComposerService` on the memory platform, `addText`, then `sessions.send` with that path, asserting a `Result` and not a throw; real `FollowUpQueue`, send in queue mode while working, asserting a stored row. These two tests will fail today. That is correct: they are the checklist items for CHAT-04 and COMP-07, and `send` should return a Result either way.

**M7. CHAT-27 tests very likely fail, and they point at a product bug.** (verified by reading; not run)
`sessions.chat-27.test.ts:155,188,204` call `applyStoredEvent` on a chat that was never opened. `applyStoredEvent` appends only when `events[id]` is loaded (`sessions.ts:1251-1256`); only `open()` loads it (`sessions.ts:561`), and `create()` does not (`sessions.ts:355-371`). `retryInNewChat` reads `state.events[id] ?? []` (`sessions.ts:1524`) and returns `chat_turn_unknown`. So tests 1, 3 and 4 should fail, test 2 passes for the wrong reason. The product bug: retry on a chat whose events are not loaded fails.
Feature: CHAT-27 (stub, slice 2 step 1, CI not run).
Fix: append through `repositories.sessionEvents.append`, call `await service.open(id)` first, and add a test for the unopened case so `retryInNewChat` loads the events or returns a clear error.

**M8. The terminal fake and the terminal repository hide two live bugs.**
(a) `core/db/terminals.ts:200-201`: `getScreenState` and `setScreenState` are `notImplemented("PLAT-08")` (verified). Every terminals test hands in repos cast with `as unknown as TerminalsServiceDeps` (terminals-run06:139, terminals-run07:124, terminals.run-01:112). In the real app an interactive terminal exit runs `void this.#saveScreen(...)` and rejects unhandled; `outputFor` on an older terminal throws.
(b) The fake handle's `screenText`/`screenSnapshot` succeed after exit (run06:82, run07:85, run-01:78). In Rust the session is removed from the table, then `pty://exit` is emitted (`pty.rs:626-636`), and `pty_screen_text`/`pty_screen_snapshot` call `state.get(&id)?` (`pty.rs:798-818`) (verified). So `#finish` (`terminals.ts:481-505`) cannot read the screen after the event, and "keeps the text captured when this run's terminal ended" (run07:330) passes only against the fake.
Features: RUN-06 (done), RUN-07, RUN-01.
Mutation missed: change `#saveScreen` to store `JSON.stringify(snapshot.value.data)`; the reader needs `{data}`; no test chains write to read because tests hand-build the JSON (run07:73).
Fix: add a contract case to `platform/contract.ts`, "screen reads after exit", with the real behaviour; make the fake throw after exit; assert the service still returns the last output. Add one test over `openTestDatabase` plus the memory PTY: create, exit, new service, `outputFor`, assert text or a Result error and never a throw.

**M9. Terminal flow control is untested and `runScript` never acknowledges output.**
`terminals.ts:744-750` decodes `onOutput` chunks for URL detection and never calls `ack`. Rust stops reading at 1 MiB of unacknowledged output (`pty.rs:93`). A run script with no mounted xterm view can stall after 1 MiB. `pending` grows without bound when no listener is attached. `connection.history` (lines 399, 411) is an empty array nothing fills. Every fake `ack` is `() => {}`. A multi-byte character split across chunks decodes to U+FFFD (new `TextDecoder().decode` without `{stream:true}`).
Features: RUN-01, RUN-06.
Mutation missed: delete `ack: (bytes) => record.handle?.ack(bytes)` (`terminals.ts:424`).
Fix: real-size test pushing 3 MiB through a fake handle with only `onOutput` attached; assert acknowledged bytes grow and the buffer stays bounded. Add late-attach replay, unsubscribe, and a split UTF-8 character.

**M10. `terminals.ts` public methods with no test.**
`close` (667-675), `openForRepo` (925-975), `loadRepo` (334-348), `ensureConnection` branches (354-377), `write`/`resize` when not running (572-594), `onData`/`onExit` replay after exit, `restart` of a running or unknown terminal, `stop` with no handle. Checklist items "Close terminal", "one repository-level terminal per repository, created lazily" have no failing test. RUN-06 is `done`. Coverage agrees: 94 uncovered lines.
Mutation missed: remove `await record.handle.kill()` in `close()`.
Fix: one test per method, with unique ids from an id source (the fakes return a constant id: run-01:98-99, run06:131, run07:115).

**M11. The `gh` output in the tests is invented, and real output is not classified.** (reviewer ran real `gh` 2.94.0)
`github.test.ts:128-135,334-366` feed strings such as `401` and `This API operation needs the "read:org" scope.` Real output: an invalid token prints "X Failed to log in ... The token in GH_TOKEN is invalid." (exit 1) and classifies as `other`, so access becomes `signed_out` instead of `unauthorized` (the PAT path, D029). Offline prints "error connecting to ..." and classifies `other`, not `offline`. The scope sentence the test itself uses classifies `other` because `missing-scope` needs "403". `classify` and `missingScopeFrom` are tested with different strings, so the real pipeline never runs.
Feature: PR-01 (done: "unauthorized", "missing-scope", "SSO" items).
Mutation missed: replace the regexes at `github.ts:165-184` with ones that match only the invented strings.
Fix: store captured real outputs under a fixtures folder. For each assert `classifyGhFailure`, the `checkAccess` result and `githubFailureMessage`. Invalid-token and offline fail today.

**M12. The most common PR poll shape is untested.** (reviewer ran the query live)
`answer()` in `github.pr-03.test.ts:79-93` always sets `pr0ByNumber`. With no stored PR number (every first poll), GitHub returns only `pr0ByBranch.nodes`. The by-branch path (`github.ts:888`, `?? repository.pr0ByBranch?.nodes?.[0]`) is the common one.
Feature: PR-03.
Mutation missed: delete that fallback; every test still passes.
Fix: fixtures captured from real responses for by-branch only, by-number only, and by-branch with zero nodes.

**M13. "Keeps the last PR" test never checks it.**
`github.pr-03.test.ts:317-328`. Title: records the failure and keeps the last PR. Body: polls once with nothing stored and asserts `unavailable: "offline"`. The injected error is `git_failed`, which the real runner never returns (a non-zero exit is an Ok result).
Mutation missed: `pullRequest: previous?.pullRequest ?? null` becomes `null` (`github.ts` near 1352-1371).
Fix: poll OK, then poll again with a real-shaped failure (exit 1, stderr "error connecting to ..."), assert the first PR is still there and `unavailable` is set. Add `process_spawn` and `shell_timeout`.

**M14. Rate limit, interval and skip rules are tested only as pure functions.**
`github.ts:1206-1217,1196-1204` wire `rateGate.remaining()` into `updatePolling`. The watch tests use 5,000 remaining. `pollSkipReason`, `nextBatchSizes`, `effectiveBatchSize`, `initialBatchSizes` and `RateLimitGate.decide` have no production caller. `#pollWorkspace` never checks the forge, so a GitLab remote runs `gh api graphql` and shows `no_github_access`; `not_github` is never produced. A missing `gh` (`process_spawn`) is labelled `offline`.
Feature: PR-03.
Mutation missed: pass `null` instead of `remaining`; hard-code `mergeStateStatus: null`.
Fix: with fake timers, watch a "selected" and a "sidebar" workspace; return remaining 800, then 499, then 5,000; assert poll counts after 5 s, 60 s, 300 s. Add UNKNOWN mergeability (1 s), a GitLab remote, an offline workspace, a missing `gh`. Wire or delete the dead functions.

**M15. A failing CI check can read "ready to merge".** (verified the three facts; the end-to-end claim is the sub-reviewer's)
`github.ts:900,1304` always passes `NO_REQUIRED_CHECKS`, so every mapped check has `required: false`. `status/git-header.ts:174-175` counts a check as blocking only when `required` or when `treat_optional_checks_as_blocking` is on, and that setting defaults to `false` (`registries/settings.ts:793-802`). `pr-mapping.test.ts:55-69` proves marking only for a set production never builds; git-header tests hand-build `required`. No test joins mapper output to the header.
Features: PR-03, PR-04, PR-06.
Mutation missed: none; every test uses hand-built data.
Fix: seam test: one poll answer with a FAILURE check goes through the store into `computeGitHeader` and `computeWorkspaceStatus`; both must say failing. Then fill `required` from branch protection or drop the field.

**M16. Create PR has no single-flight, and the checklist asks for one.**
`merge` uses `#flights`; `create` (`github.ts:1374-1408`) does not (verified: no guard in the method). Two clicks send two agent instructions. Likewise `renameBranch` and `setTargetBranch` (`git.ts:1306,1210`) have none, though GIT-06 says to ignore a second request while one runs; only `push` and `pull` have it, tested at `git.git-06.test.ts:208`.
Features: PR-01 (done: "dedupes each PR action"), PR-02 (done: second click), GIT-06, GIT-09.
Mutation: none can be written.
Fix: `Promise.all([create(id), create(id)])` leaves `agent.calls` at length 1; a third call after both settle sends again. Same for rename and set-target.

**M17. CLOSED, draft and review decisions are untested; state mapping exists twice.**
`pr-mapping.test.ts:98-151` covers draft, merged and open only. CLOSED and all three `reviewDecision` values are untested. The service tests only the negative closed case. The state mapping is written in `github.ts:1276-1283` and `pr-mapping.ts:491-498`. `closedPrIsShown` compares to the local branch name, not the pushed one, so a closed PR for pushed branch `feature` is hidden when the local branch is `local-name`.
Feature: PR-03.
Mutation missed: map CLOSED to "open"; swap approved and changes_requested.
Fix: `it.each` tables over every state, draft flag and decision; a service test where a CLOSED, number-bound PR with a matching head shows as `closed`; one function owns the mapping.

**M18. Settings tests use a fake file system that is more forgiving than the real one.**
`settings.test.ts:49-88` creates no parent folder and has no scope. Real `write_text_atomic` fails when the parent folder is missing (`files.rs:383-447`). Settings calls `mkdirp` only for `.git/info` (`settings.ts:1318`). Nothing creates `~/.conducted` or `<repo>/.conducted`. On a fresh Mac the first user-file `set()` should fail with "Failed to save setting". Rust also refuses paths outside a short list of roots (`files.rs:38-44`). The memory platform creates parents silently (`memory.ts:318-331`) and `contract.ts` writes into `notes/` without `mkdirp`, so the contract itself assumes it.
Feature: DATA-05 (done).
Mutation missed: n/a (the stand-in can never fail this way).
Fix: contract case "write into a missing folder" with the real behaviour decided; make the fake reject a missing parent; the service creates the parent first.

**M19. Settings rewrite of actions and env vars is untested.**
`settings.ts:698-741`. Nothing shows named actions (`scripts.run.<id>`) and env-var tables survive a rewrite. "Keeps unknown entries" (`settings.test.ts:624`) has neither. `sorted keys` (`settings.test.ts:486-501`) passes without sorting: the test writes `git` then `models`, already alphabetical, and smol-toml writes `$schema` first anyway.
Feature: DATA-05 (done).
Mutation missed: delete the actions loop (698-709) or the env block (710-741), every `set()` wipes the user's actions; replace `sortForWrite(document, "")` (`settings.ts:746`) with the unsorted document.
Fix: seed two ordered actions, a `local` env table and a keychain marker; call `set("default_model", ...)`; parse back and assert all present in order. Sort test: write `models.default` then `delete_branch_on_archive` and assert `git` still precedes `models`.

**M20. "Failed to save setting" is never asserted, and the user may not see it.**
Both failure tests (`settings.test.ts:530-536,656-677`) check `ok === false` and the rollback only. The message `SETTINGS_SAVE_FAILED_MESSAGE` is asserted nowhere; the delete-in-table rollback (`#deleteInTable`, `settings.ts:1185-1197`) has no failure test. `SettingsState` has no save-error field, `SettingRow.saveError` has no feeder, and only some callers toast. `engineering.md` says a failed setting write must be visible. No test crosses from a failed `set()` to something the user sees.
Feature: DATA-05 (done).
Mutation missed: change the message or code in `#setInTable`; remove the rollback in `#deleteInTable`.
Fix: assert `{code: "setting_save_failed", message: "Failed to save setting"}` on file, table and delete paths; one screen test over `createTestContainer` where a failing write shows an error.

**M21. Settings precedence is built twice, and the tested copy has no caller.**
`getForRepo`, `setForRepo`, `resetForRepo` and `resolveSetting` (`settings.ts:915-958,994-996,1016-1052`) have no non-test caller. `repo.ts` (797-802, 911) reads the shared and local files and merges with its own code. Nothing checks they agree. One home per rule is broken.
Features: DATA-05, PRJ-04.
Fix: route `repo.ts` through `getForRepo`, or add a test that feeds the same files to both and compares answers. Also untested here: the workspace-shared layer (no test passes a non-null `workspacePath`, `settings.ts:943-949`), git exclude edge cases (`settings.ts:1308-1327`: existing file with no trailing newline, lines already present, `readText` failure), and a prototype-pollution test that passes without its guard (`settings.test.ts:891-903`; `setTomlPath` already uses `Object.hasOwn` at `settings.ts:153`; call `setTomlPath(root, "__proto__.x", 1)` directly).

**M22. Workspace create is tested only up to "worktree add fails".**
`workspace.test.ts:411,708-730`. The fake `runSetup` returns `{exitCode: 0}` with no `scriptFound`, so every create test takes the "no script" branch. Untested failures in the middle: row create fails, `prepareWorktree` fails (`workspace.ts:850`), copy fails (863), file count fails (867), setup exits non-zero during create (870, the first chat must not start). The file-count checklist item ("The number of files in the new worktree is counted") has no assertion: fake `setFilesCopied` is a no-op and `ls-files` answers empty.
Features: WS-01, WS-03 (both done).
Mutation missed: replace `return this.#fail(workspace, setup.error)` with a pass-through; drop the `#fail` at 850 (row stuck in `initializing`); write `count = 0`.
Fix: one test per step asserting Err, row `failed`, `lastFailedCreate` set, first message kept, `createFirstChat` not called. Reply to `ls-files` with N lines and assert `filesCopied === N` in store and DB row. Add create-fails-then-retry-passes.

**M23. Workspace create/archive have never run over real git and a real database.**
`workspace.test.ts:116-155,239-363` and `workspace.ws-05.test.ts:64-111` use a 125-line hand fake repo, an argv-matching git fake (`starts(command, "git", ["worktree","add"])`), and a fake fs. There are two copies of `makeRunner` here and a third in `git/worktree.ws-05.test.ts`. `workspace.copy.test.ts:148` feeds a constant `ls-files` string; the NUL parse and trailing slash on directories are never checked against real git.
Mutation missed: `worktree add` without `-b`; wrong `lsFilesIgnoredNul` flags.
Fix: one real-git test under `TMPDIR` using `createTestContainer`: init a repo and a bare remote, run `create`, assert folder, `git worktree list`, branch, row `ready`, `filesCopied`; then `archive` and assert `refs/conducted/archive/<id>`, folder gone, branch deleted.

**M24. Archive: only one rollback step is tested, and archive does not stop runs.**
`workspace.ws-05.test.ts:243-333`. Untested: `cancelAll` fails (`workspace.ts:1129`), snapshot fails (1138), pin fails (1141), worktree removal fails (1163), `markArchived` false after the worktree is gone (1166-1174), branch delete fails (1190), `deleteBranch: true` on a non-default branch, double archive (`#archives` single flight, 1063). The harness has `worktreeRemoveCode` and `trashed` options that no test sets, so the Trash fallback is untested. Separately (verified at `workspace.ts:1119-1126`): archive stops only a running setup; it never stops the workspace's run processes or clears run history, though RUN-01 lists that as an archive side effect. The `run-scripts.ts` methods for it (`stopWorkspace`, `clearRuns`, `stopAllForRepository`, `onSetupFinished`, `isBusy`, `lastRunId`) are dead or called only from `cancelSetup`.
Features: WS-05, RUN-01.
Mutation missed: remove `rollBack` from the removal step; drop `options.deleteBranch ||` (`workspace.ts:1188`). Leave a dev server running in a deleted folder.
Fix: one test per step asserting the end state (row back to `ready` while the folder exists, `archiving` cleared). Exit-1 case asserting `fs.trash(path)` and `worktree prune`. Two concurrent `archive()` calls, one `runArchive`. Archive with the real `RunScriptsService` and assert the run terminal stopped and history cleared.

**M25. Setup tests that pass without the guard they name.**
`workspace.setup.test.ts:284-327`. "Ignores a second start" passes without `#setupStarting` because the second call supersedes the first via the nonce; the `current === "running"` branch (`workspace.ts:908`) is never reached. "Shows a cancelled run after cancelSetup" calls `cancelSetup` before the first await, so `scripts.runSetup` never runs and `release` is a no-op; cancelling a script that is actually running (the `onStarted` callback, `running` then `stopping`, the stale-nonce result) is untested. Lines 386 and 395 restate constants (`DEFAULT_COPY_FILES`, `COPY_FILE_SIZE_LIMIT`) and test nothing.
Feature: WS-03.
Mutation missed: remove `#setupStarting` (`workspace.ts:906`); delete `onStarted`'s `running` update (940-943); `size > COPY_FILE_SIZE_LIMIT` to `>=`.
Fix: gate the fake script until `onStarted` fires; (a) call `runSetup` again and assert one script call and state `running`; (b) `cancelSetup`, release with exit 1, assert `stopWorkspace`, state `cancelled`, row `failed`. Replace the constant tests with exactly 256 KiB copied, 256 KiB + 1 skipped, and `.env.local` copied with no config.

**M26. Tests on a real database that assert only the store.**
`workspace.git-09.test.ts:22-33` (drop `setBranch` write, `workspace.ts:1280`), `workspace.nav-04.test.ts:14-20` (drop `setPinned` write, `workspace.ts:1310`), `sections.test.ts:59-145` (five tests: `place`, `reorder`, `setCollapsed`, `remove`; "deleting a section" compares a store the seed filled in memory). `workspace.nav-02.test.ts` uses a `vi.fn` repo and never tests restore after restart. `sections.test.ts:198` uses `setTimeout(0)` and `rename` has no test.
Features: GIT-09, NAV-04, NAV-02 (done).
Mutation missed: skip the DB call in `reorder`/`setCollapsed`; `start()` that ignores `activeSessionId`.
Fix: re-read through `createRepositories(...).workspaces.get` as `workspace.git-08.test.ts:30` does, and restart a second service on the same DB. Await a deferred instead of `setTimeout(0)`.

**M27. `repo.updateConfig` happy path only.**
`repo.ts:829-933`; header says an invalid settings file "is reported instead of replaced". Untested: invalid local file (`repo.ts:844`), write failure (916), two overlapping updates (read-modify-write with no queue), unknown keys kept.
Feature: PRJ-04 (done).
Mutation missed: treat an unreadable local file as empty and overwrite the user's file.
Fix: malformed TOML in `settings.local.toml`, `updateConfig`, assert Err and file bytes unchanged. Write-failure test. Two concurrent updates keep both edits or refuse the second.

**M28. Run scripts: exit handling and stop paths untested.**
Every run terminal's `exit` is `new Promise(() => undefined)` (`run-scripts.run-01.test.ts:127,294,318,340,399,416`). The settle path (`run-scripts.ts:579-587`) has no test, nor has `stopAll` for runs (444-456), stop with nothing running (229), stopping a parked start (221), the `run_action_unknown`/`run_action_empty`/archived refusals (184-194), the default-action rule.
Feature: RUN-01.
Mutation missed: delete `process.exit.then(settle, ...)`; the Run button stays "Running" after the process dies.
Fix: resolve `exit` with 0 and with a rejection; assert phase `stopped`, `running` empty, and that an old exit does not clobber a newer attempt.

**M29. Clone leaves a folder behind and has no double-click guard.**
`repo.ts:652-700`. If clone succeeds and a later step fails (no origin, unknown default branch, checkout fails, create fails) the folder stays and the next try fails with "destination exists". `repo.prj-02.test.ts:389-401` checks only that no row was added. `cloneProgress` is one shared slot, no single flight. The "streams progress" item: `repo.prj-02.test.ts:307` checks only state `cloning`, output is set after the clone ends.
Feature: PRJ-02.
Fix: decide the rule (trash the folder this call made, or keep), test it. Two clone calls produce one `git clone` and one result.

**M30. Git: discarding an untracked file fails on real git, and glob paths hit other files.** (reviewer ran real git; I read `git.ts:935-971` and `commands.ts:360-370`, which match)
`discardFile` treats "not in base" as "unstage, then trash". `git restore --staged -- untracked.txt` exits 1 ("pathspec did not match"), `runChecked` returns the error, nothing is trashed. The test discards `added.ts` (`git.rev-01.test.ts:57,309`), whose fake answers exit 0 for every `restore`/`rm`. Separately `restoreFromSource`, `restoreStaged` and `removeCached` pass the path as a plain pathspec, while the diff commands use `:(literal)`. Discarding `app/[id]/page.tsx` also reverts `app/i/page.tsx` (reviewer ran it). `commands.test.ts:99` uses only `src/a b.ts`.
Feature: REV-01 (done).
Mutation missed: make `restoreStaged` exit 1.
Fix: real-git test with one untracked and one staged-added file, assert both end up in the Trash and `status` is clean; a test with `app/[id]/page.tsx` and `app/i/page.tsx` both modified. Refuse a path not in the change list (today that guard is what accidentally keeps `.env` out of the Trash; a naive fix would lose data).

**M31. Git fakes are never compared with real git.**
About 22 hand-written runner fakes: `git.test.ts:19`, `git-05:20`, `git-06:42`, `git-07:27`, `git-08:33`, `git-09:32`, `git-13:110`, `rev-01:28`, `rev-02:23`, `file-diff:32`, `checkpoint:27`, six in the GitHub tests, `workspace`/`repo` copies. `withWorktreeLock` is a bare `work()` in 10 of 11 files in the git area, so locks are never contended and "recheck under the lock" in `pull` is never raced. The only real-git test (`core/git/status.real-git.test.ts`) covers only the status parse. The real `ShellGitRunner.stdout` trims and honours `okExitCodes`; the GitHub fakes disagree (github.test.ts:63, pr-02:49 return raw strings; pr-03:121 ignores `okExitCodes`; only git-08:33 mirrors it).
Features: all GIT and REV items in the area.
Mutation missed: drop the probe exit codes on `configGet` (passes in 5 of 6 GitHub fakes).
Fix: one shared `FakeGitRunner` plus a contract test that runs the same script through `ShellGitRunner` over a real temp repo and bare origin under `TMPDIR` and through the fake, and compares answers: merge-base 0/1/128, `show-ref`, `cat-file -e`, `rev-parse @{u}`, `rev-list --left-right`, `push -u`, `merge --ff-only`, `reset --hard`, `branch -m`.

**M32. Pull, push and rename edges.**
(a) `git.ts:1031-1035`: a known upstream's name is used instead of the branch's. Local `feat` tracking `origin/main` (`git checkout -b feat origin/main`) pushes `HEAD:main`, straight to the target. `git.git-06.test.ts:125` uses only `origin/feat`. Mutation: push to `HEAD:${branch}`. (b) "Pulled latest changes. You're up to date!" passes without it: `PULL_UP_TO_DATE_MESSAGE` (`git.ts:159`) has no caller and `pull` returns `ok(undefined)` for every outcome; the test's last line (`git.git-06.test.ts:323`) checks the constant against its own literal. Fix: `pull` returns an outcome (`up_to_date`, `fast_forwarded`, `handed_off`) and the test asserts each. (c) `git.rev-01.test.ts:166-188,145,161`: the commit-scope fake answers whatever sha is sent; assert `shows.every(c => c.args.includes("abc"))`; two `for` loops over `hasDiff(...)` pass on an empty list. (d) GIT-02: header says a failed poll keeps the last snapshot; only the first-poll failure is tested (`git.test.ts:255`). Mutation: `snapshot: previous?.snapshot ?? null` becomes `snapshot: null`; drop the `latest` guard at `git.ts:508`.
Features: GIT-06, REV-01, GIT-02.

**M33. File diff cache limit and generation guard.**
`file-diff.ts:204-220,163-166`. "Cache limited to 25 MB" has no test; neither has "one entry larger than the cap is not stored" or the `invalidate` generation guard (`file-diff.test.ts:338` tests an idle cache). A file reads at most 2 MB, so about 14 files fill the cache.
Feature: REV-02 (done).
Mutation missed: delete the eviction loop; `>` to `>=`; drop the generation compare.
Fix: load about 14 files of 2 MB, assert the oldest re-reads and the newest does not; start a load, call `invalidate`, release the load, assert the next load reads again.

**M34. `PR-02` test pins the opposite of the issue.**
Issue #195: a repo prompt replaces the default text for Create PR. `agent-instructions.pr-02.test.ts:41-51` asserts the built-in steps are kept and the custom text added. `commitAndPush` and `reconcile` hard-code `customPrompt: null` (`git.ts:995,1149`), so the custom-prompt tests at `agent-instructions.git-05.test.ts:21` and `git-04.test.ts:38` cover a path no caller reaches.
Feature: PR-02 (done).
Mutation missed: `createPrInstruction` returns the custom text alone (the checklist is met and this test fails).
Fix: pick one rule; if the issue wins, assert `toBe(custom)`. Wire or delete the dead custom branches.

**M35. Sessions: the compare-and-set SQL guard, the card from live state, and the interrupted outcome.**
(a) `sessions.ts:1019-1067`: the pre-check at 1040 catches every test scenario. `AND config = $4` (1052) and the `written.value === 0` branch (1058-1067) never run. Mutation: delete `AND config = $4`. Fix: wrap the `Database` so `setConfig(newer)` runs between the `SELECT config` and the `UPDATE`; assert the newer config survives and no `updateConfig` request is sent. (b) `sessions.ts:1206-1237`: no test asserts that an open interaction in a live state becomes the chat's card (CHAT-10 "survives a restart"). `sessions.nav-11` reads only `markAllRead`, which also checks `liveStates[...].openInteraction`, so it stays green if the card branch (1216-1224) is deleted. Four tests: card from live state; same id keeps `timedOut` and `expiresAt`; a different id settles the old promise as withdrawn; apply, rebuild the service on the same DB, `start()`, expect the live state. (c) `sessions.chat-18.test.ts:178-224` counts `turn_ended` rows but never checks `outcome === "interrupted"`, nor that `agent_session_id` survives for resume. Mutation: `outcome: "cancelled"` in `repair.ts:137`; clear `agent_session_id` in `markInterrupted`. Fix: seed a session with an agent id, `open()` it, run `markInterrupted`, assert stored outcome `interrupted`, `chatView(id).turns` shows it, agent id unchanged, a second run adds nothing. `turn-builder.test.ts` never feeds a stored `interrupted` or `cancelled` end.
Features: CHAT-02, CHAT-10, CHAT-18 (all done).

**M36. Cancel keeps queued follow-ups only at the queue unit.**
D020 says a cancel keeps queued follow-ups. `follow-up-queue.chat-05.test.ts:118` proves it at the queue; `sessions.chat-05` uses the real queue but seeds no rows. Two overlapping cancels: the first failure resets `#cancelVersions` to its own old value (`sessions.ts:839`), undoing the second cancel's bump. `pauseOnCancel` failing (855) and `loadDraft` failing in the restore are untested. The pause is held only in memory although `Session.queuePausedAt` exists and repair writes it.
Feature: CHAT-05 (done).
Mutation missed: replace `pauseOnCancel` with a function that deletes waiting rows; `sessions.chat-05` stays green.
Fix: seed 2 waiting rows and 1 sending row through `repositories.queuedMessages`, call `sessions.cancel`, assert rows survive in DB and store, the sending row is last, the paused flag is set. Add two overlapping cancels (one refused, one accepted), a failing `pauseOnCancel`, a failing `loadDraft`.

**M37. First message on a brand-new chat can be sent twice as "first".**
`sessions.ts:627` derives `firstMessage` from `lastIdx === null`, read from the DB. Two sends before the first `user_message` is stored both get `firstMessage: true`. No test sends twice at once on a new chat, and no test wires real sessions, ingest and composer through send, event, pending cleared, `chatView` shows one turn. This is the slice-1 deadlock class.
Feature: CHAT-02.
Fix: `Promise.all([send, send])` on a new chat with the rule decided; plus one end-to-end test over `createTestContainer`.

**M38. Turn builder: a streaming reply is not tested.**
`turn-builder.test.ts:493-500` "reply streams" changes the user message text. A streaming reply grows `blocks` on the same turn.
Features: CHAT-07 (done), CHAT-06.
Mutation missed: remove `blocks: turn.blocks` from `fingerprint` (`turn-builder.ts:370`); the differ reports "same" while a reply streams and the chat list never updates.
Fix: two versions of one turn with the same user message and a longer text block, a longer thinking block, a new tool result, a new steer; assert `{kind:"tail_changed", fromIndex: 0}` each time. A 3-turn case where only turn 2 changes.

**M39. Theater test and fake drift in favourites and catalog.**
`favorite-models.test.ts:182-190` asserts the fake repository's own ids (`fav-${++state.nextId}`); the service makes no ids. The header promises reorder before delete so a failed reorder leaves the row; no test makes `reorder` or `delete` fail, and the fake `reorder` sorts a missing id first. Dedupe is tested by model only; `sameFavoriteChoice` effort, fast mode and `acpAgent` are not. Mutation: swap delete and reorder in `#remove`; remove the `acpAgent` check; remove the auto-load (`favorite-models.ts:82-85`). `agent-catalog.test.ts:94-113` tests one key only; the header says a slow model list must not block other agents. Mutation: one global request counter in `loadModels`. No contract test compares the hand-written repository fake with `createFavoriteModelRepository`.
Features: COMP-02, SET-03 (done).
Fix: delete the theater test or move it to a repository test over the real DB; add failing `reorder`/`delete`; start `loadModels("claude")` and `loadModels("acp","pi")` and answer them in both orders; run a shared contract test over fake and real repository.

**M40. Composer draft store: the size limit's rules and the fake.**
`composer.test.ts:254-268`: one other draft exists and fits only because JSON overhead pushes the total over the limit. Oldest-first order, stopping once there is room, never trashing the draft being written, the `<=` boundary (`composer.ts:383`), `trash` failing inside `#makeRoom`, `mkdirp` failing (`fail.mkdirp` at line 46 is never switched on), and a subdirectory in `readDir` are unchecked. `composer.test.ts:40-109` hand-writes a `fakeFs` that duplicates `createMemoryPlatform().platform.fs`. "Writes the newest text once" never checks "once". `composer-run06.test.ts` has no collision test: deleting the `-1` suffix loop (`composer.ts:421-427`) is missed because `exists` always returns false.
Features: COMP-01 (done), RUN-06 (done).
Fix: three drafts of different ages plus a fourth that needs one removal, asserting only the oldest is trashed; a test at exactly the limit; a held write plus a newer save; use the memory platform fs.

**M41. Keep-awake race and wiring.**
`keep-awake.ts:114,128,134-140`: the generation guard between `scan` and `stop` is untested. Mutation: delete the guard at 128; a scan in flight at quit starts `caffeinate` after `stop`. Fix: hold `pmset` with a deferred, call `stop()`, release, assert no `caffeinate`. Also: the service is not constructed in `container.ts`, `KEEP_AWAKE_SCAN_MS` has no caller.
Feature: PLAT-21 (stub).

**M42. Placeholders reachable from the container at start-up are hidden by spies.**
`container.ts:597` (spotlight `healAfterCrash`) and `container.ts:605` (hourly `updates.check`) call `notImplemented` placeholders. `container.app-01.test.ts:357,438` replace them with spies. Whether `start()` catches the throw and whether the update timer and quit handler are still wired after it (they follow the heal loop) was not checked. That test is outside this area; the service tests (`updates.test.ts` covers 1 of about 24 checklist items) cannot see it.
Features: RUN-02, APP-06.
Fix: run the container's start with the real placeholders for one user with a repo and assert it neither throws nor skips the timer, or have the container not call placeholders.

### LATER

**L1. Single theater or near-theater tests.**
`favorite-models.test.ts:182-190` (fake's ids). `pr-polling.pr-03.test.ts:77-79` asserts `NO_PR_MEMORY_MS` equals 300000 (a constant); the real expiry is untested and `github.pr-03.test.ts:155` uses `Date.now()`. `github.pr-03.test.ts:317` (title promises more than the body). `git.git-06.test.ts:323` (constant against its own literal). `workspace.setup.test.ts:386,395` (restated constants). `follow-up-queue.test.ts:82-88` ("no open interaction" is never set; mutation: drop `&& liveState.openInteraction === undefined`, `follow-up-queue.ts:60`). `settings.test.ts:891-903` (prototype pollution passes without its guard). `settings.test.ts:368-386` (title says "without exposing values"; nothing asserts it). `agent-catalog.test.ts:70-77` ("takes a notification without a request" never asserts the request was not made). `git.rev-01.test.ts` vacuous loops (see M32c).

**L2. Duplicates.**
`pr-polling.test.ts` repeats `pr-polling.pr-03.test.ts` (`decidePolling` thresholds, `requestedInterval`, halve on timeout, halve on high cost). `summarizeChecks` is tested in both `pr-mapping` files. `sessions.chat-02.test.ts:255` and `:297` cover the same `turn_ended` branch. Delete the first copy of each.

**L3. Microtask and zero-time waits.**
`composer.test.ts:135` plus 12 uses (165-295) of `setTimeout(0)`. `sessions.chat-05.test.ts:170-173,252` `settle()` is two `Promise.resolve()` turns and pins how many awaits `cancel` makes. `git.test.ts:121-123` and `github.pr-03.test.ts:160-162,346-347` spin 500 microtask ticks. `sections.test.ts:198` `setTimeout(0)`. All are deterministic today and break on a harmless extra `await`. Use `vi.waitFor` on state or a deferred.

**L4. Constant fakes and ids.**
`terminals.run-01.test.ts:98-99` `start`/`get` always return `t1`; run06:131 and run07:115 ignore the id; `getScreenState` ignores the id (run07:192,208,241). `sessions.chat-18.test.ts:76,83` constant `now`; `chat-27:56`. Six constant-clock hits in the GitHub tests hide `lastSuccessAtMs`. `killAll` over 3 terminals is untested (mutation: handle only the first).

**L5. Wrong or missing feature ids.**
`system-app-13.test.ts` cites APP-13, which is "Display components"; the copy button is the nearest item. `ports.test.ts` titles have no feature id (RUN-03). `transcript.test.ts:13,19` and `follow-up-queue.test.ts:20,47,68,75` lack ids. Eleven sessions-area files have no `@feature` header.

**L6. Git service leaves and edges.**
`GitService.watch` unsubscribe is not idempotent (`git.ts:467,474-483`): a second call decrements the shared count and stops another subscriber; a thrown `contextOf` ends the poll loop. Limiter rejection frees its slot (`git.ts:248-254`) is untested. `git.git-06.test.ts` lacks `fetch` failure, `rev-list` parse failure, `pull.rebase` read failure, agent send failure on hand-off, diverged with rebase, detached HEAD. `scope.branch` for a target scope is not checked with `isSafeRefName` (`git.ts:653-696`); a bad commit sha reads as a root commit. `#lastFetchAt` and `#viewed` grow with no lifetime. `makeService` repeats a 12-line deps block in 9 files with `cache: {} as never`. Nothing runs at 5,000 changed files or 300 watched workspaces. A branch name with a backtick breaks prompt formatting in `agent-instructions.ts` (argv is safe).

**L7. Checkpoint.**
`checkpoint.ts:120-121`: the first result is the cached array, later hits are copies, so a caller that mutates the first result changes the cache. No single-flight, the 200-file cap the header claims is untested, "one turn over 5 MB is returned, not stored" untested. `checkpointer.sh` output is never run against `changesForTurn` (a rename, a space in a path). Mutation: change `CHECKPOINT_READY_POLL_MS`; the wait is checked only as `waits > 0`.

**L8. GitHub service edges.**
Untested: `listIssues`/`listPullRequests`/`pullRequestByNumber`/`recentRepos` on 401 or offline; `fs` undefined; failing `mkdirp`; odd PR ids ("0", "-1", "1.5", "12abc"); a viewer-can-merge value of READ/TRIAGE; `merge` with `prNumber === null`, empty HEAD, no allowed method, 401, rebase and merge vectors; `chooseMergeMethod` (`github.ts:608`) and `parsePrBatchAnswer` (890) disagree when nothing is allowed. `GH_GRAPHQL_TIMEOUT_MS` and the 15 s read timeouts are not pinned. `recordGhResult` reads the Keychain about six times per tick, against a comment that says once. `#noPrUntil`, `#lastPolledAt`, `byWorkspace` never shrink; 300 watched workspaces start 300 ticks at once, with no backoff (`core/async/backoff.ts` unused). `parseAuthStatus` picks the first "Logged in" line even when the account is inactive. An older failure arriving after a newer success (`!latest` guard) is untested. `github.pr-02.test.ts`: `git ls-files` of a 100,000-file repo may exceed the shell limit.

**L9. Notifications.**
`isSuppressed`: `sessionHidden` has no case; only "finished" is tested for viewing; 50 and 51 character titles; empty `id=`/`session=` in `parseDeepLink`; `dockBadgeCount` with no unread or a missing workspace. The checklist says a tool approval does not notify while viewing; code and test (`notifications.test.ts:40`, `notifications.ts:49-55`) make it notify. The owner must say which is meant. `refreshDockBadge` error path is untested.

**L10. Sessions edges.**
`start()` has no ordering test (`compareNewest`), no `#failLoad` branches, no size test (one query per workspace, so 300 sequential queries); reopen prepends while `start()` sorts, so order changes after a restart. `applyStoredEvent` duplicate and out-of-order idx. `sessions.rev-05`: Codex, ACP, trimmed model, `review_fast_mode: false` over `fastMode: true`, send failing after create. `sessions.chat-02.test.ts:104`: `queue`/`composer` dependencies declared and never called (`composer.clearDraft`, `queue.release`, `notifications.onLiveStateChanged`). `chat-titles.ts` is not in the container; its tests miss cuts to 80 and 30 characters, illegal characters, "New chat", `fastMode`, `acpAgent`, the model-missing error, and the prompt contents.

**L11. Turn builder at real size.**
The 20,000-event test checks counts only, with one shape (5,000 short turns). Add one turn with 20,000 items, 3,000 nested tool calls, a 2,000-deep parent chain (`parentCall` walks the chain per call), and `classifyTurnsChange` on 5,000 turns. Assert ratio of n to 4n or count `fingerprint` calls, not wall time. `chatView` and `reuseTurns` rebuild per call; no test checks object identity for unchanged turns. `delivery: "plan_feedback"` is treated as a steer with no stated rule.

**L12. Repo odds.**
Two copies of FakeGit and the repo table drift (`repo.test.ts:39,86` and `repo.prj-02.test.ts:39,86`; prj-02's `create` has no `db.conflict`). `repo.prj-02.test.ts:203-218,256-265` build replies and expectations from the source's own builders (`githubRepoClone()`, `cloneWithProgress()`), so a wrong argv cannot fail; assert the literal argv once. `normaliseRemoteUrl` keeps credentials (`https://user:token@host/`) and shows them in `cloneProgress.url`; `#readRemoteUrl` turns every git failure into "no remote" (`repo.ts:1091`). `repo.config.test.ts` calls `dispose()` after the assertion, not in `afterEach`. `repo.config.test.ts:121-137` re-implements `readSettingsFile` in the harness; use the real `SettingsService`.

**L13. Workspace odds.**
No create test with repo name "My App é", a 300-character prefix or spaces in the path. `setIntendedTargetBranch` (`workspace.ts:1320`) and `applyBranchRename` store any string; create calls `isSafeRefName`, these do not. A second create (any repo) waits for the first workspace's setup because the whole creation, including the setup script and first chat, sits under one global queue key (`workspace.ts:729,869`; the only concurrency test uses an instant setup). The archive script has no timeout. `copyFile`/`copyDirectory` ignore `isSymlink`. `workspace.copy.test.ts`: the fs adapter (63-122) is a hand copy of `Platform.fs` with no contract test.

**L14. Command runner.**
`commandRequirement` is tested on five ids; walk the whole registry and assert each has an intended requirement. `hasWorkspace` is "any workspace exists", not "one is selected" (`container.ts:471-489`). No test runs a command by id through the real container (the slice-1 "dispatcher never mounted" class). Removing `"terminal."` from the prefix list is missed.

**L15. Smaller items.**
`ports.test.ts:14-18` fills `55000..65000` so it cannot tell if `64990` is allocatable; "unknown variable" checks only `ok === false`; `$CONDUCTED_PORTS` typos untested. `terminals.test.ts` does not assert `TERM`/`COLORTERM` (mutation: delete `terminals.ts:111`). `terminals.run-01.test.ts:158-166` asserts `setScreenState` not called with no settle point, so the negative can pass by timing; `:183-193` never checks the 20 s timer was cancelled. `terminals-run07`: 1000-line cap not tested (a request for 5000 passes through). `outputFor` with an explicit `terminalId` reads any workspace's terminal. `terminals.ts:291` `#records` is never pruned (300 terminals leak). `settings.test.ts` calls `stop()` only on success paths (13 places), so a failure leaks the interval and focus subscription. `settings.set()` does not check the registry key allows user scope; `set("setup_script", ...)` writes it to the user file. `toml-codec.test.ts` has no datetime, bigint, dotted or unicode key. `transcript.test.ts:8` reads only `0001_init.sql`; use `openTestDatabase` and real stored JSON. `git.git-09.test.ts`: "keeps the old remote branch and warns" asserts no delete and no push, but no warning exists in service or test.

## 4. Per-file verdicts

Paths are relative to `apps/desktop/src/core/services/`.

| File                              | Verdict | Reason                                                                                                             |
| --------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| agent-catalog.test.ts             | WEAK    | out-of-order refresh is real; per-key independence, load errors and initial state are not (M39)                    |
| agent-instructions.git-04.test.ts | REAL    | strategy, push line, no-remote, custom text; dropping `--force-with-lease` is caught                               |
| agent-instructions.git-05.test.ts | WEAK    | lowercased `toContain("commit")` is loose; custom path has no caller (M34)                                         |
| agent-instructions.git-07.test.ts | REAL    | rebase and merge steps and the value table                                                                         |
| agent-instructions.pr-02.test.ts  | WEAK    | custom-prompt test pins the opposite of the issue (M34)                                                            |
| agent-instructions.rev-05.test.ts | REAL    | default, trimmed, blank, extras                                                                                    |
| chat-titles.test.ts               | WEAK    | skip rules real; cuts, characters, fastMode, model-missing untested; service not in the container (L10)            |
| checkpoint.rev-09.test.ts         | WEAK    | `exists`, NUL count, eviction real; wait rule only `waits > 0`, no real script (L7)                                |
| command-runner.test.ts            | REAL    | real registry, once-only, throw to Err; requirement table thin (L14)                                               |
| composer-run06.test.ts            | WEAK    | happy path only; collision loop missed (M40)                                                                       |
| composer.test.ts                  | WEAK    | real round trips; fake fs, setTimeout(0), size rule unchecked (M40)                                                |
| favorite-models.test.ts           | WEAK    | serialisation real; one theater test, no failure paths (M39)                                                       |
| file-diff.test.ts                 | WEAK    | sides, guards, late answer real; 25 MB cache and invalidate untested (M33)                                         |
| follow-up-queue.chat-05.test.ts   | REAL    | real repository and DB; reorder, pause, waiting rows kept                                                          |
| follow-up-queue.test.ts           | WEAK    | pure functions solid; `canReleaseQueue` title promises more than the body (L1)                                     |
| git.git-05.test.ts                | REAL    | one instruction to the agent, no `git commit`                                                                      |
| git.git-06.test.ts                | WEAK    | push, pull, single-flight real; up-to-date is a tautology, edges missing (M32)                                     |
| git.git-07.test.ts                | REAL    | `pull.rebase` true/unset/false, custom prompt, errors                                                              |
| git.git-08.test.ts                | REAL    | clean, dirty, HEAD moved, missing ref, PR base; includes a source-scan guard that proves it can fail               |
| git.git-09.test.ts                | REAL    | lock path, `-v2`, detached HEAD, rollback, option-like names; the warning item has no test (L15)                   |
| git.git-13.test.ts                | REAL    | truth table at 59,999/60,000 ms, overlap, shared key; no production caller (M4)                                    |
| git.rev-01.test.ts                | WEAK    | discard and unsafe-input real; fake exits 0 for `restore`, sha never asserted, vacuous loops (M30, M32)            |
| git.rev-02.test.ts                | REAL    | marks saved, reset on mtime change, damaged file, slow first write race                                            |
| git.test.ts                       | WEAK    | polling, limiter, slow answer real; failure after a good snapshot untested; no caller for `watch` (M4, M32)        |
| github.git-08.test.ts             | REAL    | pins `gh pr view`/`gh pr edit` vectors; output matches real gh                                                     |
| github.pr-02.test.ts              | WEAK    | target stripping, template, link setting real; no second click, fake agent (M16)                                   |
| github.pr-03.test.ts              | WEAK    | latest-wins and fake-timer watch real; invented GraphQL shape; one title-vs-body test (M12, M13)                   |
| github.pr-11.test.ts              | REAL    | REST endpoints, issue-vs-PR split, redirect, failed write                                                          |
| github.prj-02.test.ts             | REAL    | org parsing, owner order, filter, 401 message; argv compared with the builder's own output (L8)                    |
| github.test.ts                    | WEAK    | access latest-wins, PAT env, merge single-flight real; gh failures invented (M11)                                  |
| keep-awake.test.ts                | REAL    | best file here: counted handles, memory shell contract-checked; stop race untested (M41)                           |
| notifications.nav-11.test.ts      | REAL    | real sessions on the test container, asserts the recorded badge                                                    |
| notifications.test.ts             | WEAK    | finished, badge, emoji cut real; suppression matrix thin (L9)                                                      |
| ports.test.ts                     | WEAK    | allocation real; last-block boundary and message unchecked, no feature id (L15)                                    |
| pr-mapping.pr-03.test.ts          | REAL    | reviewers, deployments, truth tables; provider regexes unchecked                                                   |
| pr-mapping.test.ts                | WEAK    | single-order dedupe, no CLOSED, required set never built in production (M15, M17)                                  |
| pr-polling.pr-03.test.ts          | WEAK    | thresholds and gate real; one constant-equals-itself test (L1)                                                     |
| pr-polling.test.ts                | WEAK    | every test is repeated in the other file (L2)                                                                      |
| repo.config.test.ts               | REAL    | real TOML codec, held reads, focus reload, dispose; best file of the area; write path thin (M27)                   |
| repo.prj-02.test.ts               | WEAK    | URL and folder rules real; expectations built from source builders (M29, L12)                                      |
| repo.test.ts                      | WEAK    | add, dedupe, init, order real over a FakeGit; stubbed removal (M5)                                                 |
| review.rev-05.test.ts             | REAL    | custom prompt, extras, error passthrough over the real instruction                                                 |
| run-scripts.run-01.test.ts        | WEAK    | newest start, exclusive, parking real; every `exit` never resolves (M28)                                           |
| run-scripts.setup.test.ts         | REAL    | env, transcript path, dedupe, close old terminal                                                                   |
| run-scripts.test.ts               | REAL    | pure helpers                                                                                                       |
| run-scripts.ws-05.test.ts         | REAL    | argv, env, non-zero exit, missing shell                                                                            |
| sections.test.ts                  | WEAK    | real DB but reads the store only, `setTimeout(0)`, no rename (M26)                                                 |
| sessions.chat-02.test.ts          | WEAK    | strong send/retry/discard; queue and composer fakes return ok where real throws; SQL guard never reached (M6, M35) |
| sessions.chat-05.test.ts          | REAL    | real queue over a real DB: drop, restore once, cancel in flight, cancelAll; cancel with queued rows missing (M36)  |
| sessions.chat-10.test.ts          | REAL    | card replaced, reconnect returns same promise, undeliverable                                                       |
| sessions.chat-11.test.ts          | REAL    | timed-out card stays, stale id ignored                                                                             |
| sessions.chat-18.test.ts          | WEAK    | real transaction rollback; outcome, agent id, live-state round trip unchecked (M35)                                |
| sessions.chat-27.test.ts          | WEAK    | tests 1, 3, 4 likely fail on setup (M7)                                                                            |
| sessions.nav-11.test.ts           | REAL    | real container and DB, store and SQL                                                                               |
| sessions.rev-05.test.ts           | WEAK    | Claude paths only; `setting \|\| base.fastMode` missed                                                             |
| sessions.test.ts                  | WEAK    | real DB for create/close/rename/delete; no start ordering, load errors or size                                     |
| settings.test.ts                  | WEAK    | strong on write order, rollback, reload races; actions/env, sort, workspace layer, message, fake fs (M18-M21)      |
| system-app-13.test.ts             | REAL    | `copyText` success and a throwing clipboard; thin, wrong feature id                                                |
| system.git-16.test.ts             | REAL    | real container, in-memory shell, failure branches; imports the command constant from the source                    |
| terminals-run06.test.ts           | WEAK    | good races; hand-built deps and handle; close, openForRepo untested (M8, M10)                                      |
| terminals-run07.test.ts           | WEAK    | source choice real; fake handle reads the screen after exit (M8)                                                   |
| terminals.run-01.test.ts          | REAL    | login shell args, exit promise, watchdog; negative assertion has no settle point (L15)                             |
| terminals.test.ts                 | WEAK    | `buildScriptEnv`, limit; `TERM` and `COLORTERM` unchecked                                                          |
| toml-codec.test.ts                | REAL    | real round trip and parse error; datetime and bigint missing                                                       |
| transcript.test.ts                | REAL    | real SQLite proves literal `%`, type filter; reads migration 0001 only                                             |
| turn-builder.test.ts              | WEAK    | builder strong; differ's streaming case is wrong (M38)                                                             |
| updates.test.ts                   | REAL    | one correct test, 1 of about 24 checklist items                                                                    |
| workspace.copy.test.ts            | WEAK    | real files and modes; git listing is a constant string (M23)                                                       |
| workspace.git-08.test.ts          | REAL    | real container, re-reads the row                                                                                   |
| workspace.git-09.test.ts          | WEAK    | real DB, store only (M26)                                                                                          |
| workspace.nav-02.test.ts          | WEAK    | `vi.fn` repo, no restart test (M26)                                                                                |
| workspace.nav-04.test.ts          | WEAK    | real DB, store only (M26)                                                                                          |
| workspace.setup.test.ts           | WEAK    | state moves real; second start and cancel pass without their guard (M25)                                           |
| workspace.test.ts                 | WEAK    | create/retry/recover real in logic; hand fakes, no failure past worktree add (M22, M23)                            |
| workspace.ws-05.test.ts           | WEAK    | archive happy path and one rollback; other steps and Trash untested (M24)                                          |

Count: REAL 33, WEAK 42, THEATER 0 (75 files).

## 5. Checklist map gaps

Backlog status from `docs/plans/backlog.md`. Items on `done` rows without a failing test come first. Items on `stub` rows are listed where code and tests have already landed.

Rows `done`:

| Feature | Item                                                              | Gap                                                             |
| ------- | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| CHAT-01 | Local workspace with no chat creates one automatically            | no test in this area                                            |
| CHAT-01 | List order (newest first)                                         | passes without it (one open chat in the test)                   |
| CHAT-02 | Queue behind a running turn (service half)                        | passes without it (fake `enqueue` where real throws, M6)        |
| CHAT-02 | Config written only while stored config is the one the caller saw | SQL guard passes without it (M35a)                              |
| CHAT-02 | Attachments carried with the message                              | passes without it (fake composer, M6)                           |
| CHAT-05 | Cancel keeps queued follow-ups (D020), end to end                 | no test; persisted pause after restart: no test (M36)           |
| CHAT-07 | Incremental builder tells the list how turns changed              | streaming reply passes without it (M38)                         |
| CHAT-10 | Open questions survive a restart                                  | no test (M35b)                                                  |
| CHAT-10 | "Could not send answers. Try again." text                         | code asserted, message passes without it                        |
| CHAT-18 | Dedupe replayed events                                            | no test in this area                                            |
| CHAT-18 | Turn cut off by a crash shown as interrupted                      | outcome and display have no failing test (M35c)                 |
| COMP-01 | Draft files kept 30 days                                          | no test (DATA-02 owns the job)                                  |
| COMP-01 | Size-limited store: oldest first, boundary                        | passes without it (M40)                                         |
| COMP-01 | Newest write wins, written once                                   | "once" passes without it                                        |
| COMP-02 | Deduped                                                           | model only (M39)                                                |
| COMP-02 | Written as a diff in one transaction                              | no test; service reorders then deletes                          |
| SET-03  | Model lists do not block other agents                             | passes without it (M39)                                         |
| RUN-06  | "Failed to attach terminal selection"                             | no test                                                         |
| RUN-06  | Sending that attachment                                           | no test and the real send throws (M6)                           |
| RUN-06  | Close terminal; repo-level terminal created lazily                | no test (M10)                                                   |
| RUN-06  | Cold restore replays the saved screen                             | no test, no code (`history` stays empty)                        |
| RUN-06  | Table terminals plus saved screen files                           | passes without it (fakes only; real repo throws, M8)            |
| GIT-02  | Visible workspace polls every 5 s                                 | passes without it in the app (M4)                               |
| GIT-02  | Failed poll keeps last snapshot                                   | no test (M32d)                                                  |
| GIT-02  | Status refreshes after any git action                             | no test                                                         |
| GIT-02  | Diff target precedence (Graphite, PR base)                        | no test                                                         |
| REV-01  | Discard of an untracked file                                      | fails on real git, test passes (M30)                            |
| REV-01  | A commit's files come from the commit sha                         | passes without it (M32c)                                        |
| REV-01  | Modified time and size of each changed file                       | no test                                                         |
| REV-02  | Cache limited to 25 MB                                            | no test (M33)                                                   |
| PR-01   | Unauthorized, SSO, missing-scope from real gh output              | pass without it (M11)                                           |
| PR-01   | Dedupes each PR action                                            | create has none (M16)                                           |
| PR-01   | `onMerged` hook                                                   | no test, never called (M3)                                      |
| PR-01   | Health updated on every gh call                                   | merge and prj-02 only; poll, `#readGh`, `listIssues`: no test   |
| PR-02   | Custom prompt replaces default                                    | test pins the opposite (M34)                                    |
| PR-02   | Second click                                                      | no test                                                         |
| PRJ-01  | Delete a repo with its workspaces                                 | passes without it; real app throws (M5)                         |
| PRJ-01  | Insert deduped by root path, race                                 | no test for the `db.conflict` race                              |
| PRJ-04  | Invalid file reported, local file and write path                  | no test (M27)                                                   |
| WS-01   | Remote origin from repo config                                    | passes in test, not wired in the container (M2)                 |
| WS-01   | Branch `-v1` when taken                                           | passes without it (fake `show-ref` answers 1)                   |
| WS-01   | Failed workspace keeps row                                        | worktree add only; other steps none (M22)                       |
| WS-01   | `github_username` prefix path                                     | no test                                                         |
| WS-01   | First chat from the default config                                | `defaultConfig` not wired in the container                      |
| WS-03   | File count                                                        | no test (M22)                                                   |
| WS-03   | Second start ignored; cancelled state                             | pass without it (M25)                                           |
| WS-03   | Quit mid-setup text (`SETUP_INTERRUPTED_MESSAGE`), `readSetupLog` | no test                                                         |
| WS-03   | `cp` failure warning, symlinks, 256 KiB boundary                  | no test                                                         |
| NAV-02  | Active tab restored after restart                                 | no test (M26)                                                   |
| NAV-07  | `project.add` mounted in the container; whole requirement table   | no test (L14)                                                   |
| DATA-05 | Actions and env written; sorted keys; workspace layer             | no test, or passes without it (M19, M21)                        |
| DATA-05 | "Failed to save setting"                                          | message passes without it (M20)                                 |
| DATA-05 | Writing adds git exclude lines                                    | create path only (M21)                                          |
| DATA-05 | Remote default branch layer                                       | passes with a wrong ref string (fake ignores args)              |
| APP-13  | `copyText`                                                        | the test cites a feature whose checklist does not hold the item |

Rows `stub` with code and tests landed:

| Feature | Item                                                                                        | Gap                                                             |
| ------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| GIT-06  | Up-to-date toast                                                                            | passes without it (M32b)                                        |
| GIT-06  | Second request ignored (rename, merge, set target)                                          | push and pull only (M16)                                        |
| GIT-09  | Keep old remote branch and warn                                                             | warning has no code or test                                     |
| GIT-08  | View fails; MERGED/DRAFT states                                                             | no test                                                         |
| GIT-13  | Fetch at most once a minute                                                                 | tested; no production caller                                    |
| REV-05  | Review model, edit before sending, `customPromptOf` wiring                                  | no test in this area                                            |
| REV-09  | Wait budget for refs; 200-file cap                                                          | only `waits > 0`; cap no test                                   |
| PR-03   | By-branch answer shape; keeps last PR; rate limit wiring; 10 s timeout; 5 min memory expiry | M12, M13, M14, L1                                               |
| PR-03   | Closed PR shown only while head matches (positive case)                                     | no test (M17)                                                   |
| PR-03   | PR state in header and sidebar updates after a poll                                         | no test (M4, M15)                                               |
| PR-11   | gh failure on lists; odd ids                                                                | no test (L8)                                                    |
| PRJ-02  | Clone streaming; clone double click; leftovers                                              | M29                                                             |
| WS-05   | Trash fallback, remove failure, double archive, errors reach the user                       | M24, M3                                                         |
| RUN-01  | Run exit settles state; archive stops runs; default action rule; validation messages        | M28, M24                                                        |
| RUN-01  | Run environment `TERM`, `COLORTERM`                                                         | no test (L15)                                                   |
| RUN-07  | Rendered output stays after exit, then saved history                                        | passes without it against real Rust (M8)                        |
| RUN-07  | "up to 1000 lines" cap                                                                      | cap untested                                                    |
| NAV-04  | Delete section returns workspaces (DB cascade); pin persisted; move out of a section        | store only (M26)                                                |
| NAV-11  | Fallback when the store has no open chat; waiting-flag from the card branch                 | no test (M35b)                                                  |
| CHAT-19 | Hidden chat never notifies; tool approvals while viewing                                    | L9                                                              |
| CHAT-27 | "Retry in new chat"                                                                         | tests likely fail (M7); "retrying n/m", "Retry now" are unbuilt |
| PLAT-21 | Scan every 10 s; manager started at launch                                                  | no test, not constructed (M41)                                  |
| SIDE-24 | Title and branch cuts, New chat, fastMode, model-missing                                    | no test (L10)                                                   |
| RUN-03  | Last block boundary, unknown variable text                                                  | L15                                                             |

## 6. Missing test layers

Integration over the real container (`createTestContainer`). Each of these would have caught a bug named above. None exists.

1. Send and first chat: seed a workspace, `sessions.send` and `createFirstChat`, memory sidecar, ingest the reply, assert one visible turn and the pending entry cleared (M1, M37).
2. Workspace creation with the repo's own settings: `.conducted/settings.toml` with `remote_name` and `file_include_globs`, then `workspace.create` (M2).
3. Merge to archive: PR poll returns MERGED, `archive_on_merge` on, workspace archived, running-chat Err reaches the user (M3).
4. Poll to header: select a workspace, advance fake time, assert git state, PR state, and the header and sidebar labels, including a failing check (M4, M15).
5. Project removal with a workspace (M5).
6. Terminal life: create, write, exit, restart the service, read output; no throw (M8).
7. Attachments and queue with real composer and real queue (M6).
8. Container start with the real placeholders (M42).
9. Cancel with queued rows through the real queue and composer (M36).

Contract tests. The Platform has one (`platform/contract.ts`); services' stand-ins do not.

1. `FakeGitRunner` against `ShellGitRunner` over a real temp repo and bare origin (M31). Replace about 22 copies.
2. A PTY handle contract: screen reads after exit, `ack`, resize, missing cwd (M8, M9).
3. File system contract: write into a missing folder, path scope (M18).
4. Favourites repository fake against the SQL repository (M39), and the workspace and repo table fakes (M23, L12).
5. Captured real `gh` outputs and GraphQL responses as fixtures (M11, M12).

Real git tests: `GitService.changedFiles`, `discardFile` (untracked, staged-added, glob path), `push` with a differently named upstream, `pull`, `setTargetBranch`, `renameBranch`, `fetchIfStale`, and a rename in `FileDiffService.load` (L6, M30, M32). `checkpointer.sh` output through `changesForTurn`.

Real-size tests: 300 workspaces in `SessionsService.start`, `markAllRead`, `cancelAll`, `GithubService.watch` and `SectionsService.place`; 5,000 changed files in `changedFiles`; 3 MiB through a terminal; 300 terminals and the unpruned `#records`; a 14-file diff cache; turn builder shapes in L11.

Concurrency tests missing: two overlapping cancels; two creates of a PR; two clones; two `updateConfig` calls; `Promise.all([send, send])` on a new chat; an older failure after a newer success in the PR poll; a keep-awake scan racing `stop`; a settings write racing a reload with a failing first write (partly covered).

## 7. Rules and guards

### Rules worth a line in `docs/engineering.md`

1. A service dependency that the tests inject and the container does not pass is a defect. Mark optional deps as needed, and give every service one container test that uses it (M1, M2, M3, M5).
2. A fake never returns `ok` for a method whose real body throws or is a placeholder. Fakes live in `src/test/`, have a contract test, and build errors the way the real thing does (M6, M8, M31).
3. A test on a database asserts what is on disk (re-read through a repository or restart the service), not only the store.
4. A negative assertion ("no call", "not saved") has a positive control in the same test and a real settle point.
5. A public service method with no caller outside tests is either wired in the same PR or deleted (M4, M14, M21).
6. Gate on real tool output: any test that parses `git`, `gh` or Rust output uses a captured fixture, not a string the test invented (M11, M12).
7. A test title that says "once", "only", "keeps" or "without" names the check that proves it. A test never asserts an exported constant against its own literal.
8. Header claims and `done` rows are checked together: a `done` row whose checklist has an item with `none` in the checklist map stays `stub`.

### Deterministic checks a script could run

| Check                                                                                              | What it flags in this area today                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test file with no `expect(`                                                                        | none (all 75 files have assertions)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Test whose every `expect` is on a `vi.fn` the test configured                                      | none found; 9 call-argument asserts at agent-catalog.test.ts:67,127,140,161 and chat-02:331,408,427,444 are effects at a port (acceptable)                                                                                                                                                                                                                                                                                                                                                                                                           |
| `vi.mock` of the file under test                                                                   | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Dependency cast `as unknown as <Name>Deps` or `{} as never` in a service test                      | sessions area 10 sites in 8 files; settings area 7 in settings.test.ts plus 4 in terminals, 1 each in keep-awake and updates; git area 15 `as never` in 9 files (`cache`, `agent`); GitHub area 15; workspace area 17 in 13 files                                                                                                                                                                                                                                                                                                                    |
| `GitRunner`/`Shell`/`fs` object literal defined in a test file (instead of `src/test/`)            | about 22 git runner fakes; two `makeRunner`, two `makeGit`; `fakeFs` in composer.test.ts and settings.test.ts; `class NodeDatabase implements Database` copies at sessions.chat-02:25, sessions.chat-05:33, follow-up-queue.chat-05:31                                                                                                                                                                                                                                                                                                               |
| `withWorktreeLock: (_x, work) => work()` pass-through                                              | 10 files in the git area; only git-09 records it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Fake method returning `ok(...)` for a source method whose body is `notImplemented`                 | 9 sites in 5 files (M6); `getScreenState`/`setScreenState` in terminals tests (M8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `expect(UPPER_CASE_CONST).toBe(literal)`                                                           | pr-polling.pr-03.test.ts:78, workspace.setup.test.ts:386,395, git.git-06.test.ts:323                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `new Promise(() => undefined)` fake with no test that resolves it                                  | run-scripts.run-01.test.ts:127,294,318,340,399,416                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `setTimeout(`/`sleep`/`Date.now()` without fake timers                                             | composer.test.ts:135 (13 uses), sections.test.ts:198, github.pr-03.test.ts:155 `Date.now()`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Microtask-count settle (`for ... await Promise.resolve()`)                                         | git.test.ts:121-123, github.pr-03.test.ts:160-162, sessions.chat-05.test.ts:170-173                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Loop with `expect` inside and no non-empty guard                                                   | git.rev-01.test.ts:145-148,161-163                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `start()` or timer in a test with no `afterEach` stop                                              | settings.test.ts (13 `start()` on success paths only), repo.config.test.ts:299-315                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Declared failure switch never turned on                                                            | composer.test.ts:46,88 (`fail.mkdirp`), workspace.ws-05 harness `worktreeRemoveCode`/`trashed`, turn-builder.test.ts:54 `"interrupted"`                                                                                                                                                                                                                                                                                                                                                                                                              |
| Public service method or exported function whose only references are tests                         | `GitService.watch`, `fetchIfStale`, `CheckpointService.exists/changesForTurn/changedSince`, `GithubService.watch`/`pollNow`, `onMerged` dep, `pollSkipReason`, `nextBatchSizes`, `effectiveBatchSize`, `initialBatchSizes`, `RateLimitGate.decide`, `summarizeChecks`, `PULL_UP_TO_DATE_MESSAGE`, `getForRepo`/`setForRepo`/`resetForRepo`, `KeepAwakeService`, run-scripts `onSetupFinished`/`stopAllForRepository`/`isBusy`/`lastRunId`/`clearRuns`, `FollowUpQueue` pure helpers, `ChatTitleService`, `classifyAttachment`/`convertsToAttachment` |
| Dependency declared in a Deps type and never read in the service                                   | `onMerged`, `cache` in `GithubServiceDeps`; `composer.clearDraft`, `queue.release`, `notifications.onLiveStateChanged` in `SessionsServiceDeps`; `cache` in `GitService`                                                                                                                                                                                                                                                                                                                                                                             |
| Two test files for one source with the same `it` titles                                            | pr-polling.test.ts vs pr-polling.pr-03.test.ts (about 5), pr-mapping `summarizeChecks` (2)                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Test file with no feature id in `describe` or title                                                | ports.test.ts (7 tests), transcript.test.ts, follow-up-queue.test.ts, 11 sessions-area files with no `@feature` header                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Fixture built by `JSON.stringify` for gh/GraphQL output with no captured file                      | github.pr-03.test.ts:29-93, github.pr-11.test.ts:132-164, github.test.ts:117-122                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Backlog row `done` and an issue checklist item mapped to `none`                                    | the `done` rows in section 5; this needs the checklist map as a data file, so the check can run (the issue bodies hold the checklists)                                                                                                                                                                                                                                                                                                                                                                                                               |
| Source file in `core/services` with a `notImplemented` call reachable from `container.ts` start-up | `spotlight.healAfterCrash`, `updates.check`, `workspace.removeWorkspacesOf`, terminals `getScreenState`/`setScreenState`                                                                                                                                                                                                                                                                                                                                                                                                                             |

Each guard needs a sample it must flag, as `boundaries.test.ts` does.

## One-paragraph summary

Of 75 test files in `core/services`, 33 are REAL, 42 are WEAK and none are wholly THEATER, with about nine theater or near-theater single tests inside the WEAK files. The worst problems are the joints between the services and the container (no chat can send because `launchFor` is never passed, repo config is ignored on workspace creation, merges never archive, polling never starts, project removal and terminal screen saving throw), fakes that drift from real git, `gh` and the PTY with no contract test (about 22 git runner copies; real `gh` output goes unclassified), and `done` rows whose checklist items have no failing test (the SQL guard in config writes, the `interrupted` outcome, the 25 MB cache, settings actions and env rewrite, the file count, restart persistence). Separately, `sessions.chat-27.test.ts` very likely fails in CI and exposes a real `retryInNewChat` bug. The best files to copy are `repo.config.test.ts`, `keep-awake.test.ts` and `sessions.chat-05.test.ts`. Next step: the container integration tests in section 6 (items 1 to 6) come first, because five of them fail today for real reasons.

# Audit s2-1-core-2 (branch slice2/step-1)

Paths are under `apps/desktop/src/` unless noted. Read only; no tests were run. Every backlog row for these eight features is still `stub`, which the issues say flips to `done` in the closing PR (LATER, one note for all eight).

## GIT-09 Rename the branch

- MUST `core/git/rename.ts:67-105` (`branchNameTaken`) repeats `branchNameIsTaken` in `core/git/worktree.ts:463-475`: the same two `show-ref` checks for `refs/heads/<n>` and `refs/remotes/<remote>/<n>`. `nextFreeBranchName` (`rename.ts:46`) is a second copy of `nextFreeName` (`worktree.ts:77`); only the start suffix differs. Fix: let `branchNameTaken` call `branchNameIsTaken` and add the PR check on top, and give `nextFreeName` a start-suffix parameter.
- MUST `core/git/rename.ts:64` `isGitHubRemote` (`/github\.com[:/]/`) is a second GitHub-remote test next to `isGithubRemoteUrl` in `core/services/github.ts:244`. The two disagree: `ssh.github.com` and `evilgithub.com.example` are handled differently. Fix: use one function, moved to a shared place so `core/git` does not import a service.
- MUST Issue items not built, and no header or issue note says so:
  - Renaming the branch does not rename the workspace folder (`GitService.renameBranch`, `git.ts:1306`, only calls `applyBranchRename`, `workspace.ts:1274`).
  - No short-lived symlink is left or tracked.
  - "Rename keeps the old remote branch **and warns the user**": nothing warns. `git.git-09.test.ts:235` only checks that nothing is deleted.
  - The repo-level custom prompt for Rename branch has no consumer in this feature (`renameBranchAfterFirstMessage`, `workspace.ts:1054`, is still a placeholder).
  - Fix: build them, or move them to named features and cut them from the GIT-09 issue.
- LATER `core/git/rename.ts:151-153` returns ok with nothing saved when the typed name equals the current branch. That is fine, but when the free-name rule picks `name-v2` the user is not told (`features/workspace/WorkspaceHeader.tsx:200` just closes the dialog). Fix: return the final name and toast it.
- LATER `workspace.ts:1274-1288` (`applyBranchRename`) upserts from a row read before the write. A concurrent change to the same row in between is overwritten in the store. Fix: re-read after the write.
- Tests: no test covers the two missing operation items (folder rename, symlink) or the remote-branch warning, since the code does not exist. The other items have tests (`git.git-09.test.ts`, `rename.test.ts`, `workspace.git-09.test.ts`).

## GIT-13 Fetch on demand, at most once a minute

- MUST `core/services/git.ts:766` `fetchIfStale` has no caller in any live path (only `git.git-13.test.ts` calls it). The PR poller (`github.ts` `#pollWorkspace`) never passes the PR base and head ids on. Engineering.md "Done means reachable": add the wiring as a checklist item on PR-03 or GIT-12, or call it from the poll.
- MUST `core/services/git.ts:326` `plainBranchName` is a copy of `branchNameWithoutRemote` in the same file (`git.ts:402`). Fix: delete `plainBranchName`, use the existing function.
- LATER `git.ts:425` `#lastFetchAt` grows with every repo and branch and is never pruned (data lifetime rule). The base and head share one key, so a head fetch blocks a base fetch for a minute. Fix: drop entries older than 60 s when writing, and decide whether the key should include the ref.
- LATER `git.ts:795` hardcodes `baseIsLocalStackParent: false`, so the `stack_parent` branch of `decideFetch` cannot happen live. It is commented, but the header does not say so.
- Tests: both checklist items have tests that would fail without the code (`git.git-13.test.ts`), but the tests prove nothing about the live trigger, since there is none.

## GIT-16 Explain a blocked git (Xcode licence) and offer the fix

- MUST `apps/desktop/src-tauri/src/shell.rs:977-1004` `ALLOWED_PROGRAMS` has neither `xcodebuild` nor `osascript`. In the real app the start-up probe (`core/git/xcode-license.ts:30`) and the "Run for me" fix (`xcode-license.ts:64`) are both refused with `shell_program_not_allowed`. The probe failure is only logged, so the notice never shows; the fix would show an error toast. The tests use the in-memory Platform, which has no allowlist, so they pass. Fix: add both programs to the list and add a Rust test that every program the UI starts is on it.
- LATER `app/xcode-license-notice.ts:47` probes once at mount; a licence change after a git failure shows nothing. `failedCommandError` (`core/git/runner.ts:305`) turns a real git licence failure into `git_xcode_license`, but nothing turns that error into the toast. Header says "check once at app start" (honest), but the issue line "Git cannot run until the licence is accepted: show the toast" is only met at start-up.
- LATER `app/xcode-license-notice.ts` is a component in a `.ts` file that probes through `platform.shell` directly, while the fix goes through a service. Pick one door.
- Tests: all five items have tests (`git-16.test.tsx`, `system.git-16.test.ts`, `xcode-license.test.ts`). No test checks the allowlist (see MUST).

## PLAT-21 Keep the Mac awake while agents work

- MUST `core/services/keep-awake.ts:93` `KeepAwakeService` is never constructed. Nothing outside its test file imports it (`container.ts` has no keep-awake). The feature does nothing in the app. Header claims "A caller calls `scan` every `KEEP_AWAKE_SCAN_MS` and whenever a chat starts or stops working" and "the app quitting (stop cancels the process)": no caller, no timer, and `container.stop()` does not call `stop()`. Items "scans every 10 seconds", "a keep-awake manager reacts to the setting" and "off below 10 percent battery" are therefore not live. Fix: build it in `container.ts`, subscribe to the setting and chat-working state, run the 10-second timer, and stop it in `stop()`.
- MUST `keep-awake.ts:99` re-types the setting key as a string constant (`"caffeinate_while_agents_running"`) instead of using the registry key in `core/registries/settings.ts:192`. Fix: read the key from the registry.
- LATER `core/registries/settings.ts:197` says "falls **below** 10 percent"; the code stops at 10 percent **or less** (`keep-awake.ts:49`). The research says 10 percent; align the text.
- LATER `keep-awake.ts:112` `stop()` bumps `#generation`, but a `scan` called after `stop()` starts caffeinate again. Fix: add a stopped flag.
- LATER No pmset or caffeinate failure reaches the user: `scan` returns the error, and with no caller no one reads it.
- Tests: the service tests are real and cover each rule. No test covers the live wiring, the timer or the stop on quit.

## PLAT-31 Window focus and blur events

- LATER `platform/tauri.ts:224-227` `onEvent` swallows a failed `listen` with an empty `catch`. The header says this is by design, but it is the banned "silent failure": a lost focus listener means polls (repo, settings) never pause or resume and nobody can tell. Fix: let the Platform report subscription failures (or log through `writeLog`).
- LATER No test runs against the real window binding. `tauri-window.test.ts` uses a fake, and the in-memory Platform passes the contract test; fine for now.
- Checklist: `isFocused`, `onFocusChanged`, the `tauri://focus` and `tauri://blur` names and the unsubscribe-before-resolve case are all tested. The "branch list refresh only while focused" rule belongs to GIT-12 (blocked on this) and has no consumer yet; `repo.ts:1012` and `settings.ts:1106` already use it.
- Header lines: all kept by the code.

## PR-03 PR status polling, batched, behind a rate-limit gate

- MUST `core/services/github.ts:1142` `watch` has no caller outside tests, and nothing calls `pollNow`. The poller is not live: no workspace's PR state is ever polled in the app. The "PR state in header and sidebar updates after a poll" item is therefore not met. Add the wiring (the sidebar and selected workspace subscribe) or a checklist item on the feature that owns it.
- MUST `github.ts:1220-1260` `#pollWorkspace` sends `prBatchQuery([one lookup])` per workspace. `MAX_BATCH_SIZE`, `initialBatchSizes`, `effectiveBatchSize` and `nextBatchSizes` (`pr-polling.ts:25,150-170`) are never called outside tests, so "PR state for a repository comes from one batched call", "batch size starts at 5, halves on timeout or high cost and grows by a fifth" and "PR polls are batched" are only pure functions. Header of `github.ts` claims "polling each watched workspace's pull request in a batch". Fix: group by repo, size by the helpers, and feed back the timeout and `rateLimit.cost` outcome.
- MUST `pr-polling.ts` `pollSkipReason` (line 112) and `RateLimitGate.decide` (line 190) have no live caller. The skip rules (inactive, unlinked, offline, no remote) are not applied by the poller, so "PR polling is skipped for inactive workspaces, unlinked repos and forges without a remote" does not hold. `#pollTick` calls `gate.remaining()` and `updatePolling` itself instead of `decide`.
- MUST `github.ts:1339-1350` `#readRateLimit` turns every failure (settings, spawn, non-zero exit, bad JSON) into `null`, and `pr-polling.ts` treats `null` as "poll at the normal rate". That is an invented default and a silent fallback. The header at `pr-polling.ts:14` and the doc of `createRateLimitGate` say the probe error is "handed to the caller as an error, never turned into a made-up budget", but the live probe never returns an error. Fix: return a `Result`, and let the gate pause polling and report on a failed probe.
- MUST `pr-polling.ts:197-211` the gate's `read` rethrows a probe failure (`throw error`). Engineering.md: failure lives in the return type, no hidden throws. Fix: return `Result<number | null>`.
- MUST `github.ts` `GithubService` has timers (`watch`) but no `dispose` or `stop`, and `container.stop()` (`container.ts:678-711`) does not stop it. Fix: add `dispose` that clears every watcher timer and call it.
- MUST Three copies of the PR state mapping. `github.ts:1270-1280` and `pr-mapping.ts:491-498` (draft only while open) are the same text. `github.ts` `parsePullRequestRecord` (line ~383) checks `draft` first, so a closed or merged draft PR is reported "draft", against the header of `pr-mapping.ts` ("draft only while open"). Fix: one function, used by all three, with a test for a merged draft.
- MUST `github.ts:2` header lists "Test first" for PR-01 and PR-11 only, and `@feature PR-01` even though the file now also owns PR-03, PR-11 and PRJ-02; `github.ts` is 1,803 lines. Per engineering.md the header must say what the file does now and which feature owns what; split the file (poller, reads, clone pickers).
- LATER `github.ts:1244-1262` `#noPrUntil`, `#lastPolledAt` and `#headByWorkspace` are never cleared when a workspace is unwatched or archived (unbounded maps).
- LATER `github.ts:1210-1216` `pollNow` is awaited inside `#pollTick` with `void`; if `contextOf` throws, the rejection is unhandled and the timer is never re-armed.
- LATER `github.ts:833` `onMerged` is wired in `container.ts:416` but `GithubService` never calls it (no merge-detected path from the poll), so archive-on-merge cannot fire from polling.
- LATER Not built and not claimed: "GitHub comment sync runs when a PR poll shows a new updatedAt" (needs a hook after `#toWorkspaceEntry`), "offline pause", the Checks tab "Waiting" state wiring, "A detail query loads more data for the selected PR". `NO_REQUIRED_CHECKS` (`github.ts`, empty set) means no check is ever marked required: say so in the header or fetch the data.
- Tests: pure rules are well tested (`pr-polling.pr-03.test.ts`, `pr-mapping.pr-03.test.ts`). No test proves that a budget below 500 or 1000 stops a real `watch` timer, that the 10-second timeout reaches `gh` (the `GH_GRAPHQL_TIMEOUT_MS` is in `gh-commands.ts` but the poll test does not check it), or that the poller batches siblings.

## PR-11 List and attach GitHub issues and pull requests

- MUST `core/services/github.ts:1738-1747` `#readGh` repeats `ghCommandError` (`github.ts:756`) line for line. Fix: use `ghCommandError` in `#readGh`.
- MUST `github.ts:1022-1062` `listOwners` and `listRepositories` (PRJ-02) repeat the settings, run, `recordGhResult`, exit-check sequence that `#readGh` already does. Fix: call `#readGh`.
- MUST `github.ts:1668` `recentRepos`, `github.ts:1646` `pullRequestByNumber` and `attachPullRequestToWorkspace` (`github.ts:1710`) have no caller except tests, and no hook exposes `recentRepos`. A pull request chosen in the picker cannot be attached: `Actions.issues.attachToWorkspace` (`core/actions.ts:144`) takes an issue and only reaches the PR path by way of the issue endpoint. Fix: wire a hook and an action, or add checklist items on the screen features that will call them.
- LATER `github.ts:1631` `listPullRequests` reads the 50 newest open PRs and filters on the client. Research 5B.1.10 also uses `search/issues?q=repo:... is:pr` for search; the issue item says "list and search". A repo with more than 50 open PRs cannot find an older one.
- LATER `github.ts` has two repo parsers, `parseGithubRepos` (REST, line 501) and `parseGithubRepositories` (gh JSON, line 704), with the same output type.
- LATER `core/hooks/github.ts:2` header still says `@feature DATA-01` and "Owns: the GitHub hooks" with "Test first: lives with the feature"; the hooks now have bodies and tests (`github.pr-11.test.tsx`).
- LATER `core/hooks/github.ts:56` `useIssues` calls `notImplemented("PR-09")` for non-GitHub providers inside a query function, which throws a placeholder at render time.
- Tests: issues filter, context path and file, and the PR path have tests (`github.pr-11.test.ts`). None checks the Issues tab disabled state on a screen (no screen yet).

## PRJ-02 Clone a project from GitHub

- MUST Dialog, landing button and Browse are not built. `features/sidebar/AddProjectButton.tsx` has no "Open GitHub project" entry (its own header says it joins "once those services exist"), no `Clone GitHub repo` dialog exists, nothing reads `cloneProgress` (`core/services/repo.ts:86`) or the owner and repo hooks (`useGitHubOwners`, `useGitHubRepos`), and `recentRepos` has no hook. Items "Landing Open GitHub project button", "Clone GitHub repo dialog", "Open GitHub project clones by URL with Browse and recent repos" are missing. Fix: build the dialog or track it as a checklist item on a UI feature.
- MUST `core/services/repo.ts:631-650` "Clone streams its progress output to the UI while clone --progress runs" is not true. `runChecked` returns only when the clone has ended, so `cloneProgress` is set to `cloning` with the output of a finished clone. The header claim at `repo.ts:593` ("Progress is kept in the store for the dialog to show") is only true after the end. Fix: use a streaming start and push each line into the store.
- MUST `repo.ts:677` `if (current.ok && current.value !== "" ...)` drops a failed `branchShowCurrent` silently and skips the checkout of the default branch. Fix: return the error.
- MUST `repo.ts:686-730` the "already added" and `db.conflict` handling repeats `addLocal` (`repo.ts:545-585`). Fix: one private "register this folder" function used by both.
- LATER `repo.ts:596` two overlapping `clone` calls share the one `cloneProgress` slot, and no single-flight guards a double click. A failed step after the clone leaves a cloned folder behind (not deleted; surface its path in the error).
- LATER `core/git/gh-commands.ts:313` `githubRepoClone` has no `timeoutMs`; check that the runner default (not read here) does not kill a large clone.
- Tests: `repo.prj-02.test.ts` and `github.prj-02.test.ts` test the service. Nothing tests the dialog or the streaming, since neither exists.

Summary: 49 findings: GIT-09 3 MUST + 2 LATER; GIT-13 2 MUST + 2 LATER; GIT-16 1 MUST + 3 LATER; PLAT-21 2 MUST + 4 LATER; PLAT-31 0 MUST + 2 LATER; PR-03 8 MUST + 4 LATER; PR-11 3 MUST + 4 LATER; PRJ-02 4 MUST + 2 LATER.

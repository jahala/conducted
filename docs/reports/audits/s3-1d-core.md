# Audit s3-1d-core: PR-08 Stacked PRs and read-only Graphite

Files read: `core/services/graphite.ts`, `core/services/github.ts` (stack parts), `core/git/gh-commands.ts`, `core/services/git.ts` (Graphite uses), `core/registries/settings.ts`, `core/hooks/github.ts`, `features/git-panel/changes/StackView.tsx`, `ChangesTab.tsx`, `GitPanel.tsx`, the six `*pr-08*` test files, issue #201, services-map 3.8, ui-map 3.6 and 6. Paths below are relative to `apps/desktop/src/`. Nothing was run or changed.

## PR-08

1. **MUST. Wrong install message** (`core/services/github.ts:644-645`, `:2884-2886`). The user sees "GitHub's stack extension is needed. Install it with `gh extension install github/gh-stack`." The required text is "<action> a stack needs GitHub's stack extension. Install it with `gh extension install github/gh-stack`." The code never inserts the action, so the wording differs from Conductor's. Fix: build the message from the action ("Syncing" or "Merging", as Conductor's renderApp words it) and use it for sync and merge. The code does not install the extension itself, which is right. The test (`github.pr-08.test.ts:193`) checks only the error code, not the message, so it would pass with any text. It should assert the full string.

2. **MUST. `mergeStack` never detects a missing extension** (`core/services/github.ts:2834-2856`). It goes through `#runPullRequestCommand`, so a "unknown command stack" failure shows as the raw `gh` error, with no install message. Fix: share the sync check (`isStackExtensionMissing`) with merge, and add a test that merge returns the same install message.

3. **MUST. "Ready for review" marks the wrong pull request** (`features/git-panel/changes/ChangesTab.tsx:129-133`, `StackView.tsx:93`). `StackView` calls `onMarkReady(entry.number)`, but `markStackReady` takes no argument and calls `actions.pullRequests.markReady(workspaceId)`. That marks the workspace's own pull request, whichever draft row was clicked. `changes-tab.pr-08.test.tsx:140` asserts `markReady` was called with `workspaceId` only, so it fixes the bug in place. The test also replaces `markReady` with `vi.spyOn(...).mockResolvedValue`, so nothing real runs. Fix: `markReady` has to accept a PR number (a contract change, so ask the owner), or the row must switch to its branch first. Then test with a draft that is not the current one.

4. **MUST. `syncStack` has no live caller** (`core/actions.ts:153` only). The "Sync stack" action never appears in the UI: `git-header.ts` offers only `merge_stack`, and no button calls `syncStack`. Checklist item "SyncStack" and "gh stack sync runs" are done in the service but unreachable. Fix: add the menu or header entry. If the owner wants it deferred, put the wiring on the checklist as an open item.

5. **MUST. Stack readiness is not built** (checklist "Readiness of each stack entry comes from a GraphQL query by PR number"). There is no query for `mergeable` or `mergeStateStatus` per stack entry. `StackEntryView` has no readiness field. `GitPanel.tsx:~185` always passes `blockedReason: null`, so "Stack blocked" (ui-map 3.6) can never show. Fix: add the per-PR GraphQL query in `gh-commands.ts`, put readiness on the entry, feed `blockedReason`, and add tests.

6. **MUST. Settings labels and shape differ from Conductor** (`core/registries/settings.ts:818-840`). ui-map 6 names the controls "Use GitHub stacked PRs" ("Instruct agents that they can use `gh stack` for PR stacking") and "Graphite stack support" ("Detect Graphite stacks for the active local workspace…"). The code has "Allow stacked pull requests" and the inverted "Turn off Graphite stack detection". The checklist asks for one positive setting with one home. Fix: show the positive labels and descriptions, and keep `graphite_disabled` as the stored key only. The code also uses `github_stacked_prs_enabled` to switch the stack view and merge. Conductor uses it only as an agent instruction. D020 and D022 need an explicit decision for that difference. If the setting does not feed the agent prompt, say so.

7. **MUST. Invented default for the trunk** (`ChangesTab.tsx:101-102`). While the workspace loads, the trunk is shown as `"main"`. The regex `^[^/]+\//` also cuts the first path part of a target branch without a remote, so `release/1.0` shows as `1.0`. Fix: use `branchNameWithoutRemote(targetBranch, remote)`, the helper `git.ts` already uses, and render the stack only once the workspace is ready.

8. **MUST. The Graphite poll is not limited to the visible repository** (`core/services/graphite.ts:131-133`, `:176-178`). Every read (`stateOf`, `parentBranchOf`, `containsBranch`, `needsRestackOf`) calls `ensureWatching`, which starts a 5 s poll for that repository. The poll then runs until `dispose()` and is never released (`#readers`). Research 3.8.1 and 5B.1.8 poll only the visible workspace's repository. A read is also a side effect, so `stateOf` is not a pure query. Fix: have the screen that shows the repository call `watch` and release it on unmount, and let the reads only read.

9. **MUST. Header claims the code does not keep.**
   - `core/services/github.ts:68-70` says "Graphite (`gt state`, `gt checkout`) is not read here", but `readStack` reads `needsRestackOf` from the Graphite service (`:2945`) and `GithubServiceDeps.graphite` exists (`:1094`). The header needs updating, and its "Must handle" does not mention the restack flag.
   - `StackView.tsx` header: "a ready action only marks a draft" is kept, but "Data: … Ready through mark ready" is wrong for any row but the current PR (finding 3).
   - `graphite.ts` header: "a failed state read kept on the repository" is kept for spawn and parse failures. A `gt state` non-zero exit is turned into "no stack" with `error: null` (`:225-228`), so a real failure such as a broken `gt` install is hidden. Research does this too (`|| echo "{}"`), so the header should say it.
   - `graphite.ts` header: "`gt` missing (the probe says so …)". The probe result is cached for the first `cwd` and for all repositories (`#installed`). Research caches it forever too, which is fine, but a probe error is also cached, so one transient error stays until restart. Do not cache an `err` result.

10. **LATER. Missing-`gt` probe differs from the research** (`gh-commands.ts:~470`). `command -v gt` is replaced by running `gt --version` with `okExitCodes: [0, 1, 127]`. This is fine only because the runner turns a missing program into `process_spawn`. The extra exit codes do nothing for `run`. Remove them or add a test that a missing program reads as "not installed".

11. **LATER. Test strength.**
    - `graphite.pr-08.test.ts` covers parse, timeout constant, newest-answer, poll cadence, off switch and checkout. Good.
    - Nothing tests `dispose()` stopping every timer.
    - Nothing tests that two repositories poll separately.
    - No test covers the 30 s timeout being applied to the real call (only the constant).
    - `git.pr-08.test.ts` covers the diff target and `gt checkout`. "PR and stack range diffs … returning resolved or unresolved" and "Diff view mode range shows a PR or stack range" have no test I could find.
    - `stack-view.pr-08.test.tsx` and the Changes-tab test both assert real behaviour, except as noted in finding 3.
    - `github.pr-08.container.test.ts` has one test that checks only the off switch.

12. **LATER. Unchecked checklist items.** I found no code or test for these: "Switch branch?" when an agent is running is built in `StackView` only, and `GitService.switchBranch` itself does not check for a running agent. "PR and stack range diffs check both commit ids, fetch any missing, find the merge base…" and "Diff view mode range" are not found. "Use GitHub stacked PRs enables the stack view and stack merges" is partly kept (view and merge, not the agent prompt). "Stack sync errors: … abort markers" is covered by the service. The `GraphiteService` has no 5 s "visible repo" gating (finding 8).

13. **LATER. Duplicated logic.** The "stacked PRs off → `github_stacks_disabled`" check is written three times in `github.ts` (`:2836`, `:2866`, `:2910`). Move it into one helper. `readStack` and `GithubServiceDeps.graphite` take a hand-written structural type (`:1094`) instead of the `GraphiteService` interface, which makes a second description of the same method.

14. **LATER. Engineering rules.** Listeners and timers: `GraphiteService.dispose` is called by `container.stop()` (`container.ts:1236`), fine. `useStack` refetches every 60 s with no overlap guard, but TanStack Query keeps only the newest result per key, so it counts as fine. A fake that repeats ids: not found.

Summary: PR-08 has 9 MUST and 5 LATER findings; the install message is wrong (MUST 1), and "Ready for review" marks the wrong pull request (MUST 3).

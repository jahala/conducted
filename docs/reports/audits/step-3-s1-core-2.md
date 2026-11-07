# Audit step-3-s1-core-2

Branch `overnight/step-3` against `main`. Read only. Owning files: `apps/desktop/src/core/status/workspace-status.ts`, `workspace-status.test.ts`, plus the wiring in `core/hooks.ts` (`useWorkspaceStatus`, `chatsFor`, `sameChatStatus`, `gitStateOf`) and `core/hooks.workspace-status.test.tsx`.

## WS-09 Workspace status as a pure function

- MUST
  `apps/desktop/src/core/model.ts:525` (and `workspace-status.ts` header). The type allows lifecycle label `"unstarted"`, which ui-map 3.8 lists (Unstarted, Setting up, Failed). `deriveWorkspaceStatus` never returns it, `WorkspaceState` has no `unstarted` value, and the header does not say it is dropped. Either remove `"unstarted"` from the union and say in the header why it is out (backlog workspaces are WS-11), or produce it. As it stands the type promises a label no code path can reach.

- MUST
  `workspace-status.ts:164-172` and the issue checklist. The issue lists "Set a manual status" and the state "derived_status and manual_status of a workspace" (services-map 2.3.1, 2.4.1: display value is `manualStatus ?? derivedStatus`, and setting a derived status clears the manual one). Nothing in the committed code covers this. `Workspace` has only `kanbanStatus` (`model.ts:111`), written by `setKanbanStatus`, and no test relates it to the derived status. Either the issue checklist is wrong (the kanban status is a separate user-set field, ui-map 3.8 says "user-set, separate"), in which case edit the issue and backlog row; or the missing behaviour belongs to this feature and the row should not be `done`. The header must state which.

- MUST
  Issue checklist, "Conductor's Local workspace and Ready (has branch) labels are replaced by our own Changes and Ready". The code has `changes` and `clean` (`model.ts:540-541`, `workspace-status.ts:159-160`). There is no `Ready` label, and the header (lines 10-11) says "changes, clean". The checklist and the code disagree. Fix the checklist to say `Changes` and `Clean`, or rename the label. Also state in the header that "Checks running (git status only)" from ui-map 3.8 is read here as "from the PR's checks" (see next finding).

- LATER
  `workspace-status.ts:134-139`. ui-map 3.8 says "Checks running (git status only)". The code also derives it from PR checks. The reading is reasonable (we have no separate git status), but it is an unlabelled interpretation. Add "Our design choice" to the header.
  Outcome: fixed already, 68f5cf36. The header states that ui-map 3.8's "Checks running (git status only)" is read here from the pull request's checks because there is no separate git-status source (workspace-status.ts:24-26).

- LATER
  `workspace-status.ts:1-20` header. The priority "lifecycle, then agent, then git" and "most urgent chat decides" are inferred; ui-map 3.8 gives the session order and the git order but not how the three groups combine, and the sidebar subtitle list there ("Initializing...", "Archiving...") is the only evidence for lifecycle going first. The header presents the cross-group order as research. Mark it "Our design choice".
  Outcome: fixed already, 68f5cf36. The header now says the order between the three groups is Our design choice, with the sidebar subtitle list as the only evidence (workspace-status.ts:14-17).

- LATER
  `workspace-status.ts:55-72`. A chat with `cancelling: true` and an open interaction returns `needs_*`, not `cancelling` (the interaction check runs first), while a cancelling working chat returns `cancelling`. This is defensible but untested and unstated. Add a test for a cancelling chat with an open interaction, and one line in the header.
  Outcome: fixed already, 68f5cf36. The header states that an open interaction outranks a requested cancel (workspace-status.ts:31-32), and workspace-status.test.ts now covers a cancelling chat with an open question.

- LATER
  `hooks.ts:108-131` (`gitStateOf`). `uncommittedFiles` and `changedFiles` are both set to `snapshot.files.length`. The two fields are meant to differ (uncommitted versus changed against the target branch). The status rule treats them as an OR so the output is right today, but GIT-04 (`git-header.ts`) will read `uncommittedFiles > 0` for "Uncommitted changes" and get committed-only changes wrong. Derive `uncommittedFiles` from the working-tree status, or leave one field out of the shared type. Likewise `pendingPullRequestAction: null` is hardcoded, so the status is correct but the shared `GitState` is only partly true. This is the same value a second reader will build, so move `gitStateOf` into `core/status/` or the git service so GIT-04 and WS-09 share one builder.
  Outcome: fixed already, 075e4b4e. useWorkspaceStatus now calls GitService.stateOf(workspaceId, prEntry, pendingAction) (hooks/workspaces.ts:99), so the duplicate gitStateOf builder is gone and both readers share one.
- LATER
  `hooks.ts:118-126`. `pullRequestUnavailable` is computed (`loading`, `none`, or the entry's reason) and then ignored by `deriveWorkspaceStatus`. When the PR lookup failed (offline, no access) the status falls through to `changes` or `clean`, which is the "never claims clean" case the header names only for git state. Either pass the unavailable reason into the rule and return no git label (null) when it is not `none`, or say in the header that PR trouble is not shown. Today a failed PR fetch on a branch with an open PR reads "clean".
  Outcome: fixed already, 68f5cf36. pullRequestLookupFailed now makes gitLabel return null for offline, no_github_access and an unknown reason, so a failed PR lookup never reads "clean" (workspace-status.ts:130-141).
- LATER
  Tests (`workspace-status.test.ts`). Items with no test that would fail without the feature:
  - Check state `waiting` counted as running (`workspace-status.ts:133`): no test uses `check("waiting")`.
  - `check("skipped")`, `"neutral"` and other non-failing states appear only once, as optional.
  - `state: "failed"` with `settingUp: true` (failed must win) and `state: "archiving"` with `settingUp: true`.
  - An archived workspace with `settingUp: true` returning null (the first guard is tested only without it).
  - `reviewDecision: "approved"` with failing checks and `mergeable: "conflicting"` with a draft are covered; "merge queue" with a closed PR is not.
  - `closed` PR combined with `uncommittedFiles: 2` should give `changes`; only the clean case is tested.
  - The "Setting up" and "Failed" labels from the checklist are tested; "Initializing" is tested too. No test for `Unstarted` (see first finding).
    Outcome: fixed already, 68f5cf36. workspace-status.test.ts now covers checks waiting (:370), skipped (:355, :391), failed+settingUp (:154), archiving+settingUp (:157), archived+settingUp (:134), merge queue with a closed PR (:391) and a closed PR with uncommitted changes (:396-398).
- LATER
  `hooks.workspace-status.test.tsx`. The tests build services with `{} as ...Deps` and set store state directly. That is acceptable for a hook that only reads stores, but `workspacesById` entries are cast (`{ state } as unknown as Workspace`) and sessions are cast, so a renamed field would not fail the type check. Use the fixtures from `core/db/test-fixtures.ts` instead. No test covers `sameChatStatus` (a streaming-only change must not re-render; a changed `backgroundTasks.length` must), which is the reason that function exists.
  Outcome: open, item WS-09. hooks.workspace-status.test.tsx:34 still casts its workspace entry with `as unknown as Workspace`, and sameChatStatus has no test anywhere (only its definition at hooks/workspaces.ts:35).

- Duplication checked: no second copy of the status order or of the chat-state mapping exists outside this file. `liveState.status === "working"` appears in `container.ts:249` and `container.ts:394` for other purposes (power and quit guards), not for status. `git-header.ts` (GIT-04, another batch) will need `hasMergeConflict`, `checksAreFailing`, `checksAreRunning`, `reviewIsBlocking` and `isReadyToMerge`; they are file-private here. Export them from a shared module before GIT-04 writes a second copy (its header already lists the same conditions: conflicts, any check failure, any pending or running check, review blocking).

- Looks and behaves like Conductor (D020, D022): the label set and order match ui-map 3.8 (Merged, In merge queue, Ready to merge, Draft pull request, Merge conflict, Checks failing, Checks running, Pull request open) and the session order. No screen is touched in this feature.

- Placeholder check: the `notImplemented("WS-09")` body is gone from `workspace-status.ts`; `git-header.ts` still holds GIT-04's placeholder, which is correct.

## Summary

WS-09: 3 MUST, 7 LATER.

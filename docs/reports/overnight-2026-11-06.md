# Overnight build, 5 to 6 November 2026

The night finished slice 2 and started slice 3. Slice 2's last three steps merged (#307, #308, #311), the five-area hardening merged (#309, #310, #312, #313, #314), main is green, and the slice report is merged ([slice-2.md](slice-2.md)). Slice 3 started at 03:25 UTC. Part 1a (the rust and sidecar batches) merged as #316 with 14 issues closed. Part 1b (the core batches) is #317: 11 features built, audited and fixed, in its second CI round when this report was written. AGENT-09, PR-08 and PR-09 are built in part but planned (D066, D067). The ui batches and step 2 were not started: a part begun after 07:00 could not merge before morning.

Slice 2's detail (steps, issues, audits, hardening by area, and what needs you for slice 2) is in [slice-2.md](slice-2.md). This page covers slice 3 and the night's own decisions.

## What needs you

- **Everything in [slice-2.md](slice-2.md#what-needs-you):** contract changes, product questions and the stale branches.
- **Slice 3 contract changes (platform.ts):**
  - `resourceUsage(workspacePaths)` (PLAT-14);
  - `PtySpawn.scrollbackLimitBytes` and a history error on `PtyHandle.onExit` (PLAT-08);
  - `onDeepLinkRejected` (PLAT-16), unless the app log is enough for links over 64 KiB.
- **Slice 3 product questions:**
  - AGENT-09 (Cursor in process) is built but planned (D066). Cursor's SDK cannot ship under D010. Also undecided: how the sidecar learns Cursor is signed in. The fixer's proposal: the app sets it from its own provider keys.
  - The 50 MiB scrollback folder cap makes the scrollback setting's 1 GB maximum meaningless (PLAT-08).
  - AGENT-18 shows a notice once per chat when the bundled skill folder is missing; the research gives no wording to compare.
  - Cursor gets the app tools as a stdio MCP server, where Conductor passes SDK tool objects. Users cannot see the difference.
  - A first message that is `/goal` never sends the workspace instruction block to Codex (AGENT-13).
- **Core-1 contract changes and questions:**
  - A migration `0005` adding `sessions.fork_resume_native_message_id` (CHAT-16). Until then, a restart before a fork's first send loses its resume point.
  - `core/api.ts`: `Actions.git.sparseCheckoutSettings` and `setSparseCheckoutDirectories` (GIT-15); a `path` on `openInDiffTool` (GIT-15); `Actions.pullRequests.syncStack` and `mergeStack` (PR-08).
  - PRJ-03's templates were invented by the builder: the gstack URL, the three template names and descriptions, and the `create-next-app` command. Keep them, replace them with Conductor's, or remove them (a visible change).
  - PR-08 and PR-09 are planned (D067). They need a build pass for the items listed above, and PR-08 also needs your contract change.
- **Core-2 contract changes and questions:**
  - `mainWorktreePath` in `packages/protocol/src/session-config.ts`, passed to the sidecar runner (WS-07).
  - A migration making `backlog_workspaces.repo_id` nullable with `ON DELETE SET NULL`, a nullable `repoId` in `model.ts`, and a repository picker on the backlog row (WS-11). Until then, removing a project deletes its backlog drafts.
  - The backlog is on by default (`unstarted_workspaces_enabled`); Conductor keeps it internal and off in release builds.
  - An unconfirmed Spotlight stop restores nothing, and the branch-pointer notice wording is ours; the research is silent on both.
  - Terminals get `resources/bin` on PATH, while PLAT-28 writes managed shims to `app_data/bin` (PLAT-35).
- **The CI summary step** names a failed bun test but prints no error message for it.
- **Stale branches added tonight** (the guard blocks force-deletes): local `slice3/step-1a`, `slice3/step-1b`, `fix/ci-316`, `fix/ci-317-panel`, `fix/ci-317-chat`, `report/slice-2`, `report/overnight-2026-11-06` and the new `node/*` branches; remote `slice3/step-1a`, `slice3/step-1b`, `report/slice-2` and `report/overnight-2026-11-06`.

## Slice 3

D065: the first step (54 features in 8 batches) lands in parts, each its own PR with one CI run.

| Part | PR   | Batches        | Features                                                                                                                          | Started (UTC) | Merged (UTC)    | Spend (USD)                                                     |
| ---- | ---- | -------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------- | --------------------------------------------------------------- |
| 1a   | #316 | rust, sidecar  | 14 done (PLAT-08, 12, 14, 16, 23, 24, 26, 27; AGENT-10, 13, 14, 18; SIDE-18, 22), AGENT-09 planned (D066)                         | 03:25         | 06:14           | about 3.9 (25.70 to about 21.8, with core-1 building alongside) |
| 1b   | #317 | core-1, core-2 | 11 done (CHAT-16, CHAT-17, DATA-07, GIT-14, GIT-15, PRJ-03, REV-04, RUN-02, SET-13, WS-07, WS-11), PR-08 and PR-09 planned (D067) | 05:05         | in CI (round 2) | about 2.5 (with part 1a's tail)                                 |

### What the audits found

- **Rust batch (19 MUST):** terminal history was not saved on quit, and a history cut could split a UTF-8 character or an escape (PLAT-08). Dictation said it was available without the speech permission, and a dropped session could deadlock (PLAT-12). Links of other schemes never reached the UI's parser (PLAT-16). The panic hook and the instance lock ran after the Tauri builder, and a release-build panic was lost before it reached the log (PLAT-27). The node gates do not compile Rust, so four compile and clippy findings reached the branch; the lead fixed them.
- **Sidecar batch (26 MUST):** Cursor lost text before a cancel, got no app tools, and read a broken SDK as "not installed" (AGENT-09, 10). `/goal` on an idle chat and `/compact` during a turn went to the agent as plain text (AGENT-13, 14). Nested secret fields reached stderr (SIDE-18). The slash cache used different keys for an open chat and for the new-workspace page, and dropped a repository in use (SIDE-22).
- **Core-1 batch (30 MUST):** a fork kept its resume point only in memory, and its checkpoint refs were not copied, so a fork could not be reverted once its origin was deleted (CHAT-16). The chat find bar could not reach a turn it had not drawn, and history search used up its limit on JSON key names (CHAT-17). The DATA-07 cache was never reached from the app. The forge rule was written twice (GIT-14), and a new untracked file "opened" in the diff tool with nothing shown (GIT-15). PRJ-03's rollback left the GitHub remote behind, and its first push had no credentials. About 20 of PR-08's 27 items, and PR-09's Link dialog and Cmd+I, are not built (D067).
- **Core-2 batch (18 MUST):** a failed review sync was only logged, and the Checks tab resolved comments past the API (REV-04). Start spotlight could never appear, and an unconfirmed stop still restored the root (RUN-02). A chosen program path that could not be staged fell back silently (SET-13); a user's own `claude` still wins in the login shell's PATH, which RUN-09 owns. A backlog start dropped its edits, and a failed create lost the backlog row (WS-11).

## Spend

DeepSeek: 33.68 USD when the night's goal began (slice 2 step 2), 20.66 USD at the end. The audits, fixers and hardening ran on the Claude subscription.

## Decisions made tonight

- D060: three agents at once, Opus fixers through mkbrief.py, the lead reads every diff, serial lands.
- D061: the guards run at mark-done; a step runs one batch plan at a time.
- D062: PLAT-28 is planned until its release feed exists.
- D063: a feature waits for needs that are not done or being built.
- D064: a quit stops the app first, for at most five seconds.
- D065: slice 3's first step lands in parts.
- D066: AGENT-09 is planned until Cursor's SDK can ship.
- D067: a feature whose title's behaviour is not built stays open.

## What went wrong, and what changed because of it

- The node gates passed work that failed later. The guards could go red only after rows were marked done (D061: `mark-done` now runs them), and Rust is not compiled in node gates (the lead compiles after each land).
- Tests the fixers wrote first ran in CI, because agents may not run tests on this Mac. A step's first CI round therefore found 29, 45, 7, 3 and 37 failures. The tests hardening added a guard for two classes of tests that can never pass, and a CI summary that names each failed test by file. It named every failure after it merged.
- Hand edits to a backlog status broke the table's alignment twice; status changes should go through a script.
- One CI watcher stopped on a network blip; the watchers now retry.

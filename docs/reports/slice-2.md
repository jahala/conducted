# Slice 2 ("Daily use") report

Slice 2 is built and merged: 100 features over four step PRs, and those merges closed their 100 issues. Two features stay open on purpose. PLAT-28 (the agent program manager) is built, but no install can succeed until a pinned release feed exists (D062). PLAT-35 (gh and watchexec) waits for it (D063). The slice ended with a hardening pass, one PR per area (D051). The process is in [overnight-build.md](../plans/overnight-build.md); every decision is in [decisions.md](../decisions.md), D050 to D065.

## What needs you

### Contract changes

Agents may not edit shared contracts, so these wait for you. Each names the feature that needs it.

- `core/api.ts`:
  - `sessions.queue.retry` (CHAT-04). The queue box calls the service directly until then.
  - `files.reveal(workspaceId, path)` (REV-08), backed by `platform.opener.revealInFinder`.
  - `Actions.pullRequests.openOnGithub` (PR-04).
  - `useChangedSinceTurn(sessionId, turnId)` (CHAT-15), so the reset dialog counts the files it reverts.
  - `Actions.settings.resetForRepo(repoId, key)` (SET-02).
  - `side`, `suggestion`, `replyToId` and `threadId` on `comments.add` and `edit` (REV-03).
- `platform/platform.ts`:
  - `FileSystem.registerRoot(path)` (PLAT-02). Without it a repository outside `~/conducted` is unreachable. This is the largest gap left in the shell.
  - `AttachmentFiles.writeBytes` and `Clipboard.readFilePaths` (COMP-07), for pasted images and Cmd+Shift+V. Both also need their Rust commands.
  - `Platform.fs.assetUrl` with a Tauri asset scope: local image previews never load.
  - A folder for `Shell.loginEnv` and `ShellCommand`, and a result for `pty_ack` (PLAT-07).
  - Corrected comments for `ArtifactPage.entries` and `omitted`: files only, absolute paths, one omitted total on every page.
- `core/model.ts`: the `ArtifactsView.omitted` comment, as above.
- `packages/protocol`:
  - One agent-provider table, read by the sidecar and the desktop. The same table is written four times today; the hardening checked that the copies agree.
  - An optional `launch` on `listModels`, `listSlashCommands` and `listMcpServers`, so model lists use the user's program path and keys.
  - A `setAgentPrograms` notification (SIDE-21).
- `packages/shared`: one `messageOf(cause)` helper (19 desktop copies) and one keyed serial queue for both runtimes.
- A migration adding `diff_comments.suggestion_base_code` (REV-03), and a per-model context-window table (CHAT-14).

### Product questions

- **PLAT-28's release feed.** Installs need the darwin-arm64 download URL, size and SHA-256 of Claude Code 2.1.308 and Codex 0.164.0 from the vendors' official hosts, shipped inside the app bundle. None of these values is in the repository, and none was invented.
- **A dependency.** Undo, redo and the default key map in the file editor need `@codemirror/commands` 6.x. It was not in the package store, and nothing is installed from the network at night.
- **Visible changes that need your yes:**
  - "Open in another app" is hidden in the file viewer, because it never worked (REV-08).
  - On the wrong-CPU screen, "Update" became "Download for Apple silicon", linking to the repository's releases page (APP-08).
  - "Hide" is left out of the Checks tab's comments until comment states can hide (PR-04).
- **Choices the research does not settle:**
  - The Claude providers dialog opens on "Claude Code subscription" when nothing is chosen.
  - A file named like an app context file is attached as `attached-<name>`, not refused.
  - Choosing a project in the palette opens the new-workspace page.
  - A terminal slash command types `<agent> /<command>; exit`.
  - Which action supersedes a workspace's review comments (REV-12).
  - Whether Continue attaches "Branch continued.md" to the chat (GIT-17), or the checklist is reworded.
  - What the task create and update cards show when a call fails.
  - A project whose folder is gone shows a Spotlight warning on every start, where it used to crash start-up.
- **Done, but nothing reaches it (D054):** NAV-15's SurfaceLayer is not mounted, and no live code calls AGENT-15. Reopen both, or wire them in slice 3.
- **Dials we set:** a quit waits at most 5 seconds for the app to stop (D064); downloads time out after 30 seconds without data; 64 early download cancels are kept.
- **Process:** `pnpm release` runs the full test suite on this Mac, against "tests run on GitHub, not on my machine". `one-home.test.ts` repeats guard 9; retiring it removes test cases.
- **Out of scope for the night:** 16 planned slice 2 rows wait for your product decisions, with their issues open. They are cloud workspaces (CLOUD-03 to 08, 13 and 17), Remote Control (RC-01 to 04) and the follow-up rows (PLAT-36 #281, SIDE-25 #282, SET-14 #283, APP-16 #297). With PLAT-28 and PLAT-35, they are the only slice 2 rows not done, so no slice 2 step is left to build.

### Stale branches and refs

The night's guard does not let agents force-delete, so these are yours:

- Local: `git branch -D slice2/step-2 slice2/step-3 slice2/step-4 harden/s2-core harden/s2-rust harden/s2-sidecar harden/s2-tests harden/s2-ui`, the 109 `node/*` branches pleach keeps, and the older `quarantine/*`, `tq/*`, `harden/{core,sidecar,ui}` and `fix/git-10-sigint`.
- Remote: `git push origin --delete slice2/step-1 slice2/step-2 slice2/step-3 slice2/step-4 harden/s2-core harden/s2-rust harden/s2-sidecar harden/s2-tests harden/s2-ui`.
- Ten `refs/pleach/rebuild/*` pins left by hand merges (`git for-each-ref refs/pleach/rebuild`).

## Steps

| Step | PR   | Features | Started (UTC) | Merged (UTC) | Spend (USD) |
| ---- | ---- | -------- | ------------- | ------------ | ----------- |
| 1    | #300 | 56       | 5 Nov 12:19   | 5 Nov 17:48  | about 10.4  |
| 2    | #307 | 33       | 5 Nov 19:42   | 6 Nov 00:07  | 5.52        |
| 3    | #308 | 9        | 6 Nov 00:10   | 6 Nov 02:24  | 1.77        |
| 4    | #311 | 2        | 6 Nov 02:25   | 6 Nov 03:25  | 0.69        |

DeepSeek spend for the slice was about 18.4 USD (44.05 to 25.70). The audits, fixers and hardening ran on the Claude subscription.

## Issues closed

- **#300 (56):** AGENT-05 #70, AGENT-06 #71, AGENT-07 #72, AGENT-08 #73, AGENT-11 #76, AGENT-12 #77, AGENT-15 #80, APP-02 #229, APP-14 #241, APP-15 #242, CHAT-09 #132, CHAT-11 #134, CHAT-27 #150, COMP-03 #156, DATA-08 #91, DATA-09 #92, GIT-04 #180, GIT-05 #181, GIT-06 #182, GIT-07 #183, GIT-08 #184, GIT-09 #185, GIT-13 #189, GIT-16 #192, NAV-04 #112, NAV-05 #113, NAV-11 #119, NAV-15 #123, PLAT-06 #12, PLAT-10 #16, PLAT-11 #17, PLAT-15 #21, PLAT-18 #24, PLAT-19 #25, PLAT-20 #26, PLAT-21 #27, PLAT-25 #31, PLAT-29 #35, PLAT-31 #37, PLAT-32 #38, PLAT-34 #40, PR-03 #196, PR-11 #204, PRJ-02 #94, REV-05 #168, REV-09 #172, RUN-01 #206, RUN-07 #212, SET-07 #221, SIDE-07 #48, SIDE-12 #53, SIDE-16 #57, SIDE-17 #58, SIDE-20 #61, SIDE-24 #65, WS-05 #102.
- **#307 (33):** AGENT-16 #81, AGENT-17 #82, CHAT-03 #5, CHAT-12 #135, CHAT-14 #137, CHAT-15 #138, CHAT-19 #142, CHAT-20 #143, COMP-04 #157, COMP-06 #159, DATA-02 #85, DATA-06 #89, GIT-03 #179, GIT-12 #188, NAV-08 #116, PLAT-17 #23, PLAT-30 #36, PLAT-33 #39, PR-04 #197, PR-06 #199, REV-03 #166, REV-06 #169, REV-07 #170, RUN-03 #208, SET-02 #216, SET-06 #220, SIDE-13 #54, SIDE-21 #62, WS-02 #99, WS-04 #101, WS-06 #103, WS-08 #105, WS-10 #107.
- **#308 (9):** CHAT-04 #127, GIT-17 #193, PR-05 #198, REV-12 #175, APP-08 #235, COMP-07 #160, REV-08 #171, SET-04 #218, SET-09 #223.
- **#311 (2):** REV-10 #173, SET-10 #224.

## What the audits and CI found

Each batch had a read-only Sonnet audit (D052), and an Opus fixer closed its MUST findings with tests that fail without the fix. The lead read every diff before merging it.

- **Step 1:** 110 MUST findings in the first five batches. Before step 2, the test-quality review (#302 to #306) added ten guards and real-thing contracts. On the way it found that the sidecar could not start, idle agents never stopped, a stored chat never opened and a cancel right after start was lost.
- **Step 2:** 138 MUST findings across six batches. CI then needed three rounds. The app could not start with any project (a Spotlight heal placeholder threw at start-up); no workspace terminal or script could start (its row broke migration 0004's rule); every shell exit threw an unhandled error (the screen save was a placeholder); deleting a workspace of a moved project failed on git.
- **Step 3:** 66 MUST findings. The fixes included unsaved editor edits lost on a tab switch, "Use the key from this Mac" doing nothing, a pasted image never attachable, Codex and Claude sign-in choices saved as one value, and a queued follow-up that could jump ahead. CI needed four rounds: the queue box re-rendered without end, PDF load errors never reached the preview, Cmd+F in the editor searched the chat, and arrow keys in a text field changed files.
- **Step 4:** 12 MUST findings. SET-10's provider catalogue did not match the research it cited; it is now Conductor's own table of 97 entries, extracted from the app bundle.

## What the hardening found and fixed, by area

- **Rust shell (#309):** the app never shipped its `bin/` helper scripts, so archive snapshots, checkpoints and the busy-repo check failed in every build. Also fixed: signal exits read as none, sidecar logs carried keys into the log export, and the verification list answered empty during the launch check.
- **Desktop core (#310):** a real quit never stopped the container, so the last composer edit, stored chat events, terminals and runs got no orderly end. A quit now stops the app first, for at most 5 seconds (D064). Also fixed: editor drafts of a deleted workspace kept forever, a leaked settings listener, a git failure read as "branch name free", and two glob patterns.
- **Tests and scripts (#312):** a new guard refuses two kinds of test that can never pass before CI runs. CI now runs every check after one fails, and lists each failed test by file on the run's summary page. It named #313's only failure on its first use.
- **Desktop UI (#313):** card shortcuts ignored rebinds, a file dropped in split panes went to every chat, closing a pane cleared another's chat, and panel layouts were never removed. The Custom provider form now has a label, and each Save button says which key it saves.
- **Sidecar (#314):** Codex approvals were never wired in, so every Codex approval was refused unseen. Also fixed: timed-out Codex cards blocked the next one, failed sends hid their reason, a queued message that could not start vanished, and a stopped agent could be reused as an untracked process.

## Decisions

D050 to D065 in [decisions.md](../decisions.md) and [process/decisions.md](../process/decisions.md). Tonight's: D060 (three agents, Opus fixers, the lead reads every diff), D061 (the guards run at mark-done; one batch plan at a time), D062 (PLAT-28 is planned), D063 (a feature waits for needs that are not done), D064 (the quit limit) and D065 (slice 3's first step lands in parts).

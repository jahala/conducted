# Changelog

Release notes, newest first. `pnpm release` writes each version's section from the commit subjects
since the last tag, and the GitHub release body is cut from that section (PLAT-39).

## 0.3.1 (2026-11-07)

### Fixes

- the release's disk image is sized from the app, and the sandbox image's version is bumped with it (#470)

## 0.3.0 (2026-11-07)

### Chores

- set slice 2 step 1's 56 rows to done (D041)

### CI

- CodeQL scans and a check for main's branch protection (PLAT-40, PLAT-41) (#385)
- measure test coverage (#298)
- switch Biome's React rules on by name (D044)
- run every package's tests even when one fails

### Cloud

- a Cursor chat runs in a cloud workspace, with Cursor's Linux SDK in the image (#462)
- a cloud workspace's status, meters, agent cost and Restart, where Conductor shows them (CLOUD-15) (#456)
- a cloud agent asks to run a command on the Mac, with your approval (CLOUD-14) (#453)
- finish CLOUD-09: host icons, Can run in, terminal reconnect, no linked folders in the cloud (#455)
- Cursor's key is swapped in the Worker; subscription sign-ins are left out under Anthropic's terms (CLOUD-18) (#451)
- the Cloud settings page, with personal cloud settings kept in the user's Worker (CLOUD-17, first part) (#448)
- a local mirror of a cloud workspace, and file search over it (CLOUD-11, first part) (#446)
- forward a cloud workspace's ports to the Mac (CLOUD-10) (#438)
- deploy and remove the Worker from the app; cloud workspaces archive, restore and delete through it (CLOUD-08) (#436)
- terminals, run scripts and previews run in the sandbox (CLOUD-09, first part) (#424)
- pair the desktop app with the user's Worker (CLOUD-07) (#415)
- secrets stay outside the sandbox; the Worker swaps in the model key and GitHub token (CLOUD-05) (#417)
- a cloud workspace keeps its work across sandbox restarts (CLOUD-06) (#416)
- the sandbox image with git, gh, the agent programs and our sidecar (CLOUD-04) (#412)
- the user's Worker and one Durable Object per workspace (CLOUD-03) (#403)
- keep a cloud workspace's rows apart through its host (CLOUD-13) (#386)

### Data

- linked folders, the context window and attachments each have one home (#426)
- remove repository methods and columns nothing uses; compacted_at is the one compaction mark (#414)

### Decide

- CLOUD-16's cloud desktop is Conductor's hosted computer, left out (D117) (#447)

### Docs

- the architecture and data-model rules say what the code keeps, and guards hold them (#404)
- the first whole-system audit (data model, boundaries, complexity) (#398)
- plan the release pipeline and repository rules (PLAT-37 to PLAT-42) (#377)
- plan a safe move from Conductor (D100, APP-17) (#376)
- move the process decisions into their own log (#355)
- record why slice 3 stopped at the night's end (D068) (#320)
- the overnight report records part 1b's merge (#319)
- the overnight report for 5 to 6 November (#318)
- the slice 2 report (#315)
- test quality review, plan and D053 to D055 (#299)
- the PLAT-15 and PLAT-20 fixers' moved items
- format design.md with Biome
- the slice 2 step 1 audit findings, and where their moved items went
- D052, batch audits start before the step's CI
- D051 judges shape against the whole backlog, not only today's callers
- D051, every slice ends with a hardening pass
- D050, the fixed umbel and pleach as the trial found them
- the step-7 audit findings, and where their moved items went
- the step-6 audit findings, and where their moved items went
- turn what the audits kept finding into rules the agents read (D049)
- note the dead umbel sessions in the morning report
- the morning report of the first overnight build
- D046, the step-5 audit findings, and where their moved items went
- the step-4 audit findings, and where their moved items went
- D045, the step-3 audit findings, and where their moved items went
- D043, and where the step-2 audit's open items went
- D042, the integration fix for a composition root built beside its modules
- rewrite the README as a product page

### Fixes

- the catalogue's paired Mac answers its cloud settings (D098) (#465)
- our screens and messages say Conducted, and a guard holds it (#464)
- the catalogue clicks with a pointer's click count (#452)
- suggestion popups unmount after the running commit, not inside it (#437)
- the review model can be any agent's, and the review chat starts with that agent (#445)
- env files load into an agent's and a script's environment at start, as in Conductor (#444)
- give the editor focus in the Link issue dialog's own close event (#443)
- read the allowed lists from architecture.md, not a second copy (#421)
- one rule decides whether a workspace is archived (#422)
- a missing file is fs_not_found in the app as in its stand-in, and the Platform's error codes are one list (#409)
- one rule decides which names hold a secret, in every runtime (#401)
- move a workspace's recent activity with the work (#388) (#400)
- removing a project removes its variables' Keychain entries (#399)
- the app starts again: no Node built-in in app code, and pnpm dev builds the sidecar (#332)
- closing a terminal tab removes it, Cancel stops Claude's own work, Run tab terminals survive switches (#329)
- terminals survive tab switches (NAV-15) and Claude's own work shows (AGENT-15) (#324)
- Cmd+Enter in a dialog without a confirm action does nothing (#321)
- the host test waits for its own reply; a taken .jpg name is refused
- a resized image keeps a name that matches its bytes; D056, D057
- Rust compiles again, and the ACP tests clean up
- the 13 failure groups of the first CI run
- act on the MUST findings of their slice 2 step 1 audit
- the sidecar starts again; shortcuts and terminal tabs
- act on the MUST findings of the slice 2 step 1 audits
- act on the MUST findings of the slice 2 step 1 audit
- act on the MUST findings of the slice 2 step 1 audits (APP-02, APP-14, CHAT-09, CHAT-11, CHAT-27, COMP-03, NAV-04, NAV-05)
- act on the MUST findings of the slice 2 step 1 audits (APP-15, DATA-08, DATA-09, GIT-04, GIT-08)
- act on the MUST findings of the slice 2 step 1 audits (SIDE-12, SIDE-16, SIDE-17, SIDE-24)
- act on the MUST findings of the slice 2 step 1 audits (AGENT-07, AGENT-08, AGENT-11, AGENT-15, SIDE-07)
- act on the MUST findings of the slice 2 step 1 audits (PLAT-06, PLAT-10, PLAT-11, PLAT-18, PLAT-25)
- act on the MUST findings of the slice 2 step 1 audits (PLAT-29, PLAT-34)
- join PR-03, PR-11, GIT-09 and the git tests after the hand merges
- step 7 CI round 2
- step 7 CI round 1 and the MUST findings of its audits
- CI round 1 and the MUST findings of the step-6 audits (D045)
- step 5 CI round 2
- act on the MUST findings of the step-5 audits (D045)
- step 5 CI round 1
- name the test helper's resolver so Biome reads it as a function
- declare the test's child as mutable
- step-4 CI and audit fixes
- compile under clippy and act on the step-4 audit
- repair what the audit fixes broke
- act on the MUST findings of the step-3 audits (D045)
- act on the MUST findings of the step-3 audits (D045)
- step 3 CI round 1
- give two effects honest dependency lists
- wire setAutoApproveEdits through the live session
- compute the workspace status from the values the memo depends on
- repair three tests the audit fixes broke
- act on the step-2 audit
- act on the step-2 audit
- act on the step-2 audit
- drop the detached task handles on purpose
- compile under clippy
- build each module with the inputs it now declares
- act on the batch audit
- give the linked-worktree test a real merge conflict
- separate a doc paragraph clippy read as a list item; update the unarchive test

### Harden

- APP-16's UI items, and the row is done (#468)
- APP-16's core, Rust, sidecar and tests items (#463)
- checkpointer signals, the test container under jsdom, moved findings (#296)
- fix what a full audit of core and platform found (#294)
- fix what a full audit of features, ui and app found (#295)
- fix what a full audit of packages/sidecar found (#293)
- fix what a full audit of apps/desktop/src-tauri found
- fix what a full audit of the scripts, test support and CI found

### Items

- every row-only parity gap gets a checklist item that cites it (#374)

### Nav

- reorder projects and set a project's default branch, as Conductor does (NAV-04, SET-07) (#423)

### Overnight

- builder prompts name their placeholder files and their own gate (#335)
- set-status sets a backlog row's status and formats the table (#327)
- plan slice 2's priority-2 features (D040)
- step 7's 2 features are done in the backlog (D041)
- batches for step 7 (D040)
- step 6's 9 features are done in the backlog (D041)
- land step 6; drop an import the merge left unused
- batches for step 6 (D040)
- keep WS-01's router fixture, drop only NAV-03's nav assertion (D047)
- take NAV-03's test rewrites out with NAV-03 (D047)
- quarantine NAV-03 from step 5 (D047)
- step 5's 10 features are done in the backlog (D041)
- batches for step 5 (D040)
- step 4's 10 features are done in the backlog (D041)
- batches for step 4 (D040)
- step 3's 20 features are done in the backlog (D041)
- batches for step 3 (D040)
- step 2's 15 features are done in the backlog (D041)
- render batches.md the way the formatter wants; preflight the step
- plans per night step, audit from the plan's ids, Closes lines
- finish step 1's features in the backlog (D041)
- restore the backlog rows the builders edited; tighten the prompt

### Parity

- every gap has an owner or a decision (#460)
- catalogue states for unshown gaps, and the bugs that hid those screens (#457)
- the screens use Conductor's exact words where they do its job (#449)
- own or decide every unowned literal, label and title gap (#431)
- own or decide the unowned gaps in the remaining map files (#432)
- own or decide every unowned text and toast gap (#429)

### Performance

- measure the database scans at real size; index the one that needs it (#406)

### Plan

- a joining node per batch, the D054 builder rule, SIDE-21 first (D058) (#301)

### Pleach

- land node/plat.20
- land node/plat.15
- land node/plat.06
- plat.20 verified (done)
- plat.15 verified (done)
- plat.06 verified (done)
- land node/plat.25
- land node/plat.19
- land node/plat.18
- land node/plat.11
- land node/plat.10
- land node/plat.25
- land node/plat.19
- land node/plat.18
- land node/plat.11
- land node/plat.10
- land node/agent.12
- land node/agent.11
- land node/agent.08
- land node/agent.07
- land node/set.07
- land node/nav.15
- land node/nav.11
- side.20 verified (done)
- git.07 verified (done)
- plat.20 verified (done)
- plat.15 verified (done)
- git.06 verified (done)
- agent.12 verified (done)
- git.05 verified (done)
- nav.11 verified (done)
- set.07 verified (done)
- ws.05 verified (done)
- prj.02 verified (done)
- land node/plat.34
- land node/plat.32
- land node/plat.29
- set.07 quarantined
- ws.05 quarantined
- prj.02 quarantined
- run.01 verified (done)
- nav.15 verified (done)
- run.07 verified (done)
- plat.34 verified (done)
- plat.29 verified (done)
- land node/side.24
- land node/side.17
- land node/plat.25
- land node/side.16
- land node/plat.19
- land node/side.12
- land node/plat.18
- land node/plat.11
- land node/plat.10
- land node/plat.06
- land node/nav.05
- land node/nav.04
- land node/comp.03
- land node/chat.27
- land node/chat.11
- land node/chat.09
- land node/git.08
- land node/app.14
- land node/git.04
- land node/app.02
- land node/side.07
- land node/data.09
- land node/agent.15
- land node/data.08
- land node/agent.11
- land node/app.15
- land node/agent.08
- land node/agent.07
- plat.32 verified (done)
- rev.05 verified (done)
- rev.09 verified (done)
- pr.11 verified (done)
- pr.03 verified (done)
- side.24 verified (done)
- plat.25 verified (done)
- side.20 verified (done)
- plat.31 verified (done)
- side.17 verified (done)
- plat.21 verified (done)
- plat.19 verified (done)
- plat.20 verified (done)
- git.16 verified (done)
- side.12 verified (done)
- side.16 verified (done)
- plat.15 verified (done)
- plat.18 verified (done)
- git.09 verified (done)
- nav.05 verified (done)
- git.13 verified (done)
- nav.04 verified (done)
- plat.11 verified (done)
- git.08 verified (done)
- plat.06 verified (done)
- comp.03 verified (done)
- plat.10 verified (done)
- chat.11 verified (done)
- git.06 verified (done)
- chat.27 verified (done)
- side.07 verified (done)
- git.07 verified (done)
- agent.15 verified (done)
- agent.12 verified (done)
- agent.11 verified (done)
- git.04 verified (done)
- git.05 verified (done)
- chat.09 verified (done)
- app.14 verified (done)
- app.02 verified (done)
- data.09 verified (done)
- agent.07 verified (done)
- agent.08 verified (done)
- data.08 verified (done)
- app.15 verified (done)
- land node/agent.06
- agent.06 verified (done)
- agent.05 verified (done)
- nav.10 verified (done)
- chat.18 verified (done)
- nav.03 verified (done)
- ws.03 verified (done)
- chat.06 verified (done)
- nav.02 verified (done)
- chat.10 verified (done)
- pr.02 verified (done)
- chat.05 verified (done)
- side.06 verified (done)
- side.08 verified (done)
- rev.02 verified (done)
- nav.03 verified (done)
- nav.14 verified (done)
- side.11 verified (done)
- ws.01 verified (done)
- chat.08 verified (done)
- app.01 verified (done)
- chat.02 verified (done)
- side.05 verified (done)
- side.04 verified (done)
- rev.01 verified (done)
- plat.22 verified (done)
- set.03 verified (done)
- plat.09 verified (done)
- prj.04 verified (done)
- side.03 verified (done)
- comp.02 verified (done)
- app.13 verified (done)
- chat.07 verified (done)
- nav.07 verified (done)
- chat.01 verified (done)
- comp.01 verified (done)
- land node/app.12
- land node/app.04
- run.06 verified (done)
- chat.01 verified (done)
- chat.01 verified (done)
- nav.01 verified (done)
- set.01 verified (done)
- agent.03 verified (done)
- prj.01 verified (done)
- pr.01 verified (done)
- comp.01 verified (done)
- side.23 verified (done)
- git.02 verified (done)
- side.10 verified (done)
- plat.02 verified (done)
- side.19 verified (done)
- agent.04 verified (done)
- app.12 verified (done)
- chat.01 verified (done)
- data.04 verified (done)
- side.02 verified (done)
- ws.09 verified (done)
- app.04 verified (done)
- data.03 verified (done)
- land node/plat.07
- land node/plat.05
- land node/plat.04
- land node/plat.03
- plat.04 verified (done)
- land node/plat.03
- plat.07 verified (done)
- plat.05 verified (done)
- side.15 verified (done)
- side.09 verified (done)
- land node/plat.01
- land node/git.01
- land node/data.05
- land node/data.01
- land node/app.11
- plat.04 verified (done)
- plat.01 verified (done)
- side.01 verified (done)
- agent.02 verified (done)
- git.01 verified (done)
- plat.03 verified (done)
- data.01 verified (done)
- app.05 verified (done)
- git.10 verified (done)
- data.05 verified (done)
- app.11 verified (done)
- land node/side.14
- side.14 verified (done)
- git.11 verified (done)

### Refactors

- split core/hooks.ts into one file per hook group (D048)

### Releases

- the Mac tags, GitHub builds, signs, notarises, attests and publishes (PLAT-37 to PLAT-39) (#387)
- v0.2.1 (#344)
- v0.2.0 (#342)
- a signed-only release checks its disk image without a ticket (#339)
- check the bundle against the version just set, and install locked packages first (#337)
- trust main's CI, sign by hash, notarise when the profile exists (#323)

### Report

- the parity counts after round 3 (#372) (#373)

### Research

- Amp, Copilot and Gemini are terminal presets in Conductor, owned by RUN-06 (#434)

### Settings

- Preview URLs are Conductor's named, ordered list (#461)

### Spikes

- Remote Control (path A) and cloud workspaces both pass; D074, D075 (#331)

### Stand-in

- read Conductor's shell strings and GitHub calls against the sample world (#375)

### Style

- cargo fmt after the step 1 merges
- format the merged imports in hooks/github.ts

### Tests

- seed the full completions cache in one write (#433)
- the real Rust relay against a Worker in Cloudflare's local runtime (#427)
- the fake watchexec writes its arguments whole (#418)
- wait for the start event, and use a test program the test writes (#410)
- wait for the update-failed toast to leave before the test ends (#364)
- build every desktop test container with createTestContainer (#358)
- GIT-16 waits for the toast to leave before its test ends (#341)
- the app's real statement queue, the contract on the Tauri adapter, one git fake (#306)
- reachable UI, real-container tests, and theater rewritten (#305)
- one home for stand-ins, checked against the real thing; idle stop works (#304)
- add the four test-shape guards (7 to 10) with a shrinking baseline (#303)
- structure guards 1 to 6, and Rust tests that can fail (#302)
- one real test container and one real test database for every test

### Ui

- Environment, repository sections, Agents, Linear, git header and Advanced follow Conductor, round 4 (D098) (#439)
- the screens and settings pages follow Conductor, round 3 (D098) (#428)
- the screens and settings pages follow Conductor, round 2 (D098) (#419)
- the screens are Conductor's; our own features take the most logical place (D098) (#407)

### Other

- A product page on GitHub Pages and a professional README (#356) (#425)
- Stage 2: Conductor's frontend on our real backend (D099) (#402)
- Parity round 3: every gap names its owner (#372)
- Overnight report, 6 to 7 November, and decisions D091 to D097 (#371)
- CLOUD-01: each workspace carries a host, and every call checks it (#370)
- Every LATER audit finding has an outcome (#351) (#369)
- SIDE-25: sidecar adapters in their own edge modules (#368)
- PLAT-36: Rust command tests through a mock Tauri app (#365)
- APP-16: finish the hardening follow-ups (#367)
- Parity gaps, round 2: chat cards, Checks panel, Home, sidecar event order (#366)
- No silent fallback to a PATH copy of agent programs, gh or watchexec (#349, D088) (#362)
- Parity gaps: sorted, screens matched to Conductor's wording, all drivable flows pass (#363)
- Encrypt terminal scrollback with a Keychain key, as Conductor does (#348, D087) (#360)
- Sidecar differential bugs: turn ends, API errors, thinking budgets, interaction order, Codex requirements, sidecar line framing (#361)
- Sidecar differential run against Conductor's sidecar (step 3d) (#359)
- A guard for file header claims (#350) (#357)
- Parity harness: Conductor's inventories, the map, five checks and the instrument check (#347)
- Slice 3 step 2: REV-13, APP-06, PR-10, RUN-05 (#354)
- Conductor reference run, stage 1: stand-in, server, guard and 08:00 run script (#346)
- UI parity: the app's screens match Conductor's (three rounds) (#345)
- Day report, 6 November, and D085 (#343)
- Slice 3 part 1e: 26 features from batches s1-ui-1, s1-ui-2, s1-ui-3 and the singles (#338)
- AGENT-09: Cursor's SDK installs on demand and runs in the sidecar (#340)
- States catalogue: every screen in a browser, with screenshots; fix: the chat had no height (#336)
- Slice 3 part 1d: stacked PRs (PR-08) and eight chat and app features (#334)
- Remote Control: open any Claude chat in claude.ai/code or the Claude app (RC-02 to RC-04) (#333)
- PLAT-28 and PLAT-35: the app downloads, verifies and runs its own Claude Code, Codex, gh and watchexec (#330)
- SET-14: saving settings keeps the user's comments (#328)
- Approved contract changes: platform, core API and migrations, protocol and shared (#325)
- PR-09: link a Linear or GitHub issue to a chat (#326)
- Slice 3 part 1c: fork to a new workspace and deep-link routes (#322)
- Slice 3 part 1b: core batches (#317)
- Slice 3 part 1a: rust and sidecar batches (#316)
- Slice 2 hardening: desktop UI (#313)
- Slice 2 hardening: sidecar (#314)
- Slice 2 step 4: Artifacts tab and OpenCode providers (#311)
- Slice 2 hardening: tests, scripts and CI (#312)
- Slice 2 hardening: desktop core and platform (#310)
- Slice 2 hardening: Rust shell (#309)
- Slice 2 step 3: nine features, audited and fixed; PLAT-28 built, open (#308)
- Slice 2 step 2: 33 features, audited and fixed (#307)
- Merge pull request #300 from jahala/slice2/step-1
- Merge remote-tracking branch 'origin/main' into slice2/step-1
- Merge remote-tracking branch 'origin/main' into slice2/step-1
- Merge branch 'fix/s2-1-rust-rebuilt' into slice2/step-1
- Merge branch 'fix/s2-1-late' into slice2/step-1
- Merge branch 'fix/s2-1-ui-1' into slice2/step-1
- Merge branch 'fix/s2-1-core-1' into slice2/step-1
- Merge branch 'fix/s2-1-sidecar-2' into slice2/step-1
- Merge branch 'fix/s2-1-sidecar-1' into slice2/step-1
- Merge branch 'fix/s2-1-rust-1' into slice2/step-1
- Merge branch 'fix/s2-1-rust-2' into slice2/step-1
- Merge branch 'node/plat.20' into HEAD
- merge node/plat.15 (conflicts kept as markers)
- merge node/plat.06 (conflicts kept as markers)
- Merge branch 'node/run.01' into HEAD
- Merge branch 'node/pr.03' into HEAD
- Merge branch 'node/git.09' into HEAD
- Merge branch 'node/rev.09' into HEAD
- Merge branch 'node/plat.21' into HEAD
- Merge branch 'node/git.16' into HEAD
- Merge branch 'node/side.20' into HEAD
- Merge branch 'node/plat.06' into HEAD
- Merge branch 'node/git.07' into HEAD
- Merge branch 'node/git.06' into HEAD
- Merge branch 'node/git.05' into HEAD
- Merge branch 'node/rev.05' into HEAD
- Merge branch 'node/prj.02' into HEAD
- Merge branch 'node/plat.31' into HEAD
- Merge branch 'node/ws.05' into HEAD
- Merge branch 'node/run.07' into HEAD
- Merge branch 'node/pr.11' into HEAD
- Merge branch 'node/git.13' into HEAD
- merge node/side.20 (conflicts kept as markers)
- merge node/plat.20 (conflicts kept as markers)
- merge node/git.07 (conflicts kept as markers)
- merge node/plat.15 (conflicts kept as markers)
- merge node/git.06 (conflicts kept as markers)
- merge node/git.05 (conflicts kept as markers)
- merge node/agent.12 (conflicts kept as markers)
- Merge pull request #292 from jahala/harden/rust
- Merge pull request #291 from jahala/harden/tests
- Merge pull request #290 from jahala/overnight/step-7
- Merge branch 'node/nav.10' into HEAD
- Merge pull request #288 from jahala/overnight/step-6
- Merge remote-tracking branch 'origin/main' into overnight/step-6
- Merge pull request #289 from jahala/docs/agent-rules
- Merge branch 'node/nav.03' into HEAD
- Merge branch 'node/nav.02' into HEAD
- Merge branch 'node/chat.10' into HEAD
- Merge branch 'node/chat.06' into HEAD
- Merge branch 'node/ws.03' into HEAD
- Merge branch 'node/pr.02' into HEAD
- Merge branch 'node/chat.05' into HEAD
- Merge branch 'node/side.08' into HEAD
- Merge pull request #287 from jahala/overnight/report
- Merge pull request #286 from jahala/overnight/step-5
- Merge branch 'node/rev.02' into HEAD
- Merge branch 'node/nav.14' into HEAD
- Merge branch 'node/nav.03' into HEAD
- Merge branch 'node/chat.08' into HEAD
- Merge branch 'node/app.01' into HEAD
- Merge branch 'node/ws.01' into HEAD
- Merge branch 'node/chat.02' into HEAD
- Merge branch 'node/side.11' into HEAD
- Merge branch 'node/side.05' into HEAD
- Merge pull request #285 from jahala/overnight/step-4
- Merge branch 'node/set.03' into HEAD
- Merge branch 'node/rev.01' into HEAD
- Merge branch 'node/comp.02' into HEAD
- Merge branch 'node/app.13' into HEAD
- Merge branch 'node/prj.04' into HEAD
- Merge branch 'node/nav.07' into HEAD
- Merge branch 'node/chat.07' into HEAD
- Merge branch 'node/plat.22' into HEAD
- Merge branch 'node/plat.09' into HEAD
- Merge pull request #284 from jahala/overnight/step-3
- Merge branch 'node/comp.01' into HEAD
- Merge branch 'node/nav.01' into HEAD
- Merge branch 'node/app.12' into HEAD
- Merge branch 'node/app.04' into HEAD
- Merge branch 'node/run.06' into HEAD
- Merge branch 'node/chat.01' into HEAD
- Merge branch 'node/set.01' into HEAD
- Merge branch 'node/prj.01' into HEAD
- Merge branch 'node/pr.01' into HEAD
- Merge branch 'node/plat.02' into HEAD
- Merge branch 'node/git.02' into HEAD
- Merge branch 'node/data.04' into HEAD
- Merge branch 'node/data.03' into HEAD
- merge node/chat.01 (conflicts kept as markers)
- merge node/comp.01 (conflicts kept as markers)
- Merge branch 'overnight/step-3' into HEAD
- merge node/chat.01 (conflicts kept as markers)
- Merge branch 'node/side.23' into HEAD
- Merge branch 'node/side.19' into HEAD
- Merge branch 'node/side.10' into HEAD
- Merge branch 'node/side.02' into HEAD
- Merge branch 'node/agent.04' into HEAD
- merge node/chat.01 (conflicts kept as markers)
- Merge pull request #280 from jahala/overnight/step-2
- merge node/plat.04 (conflicts kept as markers)
- Merge branch 'node/side.15' into HEAD
- Merge branch 'node/side.09' into HEAD
- Merge branch 'node/side.01' into HEAD
- Merge branch 'node/git.10' into HEAD
- Merge branch 'node/agent.02' into HEAD
- Merge pull request #279 from jahala/overnight/step-1
- Merge pull request #278 from jahala/coverage-and-issues
- Add the overnight build tooling and its plan
- Add placeholders for every new backlog id, and Conductor's design values
- Extend the shared contracts for everything the coverage check found
- Map every Conductor feature to a backlog id, and plan the issues
- Merge pull request #3 from jahala/readme
- Pin one runtime version and write down when tests run
- Merge pull request #2 from jahala/cloud-and-remote
- Plan a cloud option and Claude Remote Control

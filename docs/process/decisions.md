# Process decision log

Decisions about how this project's work is run: overnight builds, agent roles, audits, budgets, schedules and backlog bookkeeping. Product and engineering decisions are in [docs/decisions.md](../decisions.md). Both logs share one numbering. Newest last. A decision is changed by a new entry that names the one it replaces, never by editing the old one.

## D039. How the first overnight build runs (2026-11-04)

Context: the owner set a goal for the night and is away until morning.
Chosen:

- Builders and fixers: OpenCode with DeepSeek V4.1 Flash (`deepseek/deepseek-flash`), one fresh worker per feature, through a pleach cast in `.context/overnight/pleach.config.ts` that passes the key by name.
- Work is planned in steps and batches by `scripts/overnight/plan-batches.ts` (`docs/plans/batches.md`). CI runs once per step on GitHub; no tests and no Rust builds run on the Mac. Each node passes only the quick gate `scripts/overnight/node-gate.ts`.
- pleach's enforced red-green phases are not used: they need a test run per node. The step's CI run and the batch audit stand in for them.
- Money: the night's spend is measured from the DeepSeek balance at the start (20.99 USD), and no step starts once it passes 15 USD.
- The step-1 sidecar, data and git features gained the dependencies they have in fact (for example SIDE-03 needs SIDE-02), so they build in order instead of against each other's empty code.
  Why: the owner asked for batches, CI on GitHub only, and DeepSeek Flash.

## D040. The next step is recomputed after every merge (2026-11-05)

Context: `plan-batches.ts` counts dependency steps among the features still open. Once a step's features are done, the remaining ones move up.
Chosen: after each step merges, the conductor regenerates `docs/plans/batches.md` from the open first-slice features and runs its step 1, which is exactly the work whose dependencies are all done. Batch ids therefore describe the night's current state, not a fixed schedule.
Why: one rule for "what is ready", with no second list to keep in sync.

## D041. How a step's PR finishes its features (2026-11-05)

Context: the first step's CI failed on "Placeholders match the backlog", because the finished rows were still `stub` while their placeholders were gone. `pnpm stubs` requires both to change in the same PR. The sync script never closes issues, by design. The batch audit also found checklist items that belong to features not built yet.
Chosen:

- Before the step's first CI run, the conductor sets each finished feature's backlog row to `done` on the step branch (`drive.ts mark-done`). A feature taken out of the step goes back to `stub` with its placeholders.
- The step PR's body carries one `Closes #N` line per finished feature, so the merge closes the issues. `sync.ts --check` then confirms that rows and issues agree.
- A checklist item that another feature owns (a screen, a runner, the composition root) moves to that feature in `docs/plans/items/` before the row turns `done`. When the move leaves wiring undone, the conductor adds an item for it to the feature that owns the wiring.
- A red CI run caused by the conductor's own process does not count as a feature's fix round.
  Why: one record of what is done (the backlog), issues closed by the merge that finishes them, and no "done" that hides unbuilt items.

## D042. A composition root built beside its modules gets an integration fix (2026-11-05)

Context: in step 2, SIDE-01 (the sidecar's composition root) was built in parallel with the modules it composes. Each node passed its gate alone, but the merged batch failed typecheck, because three modules had changed their constructor inputs. pleach's land gate refused the whole batch.
Chosen: the conductor merges the batch's verified branches in a scratch worktree and gives the typecheck output to one fresh fixer for the composition root. It changes only the composition root and its test. The conductor runs every feature's gate on the result before the step branch takes it.
Why: the composition root depends on every module's inputs, so making it wait for all of them would hold it back to the last step. One integration fix per step costs less.

## D043. What a batch audit's findings become (2026-11-05)

Context: the step-2 audits returned about 100 findings for 15 features. Many name behaviour that needs a feature not built yet (a handler, a screen, wiring in the composition root). A feature's row must turn `done` in the PR that removes its placeholders, so "keep it open" is not an option once the code is in.
Chosen: one fresh fixer per feature, or per group of files, sorts each finding:

- Fixed now: a bug, a header that claims what the code does not do, a banned pattern (compatibility alias, invented default, fake success, silent fallback), duplicated logic, an unsafe read or write. Each fix gets a test that fails without it.
- Built now: missing behaviour the feature owns and can build in its own files.
- Moved: behaviour that needs another feature's code. The conductor moves the checklist item to the owner in `docs/plans/items/`, or adds an item there for the wiring.
- Later: work in the feature's own scope too large for the night. It becomes a new backlog row, listed in the morning report.
- Refused: a finding the fixer shows is wrong from the research, with the section cited.

Fixers that share a file never run at once. The composition root (`modes/sidecar-mode.ts`) is fixed last, by one fixer, with the wiring the others asked for.

Why: every finding ends in a fix, an owner or a visible row, and none is lost in a chat log.

## D045. From step 3, audits rank findings and the LATER ones stay in the repo (2026-11-05)

Context: step 2's audits returned about 140 findings, and fixing every one cost a fixer per feature and most of an hour. Many were test gaps and wording that do not change behaviour.
Chosen: each audit marks every finding MUST (a bug, a false header claim, a banned pattern, duplicated logic, an unsafe read or write) or LATER (everything else). Fixers handle every MUST. LATER findings are committed unchanged in `docs/reports/audits/` beside the step's PR, so a later contributor can take them up. A MOVE line from a fixer that names a backlog id becomes a checklist item on that feature, added by script; one without an owner goes to the morning report.
Why: the night's money and time go to behaviour, and nothing an audit found is lost.

## D046. The night stops after step 5 (2026-11-05)

Context: the night had a 15 USD DeepSeek ceiling and a 07:00 stop. After step 4 it had spent 12.3 USD at 04:56. Step 5 (10 features) fit under both: its builds cost about 1 USD and it merged before 06:30. A sixth step would cost about 2 to 3 USD more, past the ceiling, and could not finish its audit and CI rounds before 07:00.
Chosen: step 5 is the night's last. The 10 remaining first-slice features stay open for the next run, which regenerates the batches (`bun scripts/overnight/plan-batches.ts --write`).
Why: the stop rules come before the goal's "done when". A half-built step would leave an unmerged branch and unclosed issues.

## D047. NAV-03 is quarantined from step 5 (2026-11-05)

Context: after step 5's two CI fix rounds, two NAV-01 shell tests still failed. NAV-03 rebuilt the sidebar's workspace list to read the workspace store. The shell test's container has no workspace store, so the list region falls back to "This part failed to load" and the "No projects yet" text the test looks for never shows. The fix is most likely in the test fixture, but the rules allow no third fix round.
Chosen: NAV-03 leaves step 5. Its files go back to their `main` versions with its placeholders, its row goes back to `stub` and its issue stays open. Its built work and its audit fixes are kept on the branch `quarantine/nav.03` (pushed) for the next run. The next run should start from that branch and give the NAV-01 shell test a workspace store.
Why: the rule is two fix rounds, then quarantine. A red test that is probably wrong is still red.

## D048. A second run finishes the first slice (2026-11-05)

Context: the overnight run stopped with 11 first-slice features open (D046, D047). The owner asked in the morning to finish the slice, with about 7 USD left on the DeepSeek account.
Chosen: one more run with the night's process (D039 to D047). It runs in two steps: nine features including NAV-03, then CHAT-18 and NAV-10. It stops if the DeepSeek balance falls below 1 USD. Before step 1, `core/hooks.ts` is split by hook group into `core/hooks/`. `core/hooks.ts` stays the one module screens import, so the layering rule does not change, and each feature edits its own group file instead of one shared file. That shared file caused land conflicts in every step of the night. NAV-03 starts from the code it had before quarantine (commit `7ba45d3`). Its node also gives the NAV-01 shell test the workspace store it lacked.
Why: the owner's request, within the money left. The split removes the cost the night measured.

## D049. What the audits kept finding becomes rules the agents read (2026-11-05)

Context: the first overnight build's audits returned about 280 MUST findings in steps 3 to 6. They fell into a few repeated patterns:

- a file header claiming what the code does not do (about 38%);
- duplicated logic (15%);
- a late async answer overwriting newer state (15%);
- silent failures (13%);
- tests that check nothing or use fakes that repeat ids (11%);
- code nothing calls;
- listeners never removed.

Several of these had no rule in the docs, and agents read only the docs and their issue. Screen tests also kept failing because each hand-built a partial container.
Chosen: `docs/engineering.md` states each pattern as a rule. `docs/architecture.md` lists the shared helpers to use before writing one. A shared `createTestContainer` and `openTestDatabase` replace hand-built test containers and five copies of a SQLite adapter. The builder and fixer prompts in `scripts/overnight/drive.ts` repeat the rules, and the audit prompt checks headers and each rule by name.
Why: the agents start from the docs, so the docs must name what the audits were catching. The prompt carries it too, because a rule in a doc nobody quotes drifts. Nothing checks the header rule by script yet; the audit does.

## D050. The fixed umbel and pleach, checked before slice 2 (2026-11-05)

Context: the overnight build filed issues against umbel (#167 to #170) and pleach (#174 to #179). Both agents reported their fixes on master, and the local tools run from those versions: the global `umbel` is rebuilt, and the global `pleach` links to the checkout that holds the merge. Slice 2 runs about 100 features on them, so a 2-feature trial checked them first (AGENT-05 and AGENT-06, started side by side).
Found:

- pleach #174: node worktrees and the land stack live under `~/.cache/pleach/worktrees/`, outside `.git/`. Both nodes verified and landed. One empty base folder stays behind after the run (reported on #174).
- pleach #175, #177 and #124: not exercised; the trial had no conflict, no failed spawn and no refused land.
- umbel #169: two opencode workers spawned at the same moment without a database lock, so there was no retry to see. #170: `prune --prefix --repo` removed 227 dead sessions of this repository and kept live ones. #168: `logs` prints `<timestamp> <event>`. But `read` fails on a finished pleach worker, because the export runs in the removed worktree (reported on #168).
  Chosen: slice 2 runs on the fixed tools. The night's workarounds stay where a fix is not proven: workers write their final message to a file, and the conductor merges conflicting nodes by hand when a land is refused.
  Why: what the trial proved is used, and what it did not prove keeps its workaround.

## D051. Every slice ends with a hardening pass (2026-11-05)

Context: the first slice's hardening found bugs that would have broken real use: the first message of every chat deadlocked, every installed agent showed as not installed, and no shortcut or menu worked because the dispatcher was never mounted. The batch audits during the build had not caught them, because each audit sees one batch, not how the parts work together. The owner asked to repeat the pass after slice 2.
Chosen: when the last step of a slice merges, five fresh Sonnet workers harden the code by area, as after slice 1: Rust shell, sidecar, desktop core, desktop UI, tests and scripts. Besides the rules in docs/engineering.md, each judges whether the code has the right shape for the whole plan, not only for what calls it today. It reads docs/plans/backlog.md, the item map and the open issues of its area, every priority and the cloud and Remote Control rows included.

- Over-engineered: more shape than the roadmap needs. Examples are a general mechanism where the backlog has one case, configuration nobody will set, and a layer that only passes calls on. A seam later features need is right, for example the runner contract for four agents, the Platform interface or the planned cloud host.
- Under-engineered: less shape than the roadmap needs. Examples are a feature that hard-codes what its own later siblings will need to vary, a one-off where several backlog features will want the same thing, and missing error paths and limits.
- Each finding of either kind names the backlog features it checked. "Over-engineered" holds only when none of them uses the extra shape. Each fixes what it finds in its area, in one PR per area, and lists the rest for its owners. The slice's report follows the hardening.
  Why: the foundation is checked after every slice, while what was just built is still small enough to change.

## D052. Batch audits start before the step's CI (2026-11-05)

Context: slice 2's first step runs nine batches, and the last ones finish long after the first. In slice 1 every audit waited for the whole step to land and for CI to go green. Four of the first five batches also met landing conflicts. In each case two features of one batch wrote the same file: AGENT-11 and AGENT-12 each wrote `acp-runner.ts`, and GIT-05, GIT-06 and GIT-07 all edit `agent-instructions.ts`. pleach pins such nodes for a rebuild on the clean stack of their siblings, kept under `refs/pleach/rebuild/<node>`.
Chosen: a batch's audit starts as soon as its code is merged. It reads the landed branch, or a detached worktree of the batch's clean stack when the land was refused. Pinned nodes are rebuilt by pleach, not merged by hand, and are audited after they land. The audit prompt says that CI has not run, so the auditor leaves types, lint and failing tests to CI. CI still runs once for the whole step, and fixers check each audit finding against the code before acting on it.
Why: audits are read-only, so they can run while other batches build, and that removes the wait. A rebuild is better than a hand merge when both sides wrote the same file from scratch: a hand merge of two separate designs would itself need review.

## D053. A test quality review before slice 2's second step (2026-11-05)

Context: the owner asked for professional tests with no theater. Five Sonnet reviewers read every test file of slice 1 and slice 2's first step (448 files) against the code it tests. Each file got a verdict (REAL, WEAK or THEATER) and each finding names the mutation the tests would miss. A new coverage workflow measured main for the first time: desktop 86.9% lines and 75.2% branches, sidecar 90.6% lines, Rust 69.9% lines.
Found: 224 files REAL, 219 WEAK and 5 THEATER. Pure logic is tested well, and the seams between parts are not. Line coverage hides it: a screen with a theater test shows 100%. Two confirmed bugs mean no chat can run on main: the sidecar exits at start, because a startup step calls a SIDE-13 placeholder that throws, and every send fails, because the container passes no agent launch (SIDE-21).
Chosen: the plan is [docs/plans/test-quality.md](plans/test-quality.md), and the reports are in [docs/reports/test-quality/](reports/test-quality/). Guards, test kit fixes, the UI fix batch and the theater rewrites land between slice 2's first and second steps, so the step-2 builders inherit them. SIDE-21 builds first in step 2, accepted by a real-container test that sends one message. The test work uses Sonnet workers on the subscription. DeepSeek builds only the features that own a fix.
Why: the bugs that hurt most lived where parts meet, and each new step adds more parts. Fixing the test kit before the next build stops every new feature from copying the weak patterns.

## D056. The DeepSeek budget has no fixed cap (2026-11-05)

Context: the goal for slice 2 stopped DeepSeek spend at 35 USD. After slice 2's first step, the rest of the slice needed about as much as the cap had left, with no margin.
Chosen: the owner raised the budget and set no fixed cap. One floor stays: a step does not start when the balance is under 3 USD, and the owner is asked to top up instead.
Why: the floor keeps a step from running out of credit with workers half done, which would leave work to clean up by hand.

## D057. A red step is fixed at its cause, not quarantined (2026-11-05)

Context: D039 gave each step two CI fix rounds, then quarantine for the features still red. Quarantine kept main green by leaving a feature out. The owner asked for every failure to be understood and fixed instead. So far, every red run had a cause that could be fixed: a real bug, or two merged changes meeting for the first time.
Chosen: CI failures get root-cause fixes, however many rounds that takes. After two rounds, the conductor diagnoses the failure itself, or hands it to an Opus agent with the full logs, before trying again. Quarantine remains only for a feature that cannot be built yet, for example one waiting on a contract change the owner must approve, and that case goes into the report for the owner.
Why: leaving a broken feature out moves the problem into the next step, and main must stay green without features quietly dropped.

## D058. Each batch ends in a joining node, and SIDE-21 builds first in step 2 (2026-11-05)

Context: slice 2's first step planned every batch as independent features with no node that joins them. Four of its nine batches conflicted on landing and needed seven rebuilds and fifteen merges by hand. The test review then found features that nothing in the running app reaches (D054). The pleach-plan skill already asks for one integration node per plan, and the plans did not have one (pleach #181). Separately, SIDE-21, which gives every chat send its agent launch, waited on PLAT-28 (the agent program manager), although only three of its checklist items need that manager.
Chosen: a batch of two or more features in core, UI or sidecar gets a joining node. It needs every feature node, merges them, wires each feature into the composition root, removes duplicated logic and adds one integration test (docs/plans/overnight-build.md). `node-gate.ts` checks several feature ids, so the joining node's gate covers the whole batch. Every builder prompt now carries the D054 rule. SIDE-21's three program-manager items move to PLAT-28, and its dependency on PLAT-28 is dropped. SIDE-21 also owns the desktop composition root's `launchFor`, accepted by a test that sends one message. SET-04 now waits for SIDE-21 and adds its variables to the launch.
Why: the conflicts and the missing wiring both live where parallel features meet, and only a node that sees them merged can fix that inside the plan. Until SIDE-21 lands, no chat can send, so it goes first.

## D060. How the overnight build runs from slice 2 step 2 on (2026-11-05)

Context: the owner's updated machine rules allow at most three agents at once on the Mac, have Opus write anything that lands in a repo, and want every agent brief written the same way. Step 2 also showed that pleach rebuilds a pinned node on the stack recorded when its land was refused, so batches landed in parallel kept conflicting with each other's rebuilt joining nodes.
Chosen: at most three agents at once: DeepSeek builders, Sonnet auditors (read-only) and Opus fixers together. Each batch audit's MUST findings go to one Opus fixer whose brief comes from `.context/overnight/mkbrief.py`, built on the agent-brief skill and the machine rules. The lead reads each fixer's whole diff before merging. Once batches touch the same files, they land one at a time, and a conflict that only touches a generated baseline or a few headers is merged by hand rather than rebuilt. For tonight the owner chose normal pace for this repo: pushes and PRs go on, because its CI runs on GitHub's machines.
Why: the three-agent limit and the Opus rule come from the owner. Landing one batch at a time ends the rebuild chase, and a hand merge of a baseline costs less than another rebuild.

## D061. The guards run when rows are set to done, and a step runs one batch plan at a time (2026-11-06)

Context: slice 2 step 2's preflight passed, and then its rows were set to done. The test-only-exports guard skips the files of a stub feature, so setting DATA-02, CHAT-15 and COMP-04 to done brought five test-only exports into its scope, and CI went red on a check that preflight had passed. Separately, D060 caps all agents at three, DeepSeek builders included, and step 3 has three batch plans.
Chosen: `drive.ts mark-done` runs the guards on the tree after it writes the rows and fails loudly, through the same `runQuickChecks` helper preflight uses. Each step runs its batch plans one after another, each with up to three workers, and the joining node of a plan runs before the next plan starts. Slice 2's remaining 13 features regenerate into two steps (3 and 4), not the four the night's goal estimated.
Why: a check that can only go red after a status change has to run after that change. One plan at a time keeps the three-agent cap without idle slots, and it lands each batch on a step branch that already holds the batch before it, which D060 asks for once batches touch the same files.

## D062. PLAT-28 is planned until its release feed exists (2026-11-06)

Context: slice 2 step 3 built PLAT-28's program manager: install, re-download, retry, remove, prune, launch preparation and the Advanced page, reached from the composition root. Every install still ends with `program_release_missing`, because nothing produces the pinned release feed. That feed needs the darwin-arm64 download URL, size and SHA-256 of Claude Code 2.1.308 and Codex 0.164.0 from the vendors' official hosts, and it should ship inside the app bundle. None of those values is in the repository, and inventing them is not allowed. `pnpm stubs` requires a `stub` row to have a placeholder, and the feed's absence is a runtime error, not a placeholder.
Chosen: PLAT-28's backlog row is `planned`, not `stub` or `done`. Its issue stays open. The night's batches leave it alone. The feed and its packaging go to the owner as a product and release question. The built code stays on main.
Why: `done` would close the issue over a feature no user can use; a placeholder written only to satisfy the stubs check would be theater. `planned` is the status for work that needs a spike or a decision before it can be built.

## D063. A feature waits for needs that are not done or being built (2026-11-06)

Context: plan-batches read only the stub rows and dropped any need outside them, so a need on a planned row counted as met. After D062 set PLAT-28 to planned, it offered PLAT-35 (gh and watchexec), which needs PLAT-28 and the same missing release feed.
Chosen: `buildableRows` keeps a stub row only when every need is done or is itself buildable, repeated until nothing changes. A need on a planned row, a stub beyond the priority, or a missing row keeps the feature waiting, with everything that needs it. Slice 2 step 4 is REV-10 and SET-10; PLAT-35 waits for PLAT-28's feed.
Why: building a feature whose dependency cannot work yet repeats PLAT-28's blocked state and spends a step on code no user can reach (D054).

## D065. Slice 3's large first step lands in parts of a few batches (2026-11-06)

Context: slice 3 is 65 features. plan-batches puts 54 of them in its first step, in 8 batches. Under the three-agent cap (D060), with one plan building at a time (D061), that step cannot be built, audited, fixed and through CI as one PR before the morning. The night's goal asks that a step that starts either merges or stops cleanly.
Chosen: the first step lands in parts, each its own branch and PR (`slice3/step-1a`, `-1b`, ...), with one to three batches each and one CI run per part. A part starts only when the balance is above 3 USD and the part before it has merged or stopped cleanly. The rust batch starts while the last slice-2 hardening runs, because its files do not overlap.
Why: a part that merges is finished work in the morning; a 54-feature PR left half built is not.

## D066. AGENT-09 is planned until Cursor's SDK can ship (2026-11-06)

Context: slice 3 built AGENT-09, the Cursor runner that runs Cursor's SDK inside the sidecar: the loader, the run, the translation (AGENT-10), the store folder and the app tools, reached from the composition root. It cannot run in the app, because the SDK is not bundled, and D010 forbids bundling it. The loader now reports "Cursor's SDK is not installed" instead of a false "not installed" for a broken package. Its sign-in check also cannot read the key the app keeps in the Keychain.
Chosen: AGENT-09's backlog row is `planned` and its issue stays open, as with PLAT-28 (D062). AGENT-10, the translation, is done: it is complete and tested on its own. Whether and how the SDK ships, and how the sidecar learns that Cursor is signed in, go to the owner. For the second, the fixer's proposal is that the app sets Cursor's signed-in state from its own provider keys, a desktop-only change.
Why: `done` would close the issue over a runner no user can start.

## D067. A feature whose title's behaviour is not built stays open (2026-11-06)

Context: slice 3's core-1 audit found that about 20 of PR-08's 27 checklist items (stacked pull requests and read-only Graphite) are not built, and that stack sync and stack merge need `Actions.pullRequests.syncStack` and `mergeStack` in `core/api.ts`. PR-09's Link issue dialog and Cmd+I, the "link" in its title, are not built either. Their builders removed every placeholder, so `pnpm stubs` will not take `stub`, and `done` would close issues over features that do not do what their titles say.
Chosen: PR-08 and PR-09 are `planned`, with their issues open and the unbuilt items listed in the overnight report. The rows go back to `stub` when someone builds the rest; PR-08 also waits for the owner's contract change. The other six core-1 features are done, with their open items recorded.
Why: the backlog row and the issue state must say what a user can do.

## D068. No slice 3 part starts after 07:00 UTC (2026-11-06)

Context: slice 3's parts 1a and 1b each took about three hours from start to merge (D065). Part 1b merged at 07:41 UTC. Five batches remained: `s1-core` and the four `s1-ui` batches, then step 2. The goal ends slice 3's work when the night or a stop rule ends it, and asks that a step that starts either merges or stops cleanly. None of the stop rules had fired: the balance was 20.66 USD, nothing had failed three times, and no contract change blocked more than one feature.
Chosen: the night ends at 07:00 UTC for starting work. A part that would start after that does not start. The remaining batches wait for the next run, from `bun scripts/overnight/drive.ts step 1 --priority 3`.
Why: a part started at 07:41 would still be building, half audited, when the owner wakes, which is the half-built state D065 avoids.

## D069. The approved contract changes land in one PR, built by area (2026-11-06)

Context: the owner approved every contract change the slice-2 and overnight reports list, in one PR, with migrations as new steps. There were 24 changes across `platform.ts` and Rust, `core/api.ts`, `model.ts` and the migrations, and `packages/protocol` and `packages/shared`.
Chosen: three Opus agents built one area each on its own branch (platform, core, protocol), each change through contract, implementation and callers with a test seen failing first. The lead read each diff and merged the three into `contracts/day`, one PR (#325). Migrations 0005 to 0008 are new files. `mainWorktreePath` was not added: `WorkspaceContext.repoRootPath` already carries the main worktree to every runner, and a second field would hold the same fact twice. PR-08's `mergeStack` is a named placeholder behind the API, and PR-08 is `stub` again until it is built.
Why: one area per agent keeps each branch's files apart, and one PR keeps the contract change one reviewable step.

## D077. DeepSeek builders run outside the three-agent cap (2026-11-06)

Context: the owner's cap of three agents at once covered the DeepSeek builders too, so with Opus fixers and builds holding two slots, a batch's eight features built one after another (53 minutes for s1-ui-1, about 7 minutes each). The builders do not use the Claude subscription, and their gates are about 15 seconds of type-check, lint and guards.
Chosen by the owner: DeepSeek builders run outside the cap, in parallel as needed. The cap of three still holds for Claude agents (Opus and Sonnet). The lead runs at most two batch plans at once with three builders each, and still lands one batch at a time; Rust builds and full test suites stay one at a time.
Why: the builders were the bottleneck, and they cost the owner's subscription nothing.

## D085. Why each open backlog row is still open at the end of 6 November (2026-11-06)

Context: the day goal asks that no row is `stub` or `planned` without a decision saying why. At 22:00, 240 of 264 rows are done.
Chosen: these 24 rows stay open, each for the reason named.

- REV-13, PR-10, RUN-05 and APP-06 (`stub`, step 2): each needs a row that landed with part 1e (#338, merged 19:26). The goal starts no step after 19:00. They are the next run's first batch.
- PLAT-36 and SIDE-25 (`planned`): neither started. PLAT-36 needs Rust builds, which the release and the fixers held all afternoon. SIDE-25 moves the sidecar's adapters, the files AGENT-09 and the part-1e fixers were changing. They go after step 2.
- APP-16 (`planned`): it gathers the hardening findings on done features. The slice-3 hardening did not start today. Its inputs are in docs/reports/day-2026-11-06.md, "Findings by area", and in D071, D084 and D078.
- CLOUD-01 and CLOUD-03 to CLOUD-18 (`planned`): the cloud spike passed (D075), and the rows are built through the loop, starting with CLOUD-01, the host seam. None started today, because the spike, Remote Control and the priority-3 rows came first in the goal's order.
  Why: each reason is a dependency or the goal's own order and time rule. No row is held for a missing input from the owner.

## D094. The night of 6 to 7 November runs audits and fixers on DeepSeek when the Claude slot is taken (2026-11-07)

Context: the owner's rule for the night was "run one claude agent at a time max", and DeepSeek builders run outside it (D077). The loop asks for a Sonnet audit and an Opus fixer per batch, while the one Claude slot held the parity, harness and comparison work.
Chosen: step 2's audit and fixer, the hardening issues (#348, #349, #350, #352), PLAT-36, SIDE-25 and the LATER sweep (#351) ran on DeepSeek V4.1 Flash. The lead read every diff, compared test and assertion counts where tests changed, and merged only on green CI.
Why: the owner's cap comes first; the lead's review and CI carry the quality check the Claude audit would have given.

## D095. Overnight order: the parity harness before stage 2 (2026-11-07)

Context: the goal put Conductor's frontend on our backend (stage 2) before the harness. Stage 2 needs Conductor's frontend loaded in a window, which is a browser run, and the owner's ruling says "Browser and screenshot runs on this Mac wait for 08:00", which is also when the goal ends.
Chosen: stage 1's code (the stand-in, the server, the guard and the run script) was built overnight; its first run, stage 2 and the paired screenshots (3c) wait for the morning. The harness, which runs on GitHub, was built first.
Why: the work that could run at night ran; nothing broke the quiet rule.

## D096. Conductor's frontend and sidecar run only sealed, on this Mac (2026-11-07)

Context: the owner said "Go: run Conductor's own frontend on this Mac only, from the git-ignored folder, network cut off, never committed, pushed or shipped; a check fails if any of it reaches our app or repo", and later "yes" to running Conductor's sidecar beside ours under the same boundaries.
Chosen: Conductor's frontend runs from `.context/` through a stand-in on 127.0.0.1 with every other origin refused. Its sidecar runs in place under `sandbox-exec` with a fresh temporary home, no IP traffic beyond loopback, no writes in the owner's home and fake agent programs only. Their outputs stay in `.context/`. The `conductor-code` guard fails on any copy of Conductor's code in the repository, by SHA-256 fingerprints.
Why: the owner's rulings; the comparison reads Conductor's behaviour without taking anything of it into the product.

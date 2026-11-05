# Overnight goal: build the first slice

Status: proposed (2026-11-04), waiting for a go and four answers (end of this file).

## The goal

By morning, the "First slice" milestone works end to end: add a repository, create a workspace, chat with Claude Code in it, and see the diff. Every feature is built test-first by a fresh DeepSeek agent (V4.1 Flash), audited by a different model, and lands on `main` only through a pull request with green CI.

How we know it worked:

- every "First slice" issue is closed by a merged PR, or is quarantined with the evidence of why;
- `pnpm dev` opens the app, and the scripted journey (add repo, create workspace, one turn with a scripted agent, diff shown) passes in CI;
- `pnpm stubs` shows no placeholders left for the closed ids.

Kill criterion: stop the night and report if a step stays red after its two fix rounds for more than a third of its features, or if the agents need a change to a shared contract file. A wrong contract is fixed by a person in daylight, not by agents at night.

## What the agents work from

The GitHub issues. Each issue holds everything one agent needs and nothing else: the backlog row, the owning files with their "Owns" and "Test first" lines, the full item checklist (views, controls, actions, states, rules, timeouts), the research reference, and its blockers. An agent sees only its issue and the repo, never this conversation.

Before the first night, three things must exist that do not yet:

1. The issues themselves (next step in `docs/plans/github-issues.md`).
2. The test infrastructure the slice's tests stand on, as backlog ids of their own: the in-memory Platform with its contract test (PLAT-01), a scripted agent that replays recorded sessions so tests never call a paid model, and fixtures for temporary git repositories.
3. Locked contracts: `CODEOWNERS` on the shared contract files, and branch protection on `main` that requires CI.

## How a night runs

The work is planned ahead in steps and batches, generated from the backlog's priorities and Needs by `bun scripts/overnight/plan-batches.ts --write` into [batches.md](batches.md). The first slice is 67 features in 19 batches over 6 steps.

- **A batch** is up to 8 features of one dependency step and one program (Rust, sidecar, UI services, screens), so its features rarely share files.
- **A step** is every batch whose features need only earlier steps. A step's batches build side by side.
- **CI runs once per step**, and **an audit runs once per batch.** Nothing runs CI per agent.

The steps are driven by a script, `scripts/overnight/drive.ts`, not by an agent. tend2 holds the night's goal, its stop rules and each step's result. A pleach plan is a fixed graph and readiness changes after every merge, so each batch is its own pleach plan (reviewed with plotplot, 2026-11-04).

```
for each step:
  1. build: `drive.ts preflight` passes on the step branch first, because every
     node starts from it. Then for each batch, one pleach plan, one fresh agent per feature,
     at most 6 agents at a time across the step; each node passes quick
     local checks only (typecheck, lint, guards, placeholders gone)
  2. land every batch of the step onto branch overnight/step-N; push; open the PR
  3. CI once on the step's PR
  4. if CI is red: group the failures by feature, and give each group to a
     fresh fixer agent with the CI log; push; CI again. At most 2 fix rounds;
     then the failing features are taken out of the step and quarantined
  5. audit: one fresh audit agent per batch reviews the batch and marks each
     finding MUST or LATER (D045); MUST findings go to fresh fixer agents, one
     per finding group; LATER findings are committed in docs/reports/audits/;
     push; CI again
  6. merge on green. Before the first CI run the step branch sets each finished
     feature's backlog row to done, and the PR body closes their issues with
     `Closes #N` lines (D041); sync.ts --check confirms; pleach clean
  7. check the money spent; stop on any kill criterion, else the next step
```

The backlog is the one record of what is done. Issues are a view of it: the merge that turns a row `done` closes its issue, and `sync.ts --check` fails when the two disagree.

### What every agent reads first

Every agent, whether builder, fixer or auditor, starts with the same opening instruction:

1. `CLAUDE.md`, `docs/architecture.md`, `docs/engineering.md` and `docs/decisions.md`.
2. `docs/design.md` and `docs/research/conductor/ui-dimensions.md` when the work touches a screen; `docs/data-model.md` when it touches stored data.
3. Its GitHub issue (`gh issue view <number>`): the checklist, the owning files, the "Test first" lines and the blockers. For a fixer, also the CI log or the audit finding it was given.
4. The research sections the issue cites.

Then the rules: change only the files the issue owns; never edit a shared contract file (stop and report instead); write the tests first; never commit; finish with a message that lists what was built and what was not.

### One agent per task, never reused

- Each issue is one pleach node. pleach gives it a fresh git worktree, merged from the verified branches of the nodes it depends on, and a fresh umbel session that ends with the node. No agent sees a second task.
- A batch of two or more features in the TypeScript areas (core, UI, sidecar) ends in a joining node that needs every feature node (D058). It starts from their merged branches, resolves conflicts keeping both sides, wires each feature into the composition root, keeps one copy of logic two features both wrote, and adds one integration test that drives each feature through that root (D054). Its smoke gate checks every feature id of the batch. Rust batches have no joining node.
- Builder: OpenCode with `deepseek/deepseek-flash` (DeepSeek V4.1 Flash). The key reaches the worker by name only: `env: { DEEPSEEK_API_KEY: { fromEnv: "DEEPSEEK_API_KEY" } }`, because an OpenCode worker inherits no other variables.
- Work shape: an agent prompt that writes the tests for the issue's checklist first, then the feature. pleach's enforced red-green cycle needs a test run per node, which would mean CI per agent, so it is not used. The step's CI run proves the tests pass, and the batch audit checks that each checklist item has a real test that would fail without the feature.
- Agents never run `git commit`: pleach commits for them, without hooks. A worktree has no `.plotplot/bin`, so a commit there would fail.
- Gates on every node:
  - setup: `pnpm install --frozen-lockfile` (fast: pnpm links from one shared store), so the agent can type-check as it writes;
  - smoke: quick local checks only: `pnpm typecheck`, `pnpm lint`, `pnpm guards`, and the issue's placeholders gone. Tests run in the step's CI run, not per node.
- Rust builds and tests run on GitHub's macOS runners only, so no worktree here builds Tauri.
- Policy: 45 minutes per attempt, at most 2 attempts (the retry carries the failure into its prompt).

### Audits by other agents

- **Per node:** none beyond the gates. A second model that only re-runs the check script adds cost and no judgement, so the check runs in pleach's own smoke gate.
- **Per batch:** one fresh audit agent (Claude) reviews the batch on the step's branch after CI is green, against the issues and the research. It checks that each feature looks and behaves like Conductor (D020, D022), that the specs and code agree, that every checklist item has a real test, that no logic is duplicated across features, and that nothing was quietly skipped. It is told to change no files, because pleach cannot yet make an auditor read-only (umbel #92, pleach #111). Its findings go to fresh fixer agents in the same step; what cannot be fixed there becomes new backlog rows.
- **At the end of the night:** one fresh audit agent reads everything that landed, and writes the morning report.
- If Claude reaches its usage limit, umbel reports it with the reset time. The driver waits for the reset instead of retrying.

### What runs where

- **On this Mac:** the agents (umbel in tmux), git, the driver, and the quick local checks. No tests and no Rust builds.
- **On GitHub:** every test and every Rust build, once per step. The repo is public, so GitHub's standard runners cost nothing.

## Budget and stopping

- **The hard ceiling is the DeepSeek prepaid balance.** pleach does not yet enforce a per-node dollar cap (`policy.budget` is accepted but inert). So the balance is topped up with only what the night may spend. When it runs out, workers stop with "Insufficient Balance", and the kill criterion ends the night.
- **The driver keeps a soft ceiling.** Before each step it reads the DeepSeek balance, and it starts no step once the night's spend passes the limit.
- **A stop time** in the morning, after which no new step starts.
- Every stop leaves a clean state: running nodes finish or are stopped, `pleach clean` removes worktrees, no tmux sessions are left, and quarantined nodes keep their receipts.

## The morning report

One page, at `docs/reports/overnight-<date>.md`:

- the issues closed, with their PRs;
- the nodes quarantined, with their receipts and the failure in one line each;
- the audit findings, and the new issues they became;
- the money and time spent per step;
- the decisions that need a person.

## Where the goal lives

A plan this size outlives one session. The loop, the steps and their state belong in tend2, with the night's goal, its checks and each step's verified results. pleach runs each batch, and tend2 holds what carries over between nights.

## Before the first night

- Plant plotplot's garden in this repo (`plotplot init --profile minimal --lock ~/.local/share/plotplot/templates/garden.lock`). The commit adds guardrail files, so a person writes it, as in conductor-remake.
- Write the step driver (`scripts/overnight/drive.ts`) and the issue check, and test them on a one-batch step of two features while someone is awake.
- Review the Needs of the step-1 sidecar features. Several of them (session manager, write-ahead log, turns) build on each other, but the backlog lists no dependency between them, so they would build in parallel against each other's empty code.

## Needed from Jan

1. **The money.** How much to top up on the DeepSeek account for one night, and whether that account is shared with another project (plotplot mentions mull's search budget).
2. **The first run.** One batch of two features, while you are awake, before the first full night.

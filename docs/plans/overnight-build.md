# Overnight goal: build the first slice

Status: proposed (2026-11-04), waiting for a go and four answers (end of this file).

## The goal

By morning, the "First slice" milestone works end to end: add a repository, create a workspace, chat with Claude Code in it, and see the diff. Every feature is built test-first by a fresh DeepSeek agent, audited by a different model, and lands on `main` only through a pull request with green CI.

How we know it worked:

- every "First slice" issue is closed by a merged PR, or is quarantined with the evidence of why;
- `pnpm dev` opens the app, and the scripted journey (add repo, create workspace, one turn with a scripted agent, diff shown) passes in CI;
- `pnpm stubs` shows no placeholders left for the closed ids.

Kill criterion: stop the night and report if a wave's land gate fails twice, if more than a third of a wave's nodes are quarantined, or if the agents need a change to a shared contract file. A wrong contract is fixed by a person in daylight, not by agents at night.

## What the agents work from

The GitHub issues. Each issue holds everything one agent needs and nothing else: the backlog row, the owning files with their "Owns" and "Test first" lines, the full item checklist (views, controls, actions, states, rules, timeouts), the research reference, and its blockers. An agent sees only its issue and the repo, never this conversation.

Before the first night, three things must exist that do not yet:

1. The issues themselves (next step in `docs/plans/github-issues.md`).
2. The test infrastructure the slice's tests stand on, as backlog ids of their own: the in-memory Platform with its contract test (PLAT-01), a scripted agent that replays recorded sessions so tests never call a paid model, and fixtures for temporary git repositories.
3. Locked contracts: `CODEOWNERS` on the shared contract files, and branch protection on `main` that requires CI.

## How a night runs

The night is a series of waves. A wave is one pleach plan of at most six nodes: the issues whose blockers are all closed, in priority order. Each wave builds on the `main` that the last wave merged.

```
for each wave:
  1. pick the next ready issues (all blockers closed), at most 6
  2. write the wave's plan.json from the issues; pleach validate
  3. pleach run: one fresh agent per issue, in its own worktree
  4. audit agents review the wave (see below)
  5. pleach land onto branch overnight/wave-N; push; open the PR
  6. CI on GitHub; merge on green; close the issues
  7. stop on any kill criterion, else next wave
```

### One agent per task, never reused

- Each issue is one pleach node. pleach gives it a fresh git worktree, merged from the verified branches of the nodes it depends on, and a fresh umbel session that ends with the node. No agent sees a second task.
- Builder: OpenCode with `deepseek/deepseek-v4-pro`, billed per token on the DeepSeek API key.
- Work shape: pleach's enforced test-first cycle. In the red phase the agent writes the tests for the issue's checklist, and pleach requires them to fail. In the green phase the agent builds the feature, and pleach requires them to pass.
- Gates on every node:
  - setup: `pnpm install --frozen-lockfile`;
  - smoke: `pnpm typecheck`, `pnpm lint`, the tests of the touched packages, `pnpm guards`, and no placeholder left for the issue's id (`cargo fmt`, `clippy` and `test` for Rust issues).
- Policy: 45 minutes per attempt, at most 2 attempts (the retry carries the failure into its prompt), and a dollar cap per node.

### Audits by other agents

- **Per node:** pleach's cross-provider audit. A Claude or Codex session, not DeepSeek, runs the node's check script in its own session and relays the verdict. The script checks that every checklist item in the issue has a test, the issue's placeholders are gone, the boundaries hold, and no new duplicate of an existing helper appeared.
- **Per wave:** one fresh audit agent (Claude or Codex) reviews the merged wave before it lands, against the issues and the research. It checks that each feature looks and behaves like Conductor (D020, D022), that the specs and code agree, that no logic is duplicated across nodes, and that nothing was quietly skipped. What it finds becomes new issues for the next wave. It changes no code.
- **At the end of the night:** one fresh audit agent reads everything that landed, and writes the morning report.

### What runs where

The agents work on this Mac: umbel runs them in tmux, and their test-first cycle runs the tests locally. CI on GitHub is the final gate for every merge.

## Budget and stopping

- **A dollar ceiling for the night,** shared by every node, with a per-node cap inside it. When the ceiling is reached, no new node starts; nodes already running finish.
- **A stop time** in the morning, after which no new wave starts.
- Every stop leaves a clean state: running nodes finish or are stopped, no worktrees or tmux sessions are left behind, and quarantined nodes keep their receipts.

## The morning report

One page, at `docs/reports/overnight-<date>.md`:

- the issues closed, with their PRs;
- the nodes quarantined, with their receipts and the failure in one line each;
- the audit findings, and the new issues they became;
- the money and time spent per wave;
- the decisions that need a person.

## Where the goal lives

A plan this size outlives one session. The loop, the waves and their state belong in tend2, with the night's goal, its checks and each wave's verified results. pleach runs each wave, and tend2 holds what carries over between nights.

## Needed from Jan

1. **The model.** I read "DeepSeek pro fast" as OpenCode's `deepseek/deepseek-v4-pro`. If you meant `deepseek/deepseek-flash` for speed, say so. The DeepSeek API key must be in the environment umbel runs in, and I will check that without printing it.
2. **The dollar ceiling for the night.**
3. **Tests on this Mac overnight.** The agents' test-first cycle runs tests locally while you sleep, and GitHub runs the final checks. Is that acceptable, given you asked to keep tests off your machine?
4. **The audit model.** Claude (your subscription) or Codex. My recommendation: Claude for the wave audits, which need judgement; Codex for the per-node check runs.

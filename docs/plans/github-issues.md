# How work is tracked on GitHub

Status: proposed (2026-11-04). This replaces section 3 of [parallel-build.md](parallel-build.md).

## The short version

- **One issue per backlog id**, grouped under one epic issue per area with GitHub's sub-issues.
- **Dependencies** between features are GitHub "blocked by" links, so the board shows only work that can start.
- **A script creates and updates the issues** from `docs/plans/backlog.md` and the file headers. It never closes them and never touches what people write.
- **A project board** shows milestones, areas and who is on what.

## Where each fact lives

| Fact                                                    | Home                                                              | Copied to                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| Id, title, owner folder, research link, priority, needs | `docs/plans/backlog.md`                                           | the generated part of the issue                                |
| What to build, edge cases, first test                   | the file headers (`@feature ID`)                                  | the issue lists the owning files with their "Test first" lines |
| Acceptance scenarios                                    | `test.todo(...)` in the owning test files                         | the issue's checklist                                          |
| Discussion, assignee, open or closed                    | the GitHub issue                                                  | nowhere                                                        |
| Done                                                    | the backlog row's status, set in the PR that finishes the feature | the PR closes the issue (`Closes #N`)                          |

A check (`pnpm issues --check`, run in CI with the read-only token) fails when a `done` row's issue is still open, or a closed issue's row is not `done`.

## Issue hierarchy

1. **Epic per area:** one issue each for Platform (Rust), Sidecar core, Agent runners, Data, Projects and workspaces, Navigation, Chat, Composer, Review and files, Git and PRs, Run and preview, Settings, App, Test infrastructure, Cloud, Remote Control. The epic's body says what the area is, links its research and docs, and names its reviewers.
2. **Feature issue per backlog id,** as a sub-issue of its epic. Title: `CHAT-03 Steer a running turn`.
3. **No task issues.** Steps within a feature are a checklist in the feature issue. One person or pair takes a feature at a time.

## A feature issue

The script writes everything above a marker line, and keeps everything below it:

```markdown
**CHAT-03 Steer a running turn** · area: chat · priority 2 · milestone: Daily use

What: push a follow-up into the running turn and show it as pending until the agent has read it.
Research: docs/research/conductor/sessions-and-chats.md, "While the agent is working"
Blocked by: #41 CHAT-02, #77 SIDE-04

Owning files (from @feature headers):

- packages/sidecar/src/session/steering.ts: Test first: a steer sent mid-turn stays pending until read.
- apps/desktop/src/core/services/sessions.ts: Test first: ...

Acceptance scenarios (test.todo in the owning tests):

- [ ] a steer sent mid-turn shows as pending until the agent has read it
- [ ] a steer to an agent that cannot steer becomes a queued follow-up
- [ ] cancel during a steer withdraws it

Done when: placeholders for CHAT-03 are gone, its scenarios are real passing tests, and its row is `done`.
<!-- generated above: edit docs/plans/backlog.md or the file headers, not this text -->
```

## Labels

| Label              | Values                                   | Meaning                                                                  |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------------------ |
| `area:`            | the epics above                          | which part of the app                                                    |
| `priority:`        | `1`, `2`, `3`                            | first slice, daily use, polish                                           |
| `size:`            | `S`, `M`, `L`                            | roughly a day, a few days, a week or more of focused work                |
| `layer:`           | `rust`, `sidecar`, `core`, `ui`, `cloud` | which program; decides who reviews                                       |
| `contract`         |                                          | touches a shared contract file; needs a core reviewer and an issue first |
| `good first issue` |                                          | small, well specified, no contract change                                |
| `help wanted`      |                                          | ready and unclaimed                                                      |
| `needs-spike`      |                                          | blocked on a spike's answer (cloud, Remote Control)                      |

## Milestones

1. **First slice:** priority 1. Add a repo, create a workspace, chat with Claude, see the diff.
2. **Daily use:** priority 2.
3. **Polish:** priority 3.
4. **Cloud** and **Remote Control:** their spikes, then their features once confirmed.

## Project board

One GitHub project, "Conducted":

- **Fields:** Status (Todo, Ready, In progress, In review, Done), Area, Priority, Size, Milestone.
- **Views:**
  - "Ready to take": Status is Ready, nothing blocks it, no assignee. Sorted by priority.
  - By area, for reviewers.
  - By milestone, for planning.
- **Automation:** an issue moves to Ready when its last blocker closes, to In progress when a draft PR links it, to In review when the PR is marked ready, and to Done when it closes.

## Rules for contributors

- **Claim first.** Assign yourself before you start. A claim with no draft PR after 7 days is released.
- **One feature per PR.** Name the id in the title, and close the issue from the PR.
- **New ideas start as a proposal issue.** A maintainer turns an accepted proposal into a backlog row, and the script makes its feature issue. The backlog stays the one list of features.
- **Contract changes start as an issue** labelled `contract`, before any code.
- **Draft PRs run no CI.** Mark a PR ready when its checks pass locally or in a batch.

## What has to exist first

1. A `Needs` column in the backlog (the dependencies), and acceptance scenarios as `test.todo` for every open id.
2. The sync script (`scripts/issues/sync.ts`), using `gh`, idempotent, matching issues by the hidden id marker. It needs a dry-run mode that prints what it would change.
3. `CODEOWNERS` for the contract files and per layer.
4. The board and its automation.

Order: build these, run the script in dry-run, check a sample of issues by hand, then create the issues.

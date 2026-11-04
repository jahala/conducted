# Plan: make the project buildable by 20 to 100 people at once

Status: proposed, waiting for a go (2026-11-04).

## The short version

Yes to a full test suite and to issues, but in this order: first prove the contracts with a small team, then open the work. Every feature gets executable acceptance scenarios and one issue. CI stays green while work is open, never calls a paid agent, and tests every pull request against the latest main before it merges.

## 1. Specs as tests, without breaking CI

Every backlog id gets acceptance scenarios, written as `test.todo("...")` in the test file next to the code that owns it:

```ts
describe("CHAT-03 Steer a running turn", () => {
	test.todo("a steer sent mid-turn shows as pending until the agent has read it");
	test.todo("a steer to an agent that cannot steer is queued as a follow-up instead");
	test.todo("cancel during a steer withdraws it and the turn ends as cancelled");
});
```

- `test.todo` lists the scenario without passing or failing. CI stays green, and nothing pretends to work.
- Taking a feature means turning its scenarios into real, failing tests, then making them pass. The failing test stays the spec.
- `pnpm stubs` grows two rules. Every open id has at least one scenario. A `done` id has no `todo` left.
- Scenarios are drafted from the research for each area, then reviewed. A sample is checked against the research before the area opens.

## 2. Four layers of tests

| Layer      | Proves                                                                                   | Tool                                                                           | Paid agent calls              |
| ---------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------- |
| Unit       | Pure logic: status, translators, reducers, parsers, registries                           | bun test, Vitest                                                               | none                          |
| Contract   | Every stand-in behaves like the real thing                                               | the same test run against both                                                 | none in CI                    |
| View       | Every screen in every designed state (loading, empty, error, ready, plus its own states) | Vitest and Testing Library, and Playwright screenshots in the browser          | none                          |
| End to end | A few whole journeys in the real app                                                     | WebdriverIO `@wdio/tauri-service` (works on macOS through its embedded driver) | none: uses the scripted agent |

What has to exist before people can write these tests:

- **In-memory Platform** (PLAT-01). Screens and services run in tests and in a browser without Rust.
- **Scripted agent.** A runner that replays recorded agent sessions (golden transcripts). A recorder captures a real Claude or Codex session once, and CI replays it. A contract test runs the same scenario against the real runner, on a developer's machine only, so CI never spends money.
- **Test API for views.** A typed `Queries` and `Actions` implementation that returns any state on demand, so a view test can say "render the Git panel with merge conflicts".
- **States catalogue.** Every view registers its designed states once. The same list drives the view tests, the screenshot tests and a browsable catalogue, so contributors can see every screen without running agents.
- **Fixtures.** Temporary git repos with branches, conflicts and remotes, all made inside the run's own temp folder.

End-to-end journeys (about 8, run on the self-hosted Mac runner, nightly and in the merge queue):

1. Add a project, then create a workspace.
2. Chat with the scripted agent and see the diff.
3. Queue, steer and cancel.
4. Answer a question and approve a plan.
5. Revert a turn.
6. Review comments, sent to the agent.
7. Run script and terminal.
8. Archive, then unarchive.

## 3. One issue per feature

- A script creates one issue per backlog id from `docs/plans/backlog.md`. It can run again safely: issues are matched by id.
- **Labels:**
  - `area:` (rust, sidecar, runners, core, chat, git, review, run, settings, app);
  - `priority:` (1, 2, 3);
  - `size:`;
  - `good first issue`.
- **Milestones:**
  - "First slice" (priority 1),
  - "Daily use" (priority 2),
  - "Polish" (priority 3).
- **Dependencies:** a new backlog column, `Needs`, lists the ids a feature waits for. The issue shows them as "Blocked by", so people only pick work that can start.
- **One home for each fact:**
  - The backlog holds the spec: id, owner folder, research, priority, needs.
  - The issue holds the discussion, the assignee and the open or closed state.
  - A check fails when a `done` row's issue is still open, or a closed issue's row is not `done`.
- A GitHub project board shows the milestones and who is on what.

## 4. Rules for working in parallel

- **Contracts have owners.** `CODEOWNERS` requires a core reviewer for the following, and contract changes start as an issue first:
  - `packages/protocol`, `packages/shared`;
  - `platform/platform.ts`, `core/model.ts`, `core/api.ts`;
  - the migrations and `tauri-commands.md`.
- **Claim before you start.** Assign the issue to yourself. A claim with no draft PR after 7 days is released.
- **One id per pull request**, or a few closely related ones.
- **Merge queue.** GitHub's merge queue tests each PR against the latest main plus everything ahead of it in the queue, so two clean changes cannot break each other on main.
- **Required checks:** `pnpm check`, the Rust checks and the view tests on every ready PR; end-to-end in the merge queue.
- **CI cost:** the repo is public, so GitHub's standard runners are free. Mac end-to-end runs go to the self-hosted Mac runner.

## 5. Order

1. **Now, small team:** finish the scaffold merge and publish it.
2. **Small team (2 to 5 people):** build the test infrastructure from section 2 and the first slice: add a repo, create a workspace, chat with Claude, see the diff. This proves the contracts under real use.
3. **Then open the gates:**
   - generate scenarios and issues for every area;
   - add `CODEOWNERS`, the merge queue and the board;
   - open "Daily use" to everyone.

Kill criterion for opening early: if the first slice forces more than a handful of contract changes, the contracts are not ready. Stay small until they settle. A hundred people building against moving contracts produce a hundred merge conflicts.

## Needed from Jan

- A go on this plan.
- Whether the public issue list should be created now, before the first slice. My recommendation: after step 2, so people see work they can actually start.

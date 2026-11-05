# Engineering

How code is written and tested here. The commands and their timings live in [CLAUDE.md](../CLAUDE.md). The parts and their dependency rules are in [architecture.md](architecture.md).

## Building a feature

1. Pick a backlog id from [plans/backlog.md](plans/backlog.md). The files that own it carry `@feature <ID>` in their header.
2. Write the failing test named under "Test first" in the header. If you cannot make it fail, you do not understand the feature yet.
3. Build until it passes. Remove the feature's `notImplemented` placeholders.
4. Set the backlog row to `done` in the same change. `pnpm stubs` fails if a `done` row still has placeholders or a `stub` row has none.
5. Fix every doc the change makes false, in the same change.

## File header

Every source file starts with a header comment. `pnpm guards` fails on a source file without one.

```ts
/**
 * @feature CHAT-03 Steer a running turn
 * Owns: pushing a user message into the live turn and tracking when the agent has read it.
 * Behaviour: research/conductor/sessions-and-chats.md, "While the agent is working".
 * Must handle: no active turn (fall back to the queue), an agent that cannot steer, cancel during a steer.
 * Test first: a steer sent mid-turn stays in pendingSteerIds until the agent has read it.
 */
```

Rust files use `//!` with the same fields. Shell scripts use `#` lines. Mark our own design choices with "Our design choice:" so they are not mistaken for observed behaviour.

The header says what the file does now, not what the feature will do one day. When you build part of a feature, cut the claims you did not build, or move them to the feature that owns them. A "Must handle" line with no code and no test is a defect. This was the most common finding of the first overnight build's audits (D045).

## Code

- **Failure lives in the return type.** Expected failures (git refused, file missing, agent not installed) return `Result` from `@conducted/shared`. Throwing is for programmer errors and `notImplemented`. Rust commands return `CommandResult`.
- **No silent failures.** These shapes hide a failure and are refused in review: `catch { return null }` or an empty `catch`, Rust's `.ok()` or `let _ =` on a `Result` nobody reads, an error that is only logged, and a default invented when the real value is missing. Hand the error on as a value. If a write the user relies on fails (a draft, a setting, a file), the user sees it.
- **Only the newest answer changes state.** An async read that writes a store guards against an older answer arriving late: use `createLatestWins` from `apps/desktop/src/core/async/latest-wins.ts`, or a request counter. Test it with two overlapping calls whose answers arrive in the wrong order.
- **Done means reachable.** A feature is done when its code is called from a live path: the composition root, a route, a screen or a handler. If the caller belongs to a feature that is not built yet, add the wiring as a checklist item on that feature in `docs/plans/items/` (D041, D043). Do not leave code nothing calls.
- **Use the shared helpers.** Before writing a queue, a single-flight guard, a retry, an error-message helper or a database write helper, check the table in [architecture.md](architecture.md#shared-helpers). A second copy of a helper is a finding.
- **Whatever subscribes, unsubscribes.** A service that adds a listener or starts a timer has a `dispose` or `stop` that removes it, and the container's `stop()` calls it.
- **Side effects at the edge.** Functions compute; callers do I/O. A function that needs time, ids, the file system or the shell takes them as parameters.
- **Placeholders.** `notImplemented("ID")` in TypeScript, `not_implemented!("ID")` in Rust, `not_implemented "ID"` in shell. No `TODO` comments, no fake data, no silent defaults. Unused placeholder parameters start with `_`.
- **Promises are always handled.** Biome's `noFloatingPromises` is an error.
- **Comments** say what the code does and why, in plain short sentences. One idea per sentence.
- **Deleting user files** moves them to the Trash. Scripts use `trash`, never `rm`.

## Tests

| Kind                         | Tool                                  | Lives in                         | Runs                        |
| ---------------------------- | ------------------------------------- | -------------------------------- | --------------------------- |
| Unit, packages               | `bun test`                            | next to the code, `*.test.ts`    | `pnpm test`                 |
| Unit and components, desktop | Vitest with jsdom and Testing Library | next to the code, `*.test.ts(x)` | `pnpm test`                 |
| Rust                         | `cargo test`                          | inline `#[cfg(test)]` modules    | in `apps/desktop/src-tauri` |
| Guards                       | `bun test`                            | `scripts/guards`                 | `pnpm guards`               |

Rules every test follows:

- **Never test a mock of the thing under test**, and never test a placeholder.
- **Every checklist item has a test that would fail without it.** A test that would still pass with the feature removed does not count.
- **Fakes behave like the real thing.** An id source hands out a new id on every call, never a constant. The night's most repeated test bug was a fake that gave every turn the same id.
- **Screens are tested over the real container.** Use `createTestContainer` from `apps/desktop/src/test/container.ts`, and `seedRepo` and `seedWorkspace` to put data in it, instead of a hand-built object cast to `Container`. Tests that need a real database use `openTestDatabase` from `apps/desktop/src/test/sqlite.ts`.
- **jsdom has no layout.** `apps/desktop/src/test/setup.ts` adds the layout methods editors call (`getClientRects` and the like). Do not stub them per test.
- **Stand-ins are checked against the real thing.** The in-memory Platform and `createTauriPlatform` over Node-backed bindings (`src/test/tauri-node-bindings.ts`) pass the same contract cases (PLAT-01). Each run lists the cases it cannot run, with a reason, and every Platform method is named by a case or listed as uncovered. `openTestDatabase` runs the app's own statement queue (`platform/queued-database.ts`), so a statement that waits on its own transaction hangs in a test as it does in the app.
- **Wait for the event, never a fixed time.** A timeout catches a hang; it is not a way to wait.
- **Time and ids are inputs.** Pass a `Clock` and an `IdSource`.
- **No shared fixed resources.** No fixed ports, names or paths. Temporary folders come from the run's own folder (see below).
- **Release what you hold:** timers, processes, sockets, file handles.
- **Test at real size.** Anything that lists or loops is tested at the size it meets in use: a chat with 20,000 events, a sidebar with 300 workspaces, a diff of 5,000 files.
- **A guard proves it can fail.** A check that reads source text includes a sample it must flag.
- **Four guards watch the shape of tests** (`scripts/guards/test-shapes.ts`): tests that cannot fail, tests that mock the thing they test, stand-ins defined outside `src/test/`, and real time or leaked state. Each compares per-file counts with `scripts/guards/test-shapes-baseline.json`. A count may not rise, and the baseline must fall with every fix: run `bun scripts/guards/test-shapes.ts --write-baseline` after a fix, and `--list` to see every site. A mock that is a real seam carries `// seam: <ID> <reason>` on the line above.

## A run leaves nothing behind

`pnpm test` runs through `scripts/with-run-dir.ts`. It gives the run its own folder (`$TMPDIR/conducted-runs/<run id>`, recorded with the run's process id), points `TMPDIR` at it, and removes it when the run ends. When the run ends it fails if anything is left. The next run removes folders whose recorded process is gone.

Tests that create git repos, sidecar sockets or temporary files create them under `TMPDIR`, and stop every process they start by the process id they recorded.

## Commits and pull requests

- Conventional commit subjects (`feat:`, `fix:`, `refactor:`, `docs:`). The body explains why.
- Open pull requests as drafts while working. Draft PRs run no CI. Mark a batch ready and CI runs once; GitHub tests the merge result, not just the branch.

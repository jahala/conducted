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

## Code

- **Failure lives in the return type.** Expected failures (git refused, file missing, agent not installed) return `Result` from `@conducted/shared`. Throwing is for programmer errors and `notImplemented`. Rust commands return `CommandResult`.
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
- **Stand-ins are checked against the real thing.** The in-memory Platform passes the same contract test as the Tauri Platform (PLAT-01).
- **Wait for the event, never a fixed time.** A timeout catches a hang; it is not a way to wait.
- **Time and ids are inputs.** Pass a `Clock` and an `IdSource`.
- **No shared fixed resources.** No fixed ports, names or paths. Temporary folders come from the run's own folder (see below).
- **Release what you hold:** timers, processes, sockets, file handles.
- **Test at real size.** Anything that lists or loops is tested at the size it meets in use: a chat with 20,000 events, a sidebar with 300 workspaces, a diff of 5,000 files.
- **A guard proves it can fail.** A check that reads source text includes a sample it must flag.

## A run leaves nothing behind

`pnpm test` runs through `scripts/with-run-dir.ts`. It gives the run its own folder (`$TMPDIR/conducted-runs/<run id>`, recorded with the run's process id), points `TMPDIR` at it, and removes it when the run ends. When the run ends it fails if anything is left. The next run removes folders whose recorded process is gone.

Tests that create git repos, sidecar sockets or temporary files create them under `TMPDIR`, and stop every process they start by the process id they recorded.

## Commits and pull requests

- Conventional commit subjects (`feat:`, `fix:`, `refactor:`, `docs:`). The body explains why.
- Open pull requests as drafts while working. Draft PRs run no CI. Mark a batch ready and CI runs once; GitHub tests the merge result, not just the branch.

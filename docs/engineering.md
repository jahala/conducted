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

`pnpm guards` also checks the parts of a header a script can verify: each `@feature` id is a backlog row, each code name in `Owns:` or `Exports:` appears in the file, and each `Test first:` line shares a phrase with a test title, so the test it names exists. Write a `Test first:` line in the words of its test's title. A backticked name in `Owns:` is a claim about this file; name another file's function in plain words. Today's failures are in `scripts/guards/header-claims-baseline.json`, which may only shrink (D055).

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
- **Fakes behave like the real thing.** An id source hands out a new id on every call, never a constant: use `createTestIds` from `apps/desktop/src/test/ids.ts` or `countingIds` from `packages/sidecar/src/test-support/ids.ts`. The night's most repeated test bug was a fake that gave every turn the same id.
- **Screens are tested over the real container.** Use `createTestContainer` from `apps/desktop/src/test/container.ts`, and `seedRepo` and `seedWorkspace` to put data in it, instead of a hand-built object cast to `Container`. Tests that need a real database use `openTestDatabase` from `apps/desktop/src/test/sqlite.ts`.
- **The sidecar's stand-ins have one home: `packages/sidecar/src/test-support/`.** `FakeApp` checks every message against the protocol schemas the real `RpcPeer` uses, `FakePublisher` checks every event, and each stand-in has a contract test next to it that runs the real class on the same inputs. A test file that declares its own copy fails `test-support/one-home.test.ts`.
- **jsdom has no layout.** `apps/desktop/src/test/setup.ts` adds the layout methods editors call (`getClientRects` and the like). Do not stub them per test.
- **Stand-ins are checked against the real thing.** The in-memory Platform and `createTauriPlatform` over Node-backed bindings (`src/test/tauri-node-bindings.ts`) pass the same contract cases (PLAT-01). Each run lists the cases it cannot run, with a reason, and every Platform method is named by a case or listed as uncovered. `openTestDatabase` runs the app's own statement queue (`platform/queued-database.ts`), so a statement that waits on its own transaction hangs in a test as it does in the app.
- **Wait for the event, never a fixed time.** A timeout catches a hang; it is not a way to wait.
- **Time and ids are inputs.** Pass a `Clock` and an `IdSource`.
- **No shared fixed resources.** No fixed ports, names or paths. Temporary folders come from the run's own folder (see below).
- **Release what you hold:** timers, processes, sockets, file handles.
- **Test at real size.** Anything that lists or loops is tested at the size it meets in use: a chat with 20,000 events, a sidebar with 300 workspaces, a diff of 5,000 files.
- **A guard proves it can fail.** A check that reads source text includes a sample it must flag.
- **Five guards watch the shape of tests** (`scripts/guards/test-shapes.ts`): tests that cannot fail, tests that mock the thing they test, stand-ins defined outside `src/test/`, real time or leaked state, and tests that cannot pass. A test cannot pass when a Testing Library query looks for text with whitespace at an end or doubled (the library trims and collapses the page's text first), or when a `vi.mock` factory leaves out a name that a module the test reaches imports (Vitest throws when that code runs; start the factory from `importOriginal()` or use `createTestContainer`). Each compares per-file counts with `scripts/guards/test-shapes-baseline.json`. A count may not rise, and the baseline must fall with every fix: run `bun scripts/guards/test-shapes.ts --write-baseline` after a fix, and `--list` to see every site. A mock that is a real seam carries `// seam: <ID> <reason>` on the line above.

## States catalogue

The catalogue draws the real app in a browser, one screen state at a time, with no Tauri, no real repository, no agent and no network. It runs the real entry (`startApp`) on the in-memory Platform over a real SQLite (sql.js), with a fixed clock and counting ids, so a state looks the same on every run.

- `pnpm --dir apps/desktop catalogue` serves it on a free port and prints `Catalogue: <url>`. That page lists every state, with a link for light and for dark.
- `bun scripts/catalogue/shots.ts [state-id ...]` starts the server, captures each state in light and dark at 1440 x 900 into `.context/shots/ours/<state-id>-<theme>.png`, writes `index.json` beside them, and stops the server. It uses the Chromium already in Playwright's cache and downloads nothing. It exits 1 when a state fails or never settles.
- On a ready pull request that touches the desktop's screens, `.github/workflows/catalogue-shots.yml` runs the same script on GitHub and uploads the PNGs as the `catalogue-shots` artefact, kept 14 days. Screens can be read that way when no browser may run on the owner's Mac.
- The parity harness reads every state the same way and compares it with Conductor's inventories: `.github/workflows/parity.yml` runs it on GitHub and uploads the gap report as the `parity-report` artefact. What it checks, and the instrument check that must pass first, are in `docs/plans/parity-harness.md`.
- A state is registered once, in `apps/desktop/src/catalogue/states/`. Its seed writes rows through the repositories and scripts the shell (`git-repo.ts`, `github.ts`) and the sidecar (`world.ts`, `live.ts`); its after-step drives the app through its own actions and real DOM events. Most states share one cast of two projects (`cast.ts`).
- The release build never contains it: `pnpm build` runs `scripts/catalogue/check-bundle.ts` on `dist`, and `scripts/catalogue/check-bundle.build.test.ts` builds the real bundle and checks it.

### Conductor's frontend on the same states (the reference run)

The owner's ruling: Conductor's own frontend runs on this Mac only, from the git-ignored `.context/` folder, with the network cut off, and is never committed, pushed or shipped. It shows each catalogue state as Conductor draws it, for a side-by-side parity check. Stage 1 answers its native calls from our catalogue's sample data; stage 2 will answer them from our real sidecar and Tauri commands.

- Our tools live in `scripts/conductor-reference/`. The bundle, the call inventory and the sample-data mapping are drawn from Conductor's code, so they stay in the main checkout's `.context/day/` (`scripts/conductor-reference/paths.ts` finds it from any worktree).
- `inventory.ts <bundle> <out.json>` lists every native call the frontend makes: Tauri commands, plugin commands, sidecar methods, events and SQL, with argument keys, the fields read from the answer and the bundle offset of each site.
- `server.ts` serves the bundle on 127.0.0.1 with `standin.ts` injected before its first module. The stand-in is `window.__TAURI_INTERNALS__`; `backend.ts` answers through the SQL plugin over sql.js, the event plugin, the sidecar tunnel and the mapping's handlers. A call nobody answers is logged and answered with an error, never a made-up value.
- `check.ts` needs no browser: it seeds every state (through `apps/desktop/src/catalogue/seeded.ts`), builds the mapped databases, prepares the frontend's own SQL on them and counts the calls the stand-in answers.
- `run.ts [state-id ...]` is the browser run: one picture per state at 1440 by 900 in dark mode, into `.context/shots/conductor-run/`, with `index.json` and `unanswered.json`. Every request to another origin is refused and listed. It is a browser run, so on the owner's Mac it waits for 08:00.
- `pnpm guards` fails when the repository holds a file named like a bundle chunk, a copy of a bundle code file, or any of the stretches of Conductor's code listed by hash in `scripts/guards/conductor-fingerprints.json` (`scripts/guards/conductor-code.ts`). `fingerprints.ts` rewrites that list from the bundle.

## A run leaves nothing behind

`pnpm test` runs through `scripts/with-run-dir.ts`. It gives the run its own folder (`$TMPDIR/conducted-runs/<run id>`, recorded with the run's process id), points `TMPDIR` at it, and removes it when the run ends. When the run ends it fails if anything is left. The next run removes folders whose recorded process is gone.

Tests that create git repos, sidecar sockets or temporary files create them under `TMPDIR`, and stop every process they start by the process id they recorded.

## Commits and pull requests

- Conventional commit subjects (`feat:`, `fix:`, `refactor:`, `docs:`). The body explains why.
- Open pull requests as drafts while working. Draft PRs run no CI. Mark a batch ready and CI runs once; GitHub tests the merge result, not just the branch.

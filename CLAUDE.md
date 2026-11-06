# Conducted

A local-first macOS app for running coding agents in parallel. Each task gets a git worktree ("workspace"), one or more chats ("sessions") with an agent, and a review flow from diff to merged pull request. It matches the local features of Conductor 0.92.1, without its team features. An optional cloud host on the user's own Cloudflare account and Claude Remote Control are planned (D018, D019, `docs/plans/cloud-and-remote.md`).

Status: scaffold. Most bodies are placeholders that throw a named error. The plan is `docs/plans/scaffold.md`; the feature list is `docs/plans/backlog.md`.

## Know first

- **Research is the spec.** Behaviour is described in `docs/research/conductor/`, starting at `structure-map.md`. Every file header cites the section it implements.
- **Behaviour, not code.** Never copy code, prompt text or assets from Conductor's app bundle or from `.context/` (extracted research material, never committed). Write in our own words. See D002 in `docs/decisions.md`.
- **Three programs:**
  - `apps/desktop/src-tauri`: the Rust shell, a thin toolbox.
  - `apps/desktop/src`: the React UI. It owns the database and runs git.
  - `packages/sidecar`: runs the agents.
- **Shared contracts:**
  - `packages/protocol`: every message between the UI and the sidecar.
  - `packages/shared`: ids, `Result`, `notImplemented`, `Clock`, the error helpers, the keyed serial queue.
  - `apps/desktop/src/platform/platform.ts`: the one door to Rust.
  - `apps/desktop/src/core/model.ts` and `api.ts`: domain types and the screen-to-service API.
    Every package depends on these, so change them deliberately.

## Where things are written down

| Topic                                                | Doc                            |
| ---------------------------------------------------- | ------------------------------ |
| Parts, dependency rules, where logic lives           | `docs/architecture.md`         |
| How code is written and tested, file header template | `docs/engineering.md`          |
| Tables, files and how long each keeps data           | `docs/data-model.md`           |
| Tokens, components, the owner's design rules         | `docs/design.md`               |
| Decisions, dated and numbered                        | `docs/decisions.md`            |
| Tauri command names                                  | `docs/plans/tauri-commands.md` |

## Hard rules

Each one fails a check when it is broken.

- **Placeholders** call `notImplemented("ID")`, `not_implemented!("ID")` or `not_implemented "ID"`, with the ID in the backlog. No `TODO` comments. A finished feature removes its placeholders and sets its row to `done` (`pnpm stubs`, `pnpm guards`).
- **Every source file opens with a header comment**; files with placeholders name their `@feature` (`pnpm guards`).
- **Dependency rules:** only `src/platform/` imports Tauri, screens never touch the database, core never imports screens, packages never import the app (Biome, proven by `scripts/guards/boundaries.test.ts`).
- **Promises are always handled** (Biome `noFloatingPromises`).
- **Applied migrations are never edited.** Add a new one and lock it (`pnpm guards`).
- **Every table states its lifetime** (`pnpm guards`).
- **Version files agree** (`pnpm guards`).
- **Files are trashed, never deleted with `rm`** in scripts (`pnpm guards`).
- **The Rust command list, the program allowlist and the migration list match the TypeScript that uses them** (`pnpm guards`). A command with no handler carries its backlog id in a comment in `COMMANDS`.
- **Structure baselines only shrink** (D055): `scripts/guards/structure-baseline.json` counts tests that assert placeholders, exports only tests use, and optional dependencies a composition root leaves out unmarked (`// unwired: <ID>`). A fix lowers the baseline in the same change.
- **A run leaves nothing behind:** `pnpm test` fails if anything is left in the run's temp folder.

## Commands and tests

| Command                                                                        | What                                                                             | When                               |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------- |
| `pnpm install`                                                                 | Install everything                                                               | After pulling                      |
| `pnpm typecheck`                                                               | TypeScript in every package and in `scripts/`                                    | Every change                       |
| `pnpm lint`                                                                    | Biome (lint, format, boundaries) and shellcheck                                  | Every change                       |
| `pnpm test`                                                                    | Unit tests (bun test, Vitest) inside a run-owned temp folder                     | Every change to code with logic    |
| `pnpm -r test:coverage`                                                        | Coverage of the desktop and the sidecar. Reports numbers, no thresholds          | On GitHub only (coverage workflow) |
| `pnpm guards`                                                                  | Docs, data model, migrations, headers, markers, versions, structure, test shapes | Every change                       |
| `pnpm build`                                                                   | The web UI build that ships inside the app                                       | Every change to the UI             |
| `pnpm stubs`                                                                   | Placeholders against the backlog                                                 | Every change                       |
| `pnpm check`                                                                   | All of the above, stopping at the first failure                                  | Before a PR                        |
| `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test` | Rust, in `apps/desktop/src-tauri`                                                | Every Rust change                  |
| `pnpm dev`                                                                     | Run the app (`tauri dev`, port 1420)                                             | Manual checks                      |
| `pnpm release <x.y.z> [--go]`                                                  | Dry run, or bump, check, commit and tag                                          | Releases                           |

## When tests run

Measured on GitHub's runners, 2026-11-05, about 3,700 tests. Checks run on GitHub, not on the owner's Mac.

| Moment                                     | Command                                                                                                                                         | Runs                                                                                                              | Time                                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1. Every ready pull request                | CI: `pnpm typecheck`, `biome ci`, shellcheck, `pnpm test`, the web UI build, `pnpm guards`, `pnpm stubs`; Rust `fmt`, `clippy`, `test` on macOS | everything fast, every time                                                                                       | push to verdict about 2.5 min; `pnpm test` 74 to 118 s; Rust job 72 to 75 s warm, about 4 min cold |
| 2. A pull request that touches heavy tests | none yet                                                                                                                                        | view screenshots, end-to-end on a Mac runner, real-agent contract tests (planned, `docs/plans/parallel-build.md`) | not measured                                                                                       |
| 3. The main line after each merge          | CI on push to `main`                                                                                                                            | the same as moment 1                                                                                              | the same                                                                                           |
| 4. A release                               | `pnpm release <x.y.z>` on a clean checkout                                                                                                      | all of the above, then the tag                                                                                    | not measured                                                                                       |
| 5. Coverage report                         | Coverage workflow: Vitest and `bun test` on every push to `main`; `cargo llvm-cov` on macOS only on demand                                      | line, branch and function percentages; it reports and never fails on a low number                                 | TypeScript job about 2 min; Rust job about 4 min cold                                              |

- Every test is fast today, so every run is a full run. Changed-only runs, fixture caches and shared workers wait until the suite takes over 30 seconds.
- `pnpm test` first checks the runtime: Node's major version must match `.node-version`, and Bun's minor must match `.bun-version`. Rust is pinned in `apps/desktop/src-tauri/rust-toolchain.toml`. CI reads the same files.
- A flaky test gets a root cause: no retry, no skip, no looser assertion.
- In CI every check runs even when one before it failed, so one round shows every red check. The step "Failed tests, by file" lists each failed test with its first error line, in the log and on the run's summary page (`scripts/test-report.ts`, from the JUnit reports the runners write when `CONDUCTED_TEST_REPORTS` is set).

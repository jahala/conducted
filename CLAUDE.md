# Conducted

A local-first macOS app for running coding agents in parallel. Each task gets a git worktree ("workspace"), one or more chats ("sessions") with an agent, and a review flow from diff to merged pull request. It matches the local features of Conductor 0.92.1, without its team features. An optional cloud host on the user's own Cloudflare account is built: a Mac paired with the user's Worker creates cloud workspaces by choosing the Worker in the sidebar's organisation switcher (D018, D127, `docs/plans/cloud-and-remote.md`). Claude Remote Control is built: any Claude chat can be opened in claude.ai/code or the Claude app (D019).

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
| How the project's work is run (builds, agents)       | `docs/process/decisions.md`    |
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
- **Conductor's code never enters the repo** (D002): no bundle file, copy of one, or stretch of its code (`pnpm guards`; the reference run is in `docs/engineering.md`).
- **The Rust command list, the program allowlist and the migration list match the TypeScript that uses them** (`pnpm guards`). A command with no handler carries its backlog id in a comment in `COMMANDS`.
- **Structure baselines only shrink** (D055): `scripts/guards/structure-baseline.json` counts tests that assert placeholders, exports only tests use, and optional dependencies a composition root leaves out unmarked (`// unwired: <ID>`). A fix lowers the baseline in the same change.
- **A run leaves nothing behind:** `pnpm test` fails if anything is left in the run's temp folder.

## Commands and tests

| Command                                                                        | What                                                                                                                 | When                               |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `pnpm install`                                                                 | Install everything                                                                                                   | After pulling                      |
| `pnpm typecheck`                                                               | TypeScript in every package and in `scripts/`                                                                        | Every change                       |
| `pnpm lint`                                                                    | Biome (lint, format, boundaries) and shellcheck                                                                      | Every change                       |
| `pnpm test:changed`                                                            | The tests the changes since origin/main can reach (`scripts/run-tests.ts`)                                           | While working; every PR            |
| `pnpm test`                                                                    | Every unit test (bun test, Vitest) inside a run-owned temp folder                                                    | Main, after each merge             |
| `pnpm test:macos`                                                              | The desktop tests that need macOS (`*.macos.test.ts`, a real `/bin/zsh`)                                             | Every PR, in the macOS job         |
| `pnpm test:e2e [check ...]`                                                    | The real app over a fresh folder: settings round trip, a sidebar drag, settings overflow (`scripts/e2e`)             | PRs touching the app; main nightly |
| `pnpm -r test:coverage`                                                        | Coverage of the desktop and the sidecar. Reports numbers, no thresholds                                              | On GitHub only (coverage workflow) |
| `pnpm guards`                                                                  | Docs, data model, migrations, headers, markers, versions, workflows (actionlint, shellcheck), structure, test shapes | Every change                       |
| `pnpm build`                                                                   | The web UI build that ships inside the app                                                                           | Every change to the UI             |
| `pnpm stubs`                                                                   | Placeholders against the backlog                                                                                     | Every change                       |
| `pnpm check`                                                                   | All of the above, stopping at the first failure                                                                      | Before a PR                        |
| `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test` | Rust, in `apps/desktop/src-tauri`                                                                                    | Every Rust change                  |
| `pnpm dev`                                                                     | Build the sidecar, then run the app (`tauri dev`, port 1420)                                                         | Manual checks                      |
| `pnpm release <x.y.z> [--go]`                                                  | Dry run, or check main's CI, bump, write CHANGELOG.md, commit, tag                                                   | Releases                           |

## When tests run

Measured 2026-11-11: GitHub's runners, and a Mac with 18 cores under load. About 10,600 tests in 1,062 files.

| Moment                                                      | Command                                                                                                                                                     | Runs                                                                                                                                          | Time                                                                                                                                |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1. Every ready pull request                                 | CI: `pnpm test:changed --since HEAD^1`, typecheck, Biome, shellcheck, build, guards, stubs; macOS job: Rust `fmt`, `clippy`, `test`, then `pnpm test:macos` | the tests the change can reach, plus the money, data-loss and security tests that always run; everything when the run-everything list says so | a leaf screen change: 86 files, 26 s on the Mac. Push to verdict before the selection: 7 to 12 min; with it: not yet measured on CI |
| 2. A pull request that touches what the heavy tests measure | `catalogue-shots.yml` and `parity.yml` (path filters); `pnpm test:macos`                                                                                    | browser screenshots and checks; the shim in a real zsh                                                                                        | `pnpm test:macos` about 1 s                                                                                                         |
| 3. The main line after each merge                           | CI on push to `main`: `pnpm test`                                                                                                                           | every test                                                                                                                                    | tests 572 s on GitHub (desktop 514 s, scripts 46 s, sidecar 19 s), 130 s on the Mac; job 12 min                                     |
| 4. A release                                                | `pnpm release <x.y.z>` on a clean checkout of origin/main, then push the tag                                                                                | main's green CI for that commit, then the bump, changelog, commit and tag; the tag's CI run builds, signs, notarises, attests and publishes   | not measured                                                                                                                        |
| Coverage report                                             | Coverage workflow on every push to `main`; `cargo llvm-cov` on macOS on demand                                                                              | line, branch and function percentages; never fails on a low number                                                                            | TypeScript job about 2 min; Rust job about 4 min cold                                                                               |

- The selection's rules live in one file, `scripts/test-rules.ts`: the run-everything list, the folders tests read whole, and the tests that always run. `pnpm test:changed --dry-run` prints what would run. How it picks is in `docs/engineering.md` (Which tests run).
- Replayed over main's last 80 merges: 18 would run everything (migrations, manifests, the lockfile, `ci.yml`). A change to desktop code selects a median of 425 of the 830 desktop files, because most tests reach the real container; other changes select a few files.
- When main's full run fails on a test a pull request skipped, fix the defect and the rule that let it through.
- `pnpm test` and `pnpm test:changed` first check the runtime: Node's major version must match `.node-version`, and Bun's minor must match `.bun-version`. Rust is pinned in `apps/desktop/src-tauri/rust-toolchain.toml`. CI reads the same files.
- `pnpm test:e2e` runs in the `e2e` workflow on GitHub's macOS runners, on pull requests that touch what the app is built from and nightly on main; never on a runner on this Mac, because the repository is public. Measured 2026-11-12 over four runs with a warm Cargo target: building the test app 12 to 34 s, `round-trip` 176 to 184 s, `drag` 5 s (once 36 s: most likely one of its launches met the 30 s stall of #632, which a lost first-screen probe now turns into 2 s), `overflow` 5 s, 210 to 240 s in all. How it works is in `docs/engineering.md` (End-to-end tests in the real app).
- A flaky test gets a root cause: no retry, no skip, no looser assertion.
- In CI every check runs even when one before it failed, so one round shows every red check. The step "Failed tests, by file" lists each failed test with its first error line, in the log and on the run's summary page (`scripts/test-report.ts`, from the JUnit reports the runners write when `CONDUCTED_TEST_REPORTS` is set).

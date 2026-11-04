# Conducted

A local-first macOS app for running coding agents in parallel. Each task gets a git worktree ("workspace"), one or more chats ("sessions") with an agent, and a review flow from diff to merged pull request. It matches the local features of Conductor 0.92.1, without its cloud and team features.

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
  - `packages/shared`: ids, `Result`, `notImplemented`, `Clock`.
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
- **A run leaves nothing behind:** `pnpm test` fails if anything is left in the run's temp folder.

## Commands and tests

| Command                                                                        | What                                                         | When                            |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------- |
| `pnpm install`                                                                 | Install everything                                           | After pulling                   |
| `pnpm typecheck`                                                               | TypeScript in every package and in `scripts/`                | Every change                    |
| `pnpm lint`                                                                    | Biome (lint, format, boundaries) and shellcheck              | Every change                    |
| `pnpm test`                                                                    | Unit tests (bun test, Vitest) inside a run-owned temp folder | Every change to code with logic |
| `pnpm guards`                                                                  | Docs, data model, migrations, headers, markers, versions     | Every change                    |
| `pnpm stubs`                                                                   | Placeholders against the backlog                             | Every change                    |
| `pnpm check`                                                                   | All of the above, stopping at the first failure              | Before a PR                     |
| `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test` | Rust, in `apps/desktop/src-tauri`                            | Every Rust change               |
| `pnpm dev`                                                                     | Run the app (`tauri dev`, port 1420)                         | Manual checks                   |
| `pnpm release <x.y.z> [--go]`                                                  | Dry run, or bump, check, commit and tag                      | Releases                        |

Measured times are added once the suite is complete.

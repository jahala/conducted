# Conducted

A local-first macOS app for running coding agents in parallel. Each task gets a git worktree ("workspace"), one or more chats ("sessions") with an agent, and a review flow from diff to merged pull request. It matches the local features of Conductor 0.92.1, without its cloud and team features.

Status: scaffold. Most bodies are placeholders that throw a named error. See the plan in `docs/plans/scaffold.md` and the feature list in `docs/plans/backlog.md`.

## Know first

- **Research is the spec.** Behaviour is described in `docs/research/conductor/`. Start at `structure-map.md`. Every file header cites the section it implements.
- **Behaviour, not code.** Never copy code, prompt text or assets from Conductor's app bundle or from `.context/` (extracted research material, never committed). Write specs and code in our own words.
- **Three programs:**
  - `apps/desktop/src-tauri`: the Rust shell, a thin toolbox.
  - `apps/desktop/src`: the React UI. It owns the database and runs git.
  - `packages/sidecar`: runs the agents.
- **Shared contracts:**
  - `packages/protocol`: Zod schemas for every message between UI and sidecar.
  - `packages/shared`: ids, Result, notImplemented, Clock.
  - `apps/desktop/src/platform/platform.ts`: the one door to Rust.
  - `apps/desktop/src/core/model.ts`: domain types.
    Change these deliberately: every package depends on them.

## Layout

```
apps/desktop/src/        platform/ app/ core/{db,services,git,sidecar,status,registries} features/ ui/
apps/desktop/src-tauri/  src/*.rs, migrations/*.sql, capabilities/
packages/protocol/       rpc.ts events.ts agent-message.ts interactions.ts live-state.ts ...
packages/sidecar/src/    rpc/ session/ process/ outbox/ checkpoints/ prompt/ shell-env/ runners/ tools/ models/
bin/                     checkpointer.sh git-busy-check.sh spotlighter.sh
scripts/                 check-stubs.ts, conductor-re/ (research extraction tools)
```

## Rules

- **Placeholders.** An unbuilt body calls `notImplemented("ID")` (TS), `not_implemented!("ID")` (Rust) or `not_implemented "ID"` (shell). The ID must be in `docs/plans/backlog.md`. No `TODO` comments, no fake data, no silent defaults. When a feature is finished, remove its placeholders and set its row to `done` in the same change.
- **File header.** Every source file starts with:

  ```
  /**
   * @feature CHAT-03 Steer a running turn
   * Owns: <what this file is responsible for, one sentence>
   * Behaviour: <research file and section>
   * Must handle: <edge cases, races, state transitions>
   * Test first: <the first failing test to write>
   */
  ```

  Mark our own design choices with "Our design choice:" so they are not mistaken for observed behaviour.
- **Boundaries (lint-enforced):** only `src/platform/` imports `@tauri-apps/*`. `features/` and `ui/` never import `core/db`.
- **Architecture:** side effects at the edge, dependencies passed as parameters, failure in the return type (`Result`), only the newest async result changes state.
- **Data lifetime:** every table or file that grows states what it keeps, for how long, and what removes the rest. Never edit an applied migration; add a new one.
- **Deleting files:** the app moves user files to the Trash. Scripts use `trash`, never `rm`.

## Commands and tests

| Command                                     | What                                     | When                            |
| ------------------------------------------- | ---------------------------------------- | ------------------------------- |
| `pnpm install`                              | Install everything                       | After pulling                   |
| `pnpm typecheck`                            | TypeScript in every package              | Every change                    |
| `pnpm lint`                                 | Biome lint, format and boundary rules    | Every change                    |
| `pnpm test`                                 | Unit tests (bun test, vitest in desktop) | Every change to code with logic |
| `cargo check` (in `apps/desktop/src-tauri`) | Rust                                     | Every Rust change               |
| `pnpm stubs`                                | Placeholders vs backlog                  | Every change                    |
| `pnpm check`                                | All TypeScript checks above              | Before a PR                     |
| `pnpm dev`                                  | Run the app (`tauri dev`, port 1420)     | Manual checks                   |

Tests never mock what they test, wait for events instead of sleeping, and leave nothing behind (temp repos and folders are removed by the test that made them). Measured times will be added once the suite exists.

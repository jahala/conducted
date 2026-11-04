# Plan: scaffold a local-only app with Conductor's features

Status: proposed, waiting for a go (2026-11-04).
Source of truth for behaviour: [docs/research/conductor/structure-map.md](../research/conductor/structure-map.md) and the docs it links.

## Goal

Create the full project skeleton for a desktop app that matches Conductor's local features one to one. Every folder and file that the finished app needs exists. Each file holds its real interface (types, function signatures, component props) and a header comment that says what the file must do, which research section describes the behaviour, and what test proves it. Bodies are stubs.

## Definition of done

1. Every feature row in the structure map's feature inventory (minus the cloud list) has a backlog ID and at least one file that owns it.
2. The project installs and passes its checks: `pnpm install`, `pnpm typecheck`, `pnpm lint`, `cargo check`, and `pnpm test` (a few real tests for the code that is real, see below).
3. `pnpm tauri dev` opens a window with the real app shell (sidebar, center, right panel) showing designed empty states.
4. `pnpm stubs` lists every remaining stub by backlog ID. It fails if a stub has no backlog entry, or a backlog entry has no stub and is not marked done.

## The stubs are deliberate

A scaffold is made of placeholders, and this one is approved as such. To keep them visible, every placeholder throws one named error:

```ts
// packages/shared/src/not-implemented.ts
export class NotImplemented extends Error {
  constructor(readonly featureId: string) { super(`Not implemented: ${featureId}`) }
}
export const notImplemented = (featureId: string): never => { throw new NotImplemented(featureId) }
```

Rust uses one matching error variant. No silent defaults, no fake data, no `TODO` comments. The stub check (definition of done, step 4) is the guard.

## What is real code in the scaffold, and what is a stub

| Real now | Stub with a spec |
|---|---|
| Monorepo, build, lint, typecheck and test config | All service bodies |
| Tauri config, plugin list, capability file, window setup | All Tauri command bodies except a health check |
| The shared protocol: Zod schemas for every RPC method, event and live state | All sidecar logic (session manager, runners, tools) |
| Our neutral agent-message schema and canonical tool names | Agent translators |
| The Platform interface (the one door to Rust) | Its Tauri implementation, except the health check |
| The database schema as migration 0001 | Repository query bodies |
| The command and settings registries (entries, keys, labels) | Their handlers |
| App shell layout, routes and empty states | Feature components beyond their props and layout boxes |
| The stub check script | |

## Scope

In: everything local in the structure map. That is projects and worktree workspaces; chats with Claude Code, Codex, Cursor, OpenCode and Pi; queue, steer, cancel, questions, approvals and plan mode; checkpoints, revert and fork; diff review and comments; git and PR flows through `gh`; checks; run scripts, Spotlight, ports and browser preview; terminals; file tree, search and editor; command palette, shortcuts and settings; notifications, updates, dictation and diagnostics. Linear issue linking is included because it runs on the client.

Out: organizations, sign-in to a Conductor-style service, cloud workspaces and sandboxes, file sync, cloud port forwarding, cloud desktop, routines, workspace chat, pokes, profiles, team artifacts, `RunLocalCommand`, computer admin tools, the `conductor` cloud CLI, the Piccolo agent, iPhone remote control (it needs a hosted relay), and PostHog and Sentry.

## Decisions

1. **Same stack as Conductor**: Tauri 2 with a thin Rust shell, React with TanStack Router and Query and zustand, and a TypeScript sidecar on Bun. The research maps onto it file by file, and the agent SDKs are TypeScript.
2. **Our own neutral message format.** Every runner translates into it, Claude included. Conductor borrowed Claude's format and then needed a second renderer for Codex.
3. **One event log.** A session's history lives in `session_events` only. There is no second message table, and pruning is defined in migration 0001 (data lifetime from day one).
4. **The sidecar writes the backup before sending** each event (a real write-ahead log). Conductor's outbox is best-effort.
5. **No cloud seam.** Conductor's "host" abstraction exists for cloud machines. A local-only app does not need it. If cloud work is ever wanted, it gets its own plan.
6. **Licensed or open libraries only.** The chat list uses an open-source virtualiser instead of the commercial `VirtuosoMessageList`. Every dependency's licence is checked when it is added.
7. **Agent programs come from the user's machine first.** The app finds installed `claude`, `codex`, `cursor-agent`, `opencode` and `pi` on the captured login-shell `PATH`. A download manager like Conductor's stays a stub with a spec, because it needs a hosted release feed.
8. **Behaviour, not code.** Nothing is copied from Conductor's bundles: no code, no prompt text, no assets (city lists, sounds, videos, icons). Specs describe what happens, in our words.

## Repository layout

```
app/                         (root, name to be decided)
├── package.json  pnpm-workspace.yaml  tsconfig.base.json  biome.json
├── CLAUDE.md                project brief and test strategy
├── docs/plans/backlog.md    every feature ID, owner files, acceptance test
├── bin/                     our own checkpointer.sh, git-busy-check.sh, spotlighter.sh
├── scripts/check-stubs.ts
├── packages/
│   ├── shared/              notImplemented, ids, Result type, time and id sources
│   ├── protocol/            Zod: rpc methods, app→sidecar, sidecar→app, session events,
│   │                        live state, session config, agent message format, tool names
│   └── sidecar/
│       └── src/
│           ├── main.ts      modes: sidecar, logger
│           ├── rpc/         socket server, NDJSON framing, method table
│           ├── session/     manager, per-session queue, turn, steering, interactions, live state
│           ├── process/     leases, idle stop, warm pool
│           ├── outbox/      write-ahead event log, ack, replay
│           ├── checkpoints/ calls bin/checkpointer.sh, diff summary
│           ├── prompt/      first-message instruction, mentions, attachments, preferences
│           ├── shell-env/   login-shell capture, secret stripping
│           ├── runners/     runner contract; claude/, codex/, cursor/, acp/ (opencode, pi)
│           ├── tools/       MCP tools for agents + socket bridge for codex and acp
│           └── models/      model catalog, harness versions, auth flows
└── apps/desktop/
    ├── src-tauri/
    │   ├── Cargo.toml  tauri.conf.json  capabilities/default.json
    │   ├── migrations/0001_init.sql
    │   └── src/  lib.rs menu.rs shell.rs files.rs file_search.rs pty.rs
    │           terminal_history.rs sidecar.rs binaries.rs keychain.rs attachments.rs
    │           notifications.rs speech.rs updater.rs resource_usage.rs db.rs logger.rs
    └── src/
        ├── main.tsx
        ├── platform/        Platform interface + Tauri implementation (the only Tauri importer)
        ├── app/             router, routes, AppShell, providers, startup sequence
        ├── core/
        │   ├── container.ts service wiring
        │   ├── db/          one repository module per table
        │   ├── services/    workspace, repo, git, github, checkpoint, file-diff, sessions,
        │   │                composer, settings, sections, favorite-models, run-scripts,
        │   │                spotlight, ports, terminals, notifications, updates, mcp, linear
        │   ├── git/         exec, command catalogue, worktree, status, diff
        │   ├── sidecar/     RPC tunnel, handlers for sidecar requests
        │   ├── status/      workspace status as a pure function
        │   └── registries/  commands and shortcuts, settings
        ├── features/        sidebar, home, dashboard, create-workspace, workspace (header,
        │                    tabs, splits), chat (list, turns, tool cards, approvals, questions,
        │                    plan review, progress, context wheel), composer, git-panel, diff,
        │                    file-viewer, pr, terminal, scripts-panel (setup, run, ports),
        │                    browser-preview, palette, settings, onboarding, diagnostics, open-in
        └── ui/              design system components and tokens
```

The ESLint-style boundary rules from Conductor are copied as Biome rules or a small script: only `platform/` may import `@tauri-apps/*`, and `features/` may not import `core/db` directly.

## File header convention

```ts
/**
 * @feature CHAT-03 Steer a running turn
 * Owns: pushing a user message into the live turn and tracking when the agent has read it.
 * Behaviour: research/conductor/sessions-and-chats.md, "While the agent is working".
 * Must handle: no active turn (fall back to queue), agent cannot steer, cancel during steer.
 * Test first: a steer sent mid-turn appears in pendingSteerIds until the agent consumes it.
 */
```

## Build order and checkpoints

1. **Foundations** (done by me, one pass): root config, `shared`, `protocol`, the Platform interface, the container shape, migration 0001, the runner contract, the backlog with IDs, the stub check. Checkpoint: typecheck and stub check pass. Every later step builds on these files, so they are written once and reviewed before anything else starts.
2. **Five parallel workers**, each in its own folders, all importing the foundation contracts:
   - Rust shell (`src-tauri/`)
   - Sidecar core and runners (`packages/sidecar/`)
   - UI core (`core/`, `platform/` implementation, `app/`)
   - UI features: sidebar, workspace, chat, composer, palette
   - UI features: git panel, diff, files, PR, terminal, scripts, settings, onboarding, diagnostics, and the UI kit
   Checkpoint: each worker's folder typechecks on its own.
3. **Integration and review** (me): full checks, stub check, open the window and screenshot the shell, re-read every file against the backlog and research.

## Kill criteria

- The scaffold fails if a feature in the structure map has no owning file, or if the full checks cannot pass.
- It also fails if the stub headers drift from the research. In the review, a random sample of 20 headers is checked against the cited sections. If more than 2 are wrong, the affected area is redone.

## Risks and how the plan handles them

- **Inconsistent interfaces between workers.** All cross-folder types live in `protocol`, `shared` and the Platform interface, which are written first.
- **Fiction in the comments.** Every header cites a research section. Our own design choices (decisions 2 to 7) are marked as such, so they are not confused with observed behaviour.
- **A big skeleton can lock in a design too early.** The scaffold fixes the contracts and folders, not the internals. After the scaffold, the first build step should be a thin working slice: add a repo, create a worktree, chat with Claude, see the diff. It proves the contracts before the rest is filled in.
- **Scale.** Roughly 300 to 400 files. The work is split by folder, so workers never edit the same file.

## Needed from Jan

- A working name for the app. It is used for the bundle id, package names and window title, and can be changed later.
- A go.

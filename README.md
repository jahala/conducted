# Conducted

**Run several coding agents side by side, each in its own copy of your repo.** Conducted is a macOS app for working with Claude Code, Codex, Cursor, OpenCode and Pi in parallel. Every task gets its own git worktree and branch, its own chats with an agent, and a review flow from the first diff to a merged pull request.

> **Status: scaffold.** The structure of the whole app is in place, and it does not run agents yet. Every feature exists as typed code with a written spec and a placeholder body, tied to an item in the [backlog](docs/plans/backlog.md). This is the moment to help build it.

## What it will do

- **Workspaces.** One click creates a git worktree on a new branch, runs your setup script, and gives it a free port. Work on ten things at once without them touching each other.
- **Chats with any agent.** Send a message, queue the next one, or steer the agent mid-turn. Answer its questions, approve its plan, cancel at any time.
- **Snapshots of every turn.** Each turn is saved as a hidden git ref, so you can revert to any point in a chat or fork it.
- **Review.** See the diff by branch, by commit or by turn. Leave comments for the agent, then let it fix them.
- **Pull requests.** Create, check, fix failing checks and merge, all through `gh`.
- **Run and preview.** Start your dev server or tests per workspace, open a browser preview, or try the changes in your main checkout with Spotlight.
- **Terminals, file search, a command palette** and keyboard shortcuts for everything.

It runs locally and needs no account. The agents run with your own installed tools and subscriptions.

Planned next ([plan](docs/plans/cloud-and-remote.md)): cloud workspaces that keep working while your Mac sleeps, on your own Cloudflare account, and opening any Claude chat on your phone through Claude's Remote Control.

## How it is built

```
Rust shell (Tauri 2)   windows, terminals, shell commands, Keychain, notifications
   │  Tauri commands
React UI               every screen; owns the SQLite database and runs git
   │  JSON-RPC over a Unix socket
Sidecar (Bun)          one process per active chat: Claude Agent SDK, Codex app-server, ACP
```

Read [docs/architecture.md](docs/architecture.md) for the parts and their rules, and [docs/decisions.md](docs/decisions.md) for why it is built this way.

## Build it

You need macOS, [Rust](https://rustup.rs), [Node.js](https://nodejs.org) LTS, [pnpm](https://pnpm.io) 9 and [Bun](https://bun.sh).

```bash
git clone https://github.com/jahala/conducted
cd conducted
pnpm install
pnpm check      # typecheck, lint, tests, guards, placeholders against the backlog
pnpm dev        # opens the app
```

## Help build it

1. Pick an item from the [backlog](docs/plans/backlog.md). Priority 1 items make up the first working version.
2. Every file that belongs to it carries its id (`@feature CHAT-03`) and a header that says what to build, which part of the research describes it, and which test to write first.
3. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/engineering.md](docs/engineering.md). Open a draft pull request early.

## Where the spec comes from

Conducted rebuilds the local features of [Conductor](https://conductor.build), a commercial app for running coding agents in parallel. The research in [docs/research/conductor/](docs/research/conductor/structure-map.md) describes how Conductor behaves. Conducted's code, text and assets are its own: nothing is copied from Conductor ([decision D002](docs/decisions.md)). Conducted is not affiliated with Conductor or its makers.

## Support

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/jahala)

## License

MIT

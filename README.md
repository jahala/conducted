# Conducted

**Run a team of coding agents on your Mac.** Conducted gives every task its own git worktree and branch, its own chats with an agent, and one path from the first diff to a merged pull request. Ten agents can work on one repository at once without touching each other's files.

It drives the agents you already use: Claude Code, Codex, Cursor, OpenCode and Pi. They run on your machine, with your own subscriptions and keys. Conducted adds the workspace around them: isolation, review, snapshots of every turn, and the git and GitHub work that follows.

> **Status: pre-alpha.** The architecture, the data model and a written spec for every feature are in place, and the features are being built. It does not run agents yet. Progress is tracked in the [milestones](https://github.com/jahala/conducted/milestones).

## How a task flows

1. **Create a workspace.** Pick a repository and describe the task, or start from a branch, a pull request or an issue. Conducted makes a worktree on a new branch, copies your `.env` files, runs your setup script and reserves a port.
2. **Work with the agent.** Chat with any of the five agents. While it works, queue the next message or steer it mid-turn. Answer its questions and approve its plan from cards in the chat. Every turn is saved as a snapshot, so you can revert any turn, or fork the chat from it.
3. **Review the change.** Read the diff by branch, by commit or by turn. Leave comments on lines, and send them to the agent to fix. Run your dev server or tests in the workspace, and open a preview in the app.
4. **Ship it.** Create the pull request, watch its checks, send failing checks back to the agent, and merge, all from the same panel. Archiving the workspace removes the worktree and keeps its history.

## What is in it

| Area           | What you get                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workspaces     | One worktree and branch per task, setup and archive scripts, a port each, linked folders, a sidebar grouped by status or project, sections and pins                            |
| Chats          | Several chats per workspace as tabs and split panes, any agent and model per chat, queue and steer, questions and plan approval, a progress tracker, context and cost per turn |
| Remote Control | Open any Claude chat in claude.ai/code or the Claude app to follow it, send follow-ups and answer approvals while it runs on your Mac                                          |
| Snapshots      | A hidden git ref before and after every turn: revert to a turn, fork a chat, see what each turn changed                                                                        |
| Review         | Changed files by scope, a split or unified diff, review comments for the agent, file tree, quick open, search in files, an editor and previews                                 |
| Git and GitHub | Commit, push and pull; create, check, fix and merge pull requests; stacked PRs; Linear and GitHub issues as context                                                            |
| Run and test   | Run scripts per workspace, terminals, port detection, an in-app browser preview, and Spotlight to try changes in your main checkout                                            |
| The rest       | A command palette, keyboard shortcuts for everything, notifications, dictation, and settings per user and per repository                                                       |

## Why

Coding agents are good enough to work in parallel, but a terminal per agent does not scale. Agents collide in one checkout, their sessions get lost, and reviewing their work means switching tools. Conducted keeps each task isolated and reviewable, and keeps the history of every turn, so you can run many agents and still know what each one did.

## What it does not do

- It does not include an agent. It drives the agent programs you install, or downloads their official releases for you.
- It does not need an account or a server. Everything runs on your Mac.
- It does not send your code anywhere except to the agent you chose.
- It runs on macOS only.

## Coming next

- **Cloud workspaces on your own Cloudflare account,** so agents keep working while your Mac sleeps. You deploy it to your account; there is no hosted service.

It starts with a small test of the idea, described in [docs/plans/cloud-and-remote.md](docs/plans/cloud-and-remote.md).

## How it is built

```
Rust shell (Tauri 2)    windows, terminals, shell commands, Keychain, notifications, updates
   │  Tauri commands
React UI                every screen; owns the SQLite database and runs git and gh
   │  JSON-RPC over a Unix socket
Sidecar (Bun)           one process per active chat: Claude Agent SDK, Codex app-server, ACP
```

The parts and their rules are in [docs/architecture.md](docs/architecture.md), the reasons in [docs/decisions.md](docs/decisions.md).

## Build from source

You need macOS, [Rust](https://rustup.rs), [Node.js](https://nodejs.org) 26, [pnpm](https://pnpm.io) 9 and [Bun](https://bun.sh). The exact versions are pinned in `.node-version`, `.bun-version` and `rust-toolchain.toml`.

```bash
git clone https://github.com/jahala/conducted
cd conducted
pnpm install
pnpm dev      # opens the app
pnpm check    # typecheck, lint, tests, guards
```

## Help build it

Every feature has an id in the [backlog](docs/plans/backlog.md), for example `CHAT-03 Steer a running turn`. The files that own a feature carry its id in their header, with what to build, the research behind it, and the first test to write. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/engineering.md](docs/engineering.md), and open a draft pull request early.

## Where the spec comes from

Conducted rebuilds the local features of [Conductor](https://conductor.build), a commercial app for running coding agents in parallel. The research in [docs/research/conductor/](docs/research/conductor/structure-map.md) describes how Conductor behaves. Conducted's code, text and assets are its own; nothing is copied from Conductor ([decision D002](docs/decisions.md)). Conducted is not affiliated with Conductor or its makers.

## Support

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/jahala)

## License

MIT

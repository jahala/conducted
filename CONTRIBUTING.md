# Contributing

Thanks for your interest. Every feature has an id in [docs/plans/backlog.md](docs/plans/backlog.md), for example `CHAT-03 Steer a running turn`. The files that own a feature carry its id in their header, with what to build, the research behind it, and the first test to write. A row that is not `done` yet is the most useful thing to pick up.

## Set up

You need macOS, [Rust](https://rustup.rs), [Node.js](https://nodejs.org), [pnpm](https://pnpm.io) and [Bun](https://bun.sh). The exact versions are pinned in `.node-version`, `.bun-version`, `package.json` and `apps/desktop/src-tauri/rust-toolchain.toml`; `pnpm test` checks them first.

```bash
pnpm install
pnpm dev      # builds the sidecar and opens the app
pnpm check    # typecheck, lint, tests, build, guards, placeholders
```

How the parts fit together is in [docs/architecture.md](docs/architecture.md), and how code is written and tested in [docs/engineering.md](docs/engineering.md).

## Workflow

1. Fork, branch, change.
2. Pick a backlog id. Write the failing test named under "Test first" in the file header, then make it pass.
3. Remove the feature's placeholders and set its backlog row to `done` in the same change.
4. Run the gates locally:

   ```bash
   pnpm install
   pnpm check                     # typecheck, lint, tests, placeholders vs backlog
   cd apps/desktop/src-tauri
   cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
   ```
5. Open a PR as a draft while you work. Mark it ready when the gates pass; CI runs on ready PRs.

## What helps

- **Small PRs.** One backlog id, or a few related ones.
- **Conventional commits.** `feat: ...`, `fix: ...`, `refactor: ...`, `docs: ...`.
- **A test.** Features need at least one; bug fixes need a regression test.
- **Plain comments.** Short sentences that say what the code does and why.

## Code style

See [CLAUDE.md](./CLAUDE.md) for the layout, the file header, and the rules the linter enforces (only `src/platform/` talks to Tauri; screens never read the database).

## Bigger changes

Changes to the shared contracts (`packages/protocol`, `packages/shared`, `apps/desktop/src/platform/platform.ts`, `apps/desktop/src/core/{model,api}.ts`) touch every part of the app. Open an issue first so we can agree on the shape.

## License

By contributing, you agree your work is licensed under the project's [MIT License](./LICENSE).

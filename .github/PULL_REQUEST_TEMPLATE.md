## Summary

<!-- One paragraph: what changed and why. Name the backlog ids it moves to done. -->

## Test plan

<!-- How to verify this works. CI runs the same checks on every ready PR. -->

- [ ] `pnpm check` (typecheck, lint, tests, placeholders vs backlog)
- [ ] `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test` in `apps/desktop/src-tauri`
- [ ] Backlog rows for finished features set to `done`

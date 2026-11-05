# Test quality review: Rust shell, scripts, CI and missing layers

Snapshot: commit `808d632` of `slice2/step-1` (slice 1 plus slice 2 step 1, CI not run on step 1). Nothing was run. Everything below comes from reading, `rg`, `jq`, `gh`, the CI logs of recent runs and the coverage files.

## 1. Summary

Files read:

- Rust shell: 8 files with tests (`lib.rs`, `shell.rs`, `pty.rs`, `sidecar.rs`, `files.rs`, `file_search.rs`, `navigation.rs`, `binaries.rs`, 161 `#[test]` functions), plus the 15 Rust files that hold only placeholders or helpers (`process_group.rs`, `error.rs`, `db.rs`, `keychain.rs` and others).
- `bin/`: 3 scripts. Their tests live in `packages/sidecar/src/checkpoints` (read for the script behaviour only).
- `scripts/`: 9 test files, 12 sources, `release.ts`, `issues/sync.ts`, `release/bundle.ts`, `conductor-re/`.
- `.github/workflows/ci.yml`, `dependency-review.yml`, `dependabot.yml`, and CI step timings from `gh run view`.
- For part 3: `tauri.ts` against `lib.rs`, `platform/contract.ts`, `test/sqlite.ts`, the hardening reports of slice 1, the whole backlog.

Verdicts for the 19 test files in my area: **REAL 11, WEAK 8, THEATER 0**. Two single tests inside WEAK files are theater (listed in section 3).

| Group | REAL | WEAK |
| --- | --- | --- |
| Rust (8) | `navigation.rs`, `lib.rs` | `shell.rs`, `pty.rs`, `sidecar.rs`, `files.rs`, `file_search.rs`, `binaries.rs` |
| bin script tests (2) | `checkpointer.test.ts`, `git-busy-check.test.ts` | none |
| scripts (9) | `check-runtime`, `check-stubs`, `with-run-dir`, `boundaries`, `issues/model`, `node-gate`, `plan-batches` | `guards.test.ts`, `overnight/drive.test.ts` |

No test file exists for `release.ts`, `issues/sync.ts`, `guards/run.ts`, `scripts/conductor-re/*` and `spotlighter.sh`.

Three worst problems:

1. **The Tauri command layer is never run.** All 53 `#[tauri::command]` functions are tested, if at all, through their inner helpers. There is no mock app (no `tauri::test`, no `features = ["test"]`). The result is already visible: `programs_verification_errors` is defined and called by the TypeScript Platform but is not in `generate_handler!`, and `xcodebuild` and `osascript` are sent through `shell.run` by `core/git/xcode-license.ts` but are not in `ALLOWED_PROGRAMS`. Both are the same class as "the dispatcher was never mounted", and both are live in this snapshot.
2. **Process-group kill is only half tested.** `process_group::terminate_group` is the one kill routine behind cancel, timeout, sidecar shutdown and the login-shell capture. The measured coverage shows its SIGKILL line (`process_group.rs:50`) never ran. Deleting it fails no test.
3. **Seams are covered by stand-ins, not by the real thing.** The "Tauri" Platform never runs the PLAT-01 contract (only the in-memory one does, `memory.test.ts:62`). Migrations only run from an empty database through `node:sqlite`, never through the real migrator, and nothing checks that `db.rs` lists every `.sql` file. The shell-script tests run on Ubuntu only, but the scripts ship to macOS.

Judgement: the Rust helpers and the shell scripts are tested with care. They use real processes, real git repos and real PTYs, and the checkpointer suite is the best in the repo. What is missing is everything that joins them: the commands, the events, the supervisor, the exit watcher, the packaging. The scripts and guards mostly prove they can fail, with holes listed below. The measured numbers back this: the code that is not covered is almost exactly the command layer.

## 2. Coverage

Source: the coverage workflow's Rust artifact and `lcov.info`. It measures `main`, which is slice 1 only, so `binaries.rs`, `file_search.rs` and the tests in `lib.rs` show 0 % because main held placeholders. Branch coverage is not collected. TypeScript coverage was still being written when I looked, and it does not include `scripts/` or `bin/` anyway, so those have no measured numbers.

| File (main) | Lines | Functions | Where the gaps are |
| --- | --- | --- | --- |
| `sidecar.rs` | 63.9 % | 66.0 % | `blocking_start` and `start_process` (538-632), `start_locked`, `spawn_reader`, `spawn_supervisor` (842-980), `on_process_ended` (996-1062), the three commands (1079-1138) |
| `pty.rs` | 73.0 % | 62.5 % | `start_io_threads` (571-640), `pty_spawn` and all the commands (645-747, 788-836), `exit_details` and `signal_number` (860-881) |
| `navigation.rs` | 79.0 % | 85.7 % | `install_guard` and the shim |
| `shell.rs` | 82.5 % | 72.2 % | `shell_run`, `shell_start`, `shell_cancel`, `shell_login_env` (930-1071), background capture |
| `files.rs` | 88.9 % | 76.8 % | a few error branches; the `fs_*` command bodies |
| `process_group.rs` | 95.2 % | 100 % | line 50, the SIGKILL |
| `terminal_history.rs` | 23.3 % | 10 % | placeholder |
| Total | 69.9 % | 57.9 % | 270 of 642 functions never run |

The instrument checks out on a known case. My reading said the SIGKILL line of `terminate_group` is never reached, and the coverage file lists exactly line 50 as the only missed line of `process_group.rs`.

The least covered files that matter are `sidecar.rs` and `pty.rs`. In both, the uncovered lines are the threads and commands that carry events to the UI: `sidecar://line`, `sidecar://ready`, `sidecar://restart`, `pty://exit`.

## 3. Findings

### MUST

**M1. The Tauri command layer is never run (PLAT-36, planned, no tests).** `lib.rs:272` lists 52 commands; no test builds an app, calls one through IPC or listens for an event. Misses:
- Mutation: delete any line of `generate_handler!`. All tests pass.
- Mutation: in `shell_start` (`shell.rs:1041`), emit `shell_done(...)` directly and skip `finish_run`, so a cancel is lost. No test fails. The test that comes closest (`plat_03_a_cancelled_run_reports_shell_cancelled`, `shell.rs:1662`) re-assembles the pieces by hand in the test itself.
- Mutation: delete `if cancelled_now { terminate_group(pid) }` (`shell.rs:1058`). The unit test only checks that `set_running_pid` returns true.
- Mutation: remove the cache check in `shell_login_env` (`shell.rs:1090`), so the shell runs twice. No test calls it twice.
- The PLAT-03 "Test first" line ("start `sleep 30`, call `shell_cancel`, get `shell://done` with `shell_cancelled`") has no test of that shape.
- Fix: PLAT-36 as described in section 6, layer 3. It needs the commands to be generic over `R: Runtime` (21 of the 53 commands take a concrete `AppHandle`) and a shared `builder()` that `run()` and the tests both use, so the test mounts the very list the app mounts.

**M2. A command is defined and called but never registered; its event has no sender (PLAT-34).** `binaries.rs:177` `programs_verification_errors` has no entry in `generate_handler!` (`lib.rs:272`); `emit_verification_errors` (`binaries.rs:167`) has no caller. `tauri.ts:1017` calls the command. All 10 tests in `binaries.rs` pass because they test `verify_bundled_programs`, which is sound.
- Mutation that is already true in the code: the registration is missing. No test sees it.
- `plat_34_the_event_name_is_the_one_the_platform_listens_for` (`binaries.rs:531`) asserts a constant against the literal that the test author typed. THEATER. Mutation: rename the constant on both sides, or never emit; the test stays green.
- Fix: register the command, call `emit_verification_errors` from `setup`, and test both through the mock app. Add the static guard in section 7 (R1).

**M3. The program allowlist and the callers disagree.** `ALLOWED_PROGRAMS` (`shell.rs:977`) does not hold `xcodebuild` or `osascript`, but `core/git/xcode-license.ts:35` and `:69` run them through `shell.run`. In the real app GIT-16 ends in `shell_program_not_allowed`. The Rust tests prove that `curl` is refused. The TypeScript tests use a fake shell that accepts everything. Nothing checks the two lists against each other.
- Fix: a guard that reads the literal `program: "..."` strings in non-test TypeScript and requires each to be on the Rust list (R2). `rust-contract.test.ts` already does this style of check for the environment names, so the pattern exists.

**M4. `terminate_group`'s SIGKILL step is untested (`process_group.rs:39-50`).** Every test that goes through it uses `sleep`, which dies on SIGTERM. The only SIGTERM-ignoring test (`plat_03_quitting_kills_a_command_that_ignores_sigterm`, `shell.rs`) goes through `terminate_all`, which has its own copy of the loop (`shell.rs:292`). Two copies of one kill routine, one tested.
- Mutation: delete `let _ = signal_group(pgrp, SIGKILL);`. Coverage confirms no test reaches it. Result: a cancelled `npm run dev` that traps TERM lives forever, and the sidecar can outlive a quit.
- Fix: one test per caller class with `trap '' TERM`: `terminate_group` directly, a `shell_start` cancel, a timeout, `shutdown`. Make `terminate_all` call `terminate_group` (or the reverse) so there is one loop.

**M5. The PTY exit path and kill-with-children are untested (`pty.rs`).**
- `start_io_threads` (`:571`) has no test. It removes the session, saves history, and emits `pty://exit` once. `exit_details` and `signal_number` (`:860`, `:870`) have no test.
  - Mutation: swap `exit_code` and `signal`. No test fails.
  - Mutation: drop `.remove(&session.id)`, so a dead terminal stays in the table. No test fails.
  - Mutation: drop `session.flow.close()`, so a paused reader blocks the exit event. No test fails (the 3 MiB test pumps a `Cursor`, not a PTY).
- `plat_07_kill_signals_the_foreground_group_and_ends_the_child` (`:1273`) passes without the SIGHUP, because `killer.kill()` ends the single `sleep`. The header promise "so `npm run dev` children stop with the shell" has no test with a child in another group.
- `spawn_terminal` with zero columns or rows is untested (only `ScreenMirror::resize` is).
- Fix: a terminal test that runs `sh -c 'sleep 30 & wait'` under job control, kills it, and asserts both pids are gone. Exit mapping tests for exit 0, exit 3, SIGTERM, SIGKILL. The rest goes through the mock app (M1).

**M6. Sidecar supervision is untested and one test is theater (`sidecar.rs`).**
- `start_locked` (`:857`), the reader that turns socket lines into `sidecar://line` (`:910`), the supervisor (`:962`), `on_process_ended` and the restart loop (`:996`), and the three commands (`:1085`-`:1138`) never run in a test. 36 tests cover the parts around them.
- `plat_09_a_start_announces_ready_on_the_documented_event` (`:1569`) asserts `EVENT_READY == "sidecar://ready"`. THEATER. Mutation: delete `app.emit(EVENT_READY, ())` (`:906`). Stays green.
- Missing behaviours the header promises: two overlapping `sidecar_ensure_started` calls give one start; `sidecar_send` during a start waits; the 6th crash in a minute stops the restarts and emits `willRetry: false`; a restart waiting out its backoff does not start after `shutdown`; a line longer than 32 MiB is dropped and the relay carries on.
- Fix: a mock-app test with a fake sidecar (a small script that prints `SOCKET_PATH=` and serves a Unix socket; `nc -lU` or a few lines of `bun`) and a second test that launches the real Bun sidecar through `CONDUCTED_SIDECAR_BIN`.

**M7. File scope is proven for one command of six, and search has no scope.**
- `files.rs:589` `checked_target` is shared, and `plat_29_read_text_outside_the_roots_is_refused` (`:1249`) covers it through `read_text_checked`. Write, stat, mkdirp, read_dir and trash are not tested against an outside path. Mutation: in `mkdirp_checked` (`:626`) call `absolute_path` instead of `checked_target`. All tests pass. Same for `trash_checked` (`:645`).
- `allowed_roots` and the `fs_*` command bodies are never run; the roots come from `AppHandle`.
- `file_search.rs:402-445`: `search_list_tree`, `search_fuzzy` and `search_grep` take any folder with no scope check. Today the webview can grep `~/.ssh`. PLAT-29 says "the webview may read only listed paths". No test says whether search is meant to be inside the rule.
- `plat_29_capabilities_limit_the_opener_and_drop_the_broad_plugin_defaults` (`files.rs:1269`) searches the JSON text. It asserts that `https://*` and `http://*` are present, so it proves the scope is wide, not that a URL is refused.
- `docs/architecture.md` ("Trust boundaries") says the view may call only what `capabilities/default.json` lists. In Tauri 2, app commands are open to every window unless the build lists them in an `AppManifest`, and `build.rs` is just `tauri_build::build()`. This is from the Tauri docs; I did not launch the app to confirm. If it is true, the file-scope and program-scope checks are the only gate, and `sh`, `bash` and `zsh` are on the program list.
- Fix: a table-driven test that every `*_checked` function refuses an outside path with `fs_out_of_scope`. A decision on search scope, then a test. A launched-window test that a command outside the intended set is refused (layer 1), or an `AppManifest`.

**M8. The allowlist test pins the weak semantics.** `plat_29_allows_a_named_program_and_its_absolute_path` (`shell.rs:1718`) asserts `/opt/homebrew/bin/gh` passes because its file name is `gh`. By the same rule `/tmp/anything/git` passes, and `sh -c` runs anything. The test name promises a boundary the code does not draw.
- Fix: decide. Either the list is a mistake guard (say so in the header and drop the PLAT-29 wording), or absolute paths must resolve inside known folders and the shells leave the list. Then test the decision, including `/tmp/x/git`.

**M9. The "Tauri" Platform is a stand-in that never meets Rust.** `docs/engineering.md` says the in-memory Platform "passes the same contract test as the Tauri Platform". `runPlatformContract` is called with the real factory only for the memory Platform (`memory.test.ts:62`). `contract.test.ts` only registers the case names for "tauri" with a factory that throws. The Tauri Platform tests (`tauri-*.test.ts`) use hand-written payloads such as `{ exitCode: 0, ... }`. Rust payload shapes (`ShellOutput`, `FileStat`, `PtyChunk`, `CommandError`) have no Rust test at all; `error.rs` has none.
- Mutation: rename `#[serde(rename_all = "camelCase")]` on `ShellOutput`. Rust tests, TS tests, and the contract all pass.
- Fix: shared golden JSON files that a Rust test serialises into and a TypeScript test parses with the real schema; plus the contract run against the Tauri Platform over the mock app (layer 3).

**M10. Migrations: nothing joins the files to the app.** `db.rs:40-70` lists four migrations by hand. `test/sqlite.ts:21-24` applies every `.sql` it finds on disk to an empty in-memory `node:sqlite` database. The migrations guard (`scripts/guards/migrations.ts`) checks hashes of files.
- Mutation: add `0005_x.sql`, lock it, forget the entry in `db::migrations()`. Every test and every guard passes, and the real database never gets the table.
- Nothing runs a migration against a populated database, or through sqlx (the migrator the plugin really uses; it differs from `node:sqlite` in statement handling and SQLite version).
- Fix: a Rust test that `migrations()` equals the sorted file list with versions 1..n and `include_str!` matching the file (or a guard, R3); later a populated-database upgrade test (layer 4).

**M11. The release bundle is never built or inspected; SIDE-23 is `done` without its wiring.** `tauri.conf.json` has no `bundle.externalBin` and no `resources`. A release build ends in `sidecar_binary_missing`, and `bin/checkpointer.sh` is not shipped. The audit and `APP-16` already know. `release/bundle.ts` is all placeholders (PLAT-25, stub). CI only builds the web UI. No test fails today because none looks.
- Fix: a test that unpacks a debug-built `.app` and checks the sidecar, the `bin/` scripts, `Info.plist` keys and the entitlements (layer 1). Until then SIDE-23's row should not say `done`.

**M12. "A run leaves nothing behind" is enforced for TypeScript files only.**
- `scripts/with-run-dir.ts` looks only at files in the run's temp folder. It does not look at processes. Rust tests run outside it (`cargo test` in the Rust job; the job has no bun).
- `shell.rs` removes its fixtures at the end of each test with `.ok()` (`:1248`, `:1263`, `:1278`, `:1301`), so a failed assertion leaves the folder, and an error is swallowed. Other files use a `Drop` guard.
- Tests that start `sleep 30` clean up after the assertions (`sidecar.rs:1549`, `shell.rs` grandchild test), so a failing assertion leaves a process.
- A `TempDir` struct is copied into four test modules (`files.rs:716`, `file_search.rs:452`, `sidecar.rs:1153`, `binaries.rs:335`), and `shell.rs` has a fifth variant. Engineering says a second copy of a helper is a finding.
- Fix: one `test_support` module with `TempDir` and a `ChildGuard` that kills the group on drop; run `cargo test` under the run-dir wrapper (add bun to the macOS job) and add a leftover-process check.

**M13. The shell-script tests run on Linux, the scripts run on macOS.** Coverage logs show `checkpointer.test.ts` and `git-busy-check.test.ts` ran on `/home/runner` (ubuntu-latest). The scripts use `find -mmin`, `find -delete`, `pgrep -P`, `mktemp`, `sed`, `date -u`, and `trash`, and the `/bin/bash` on a default Mac path is version 3.2. The no-`trash` branch is tested; the real `trash` path and BSD tools are not. I did not find a breakage; I found that nothing could tell.
- Fix: run the two `bin/` test files on the macOS runner as well (the Rust job; add `setup-bun`).

**M14. Search errors stop the whole search.** `file_search.rs:156`, `:179`, `:375` turn any walk error into a failed call, and `:382` fails the whole grep on one unreadable or just-deleted file. A workspace with one permission-denied folder breaks Cmd+P and search in files. No test uses an unreadable entry. I did not run it, but reading the loop leaves no other outcome.
- Also in this file: `plat_06_fuzzy_skips_ignored_files` (`:618`) asserts `.all(...)` on the result. It passes on an empty list. Mutation: make `search_fuzzy` return `[]`. Green. `plat_06_fuzzy_match_files_ranks_and_limits` (`:601`) only checks that `alpha.ts` is first; the tie-breakers in the header (shorter path, then alphabetical) are not tested. The header claims `.git/info/exclude` and the global ignore file are honoured; neither has a test.
- Fix: assert `src/alpha.ts` is present; a three-file tie test; an unreadable-folder test (`chmod 000`) that expects the other results plus a reported skip, or a decision that the whole call should fail.

**M15. Docs that the tests contradict (fix in the same change).**
- `CLAUDE.md` "When tests run": `pnpm test` "16 to 26 s", "Every test is fast today". CI logs of 2026-11-05: `pnpm test` took 74 s on a PR run (42021891601) and 118 s on the main push (42022220232). `engineering.md` says changed-only runs wait until the suite passes 30 s. It has.
- `engineering.md`: the Platform contract claim (M9). `architecture.md`: the capabilities claim (M7).
- `CLAUDE.md`: "CI reads the same files" for Rust. `ci.yml` installs `dtolnay/rust-toolchain@stable`; the pinned `1.99.1` is picked up only because rustup reads `rust-toolchain.toml` at the first `cargo` call. It works, but it installs two toolchains.

### LATER

- **Constant tests.** `plat_04_capture_timeouts_are_five_and_three_seconds` (`shell.rs:1189`), the two event-name tests above. They pin a number or a string that is already in the source.
- **`plat_32_reports_the_cpu_this_build_was_made_for`** (`lib.rs:363`) repeats the `cfg!` expression of the function. It catches a one-sided edit only. The unexpected-version branch of `read_os_version` has no test because parsing sits inside the function that runs `sw_vers`.
- **Fake login shell.** `FIXTURE_SHELL` (`shell.rs:1214`) stands in for `zsh -ilc`. The real `/bin/zsh -ilc` capture (stderr noise, job-control warnings, `env -0` on macOS) is never run, and it exists on the macOS runner. Add one test with an empty `ZDOTDIR`.
- **`repair_process_path`** (`shell.rs:955`) writes the process PATH through `unsafe set_var`; only `path_to_repair` is tested.
- **Hand-written base64** (`pty.rs:886`) has five vectors. Add `foob`, `fooba`, `foobar` and bytes above 0x7F, or use the `base64` crate.
- **Blocking PTY reads with no timeout** in `pty.rs` tests (`:1181`, `:1221`). A child that never prints would hold the 30-minute job.
- **Fixed sleeps.** The 500 ms wait in `plat_04_a_capture_that_outlives_its_timeout_is_killed` proves a negative by time. It can only fail in the right direction, but it is a fixed wait.
- **Real size in Rust.** Limits are tested at 1, 2 and 1024 (`collect_tree(root, 1)`, `drive_with_limit(..., 1024)`). The real limits (200,000 entries, 64 MiB of output, 32 MiB line, 10,000 scrollback lines) are never approached.
- **Writes through a symlink after the scope check** use the original path (`checked_target` returns the unresolved path). No race test. Low priority.
- **`boundaries.test.ts`** writes probe files into the real source folders. A parallel typecheck, vitest or biome run can see them. It also lacks probes for `features → @tauri-apps`, `platform → features/ui/app`, `protocol → apps` and relative-path escapes. Its "no probe files remain" test skips files of its own pid, so it cannot catch its own leak.
- **`guards.test.ts`** has no sample for a Rust (`//!`) or shell (`#`) file without a header, although `SOURCE` (`source-rules.ts:10`) includes both. Mutation: drop `rs` from `SOURCE`. Green. The `rm` marker is tested for `.sh` only and `find -delete` slips past it. `apps/desktop/src-tauri/build.rs` has no header and sits outside `SOURCE` (`src-tauri` is not `src/`).
- **`workflows.ts`** checks timeouts only. Nothing checks that actions stay pinned to a SHA, that `ci.yml` still runs `cargo test`, `pnpm test`, `pnpm guards`, `pnpm stubs`, or that `merge_group:` is a trigger once the merge queue from `parallel-build.md` is on (without it, required checks never report on the queue's branch).
- **`cargo test`** runs without `--locked`.
- **`scripts/release.ts`** has no test. Its dry run does not run the first step's checks (clean tree, on main, tag free), so a dry run cannot say whether `--go` would refuse. It runs `cargo test` on the owner's Mac, which the owner's rule says happens on GitHub only. It does not check CI is green for the commit.
- **`scripts/issues/sync.ts`** has no test for `merged()` (`:137`, keeps human text below the generated marker), `--check`, paging, or the retry loop. Mutation: return `generated` always; human notes in every issue are lost. `parseHeader` is tested only for `*`-style comments; the `//!` and `#` forms (read for Rust and shell files) are not.
- **`overnight/drive.ts`**: the `plan` output (nodes, `accept.smoke`, policy) is the product and has no test or `pleach validate` check. `RULES` is checked for three phrases, which pins wording. `node-gate.ts` `testsFor` accepts a `describe("ID ...")` with no assertion inside; a gate that proves a test exists, not that it asserts.
- **`scripts/conductor-re/`** (9 files: 8 Python, 1 shell script) has no header check, no shellcheck, no lint, no test. CI runs `shellcheck bin/*.sh` only. They read Conductor's app bundle (D002), so consider moving them to `.context/`.
- **`spotlighter.sh`**: the env-var check and the argument check are already built and untested (RUN-08 is a stub, so this is low).
- **`checkpointer.sh` at size.** Tests use a handful of files. A repo with 10,000 files and a slow `git add` is the case the SIGTERM handling exists for.

## 4. Per-file verdicts

| Path | Verdict | Reason |
| --- | --- | --- |
| `src-tauri/src/shell.rs` | WEAK | Helpers real (groups, timeout, overflow, capture, quit). Commands, event, login-env cache, repair untested; allowlist test pins weak rule (M1, M8) |
| `src-tauri/src/process_group.rs` | WEAK (no own tests) | Covered via `shell.rs`; SIGKILL line never runs (M4) |
| `src-tauri/src/pty.rs` | WEAK | Flow control and mirror real. Exit thread, exit mapping, kill with children, commands untested (M5) |
| `src-tauri/src/sidecar.rs` | WEAK | Pure parts and log rules real. Start, relay, supervisor, restart untested; one constant test is theater (M6) |
| `src-tauri/src/files.rs` | WEAK | Atomic write, symlinks, trash, scope function real. Scope wiring for 5 of 6 commands, string-search capabilities test (M7) |
| `src-tauri/src/file_search.rs` | WEAK | List, grep, limits real. No scope, error paths, loose fuzzy asserts (M7, M14) |
| `src-tauri/src/navigation.rs` | REAL | The URL decision is pure and fully covered. `install_guard` and the shim are not run; CSP test is text checks (admitted in the header) |
| `src-tauri/src/binaries.rs` | WEAK | `verify_bundled_programs` well tested. Command unregistered, event unsent, constant test (M2) |
| `src-tauri/src/lib.rs` | REAL | `system_info` and the arch parser are tested; one tautology. Handler list, `app_quit`, `app_info`, `health` untested (M1) |
| `src-tauri/src/{attachments,db,deep_link,keychain,logger,menu,notifications,open_with,resource_usage,speech,terminal_history,updater,error,main}.rs` | n/a | Placeholders (no tests by rule), except `error.rs`, whose JSON shape is a contract with no test (M9) |
| `bin/checkpointer.sh` via `checkpointer.test.ts`, `run-checkpointer.test.ts` | REAL | Real repos, real script, all 25 checklist items have a test, signals, odd names. Runs on Ubuntu only (M13) |
| `bin/git-busy-check.sh` via `git-busy-check.test.ts` | REAL | Every state and exit code, real git operations |
| `bin/spotlighter.sh` | none | Stub (RUN-08) |
| `scripts/check-runtime.test.ts` | REAL | Flipping the major/minor comparison fails a test; the `main` block is untested but small |
| `scripts/check-stubs.test.ts` | REAL | Each disagreement is named; planted samples |
| `scripts/with-run-dir.test.ts` | REAL | Runs the wrapper for real; leaves a file; dead-run cleanup. Watches files only (M12) |
| `scripts/guards/guards.test.ts` | WEAK | Planted samples for each guard, but only `.ts` for headers, only `.sh` for `rm` (LATER) |
| `scripts/guards/boundaries.test.ts` | REAL | Runs Biome on a planted bad import per rule, plus a control. Missing probes, writes into the tree |
| `scripts/issues/model.test.ts` | REAL | Parsing, labels, rendering; bad rows reported not dropped |
| `scripts/overnight/drive.test.ts` | WEAK | Prompts, `--only`, `markDone`, balance are real; `plan`/`step`/`closes` untested; one test pins prose |
| `scripts/overnight/node-gate.test.ts` | REAL | Placeholder and test-name detection in TS and Rust |
| `scripts/overnight/plan-batches.test.ts` | REAL | Step order, one program per batch, splitting, loop refusal |
| `scripts/release.ts`, `scripts/issues/sync.ts`, `scripts/guards/run.ts`, `scripts/conductor-re/*` | no test | See LATER |
| `.github/workflows/*` | guard only | Timeout guard only (`workflows.ts`) |

## 5. Checklist map gaps

Items with a real failing test are left out. "No test" means no test fails if the item is removed. "Passes without it" means a test exists but stays green.

| Feature | Item | Status |
| --- | --- | --- |
| PLAT-03 | execute_shell_command_cancellable starts a cancellable process; "a command starts / cancels a shell process" (frontend 3a) | No test at the command (M1). `shell_start` and `shell_cancel` never run |
| PLAT-03 | cancel kills the whole process group | Passes without the SIGKILL step (M4) |
| PLAT-03 | distinct timeout and cancel result | Tested by hand-assembling `shell_done`; the event path has no test |
| PLAT-04 | A command returns the login-shell env and PATH; first call and warm-up share one capture | No test (`shell_login_env`) |
| PLAT-04 | The login-shell PATH is repaired at startup (two items) | No test (`repair_process_path`, `start_background_capture`) |
| PLAT-04 | 5 s and 3 s timeouts | Passes without the behaviour: the test asserts the constants only |
| PLAT-05 | Well-known paths | No test (`fs_paths`) |
| PLAT-05 | Remove to the Trash | Tested on a folder the test picks. The real Trash folder is only tested for the failing case |
| PLAT-07 | pty-data and pty-exit events reach the handle (3 items) ; "emits ready, data and exit" | No test. `pty://exit` once, session removed, exit code mapping (M5) |
| PLAT-07 | pty_write, pty_resize, pty_kill, pty_ack commands | No test at the command; `pty_resize` also resizes the mirror, untested; zero size at spawn untested |
| PLAT-07 | Kill stops children in another group | Passes without the SIGHUP (M5) |
| PLAT-09 | ensure_sidecar_started starts if not running ; a command starts the sidecar | No test of the sequence or the single-flight (M6) |
| PLAT-09 | A ready event tells the UI the connection is up | Passes without it (constant test) |
| PLAT-09 | rpc_from_sidecar delivers lines ; the shell relays JSON-RPC lines | Writer tested; reader and event not |
| PLAT-09 | Rust kills orphaned sidecars | Matching tested; `kill_orphans` (the `ps` call and the kill) not |
| PLAT-09 | Restart policy | Plan arithmetic tested; the loop and `willRetry` event not |
| PLAT-22 | CSP replaces null | Text checks of the JSON. A page loading under the CSP is not tested (header admits) |
| PLAT-29 | The webview may read only listed paths | One command of six (M7) |
| PLAT-29 | Shell access limited to named scopes | Test pins file-name-only rule (M8) |
| PLAT-29 | Opener limited to URL scopes | Passes without the scope: the test checks that the wide schemes are listed |
| PLAT-34 | get_binary_verification_errors lists failures ; the event reports them | No test; command unregistered, event unsent (M2) |
| PLAT-06 | Directory listing applies the standard ignore filters | `.gitignore` tested; `.git/info/exclude` and global ignore not |
| PLAT-06 | fuzzy_match_files ranks | Top-1 only; tie-breakers untested |
| SIDE-23 | externalBin wiring; packaged copy | No test, not built (M11) |
| PLAT-25 | App has a bundle id and version | Version agreement is guarded; bundle id has no test |
| PLAT-36 | Mock-app tests | None, by definition |
| RUN-08 | requires its env, exits 1 when missing | Built, no test |
| GIT-10, GIT-11 | all items | Each has a test. "Spotlight uses the checkpointer" belongs to RUN-08 |

The node gate looks for the feature id in a test title. Of the 68 `done` rows, one (AGENT-01) has no test naming it. That counts titles only; the table above is the real measure.

## 6. Missing test layers

Findings so far, for reference when ranking: the three slice-1 bugs (first chat message deadlocked, every agent "not installed", dispatcher never mounted) all lived above the Rust shell. Two more of the same class are live in the Rust shell in this snapshot (M2, M3).

### Ranking by bugs caught

| Rank | Layer | Slice-1 bugs it would have caught | Live bugs in this snapshot it catches | Relative cost |
| --- | --- | --- | --- | --- |
| 1 | App launch and one chat message | all 3 | sidecar not bundled, CSP, unregistered command if the journey touches it | highest, one-time spike |
| 2 | Sidecar composition over a real socket, scripted agent, fake CLIs on PATH | deadlock, "not installed" | none found, protocol drift | low |
| 3 | Rust commands through a mock app, plus Rust and TypeScript contract checks | none | M2, M3, M1, M7 | low |
| 4 | Migrations on a populated database, through the real migrator | none | M10 class | low |
| 5 | Real-agent contract tests | "not installed" only if the CLI is real | upstream drift, which nothing sees today | recurring token cost |
| 6 | Real-size lists | none | M14 class, PTY/shell limits | low to medium |
| 7 | View screenshots | none | none | medium |

Build order differs from the rank. Layer 2 comes first because it builds the scripted agent that layer 1 needs. Layer 3's static contract part (R1, R2, R3) is a day-one guard and costs no runner time.

### Layer 1. App launch and one chat message

- Covers: a debug-built `.app` starts on a macOS runner; the real SQL migrator runs on a fresh database file; the webview loads under the real CSP; the sidecar starts from the bundle (or `CONDUCTED_SIDECAR_BIN`); a fixture git repo (made under `$TMPDIR`) is added; a workspace is created (a real `git worktree`); one message goes to the scripted agent; the reply and the diff appear; quit leaves no process behind. The 8 journeys in `parallel-build.md` grow from this.
- Features that need it (all slices):
  - Slice 1 done rows it protects: APP-01, PLAT-02, PLAT-09, PLAT-22, SIDE-23, WS-01, WS-03, PRJ-01, CHAT-01, CHAT-02, CHAT-05, CHAT-18, REV-01, REV-02, NAV-14, RUN-06.
  - Slice 2: APP-02, APP-08, PRJ-02, WS-02, WS-04, WS-05, WS-06, CHAT-03, CHAT-04, CHAT-11, CHAT-12, CHAT-15, COMP-03, REV-03, REV-09, REV-12, RUN-01, RUN-03, RUN-07, PLAT-15, PLAT-17, PLAT-25, PLAT-28, PLAT-34, PLAT-35.
  - Slice 3: PLAT-13 (update feed fixture), PLAT-16 and NAV-17 (launch with a `conducted://` URL), PLAT-23, PLAT-27 (single instance), APP-06.
  - Planned: CLOUD-02 and RC-01 spikes use the same harness.
- What it takes:
  - Runner: `macos-latest` (arm64, which matches PLAT-25's single arm64 binary). The repo is public, so standard runners are free; a private repo bills macOS minutes at a higher rate.
  - Measured: the Rust job is 71 s warm (run 42022220232: cache restore 28 s, clippy 16 s, test 17 s) and about 4 min cold. A `tauri build --debug` plus the web build is not measured. Measure it first with one `workflow_dispatch` run.
  - Driver: the plan names `@wdio/tauri-service` on the claim that it works on macOS through an embedded driver. I could not verify that. The stock `tauri-driver` does not drive WKWebView on macOS. Kill criterion for the spike: if the launched app cannot be driven to the empty state in CI, switch to a test-only plugin that evals a script in the webview, or a self-test flag that runs the journey inside the app and exits 0 or 1.
  - Needs the scripted agent (layer 2), no secrets, no tokens. Run on pushes to main, nightly, and on PRs with a label. Not on every PR.
  - Screenshots through the OS need screen-recording permission on the runner; take them from inside the webview instead.
  - Not testable on a runner: native notifications (PLAT-11), dictation (PLAT-12), Keychain prompts (PLAT-10) beyond a temporary keychain, notarisation (PLAT-25).

### Layer 2. Sidecar composition over a real socket

- Covers: the UI services (`createTestContainer`) talk to the real sidecar process over its Unix socket, through a Platform door that relays like Rust does; a scripted runner replays recorded turns; agents are fake CLI scripts placed on PATH, so `detect` runs for real. One test per hazard: first message, steer, cancel, restart with replay, an interaction left open, a checkpoint per turn.
- Would have caught: the shared-queue deadlock (the hardening reproduced it only after wiring the real outbox by hand), and `detect` losing `this`, because the fake CLI is found through the real path.
- Features: SIDE-02, 03, 04, 05, 06, 07, 11, 12, 13, 16, 17, 20, 21, 24; AGENT-01 to 08, 11, 12, 15, 16, 17; DATA-03, DATA-04; CHAT-02, 03, 04, 05, 10, 11, 12, 18; COMP-06; REV-09; WS-05; GIT-10; PR-05; CHAT-27.
- Runner: `ubuntu-latest` in the existing TypeScript job (needs `git`, bun, node, already there). The whole `pnpm test` step already takes 74 to 118 s, so put this in a second job that runs in parallel. No secrets.
- First step: add a `scripted` runner kind selectable in config, fed by the recorded transcripts the plan calls "golden". Today the Claude `Query` is scripted by hand inside each test (`translate.smoke.test.ts`), so nothing ties the scripted shape to what the SDK sends.

### Layer 3. Rust commands through a mock app, plus the Rust and TypeScript contract

- Static checks, no runner cost, inside `pnpm guards` (section 7): handler list against `COMMANDS` against `tauri-commands.md`; TypeScript `program:` strings against `ALLOWED_PROGRAMS`; event names; every migration in `db.rs`. In this snapshot they flag M2 and M3, and 19 more `COMMANDS` names with no handler (all planned work, so the rule needs a status tag), and `notification_take_pending`, which Rust registers and TypeScript never names.
- Mock-app tests (PLAT-36): `tauri::test::mock_builder()` with the same `builder()` that `run()` uses; calls by name through IPC; listens for events. Cases: the `shell_start`, cancel, timeout events; the `fs_*` scope for every command; `fs_paths`; a PTY from spawn to `pty://exit` (including the `Channel`: whether the mock IPC accepts a `Channel` argument is unverified, so test the inner `start_io_threads` as the fallback); `sidecar_ensure_started` twice at once; `app_quit`; `CommandError` as `{ code, message }`; the same PLAT-01 contract run against the Tauri Platform with `invoke` wired to the mock app.
- Prerequisites: add `tauri = { features = ["test"] }` as a dev-dependency; make the 21 commands that take `AppHandle` generic over `R: Runtime`; split `run()` into a `builder()`. The real runtime cannot be created inside `cargo test` threads (the event loop needs the main thread), which is why the mock runtime is the way.
- Features: PLAT-03, 05, 07, 09, 29 (done); PLAT-06, 10, 11, 15, 17, 18, 19, 20, 21, 28, 30, 31, 32, 33, 34, 35 (slice 2); PLAT-08, 12, 13, 14, 16, 23, 24, 26, 27 (slice 3); SIDE-18, SIDE-21, SIDE-22, SET-13, RUN-07, GIT-16.
- Runner: the existing macOS Rust job. `tauri` already compiles there, so it adds test code and a few seconds to the 17 s `cargo test` step. Keychain tests (PLAT-10) need a temporary keychain (`security create-keychain`, unlock, set as default) on the runner; plan for it.

### Layer 4. Migrations on a populated database

- Covers: applies `db::migrations()` (not the files) through the real sqlx migrator on a database file; for each shipped version N keep a fixture database built by running migrations 1..N and inserting representative rows through the repository code, then upgrade to latest and check row counts, `PRAGMA foreign_key_check`, `PRAGMA integrity_check`, and the `_sqlx_migrations` rows that PLAT-17 reads. A newer-database case for PLAT-17. DATA-02 and DATA-06 lifetime jobs on 100,000 events.
- Features: DATA-01, 02, 03, 06, 07, 08; PLAT-17; SET-14; WS-05, WS-06, WS-11; REV-12; COMP-09; CHAT-18; APP-16; every migration slice 2 adds (0004 exists already; DATA-08 is still `stub`).
- Runner: the macOS Rust job (`rusqlite` or the plugin's sqlx, a few seconds). Fixtures are small files in the repo. Rule: once a migration ships, its fixture is added in the same change that locks it.

### Layer 5. Real-agent contract tests

- Covers, per agent CLI (`claude`, `codex`, `opencode`, `pi`, `cursor-agent`): detection and version parsing; one trivial turn ("reply with ok"); the stream translates to neutral items with no unknown type; resume; interrupt; a tool approval round trip; model and slash-command listing. It also records the real stream so layer 2's scripted agent stays honest, and fails when the shape drifts.
- Features: AGENT-02 to 18, SIDE-14, 15, 16, 17, 24, SET-03, 09, 10, 12, CHAT-14, 27, 28, COMP-02, 03, 06, 10. Not testable from a runner: RC-01 to 04 (needs a claude.ai session), CLOUD-18.
- Runner: `ubuntu-latest` is enough for the sidecar protocol. Install the CLIs from npm in the job. It needs a provider key in an Actions secret, so a nightly or `workflow_dispatch` job on `main` only, never on fork PRs (secrets are not passed to them). Subscription sign-ins cannot be used on a runner; use API keys with a spend cap. Cost is a few cents per run (one-word turns). Note the app strips provider keys from the agent environment, so the test must add its own.
- Drift to watch for first: the SDK `Query` shape the Claude tests script by hand.

### Layer 6. Real-size lists

- TypeScript already has some (turn builder with 20,000 events, sidebar). Rust has none. Cases: `search_list_tree` and grep over 50,000 files and at the 200,000 limit; `fs_read_dir` with 10,000 entries; a 100 MiB PTY flood through the flow control, base64 and the mirror; a 64 MiB shell output; a 32 MiB sidecar line; outbox replay with 100,000 events; a chat with 20,000 events in the real DOM; a diff of 5,000 files.
- Features: PLAT-06, 07, 08; RUN-06, 07; SIDE-06; DATA-02, 04, 06; CHAT-06, 07, 17, 25; NAV-03 to 06; REV-01, 02, 06, 07, 10; PR-03, 04; GIT-02, 12.
- Runner: Rust cases on the macOS job, TypeScript cases on Ubuntu. Make them `#[ignore]` or a separate script to keep `cargo test` at about 20 s, and run them on main and nightly. The tests assert a time bound only as a hang guard; the real check is the memory and "does not hang" outcome.

### Layer 7. View screenshots

- Covers: every screen in every designed state from the states catalogue (loading, empty, error, ready), light and dark, rendered over the in-memory Platform in a browser, compared with baselines.
- Features: APP-04, 05, 12, 13, 14; NAV-01, 03, 05, 06, 12, 13; CHAT-08, 09, 20, 22, 24; COMP-01, 02; REV-02, 08, 11; SET-02, 06; every UI row. Value is design review, not wiring: none of the three slice-1 bugs would show.
- Runner: `ubuntu-latest` with Playwright WebKit (closest to the app's engine on Linux). Pin one OS for the baselines because font rendering differs across systems. WKWebView itself is only reachable in layer 1. Baselines in the repo; update by a label-triggered job. Not measured.

## 7. Rules and guards

Rules worth adding to `docs/engineering.md`:

1. **Register or it does not exist.** A Rust command is done when it is in `generate_handler!`, in `COMMANDS`, in `tauri-commands.md`, and a mock-app test calls it by name.
2. **Every program the UI runs is on the list.** Add the program to `ALLOWED_PROGRAMS` in the same change that first runs it.
3. **One kill routine.** Signal groups only through `process_group::terminate_group`; a test per caller with a child that ignores SIGTERM.
4. **Temp folders and child processes in Rust tests go through one `test_support` guard that cleans up on drop.** No `remove_dir_all(...).ok()` after the assertions.
5. **A constant is not a behaviour.** No test whose only assertion is `assert_eq!(CONST, "literal")`.
6. **A negative assertion on a collection is paired with a positive one** (`all(...)`, `!any(...)`, empty-list outcomes).
7. **A stand-in names the test that checks it against the real thing**, in its header, and the doc that claims it points at that test.
8. **Shell scripts that ship to macOS are tested on macOS.**
9. **A migration is added to `db::migrations()` in the same change as its file, and its populated-database fixture is added when it ships.**
10. **A doc that quotes a measured time carries the run id**, and the doc is rewritten when a run passes its own threshold.

Deterministic checks a script could run, with what each flags today:

| # | Check | Flags today in my area |
| --- | --- | --- |
| R1 | Every `#[tauri::command]` fn is in `generate_handler!`; every name in `COMMANDS` is registered or tagged with a backlog id that is not `done`; every registered name is in `tauri-commands.md` | `programs_verification_errors` (defined, unregistered, called); 19 more `COMMANDS` names with no handler (all planned, would need tags); `notification_take_pending` (no TypeScript name) |
| R2 | Every literal `program: "..."` in non-test TypeScript is on `ALLOWED_PROGRAMS` | `xcodebuild`, `osascript` |
| R3 | The `.sql` files in `migrations/` equal `db::migrations()` (names, versions 1..n, `include_str!` paths) | none today (4 of 4 match); the sample must flag a missing entry |
| R4 | Rust: a `#[test]` whose body has no `assert`, `expect` or `unwrap`; TypeScript: a test file that names a feature id and has no `expect` | none for Rust; node gate lets titled empty files through |
| R5 | Rust tests whose only assertion is `assert_eq!(UPPER_CASE_CONST, literal)` | `plat_09_a_start_announces_ready_on_the_documented_event`, `plat_04_capture_timeouts_are_five_and_three_seconds`, `plat_34_the_event_name_is_the_one_the_platform_listens_for` |
| R6 | A `.all(` or `for` assertion over a result with no non-empty assertion in the same test | `plat_06_fuzzy_skips_ignored_files` |
| R7 | `remove_dir_all(...)` or `remove_file(...)` inside a test body outside a `Drop` impl; more than one `struct TempDir` in the crate | 4 calls in `shell.rs` (`:1248`, `:1263`, `:1278`, `:1301`); 4 copies of `TempDir` |
| R8 | After the run, no process started by the tests remains (process group of the runner is empty, or `pgrep` for fixture programs) | cannot be flagged yet, nothing measures it |
| R9 | Workflow guard: every `uses:` is a 40-hex SHA; `ci.yml` contains `cargo test --locked`, `pnpm test`, `pnpm guards`, `pnpm stubs`; `merge_group` present when a merge queue is configured | `cargo test` without `--locked`; no `merge_group` (not needed until the queue is on) |
| R10 | Header guard sample for each of `.rs`, `.sh`, `.ts`; `SOURCE` covers `src-tauri/*.rs` and `build.rs` | no sample for `.rs`, `.sh`; `build.rs` has no header and is out of scope |
| R11 | `shellcheck` over every `*.sh` in the repo, not only `bin/` | `scripts/conductor-re/extract_bun_sidecar.sh` is unchecked; the 8 `.py` files have no checker |
| R12 | `tauri.conf.json` has `bundle.externalBin` and `resources` for `bin/*` once PLAT-25 is `done`; until then the SIDE-23 row cannot be `done` | `externalBin` missing |
| R13 | The CI step times quoted in `CLAUDE.md` are within 2x of the latest main run (`gh run view`) | `pnpm test` quoted at 16-26 s, measured 74-118 s |
| R14 | A `done` row with no test whose title or function name carries the id | AGENT-01 |

## Closing summary

In my area, 19 test files: 11 REAL, 8 WEAK, 0 THEATER at file level. Two single tests are theater (`plat_09_a_start_announces_ready_on_the_documented_event`, `plat_34_the_event_name_is_the_one_the_platform_listens_for`) and one more is constant-only. Worst problems: the Tauri command layer is never run through an app, and it already hides two live bugs (`programs_verification_errors` unregistered, `xcodebuild` and `osascript` not allowed); the SIGKILL step of the one kill routine is untested, as the coverage file confirms line by line; and the key seams are covered by stand-ins (the Tauri Platform never runs the contract, migrations never run through the real migrator or from a populated database, shell scripts are tested on Linux only). The checkpointer, git-busy-check, plan, stub and run-dir scripts are well tested. The missing layers, in rank order, are app launch with one chat message, sidecar composition with a scripted agent and fake CLIs, the mock-app command tests with the static contract guards, migrations on real data, real-agent contract tests, real-size lists and view screenshots. Next I would build the static guards R1 to R3 and the scripted agent first, because they are cheap and everything else depends on them.

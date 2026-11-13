# Engineering

How code is written and tested here. The commands and their timings live in [CLAUDE.md](../CLAUDE.md). The parts and their dependency rules are in [architecture.md](architecture.md).

## Building a feature

1. Pick a backlog id from [plans/backlog.md](plans/backlog.md). The files that own it carry `@feature <ID>` in their header.
2. Write the failing test named under "Test first" in the header. If you cannot make it fail, you do not understand the feature yet.
3. Build until it passes. Remove the feature's `notImplemented` placeholders.
4. Set the backlog row to `done` in the same change. `pnpm stubs` fails if a `done` row still has placeholders or a `stub` row has none.
5. Fix every doc the change makes false, in the same change.

## File header

Every source file starts with a header comment. `pnpm guards` fails on a source file without one.

```ts
/**
 * @feature CHAT-03 Steer a running turn
 * Owns: pushing a user message into the live turn and tracking when the agent has read it.
 * Behaviour: research/conductor/sessions-and-chats.md, "While the agent is working".
 * Must handle: no active turn (fall back to the queue), an agent that cannot steer, cancel during a steer.
 * Test first: a steer sent mid-turn stays in pendingSteerIds until the agent has read it.
 */
```

Rust files use `//!` with the same fields. Shell scripts use `#` lines. Mark our own design choices with "Our design choice:" so they are not mistaken for observed behaviour.

`pnpm guards` also checks the parts of a header a script can verify: each `@feature` id is a backlog row, each code name in `Owns:` or `Exports:` appears in the file, and each `Test first:` line shares a phrase with a test title, so the test it names exists. Write a `Test first:` line in the words of its test's title. A backticked name in `Owns:` is a claim about this file; name another file's function in plain words. Today's failures are in `scripts/guards/header-claims-baseline.json`, which may only shrink (D055).

The header says what the file does now, not what the feature will do one day. When you build part of a feature, cut the claims you did not build, or move them to the feature that owns them. A "Must handle" line with no code and no test is a defect. This was the most common finding of the first overnight build's audits (D045).

## Code

- **Failure lives in the return type.** Expected failures (git refused, file missing, agent not installed) return `Result` from `@conducted/shared`. Throwing is for programmer errors and `notImplemented`. Rust commands return `CommandResult`.
- **No silent failures.** These shapes hide a failure and are refused in review: `catch { return null }` or an empty `catch`, Rust's `.ok()` or `let _ =` on a `Result` nobody reads, an error that is only logged, and a default invented when the real value is missing. Hand the error on as a value. If a write the user relies on fails (a draft, a setting, a file), the user sees it.
- **Only the newest answer changes state.** An async read that writes a store guards against an older answer arriving late: use `createLatestWins` from `apps/desktop/src/core/async/latest-wins.ts`, or a request counter. Test it with two overlapping calls whose answers arrive in the wrong order.
- **Done means reachable.** A feature is done when its code is called from a live path: the composition root, a route, a screen or a handler. If the caller belongs to a feature that is not built yet, add the wiring as a checklist item on that feature in `docs/plans/items/` (D041, D043). Do not leave code nothing calls.
- **Use the shared helpers.** Before writing a queue, a single-flight guard, a retry, an error-message helper or a database write helper, check the table in [architecture.md](architecture.md#shared-helpers). A second copy of a helper is a finding.
- **Whatever subscribes, unsubscribes.** A service that adds a listener or starts a timer has a `dispose` or `stop` that removes it, and the container's `stop()` calls it.
- **Side effects at the edge.** Functions compute; callers do I/O. A function that needs time, ids, the file system or the shell takes them as parameters.
- **Placeholders.** `notImplemented("ID")` in TypeScript, `not_implemented!("ID")` in Rust, `not_implemented "ID"` in shell. No `TODO` comments, no fake data, no silent defaults. Unused placeholder parameters start with `_`.
- **Promises are always handled.** Biome's `noFloatingPromises` is an error.
- **Comments** say what the code does and why, in plain short sentences. One idea per sentence.
- **Deleting user files** moves them to the Trash. Scripts use `trash`, never `rm`.

## Tests

| Kind                         | Tool                                  | Lives in                            | Runs                              |
| ---------------------------- | ------------------------------------- | ----------------------------------- | --------------------------------- |
| Unit, packages               | `bun test`                            | next to the code, `*.test.ts`       | `pnpm test`                       |
| Unit and components, desktop | Vitest with jsdom and Testing Library | next to the code, `*.test.ts(x)`    | `pnpm test`                       |
| Desktop, needs macOS         | Vitest, project `macos`               | next to the code, `*.macos.test.ts` | `pnpm test:macos`, CI's macOS job |
| Rust                         | `cargo test`                          | inline `#[cfg(test)]` modules       | in `apps/desktop/src-tauri`       |
| End-to-end, the real app     | WebdriverIO, the app's own WebDriver  | `scripts/e2e`                       | `pnpm test:e2e`                   |
| Guards                       | `bun test`                            | `scripts/guards`                    | `pnpm guards`                     |

Rules every test follows:

- **Never test a mock of the thing under test**, and never test a placeholder.
- **Every checklist item has a test that would fail without it.** A test that would still pass with the feature removed does not count.
- **Fakes behave like the real thing.** An id source hands out a new id on every call, never a constant: use `createTestIds` from `apps/desktop/src/test/ids.ts` or `countingIds` from `packages/sidecar/src/test-support/ids.ts`. The night's most repeated test bug was a fake that gave every turn the same id.
- **Screens are tested over the real container.** Use `createTestContainer` from `apps/desktop/src/test/container.ts`, and `seedRepo` and `seedWorkspace` to put data in it, instead of a hand-built object cast to `Container`. Tests that need a real database use `openTestDatabase` from `apps/desktop/src/test/sqlite.ts`.
- **The sidecar's stand-ins have one home: `packages/sidecar/src/test-support/`.** `FakeApp` checks every message against the protocol schemas the real `RpcPeer` uses, `FakePublisher` checks every event, and each stand-in has a contract test next to it that runs the real class on the same inputs. A test file that declares its own copy fails `test-support/one-home.test.ts`.
- **jsdom has no layout.** `apps/desktop/src/test/setup.ts` adds the layout methods editors call (`getClientRects` and the like). Do not stub them per test.
- **Stand-ins are checked against the real thing.** The in-memory Platform and `createTauriPlatform` over Node-backed bindings (`src/test/tauri-node-bindings.ts`) pass the same contract cases (PLAT-01). Each run lists the cases it cannot run, with a reason, and every Platform method is named by a case or listed as uncovered. `openTestDatabase` runs the app's own statement queue (`platform/queued-database.ts`), so a statement that waits on its own transaction hangs in a test as it does in the app.
- **Wait for the event, never a fixed time.** A timeout catches a hang; it is not a way to wait. So the limits are hang-sized: 60 s per test and hook in Vitest (`apps/desktop/vite.config.ts`) and bun (`--timeout 60000` in each bun package's test script and in `scripts/run-tests.ts`), the same in the cloud Worker's Vitest (`apps/cloud/vitest.config.ts`), and 30 s for Testing Library's `findBy*` and `waitFor` (`apps/desktop/src/test/hang-timeouts.ts`). Bun ignores a timeout in `bunfig.toml`.
- **Time and ids are inputs.** Pass a `Clock` and an `IdSource`.
- **No shared fixed resources.** No fixed ports, names or paths. Temporary folders come from the run's own folder (see below).
- **Release what you hold:** timers, processes, sockets, file handles.
- **Test at real size.** Anything that lists or loops is tested at the size it meets in use: a chat with 20,000 events, a sidebar with 300 workspaces, a diff of 5,000 files.
- **A guard proves it can fail.** A check that reads source text includes a sample it must flag.
- **Five guards watch the shape of tests** (`scripts/guards/test-shapes.ts`): tests that cannot fail, tests that mock the thing they test, stand-ins defined outside `src/test/`, real time or leaked state, and tests that cannot pass. A test cannot pass when a Testing Library query looks for text with whitespace at an end or doubled (the library trims and collapses the page's text first), or when a `vi.mock` factory leaves out a name that a module the test reaches imports (Vitest throws when that code runs; start the factory from `importOriginal()` or use `createTestContainer`). Each compares per-file counts with `scripts/guards/test-shapes-baseline.json`. A count may not rise, and the baseline must fall with every fix: run `bun scripts/guards/test-shapes.ts --write-baseline` after a fix, and `--list` to see every site. A mock that is a real seam carries `// seam: <ID> <reason>` on the line above.

### Which tests run

`pnpm test` runs every test. `pnpm test:changed` runs the tests the changes since origin/main can reach; every pull request runs it in CI, and main runs every test after each merge. Both go through `scripts/run-tests.ts`; `--dry-run` prints the choice without running it.

- **Each runner's own graph decides.** Vitest's module graph picks the desktop's and the cloud's tests (`scripts/vitest-affected.ts` asks it through Vitest's Node API). Bun's resolver walks the imports of the bun-tested folders. `bun test --changed` is not used: it does not follow a workspace package imported by name, so a change to `packages/shared` selected none of the sidecar's tests.
- **Files read by name count.** Code that names a changed file reads it (comments are stripped first): a data file by its base name, a module by its folder and base name. A test that lists or builds a whole folder is named in a folder rule.
- **One file holds the rules:** `scripts/test-rules.ts`. A change on its run-everything list (manifests, the lockfile, test and CI configuration, the test run itself, migrations, generated code) runs everything. Its always list keeps the money, data-loss and security tests running on every pull request. Its macOS job list says what CI's macOS job reads ([CI](#ci)).
- **Never an empty pass.** When code changed and no test reaches it, every test runs.
- **The main line is the net.** When its full run fails on a test a pull request skipped, fix the defect and the rule that let it through. Nothing else checks the folder rules.
- **Desktop tests come in two kinds:** the Vitest project `unit`, the default everywhere, and `macos` (`*.macos.test.ts`), for tests that need a program only macOS ships, such as `/bin/zsh`. The macOS kind runs in CI's macOS job.

## CI

Every workflow runs on GitHub-hosted runners. A push costs this Mac nothing, and no job runs on the owner's Mac. Every job has `timeout-minutes`, so a hung runner stops at a known time rather than GitHub's six-hour default (`pnpm guards` checks this). A newer push cancels the older run of the same pull request; a push to main never cancels the run of the commit before it.

- `ci.yml` runs the fast checks on every ready pull request and on each push to main. A pull request runs only the tests its changes can reach ([Which tests run](#which-tests-run)); a push to main runs every test. Its macOS job (`rust`) runs the Rust checks and `pnpm test:macos`. GitHub's macOS runners are scarce, so a pull request runs that job only when it changes something on `MACOS_JOB` in `scripts/test-rules.ts`: the Rust crate, the desktop files the Rust tests read or the macOS tests import (with their setup files), the cloud's sources, the sidecar and the shared package, `bin/`, the sample program manifests, the manifests and lockfile, the runtime versions, the macOS tests' configuration and `ci.yml`. A small Ubuntu job, `macos-changes`, asks `scripts/macos-job.ts`; when it fails, the macOS job runs. A job skipped by its condition reports success, so the required check passes. A push to main always runs the macOS job. `scripts/macos-job.test.ts` fails when the crate names a path outside itself, or a macOS test imports a file, that the list misses. No Rust test reads the whole UI source: the `programs` guard checks the UI's programs against the Rust allowlist on Linux (D141).
- `codeql.yml` scans the TypeScript and the Rust with CodeQL on ready pull requests to main, on pushes to main, and weekly. Rust is scanned in build mode `none`, so the scan needs no build and no macOS runner. Results appear under Security > Code scanning; the workflow asks only for `security-events: write`.
- `coverage.yml`, `parity.yml`, `catalogue-shots.yml` and `dependency-review.yml` run the measurements, the parity harness, the screenshots and the dependency review described in [States catalogue](#states-catalogue).

`main` takes changes only through pull requests whose `typescript` and `rust` checks pass (the path-filtered `harness` job is not required, since a required check that never runs would hold a pull request forever). `pnpm repo-rules` reads `main`'s branch protection with `gh api` and fails, naming each missing part: the pull request requirement, or one of the required checks. The rule is data in `scripts/repo-rules.ts`; the comparison is a pure function tested in `scripts/repo-rules.test.ts`. `pnpm repo-rules --apply` prints the settings it will write, then sets exactly those rules with `gh api -X PUT`; it needs a `gh` login with repository admin.

## States catalogue

The catalogue draws the real app in a browser, one screen state at a time, with no Tauri, no real repository, no agent and no network. It runs the real entry (`startApp`) on the in-memory Platform over a real SQLite (sql.js), with a fixed clock and counting ids, so a state looks the same on every run.

- `pnpm --dir apps/desktop catalogue` serves it on a free port and prints `Catalogue: <url>`. That page lists every state, with a link for light and for dark.
- `bun scripts/catalogue/shots.ts [state-id ...]` starts the server, captures each state in light and dark at 1440 x 900 into `.context/shots/ours/<state-id>-<theme>.png`, writes `index.json` beside them, and stops the server. It uses the Chromium already in Playwright's cache and downloads nothing. It exits 1 when a state fails or never settles.
- On a ready pull request that touches the desktop's screens, `.github/workflows/catalogue-shots.yml` runs the same script on GitHub in three parts side by side (`--shard=k/3`) and uploads the PNGs as the `catalogue-shots-1` to `catalogue-shots-3` artefacts, kept 14 days. Screens can be read that way when no browser may run on the owner's Mac. Its `browser-checks` job runs the `*.browser.ts` checks the workflow lists, each in Chromium: a Codex visualization's inline scripts run under the app's production policy and its frame cannot reach the app or the network (`scripts/visualization/frame-policy.browser.ts`, issue #466); the pointer drags (issues #481 and #529); the Settings sidebar (issue #488); Cmd+Shift+Enter approves a waiting plan from the composer (`scripts/catalogue/plan-approve.browser.ts`, issue #586); and the Agents page's tabs fit their row at the default window, also with scrollbars that take space (`scripts/catalogue/agents-tabs.browser.ts`, issue #625).
- The parity harness reads every state the same way and compares it with Conductor's inventories: `.github/workflows/parity.yml` runs it on GitHub and uploads the gap report as the `parity-report` artefact. What it checks, and the instrument check that must pass first, are in `docs/plans/parity-harness.md`.
- A state is registered once, in `apps/desktop/src/catalogue/states/`. Its seed writes rows through the repositories and scripts the shell (`git-repo.ts`, `github.ts`) and the sidecar (`world.ts`, `live.ts`); its after-step drives the app through its own actions and real DOM events. Most states share one cast of two projects (`cast.ts`).
- The release build never contains it: `pnpm build` runs `scripts/catalogue/check-bundle.ts` on `dist`, and `scripts/catalogue/check-bundle.build.test.ts` builds the real bundle and checks it.

### Conductor's frontend on the same states (the reference run)

The owner's ruling: Conductor's own frontend runs on this Mac only, from the git-ignored `.context/` folder, with the network cut off, and is never committed, pushed or shipped. It shows each catalogue state as Conductor draws it, for a side-by-side parity check. Stage 1 answers its native calls from our catalogue's sample data; stage 2 answers them from our real Rust shell and sidecar (D099).

- Our tools live in `scripts/conductor-reference/`. The bundle, the call inventory and the sample-data mapping are drawn from Conductor's code, so they stay in the main checkout's `.context/day/` (`scripts/conductor-reference/paths.ts` finds it from any worktree).
- `inventory.ts <bundle> <out.json>` lists every native call the frontend makes: Tauri commands, plugin commands, sidecar methods, events and SQL, with argument keys, the fields read from the answer and the bundle offset of each site.
- `server.ts` serves the bundle on 127.0.0.1 with `standin.ts` injected before its first module. The stand-in is `window.__TAURI_INTERNALS__`; `backend.ts` answers through the SQL plugin over sql.js, the event plugin, the sidecar tunnel and the mapping's handlers. A call nobody answers is logged and answered with an error, never a made-up value. Handlers get two general tools through their context: `shell-reader.ts` reads the shell strings a frontend hands its native side (quotes, variables, `&&`, `||`, `if`, groups, redirections and the common built-ins) and runs each program against the sample world, with no answer for anything it cannot read exactly; `github-answers.ts` cuts a scripted GitHub GraphQL answer to the fields a query selects and applies `gh --jq` paths. A byte body (the fs plugin's writes) reaches a handler as `{ payload, headers }`.
- `check.ts` needs no browser: it seeds every state (through `apps/desktop/src/catalogue/seeded.ts`), builds the mapped databases, prepares the frontend's own SQL on them and counts the calls the stand-in answers.
- `run.ts [state-id ...]` is the browser run: one picture per state at 1440 by 900 in dark mode, taken once the page has been quiet for about a second, into `.context/shots/conductor-run/`, with `index.json` and `unanswered.json`. Every request to another origin is refused and listed. It is a browser run, so on the owner's Mac it waits for 08:00.
- `live.ts [state-id ...] [--fronts conductor,ours]` is stage 2, a browser run (D099). Per state and front it seeds the state, moves its sample Mac under a fresh sealed scratch folder (`sidecar-diff/seal.ts`), builds its repositories with real git (`world-disk.ts`), and starts the end-to-end test app (`buildTestApp`, below) built with the config override in `live-config.ts` into a target folder of its own (D145). So it has its resources and bundled sidecar, and it opens behind the owner's work. Its hidden window opens the bridge page (`bridge.ts`) of the live server (`live-server.ts`) on `http://localhost:1420`, which must be free. The seeded rows go into the app's own database through its database commands (`db_open`, `db_select`, `db_execute`). Conductor's frontend, or our own built UI, then runs in Chromium; `translator.ts` sends each call to our real commands, plugins, events and sidecar through the bridge, by the name-by-name mapping in `.context/day/conductor-ref/live-mapping.ts` (or unchanged, for our UI). It writes `.context/shots/conductor-live/` (`<state>-dark.png`, `ours/<state>-dark.png`, `index.json`, `live.json` with every call and its outcome) and stops the app and its sidecar by their process ids.
- `sidecar-diff/diff.ts [scenario-id ...]` runs Conductor's sidecar (from the installed app, in place) and ours side by side on the same scenario calls and the same fake `claude` and `codex` programs, one at a time, each under `sandbox-exec` with a throwaway home, no network beyond loopback and no writes under the owner's home. Raw output and the in-order comparison go to `.context/day/conductor-ref/sidecar-diff/`; the findings of the first run are in `docs/reports/sidecar-diff-2026-11-07.md`.
- `pnpm guards` fails when the repository holds a file named like a bundle chunk, a copy of a bundle code file, or any of the stretches of Conductor's code listed by hash in `scripts/guards/conductor-fingerprints.json` (`scripts/guards/conductor-code.ts`). `fingerprints.ts` rewrites that list from the bundle.

## A run leaves nothing behind

`pnpm test`, `pnpm test:changed` and `pnpm test:macos` run through `scripts/with-run-dir.ts`. It gives the run its own folder (`$TMPDIR/conducted-runs/<run id>`, recorded with the run's process id), points `TMPDIR` at it, and removes it when the run ends. When the run ends it fails if anything is left. The next run removes folders whose recorded process is gone.

Tests that create git repos, sidecar sockets or temporary files create them under `TMPDIR`, and stop every process they start by the process id they recorded.

## End-to-end tests in the real app

`pnpm test:e2e [round-trip|drag|overflow]` drives the app people use: the Tauri shell with WKWebView, the real sidecar and a real database (issue #564, D135). The other tiers run in jsdom, in Chromium or through the service container, and missed bugs that only the real window shows.

- **The test build** is a debug `.app` bundle with the release config's bundled sidecar (`tauri build --debug --bundles app --features e2e`). The `e2e` Cargo feature compiles in `tauri-plugin-wdio-webdriver`, the WebDriver server inside the app that is how WebdriverIO reaches WKWebView on macOS, and makes the build serve the built UI with no dev server. Nothing else turns the feature on. A release fails when its app binary carries the server (`verifyBundle` in `apps/desktop/src-tauri/release/bundle.ts`), and every e2e run first proves that scan finds the server in the test build.
- **Where it runs.** `.github/workflows/e2e.yml` runs it on GitHub's hosted macOS runners, on pull requests that touch what the app is built from, nightly on main, and by hand. Its `paths` list leaves out test files the build never reads; `scripts/e2e/trigger.test.ts` holds it to what the run, the sidecar's build and the bundle check import, and to the bundle's resources. The repository is public, so it never runs on a runner on the owner's Mac: such a runner would execute any outside pull request's code there.
- **One fresh folder per check**, under `/tmp/conducted-e2e/`, holds a clone of the bundle and the app's home and temp folder: its data, config, WebKit storage and settings files. The app starts with an environment built from nothing. `HOME` and `CFFIXED_USER_HOME` both point into the folder; without the second, WebKit keeps the page's storage in the owner's `~/Library/WebKit`, shared with every copy of the app. Each launch checks that the Keychain search list holds none of the owner's keychains, and the first launch checks that the page's storage starts empty. The app runs under the sidecar differential run's sandbox profile: no network beyond loopback and no writes in the owner's home, so it downloads no agent programs. Its programs come only from the fresh folder and the system's own folders (`/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`, `/usr/libexec`, `/System` and the Xcode developer folder that `/usr/bin/git` hands over to). The app's PATH is the system's, and the fresh home's `.zshenv` turns off zsh's system startup files, so the login shell the app reads its PATH from adds no Homebrew or `/usr/local/bin` folder (`/etc/zprofile` runs `path_helper`, which would). The sandbox refuses any other program, so a path written out in full cannot reach one either, and to the app such a program does not look executable (issue #640). Each launch proves the sandbox refuses a probe program, and fails when the app's login PATH (`shell_login_env`) holds any other folder. A process seen under the app that runs a program from another folder fails the run. The kernel's sandbox reports were tried as a record of refused programs and dropped: it does not report a refusal of a program the sidecar starts.
- **Seeded data.** After a first launch applies the migrations, the app quits and `scripts/e2e/world.ts` writes two projects (one with a very long name), three workspaces on this Mac and one cloud workspace through the app's own repositories, with real git repositories on disk.
- **The first screen.** `launch` probes the page every 100 ms until the sidebar's Settings link is drawn. Each probe runs under a 2 s script timeout, and the session's own 30 s comes back once the screen is seen (`FIRST_SCREEN_PROBE_MS` in `scripts/e2e/harness.ts`). The test-only WebDriver server (`tauri-plugin-wdio-webdriver` 2.0.0-next.0) sometimes loses a script sent in the page's first milliseconds and answers only when the script timeout runs out, which stalled launches for 30 s (#632). The page itself is live meanwhile, and release builds have no WebDriver server, so users never meet it. The plugin is used as published, not patched.
- **A restart** is the app's own quit (`app://quit-requested`, what the Quit menu item sends), then a new start over the same folder.
- **The checks.** `round-trip` changes every registry setting on every settings page, the user's and a project's, and the cloud workspace's Sync files switch, restarts, and reads each back in the window. Settings are listed from the registry, so a new one is covered without editing the check; one it cannot reach fails it, unless `NOT_COVERED` in `scripts/e2e/settings-round-trip.ts` names the reason. `drag` drags a workspace onto Pinned in the sidebar and checks it lands there. `overflow` measures every settings page for anything that scrolls sideways or reaches past the window, at rest, with a long project name and with search results open, after proving the measurement on a known wide box.
- **Leaves nothing behind.** Every ending, Ctrl+C included, stops the app and everything it started by the pids it recorded, and removes the folder. A process that outlived its app or a folder left on disk fails the run. A run killed outright leaves its folder to the next run, which removes it.
- **Limits.** The WebDriver server sends pointer input as events in the page. It does not move the Mac's cursor, so it never starts macOS's own drag session, which Tauri's handler answers. The test app opens behind the owner's work: no Dock icon, never the active app, and its window kept below other windows (#633). A run on the owner's Mac still waits for 08:00 during quiet hours, as builds do.

## Releases

A release has two homes. On the Mac, `pnpm release X.Y.Z --go` checks that main's CI passed for the commit, bumps every version file, writes the notes into `CHANGELOG.md`, commits and tags `vX.Y.Z`, and prints the push command. It does not build.

Pushing the tag runs `.github/workflows/release.yml` on a GitHub-hosted macOS runner. The workflow checks the tag against every version file, imports the Developer ID certificate into a temporary keychain it always deletes, builds, signs, notarises and staples the app, makes the update archive, its `.sig` and `latest.json`, attests every file with `actions/attest-build-provenance`, and creates the GitHub release with the body cut from that version's `CHANGELOG.md` section. A tag with a suffix after the patch number, such as `v0.2.2-rc.1`, makes a pre-release: the dry run.

The steps live in `scripts/release-ci.ts`, `scripts/release/` and `apps/desktop/src-tauri/release/bundle.ts`. Credentials reach them from one edge: the keychain on the Mac, environment variables from repository secrets in CI. A missing credential names itself and stops the run, so CI never publishes a signed build that was not notarised. The secrets are named in `.github/workflows/release.yml`; set their values by piping, never on a command line.

Every build copies `apps/desktop/src-tauri/THIRD-PARTY-NOTICES.txt` into the app's `Contents/Resources`, and the release check fails a bundle without it or with a copy that differs (D148). The file lists every package the app ships with its licence and notice files. `bun scripts/notices/generate.ts` writes it from pnpm's and Cargo's data; run it after any dependency change, because `pnpm guards` fails until the file matches, and `scripts/notices/bundles.build.test.ts` fails when a bundle takes a package the file does not list.

After the release exists, the same workflow updates the Homebrew cask in `jahala/homebrew-tap`: it hashes the published disk image, writes `Casks/conducted.rb` with `scripts/release/cask.ts`, and pushes it with a deploy key that may write only to that tap. A pre-release leaves the cask on the newest stable release (PLAT-42).

Anyone can check that a published file came from this repository's code:

    gh attestation verify <file> --repo jahala/conducted

### The agent programs' versions

The app ships its own copies of Claude Code and Codex, pinned by the release feed at
`apps/desktop/src-tauri/programs/release-feed.json` (PLAT-28). The same versions appear in the
Rust pins (`pinned_version` in `apps/desktop/src-tauri/src/binaries.rs`), in the cloud image's
program table (`apps/cloud/sandbox/image.ts` and its Dockerfile), and in the SDK the sidecar pins
(`@anthropic-ai/claude-agent-sdk` in `packages/sidecar/package.json`). They move together.

`bun scripts/programs/update-feed.ts` reads the newest Claude Code release from
`https://downloads.claude.ai/claude-code-releases/<version>/manifest.json` and the newest Codex
release from GitHub, and writes every file above with the size and SHA-256 each publisher states.
It never computes or guesses a checksum: a release without one is refused. It moves the SDK pin to
the newest wrapper the Claude Code manifest's `sdkCompat` tested, and says so. When every pinned
copy is current, it changes nothing.

Between app updates, the program manager moves Claude Code forward on its own (D133,
`apps/desktop/src-tauri/src/binaries/follow.rs`). At launch and once a day it reads
`https://downloads.claude.ai/claude-code-releases/latest` and that release's `manifest.json`, the
two files Claude Code's own installer reads. It installs the release for new chats when it is newer
than the copy that runs and its `sdkCompat.testedWrapperVersions` lists the SDK the sidecar pins,
with the size and SHA-256 the manifest states. The feed's version stays the floor and the answer
when the host is out of reach. `build.rs` reads the SDK pin from `packages/sidecar/package.json`,
so it has one home. Codex, gh, watchexec and the cloud image keep their pins.

`.github/workflows/agent-programs.yml` runs the script daily and on manual dispatch. When a file
changes, it updates the `chore/agent-program-versions` branch and opens or updates one pull
request from it. The workflow needs no secret beyond its own token; the script reads GitHub with
`GITHUB_TOKEN` when the workflow sets it.

## The product page

The product page is served by GitHub Pages from a build, never from a folder in the repository. Its sources are in `docs/site/`: `index.html`, `changelog.html` (published as `changelog/index.html`), `style.css` and the screenshots in `docs/site/images/`. The fonts are the app's own, copied from `apps/desktop/src/assets/fonts/` with their licence.

- `bun scripts/site/build.ts <out-dir>` builds it into a new or empty folder. It writes the Changelog page from `CHANGELOG.md`, newest release first, each release under the anchor `#vX.Y.Z` that the app's update notice can link to. It asks GitHub for the latest release, and the Download button points at that release's `.dmg`; with none, the page says no signed build is published yet and points at building from source.
- `.github/workflows/pages.yml` runs the build and publishes it on each push to main that touches the page or `CHANGELOG.md`, and when the release workflow's `pages` job asks after publishing a release. A pull request that touches the page builds it without publishing.
- `bun scripts/site/screens.ts` captures the page's catalogue states and copies them into `docs/site/images/`.
- `pnpm guards` builds the page in memory and fails on a local link, image, font or anchor that does not resolve, an image no page uses, or a link to a repository path or README heading that does not exist (`scripts/guards/site.ts`). The docs guard does the same for the README's links and images. `scripts/site/site.test.ts` checks that every colour in `docs/site/style.css` is one of the app's token values.

## Commits and pull requests

- Conventional commit subjects (`feat:`, `fix:`, `refactor:`, `docs:`). The body explains why.
- Open pull requests as drafts while working. Draft PRs run no CI. Mark a batch ready and CI runs once; GitHub tests the merge result, not just the branch.

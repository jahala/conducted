# Decision log

Each decision with its context, what was chosen and why. Newest last. A decision is changed by a new entry that names the one it replaces, never by editing the old one.

This log holds decisions about the product and how it is built. Decisions about how this project's work is run (overnight builds, agents, audits, budgets and schedules) are in [docs/process/decisions.md](process/decisions.md). Both logs share one numbering, so a `Dnnn` number names one entry in one of them.

## D001. Build on Conductor's local feature set, from its observed behaviour (2026-11-04)

Context: the goal is a desktop app for running coding agents in parallel. Conductor 0.92.1 is a working example of such a product.
Chosen: match Conductor's local features one to one, using the research in `docs/research/conductor/` as the spec.
Why: a proven product is a better spec than a fresh design. The research covers its structure, sessions and screens in detail.

## D002. Behaviour, not code (2026-11-04)

Context: the research was made by reading Conductor's bundled code.
Chosen: nothing is copied from Conductor's app bundle: no code, prompt text, assets, sounds, city lists or icons. Specs and code are written in our own words. Extracted material stays in `.context/`, which git ignores.
Why: the behaviour of a product can be rebuilt freely; its code and assets belong to its makers.

## D003. Same stack as Conductor: Tauri 2, React, a TypeScript sidecar on Bun (2026-11-04)

Chosen: a thin Rust shell, a React web UI that owns the database and runs git, and a sidecar process that runs the agents.
Why: the research maps onto it file by file. The agent SDKs are TypeScript. Tauri keeps the app small by using the system WebKit view.

## D004. Leave out every cloud and team feature (2026-11-04)

Chosen: no organizations, cloud workspaces, file sync, routines, workspace chat, cloud CLI, phone remote control or analytics. No "host" abstraction for remote machines.
Why: they are a second product on top of the local one, and need a hosted service. A cloud plan, if ever wanted, gets its own decision.

## D005. Our own neutral agent-message format (2026-11-04)

Context: Conductor reuses Claude's SDK message format for all agents, and needed a second renderer for Codex.
Chosen: `packages/protocol/src/agent-message.ts` defines our format. Every runner translates into it, Claude included. The original payload is kept in `raw`.
Why: one renderer for every agent, and the format stays ours when a vendor changes theirs.

## D006. One event log per chat (2026-11-04)

Context: Conductor writes every chat twice (an old message table and a new event table), which grew its database to 12 GB.
Chosen: `session_events` is the only chat history. Every growing table states its lifetime in the migration, and the data-lifetime job enforces it.
Why: one home for the data, and storage that stays bounded.

## D007. The sidecar writes its backup before sending (2026-11-04)

Context: Conductor's event backup is best effort and can miss events in a burst.
Chosen: a write-ahead log per chat. An event is written to disk before it is sent, and removed when the UI confirms it stored it.
Why: no agent output is lost when the app or the sidecar dies mid-turn.

## D008. An explicit turn-ended event (2026-11-04)

Context: in Conductor, a turn cut off by a crash has no end marker.
Chosen: `turn_ended` with outcome `success`, `error`, `cancelled` or `interrupted`. Startup repair closes open turns as `interrupted`.
Why: every turn has a known end, and the UI can show which ones were cut off.

## D009. Agent programs come from the user's machine (2026-11-04)

Chosen: the app finds `claude`, `codex`, `cursor-agent`, `opencode` and `pi` on the login-shell PATH. A download manager stays a spec.
Why: downloading needs a hosted release feed and signed binaries, which do not exist yet.

## D010. Open-source libraries in place of paid ones (2026-11-04)

Chosen: `react-virtuoso` (MIT) for the chat list instead of the commercial `VirtuosoMessageList`. Every new dependency's licence is checked when it is added. The Claude Agent SDK and the Cursor SDK use their vendors' terms; the Cursor SDK is not bundled, and its runner codes against a narrow local interface.
Why: anyone can build and ship the app.

## D011. Placeholders are named and counted (2026-11-04)

Chosen: unbuilt bodies call `notImplemented("ID")`, with the ID in `docs/plans/backlog.md`. `pnpm stubs` fails when code and backlog disagree. The UI shows "Not built yet: ID" instead of crashing.
Why: a scaffold made of placeholders must not hide unfinished work.

## D012. Open source under MIT, research included, name "Conducted" (2026-11-04)

Context: the risks were raised before the choice. The research describes another company's internal code, and the name is close to "Conductor".
Chosen by the owner: MIT licence, the research stays in the repo, the name stays, and the repo goes public now.

## D013. The Rust shell restarts a crashed sidecar (2026-11-04)

Context: Conductor has no restart loop.
Chosen: restart with backoff, at most 5 restarts per minute, then report the failure in the UI.
Why: a crash in one agent's code must not leave every chat dead until the app restarts.

## D014. Terminal scrollback is stored unencrypted, owner-only (2026-11-04)

Context: Conductor encrypts scrollback with a Keychain key.
Chosen: plain files with mode 0600 in a 0700 folder, removed after 14 days.
Why: the files sit in the user's own account, like shell history does. Encryption can be added later without a format break, as a new decision.

## D015. Cancel tries an in-protocol interrupt before stopping Claude (2026-11-04)

Context: Conductor always kills the Claude process on cancel, which costs a restart and a history reload.
Chosen: call the SDK's interrupt first; stop the process if the turn has not ended after 5 seconds.
Why: cancel stays cheap when the agent cooperates. The first AGENT-02 test must prove that an interrupt ends a turn cleanly.

## D016. Agent turns are never resent by the app (2026-11-04)

Context: an agent turn costs money, and a turn that got no answer may still have been billed.
Chosen: all turns go through the sidecar's session manager. A turn interrupted by a crash is marked `interrupted` and shown; only the user can send it again.
Why: an automatic retry could bill the same work twice, or run the same edits twice.

## D017. Allow the glib advisory that only affects Linux builds (2026-11-04)

Context: dependency review flags GHSA-wrw7-89jp-8q8g in glib 0.18.5. glib is in the lockfile only through Tauri's Linux toolkit (gtk 0.18). The app ships for macOS, and the macOS build does not compile glib.
Chosen: `allow-ghsas` for this one advisory in `.github/workflows/dependency-review.yml`, with the reason beside it.
Why: the advisory cannot reach a shipped build, and the fix depends on Tauri moving to a newer gtk-rs. Revisit when Tauri updates, or before any Linux build.

## D018. A cloud option on the user's own Cloudflare account (2026-11-04)

Replaces D004 for cloud workspaces. Team features (organizations, shared workspaces, routines, workspace chat) stay out.
Context: the owner wants workspaces that keep running when the Mac sleeps. Cloudflare's Sandbox SDK runs isolated Linux containers with git, a shell and files, and Cloudflare documents running Claude Code, Codex, OpenCode and Pi in them.
Chosen: an optional cloud host for workspaces, deployed by each user to their own Cloudflare account (Workers Paid, 5 US dollars a month plus usage), with their own model key. We host nothing. The UI reaches git, shell, files, terminals and the sidecar through a `Host` interface, local or cloud. The details and a spike with a kill criterion are in `docs/plans/cloud-and-remote.md`.
Why: no servers, billing or user data on our side, and the sidecar already runs anywhere its I/O is passed in.

## D019. Claude Remote Control for Conducted's chats (2026-11-04)

Context: Claude Code's Remote Control lets claude.ai/code and the Claude mobile app follow and steer a running session. Anthropic documents it for interactive sessions with a claude.ai login; the Agent SDK ships an `@alpha` bridge API for it. Conductor does not offer it.
Chosen: support it for Claude chats, chosen per chat. A spike decides between letting Claude Code connect itself and our own bridge through the alpha API, and drops the feature if neither works without undocumented protocols.
Why: following and steering agents from a phone is a large part of running several of them at once.

## D020. Match Conductor in everything the user sees or does (2026-11-04)

Context: a coverage check found 131 places where the scaffold differs from Conductor on purpose. Most are internal; a few change what the user sees, such as agents not being installed for the user, one approval choice missing, and queued follow-ups kept after a cancel.
Chosen: everything visible on screen and every action the user can take matches Conductor. Internals may differ only where they fix a documented Conductor problem (for example D006, D007, D008), and each such difference has a decision entry. Visible differences found by the check are put back. A visible difference stays only when it adds information without removing any (D008's "interrupted" turns), and is listed here.
Why: the goal is Conductor's product, rebuilt; its internals are free to improve.

## D021. Install and update agent programs for the user (2026-11-04)

Replaces D009.
Context: Conductor downloads, verifies and updates its own copies of Claude Code and Codex, so they work without the user installing anything. D009 used only what was installed on the user's PATH.
Chosen: the app downloads the official releases of the agent programs from their vendors, verifies them, keeps them up to date, and removes old versions. A copy on the user's PATH is used when the user chooses it in settings, or when a download is not possible.
Why: D020. A first run that works without a terminal is part of the product.

## D022. The visual design matches Conductor's (2026-11-04)

Context: D020 covers what the user sees. The owner asked for the same look as well: colours, fonts, sizes, spacing, padding, radii and motion.
Chosen: our design tokens take Conductor's measured values (`docs/research/conductor/ui-dimensions.md`), in light and dark. We store the values in our own token file; we do not copy Conductor's stylesheet or assets (D002). One rule stays ours: text and controls meet WCAG AA contrast. Where a measured pair falls short, we adjust that one value and list it in `docs/design.md`.
Why: a rebuild that looks the same is easier to compare and to switch to. Accessibility is not traded for likeness.

## D023. The design values we take from Conductor, and the four we change (2026-11-04)

Context: `docs/research/conductor/ui-dimensions.md` measured Conductor's design values for D022.
Chosen:

- Fonts: Geist for the interface and Geist Mono for code, taken from their official open-licence (SIL OFL) release and bundled with the app, never from Conductor's bundle. The terminal keeps Menlo first.
- Weights: 350, 400, 450, 500 and 600, as Conductor uses them.
- Type scale names follow Conductor's (`text-sm` is the 14px body size), so measured values carry over one to one.
- Colours: Conductor's values, light and dark, except the pairs that fail WCAG AA. Those take the nearest passing value in the same hue, listed in `docs/design.md`.
- Focus: every control keeps a visible focus ring. Conductor turns it off on buttons; ours stays on.
  Why: likeness where it costs nothing, accessibility where Conductor falls short.

## D024. `gh` and `watchexec` are installed and updated like the agent programs (2026-11-04)

Extends D021.
Context: Conductor ships its own `gh` (with the `gh stack` extension that "Sync stack" runs) and `watchexec` (which Spotlight runs), so pull requests and Spotlight work on a Mac that has neither. D021 named only the agent programs, and the scaffold used `gh` from the user's PATH.
Chosen by the owner: the app downloads the official releases of `gh` and `watchexec`, verifies them, keeps them up to date and removes old versions, through the same program manager as the agent programs (PLAT-28, PLAT-35). By D020 this also covers the `gh stack` extension. A copy on the user's PATH is used when the user chooses it in settings, or when a download is not possible.
Why: D020. GitHub features and Spotlight then work on a first run without a terminal.

## D025. What stays out (2026-11-04)

Context: D004, D018 and D019 say which team and hosted features stay out. The coverage check found more behaviours that only work with Conductor's own service or accounts.
Chosen: these are not built.

- The Muse Code agent and its protocol. It needs Conductor's partner account, and Conductor itself hides it behind an internal flag.
- The Help menu items Best Practices and Submit a Prompt, which open Conductor's website and prompt programme.
- The phone relay: pairing a phone, the paired device list and requests relayed from a phone. Remote control is D019's claude.ai route.
- Conductor's hosted computers and its cloud backend (the computer tools, the multiplexed websocket, standby sandboxes). Our cloud is D018's.
- Sharing prompt snippets ("Visible to"). Snippets stay private to the Mac.
- Organisation policies, staff and developer tools (internal mode, the app-actions bridge, the inspector opened through AppleScript, test hooks), analytics and crash reporting, and GitHub App sign-in.
  The item-level list is in `docs/plans/items/README.md`.
  Why: each needs a service, an account or a partner agreement that we do not have. None of them changes what a user can do with their own Mac and agents.

## D026. One log: sidecar log lines go to the Rust shell's log files (2026-11-04)

Context: the Rust shell writes the app's log files (PLAT-18). The sidecar also had a logger mode with its own HTTP server, ring buffer and discovery file (SIDE-18), and nothing started it. Conductor runs such a server.
Chosen by the owner: one log. The sidecar writes its log lines to stderr, one JSON object per line. The Rust launcher (PLAT-09) writes them into the app log files with a sidecar tag. The level changes at runtime through `setLogLevel`. The logger mode, its HTTP routes and its variables are removed (SIDE-18).
Why: one home for logs, one export, and one fewer process and port. The user sees the same logs and the same "Open sidecar logs" command.

## D027. Script and agent variables use only `CONDUCTED_*` names (2026-11-04)

Context: Conductor gives setup scripts, run scripts and agents variables named `CONDUCTOR_*` (workspace name, path, root path, default branch, port and others). Ours are named `CONDUCTED_*`. A script copied from a Conductor repository would read empty values.
Chosen by the owner: only `CONDUCTED_*`. No `CONDUCTOR_*` names are set, and there is no alias. This is a visible difference that stays, added to D020's list.
Why: the names are ours, and an alias would be a compatibility shim kept forever. Renaming the variables in a script is a one-time change.

## D028. The sidecar has no HTTP server and no health route (2026-11-04)

Context: Conductor's sidecar serves one HTTP health route on 127.0.0.1, guarded by a bearer token that the shell passes on stdin. Our protocol had a `getHealth` method that nothing calls.
Chosen: the sidecar listens only on its Unix socket. A sidecar process that is alive and connected counts as healthy; the restart loop is D013's. `getHealth` is removed from the protocol (PLAT-09).
Why: the socket is private to the user's account, so a port and a token add an attack surface and nothing else. The user sees the same failure screen when the sidecar is down.

## D029. GitHub access goes through `gh` with the user's own sign-in (2026-11-04)

Context: Conductor hands each agent session a fresh GitHub token from a broker (wrapper scripts and a socket), and offers GitHub App sign-in through its service.
Chosen: the app and the agents call `gh` (D024), signed in with the user's own `gh` login, or with the personal access token the user enters on the Account page, kept in the Keychain and given to `gh` as `GH_TOKEN`. There is no token broker and no per-session token. The `gh_auth_method` setting keeps Conductor's values `cli` and `pat` (services-map 3.9); `conductor-app` is not offered. GitHub App sign-in stays out (D025).
Why: both sign-in ways the user sees stay. A broker exists to refresh tokens from Conductor's service, which we do not have.

## D030. Chat titles and branch names come from a short run of the user's own agent (2026-11-04)

Context: Conductor asks its hosted summarizer for chat titles, and runs branch-name prompts through a throwaway agent session. We have no hosted service.
Chosen: one sidecar call, `runUtilityPrompt { agent, model, prompt, cwd }`, returns plain text (SIDE-24). It covers Conductor's ACP and Cursor one-shot calls for every agent.

- It uses the chat's own agent and the cheapest model in its catalog. If that agent is not signed in, the call fails and nothing is written.
- The run is not in the chat list, writes no events, takes no checkpoints, has its tools off and closes at once. The prompt text is ours.
- A chat title is asked after the first answer of a new chat; a branch name after the first message of a workspace (WS-04). Both are skipped when the user named the chat or branch, a PR is linked, the branch changed, or the answer is empty or equals the placeholder. A name clash retries once with a suffix.
- On failure the placeholder stays and a log line is written. The app never resends the call (D016).
- The "AI generated chat titles" switch turns the call off, so the chat text never leaves the user's own agent.
- First test: the call leaves no event rows, no checkpoint refs and no chat-list entry.
  Why: the user sees titles and branch names as in Conductor, without a hosted service, and the cost stays on the user's own agent account.

## D031. Sidecar wire and storage details that differ from Conductor (2026-11-04)

Context: file headers record these choices; none changes what the user sees.
Chosen:

- The write-ahead log (D007) accepts acknowledgements in any order, names its files from the UTF-8 session id, sweeps idle files after 30 days, and is required at start: a bad outbox stops the sidecar.
- Checkpoint refs live under `refs/conducted/checkpoints/`.
- `user_message` events have no `state`. There is no `queryError` or `sessionStatusNotification`: live state and D008's `turn_ended` carry both. `turnId` is required, and `sequence` replaces `notificationIndex`.
- Our own JSON-RPC error codes, `-32001` to `-32005`.
- Interactions are not stored as events; their effect shows as tool calls (D005, D006). ACP turns get a `session_started` notice in place of a synthetic init message.
  Why: each fixes an ordering, naming or loss problem that D006 to D008 describe, at no cost to the user.

## D032. One session manager for every folder (2026-11-04)

Context: Conductor keeps one agent host per workspace folder, keys processes by agent, session, folder and a config hash, and builds a session's config once.
Chosen: one session manager serves every folder. The process key is agent plus session, and the runner decides when a restart is needed. The config arrives with every message and is applied by the runner. A config change during a turn waits until the turn ends, which is what Conductor's user sees too (claude-runner 1.5). One MCP bridge serves the sidecar run, with one token per chat. Runners are declared interfaces with capability flags, report their own model lists (SIDE-14) and their own sign-in state (SIDE-15), and the session manager owns status. Listening ports are read with `lsof`. The cloud seam is the Host interface (CLOUD-01).
Why: fewer moving parts and one place that decides what runs, with the same behaviour on screen.

## D033. Provider keys: one strip list, and each key reaches only its agent (2026-11-04)

Context: Conductor strips provider keys from the captured login-shell environment with one list per agent, then adds the keys the user entered. The credential forms are put back (SET-09).
Chosen: one strip list removes every provider key from the captured environment (SIDE-10). Keys entered in the forms are stored in the Keychain (PLAT-10). Each runner receives only the keys of its own provider (SIDE-21), and a key from the Mac's environment only when the user picks "Use the key from this Mac".
Why: the same result per agent with one rule, and no key reaches an agent that should not have it.

## D034. Startup repair keeps cut-off workspaces, marked failed (2026-11-04)

Context: at startup Conductor deletes local workspaces left half-created, and opens a workspace whose setup was cut off as ready.
Chosen: half-created workspaces stay in the list as failed with Retry, and a cut-off setup shows as failed with its log (DATA-03). This is a visible difference that stays, added to D020's list.
Why: it adds information and removes none, like D008's interrupted turns. The user can see what went wrong and retry, or delete.

## D035. Linear uses a personal API key (2026-11-04)

Context: Conductor signs in to Linear with an account token that its service refreshes.
Chosen: the user pastes a personal Linear API key, kept in the Keychain; a rejected key shows "key rejected" (PR-09). This is a visible difference that stays, added to D020's list.
Why: the account flow needs a registered app and a hosted callback, which we do not have.

## D036. Rewind marks events; we prune checkpoint refs (2026-11-04)

Context: Conductor's rewind deletes chat rows after a point, and keeps checkpoint refs.
Chosen: rewind marks events `reverted_at` and keeps them (D006). Checkpoint refs of a deleted chat are removed, and those of an archived workspace 30 days after archiving (DATA-06).
Why: a rewind can be inspected later, and refs do not pile up in the user's repository.

## D037. Changing the workspaces folder keeps existing data (2026-11-04)

Context: when the user changes the workspaces root folder, Conductor asks "Change root path?" and then wipes repos, workspaces, chats, events, attachments and comments from its database.
Chosen: the same confirmation, and the new folder applies to new worktrees. Existing workspaces and chats stay where they are. This is a visible difference that stays, added to D020's list.
Why: it removes no information, and the wipe destroys work the user may still need.

## D038. Smaller storage, update and packaging choices (2026-11-04)

Context: file headers and `docs/data-model.md` record these; none changes what the user sees.
Chosen:

- Draft staging is swept after 7 days, not 30. The update check runs hourly and on window focus, not every 60 and 300 seconds.
- The workspace port is stored in `workspaces.port` and stays the same across restarts.
- No `cache.db`, no shared local-storage layer: small UI stores are listed with their lifetimes in `docs/data-model.md`. The Rust shell never reads the database; the UI passes settings in.
- No `conductor.json` migration, no `deprecated_at` on settings (unknown keys are dropped), no worktree layout version (`storage_version`). Repo scripts, prompts and file globs live in `.conducted/settings.toml` and repo-scoped settings, and shared repo settings are read from the checkout.
- "Setting up" is an in-memory state of an `initializing` workspace. The board status is one stored value; an empty value means automatic.
- Each statement sets `updated_at` itself, in milliseconds, in place of triggers.
- Worktree removal moves the folder to the Trash.
- Our own deep-link scheme (`conducted`), update feed and signing key. Release builds run the sidecar from Tauri's `externalBin`.
  Why: simpler storage with stated lifetimes, and names that are ours.

## D044. Biome's React rules are switched on by name (2026-11-05)

Context: two features (WS-09, COMP-01) passed their node gate's `pnpm lint` and then failed it on the step branch, both on `useExhaustiveDependencies`. The same commit passed lint inside a worktree under `.git/` (where pleach puts its worktrees) and failed outside it. Biome switches its React rules on only when it detects React, and it does not detect it from inside `.git/`.
Chosen: `biome.json` turns the React domain on by name (`linter.domains.react: "recommended"`). Checked on the known case: with the setting, the same file fails lint inside `.git/` too.
Why: a gate must check the same rules wherever it runs.

## D054. Done means reachable through the real composition root (2026-11-05)

Context: the slice-1 hardening found the dispatcher was never mounted. The test review found the same class again, more widely. The container passes no `launchFor`, `repoConfig` or `defaultConfig`. Nothing calls `GitService.watch` or `GithubService.watch`, and `onMerged` is never wired. Ten UI components are built and tested, but nothing imports them. Each feature's own tests passed, because each test supplied the missing part itself.
Chosen: a feature is done when its code runs from the real composition root (`core/container.ts` or the sidecar's `sidecar-mode.ts`), with one test over `createTestContainer` or the real sidecar host. Two guards hold this (docs/plans/test-quality.md, batch 4a). Guard 5 fails on code whose only importers are tests. Guard 6 compares what each composition root passes with each service's `Deps` type, and an optional dependency left out needs an `// unwired: <ID>` marker naming a stub row. Builder and audit prompts carry the rule.
Why: a part that only tests call is not a feature, and an audit of one batch cannot see what the composition root forgot.

## D055. Guard baselines may only shrink, and there are no known-red marks (2026-11-05)

Context: the new test-quality guards flag hundreds of existing violations, and the plan's first draft also proposed marking real failing tests as expected to fail (`it.fails`, `test.failing`) until their owner builds.
Chosen: each guard reads a committed baseline of today's violations per file. A guard fails when a count rises, and also when the baseline is higher than the real count, so every fix lowers the file. There are no expected-failure marks. A test that fails because the product is broken lands in the same change as its fix, or is the acceptance test of the feature build that owns the fix, written test first in that build.
Why: a baseline that can only fall lets the guards start today without hiding anything new. An expected-failure mark is a skip by another name, which the project's rules and weeder (T3) refuse.

## D059. The app does not edit the user's Codex config (2026-11-05)

Context: SIDE-13 hands Codex the app tools server through Codex's own config. Conductor writes its server entry into the user's or the repository's Codex config file when one is missing, and replaces a clashing entry. A check against codex-cli 0.154.0 showed that when that config already defines a server with the same name, Codex rejects its whole config.
Chosen: Conducted passes its server through the launch arguments and never writes to the user's or the repository's Codex config. When either file already defines a server named `conducted`, the app leaves its own server out for that chat and logs a warning that names the file. This differs from Conductor (D020) on purpose.
Why: a user's config file is theirs, and an app that rewrites it can break their setup outside the app. The cost is that a user who named a server `conducted` gets no app tools in Codex until they rename it; the warning says so.

## D064. A quit stops the app first, for at most five seconds (2026-11-06)

Context: the core hardening found that `Container.stop()` ran only in tests. A real quit called `app_quit` at once, so a composer draft on its debounce, chat events being stored, terminals and runs got no orderly end. Running the stop first can hang on one step (a stuck disk write, a sidecar that never answers), and then Cmd+Q would do nothing.
Chosen: a quit runs the container's stop and then quits, and quits anyway after `QUIT_STOP_LIMIT_MS` (5 seconds) if the stop has not ended, with a log line. The research gives no limit; 5 seconds is our dial.
Why: an orderly stop keeps the user's last edit and every stored event; a quit that never happens is worse than one that skips the last step.

## D070. "Open in another app" opens the Open in menu's app (2026-11-06)

Context: REV-08's rebuilt "Open in another app" failed with "No default app configured" whenever no default was chosen. The research gives only the toast. Conductor's own code (renderApp: `pe = B && fe.some(...) ? B : fe[0]?.id`) opens the chosen app when it is installed, else the first app of its Open in list, and shows that toast only for an empty list.
Chosen: the same rule, written once (`defaultOpenInApp` in `features/open-in/open-in-apps.ts`) and read by the Open in menu and the file tab through `useOpenInApps`. `files.openInApp` takes the app name.
Why: D020, checked against Conductor itself where the research is silent.

## D071. A test that builds its own container gets the missing service; the hardening moves it to the test container (2026-11-06)

Context: the contract PR's CI failed in `composer-shell.test.tsx`: the context wheel now reads the new `contextWindows` service, and the test hands the app a partial container cast as `Container`, so the service was missing. 17 desktop test files build such a container; the slice-2 tests hardening listed 15 of them for `createTestContainer` (APP-16).
Chosen: the failing test's container gets the service now, so the contract PR can land. Moving every hand-built container to `createTestContainer` is the tests-and-scripts hardening's job today (APP-16), where the whole set is changed and checked at once.
Why: the cause is the hand-built container, and fixing the set belongs in one change with a guard, not in a contract PR.

## D072. Rewriting a settings file keeps the user's comments (2026-11-06)

Context: Conductor rewrites a whole settings file on every save. It sorts the keys and drops every comment (services-map 4.2.1, main @290816). SET-14 asks that a rewrite keep the user's comments, or warn before the first rewrite that would drop them.
Chosen: an existing settings file is patched in place with `@decimalturn/toml-patch` (MIT, no dependencies, released monthly). Only entries whose values change are rewritten; comments, blank lines and key order stay. A new file is written whole and sorted, as before. A comment beside or directly above an entry that the save removes goes with that entry. When a save would drop any other comment (a legacy `[tasks]` table moved to `scripts.run`, or a file the patch cannot edit), the first such save is refused with a warning that quotes the comments, and the next save that would drop the same ones goes ahead. The warning's wording is ours: the research has none, because Conductor drops comments without a word.
Why: a hand-written file belongs to the user, and a save that deletes their notes removes information. Keeping the user's key order differs from Conductor's sorted output; sorting an existing file would move the user's own lines. A hand-rolled format-preserving TOML editor would be a second TOML parser to maintain, with TOML's four string kinds, dotted keys and inline tables to get right.

## D073. PR-08's stack readiness and range diffs change two contracts (2026-11-06)

Context: PR-08's audit (slice 3 part 1d) found stack readiness and the PR and stack range diffs unbuilt. Readiness needs each stack entry's merge state and commit ids, which `StackEntryView` did not carry; the range view needs a range kind of diff scope, which `DiffScope` did not have. The approved contract list (D069) named neither.
Chosen: the lead approved both, and only what they need: `mergeStateStatus`, `headSha` and `baseSha` on `StackEntryView` (with a `MergeStateStatus` type), and `{ kind: "range"; prNumbers }` on `DiffScope`. The readiness rules follow Conductor's own code (D002: behaviour, not code).
Why: one feature needed them, so the kill rule (a contract change blocking more than one feature) did not apply, and the owner's ruling for today makes these the lead's calls.

## D074. Remote Control goes ahead on path A (2026-11-06)

Context: the Remote Control spike (RC-01, docs/plans/cloud-and-remote.md Part 2) passed all three checks with the owner on claude.ai: the chat appears, a message typed there starts a turn in our stream, and an approval answered there settles our own. It works through the query object's `enableRemoteControl`, which the SDK ships but does not put in its public types; the documented `remoteControlAtStartup` setting does nothing for an SDK chat.
Chosen: RC-02 to RC-04 are built on path A. The Agent SDK stays pinned to an exact version, and a contract test fails when `enableRemoteControl` or the shape of its answer changes. A message typed on claude.ai is shown from the agent's transcript (the stream carries only its id). An approval aborted by an answer on claude.ai closes the app's card as answered elsewhere.
Why: the kill criterion drops the feature only when it needs a reverse-engineered protocol; one SDK method outside the types, pinned and tested, is the alpha-API case the criterion allows.

## D075. Cloud workspaces go ahead (2026-11-06)

Context: the cloud spike (CLOUD-02, docs/plans/cloud-and-remote.md Part 1) passed all four kill criteria on the owner's Cloudflare account: warm start 2.3 to 8.8 s, cold start 14.5 s, about 0.02 US dollars per active hour (0.11 at worst on `standard-1`), and work kept across a restart through an R2 backup. Every `conducted-spike-*` resource was deleted and the lead confirmed none is left.
Chosen: the cloud rows are scaffolded and built through the loop, starting with the host seam (CLOUD-01). The build takes from the spike: the sidecar runs unchanged behind a WebSocket bridge, the Rust shell owns the cloud connection, the backup runs at each turn end, and an uninstall deletes the container application with the Worker.
Why: the spike's own criteria decide (D018); all four passed with margin.

## D076. A short message the app sends as the user's own chat line is on-screen wording (2026-11-06)

Context: PR-08's Resolve on a diverged stacked branch falls back to asking the agent; Conductor sends "Resolve branch incompatibility with remote", which the chat shows as the user's message. D002 forbids copying prompt text; D020 asks for Conductor's wording on screen.
Chosen: a short message the app sends in the user's name, which the chat shows as the user's line, is on-screen wording and matches Conductor (D020). Longer instructions to the agent that the user does not see as their own line stay in our own words (D002).
Why: the user reads that line in the chat like any label.

## D078. PR-07's activity list shows commits and comments, as Conductor's does (2026-11-06)

Context: PR-07's checklist asked for commits, reviews, comments and status changes in the PR activity list. The lead first planned new pull request model fields for reviews and status changes. The ui-2 fixer then read Conductor's activity list (renderApp `l6a` @9996475): it shows commits and comments only, and Conductor uses review data only for the reviewer list.
Chosen: the activity list shows commits and comments. The checklist item reads "commits and comments". The pull request model gets no new fields. The review and status branches the builder left in `PrActivityItem.tsx`, which nothing reaches, go to the desktop UI hardening.
Why: Conductor is the reference (D020), and the list it draws needs no data we lack.

## D079. App updates use the Tauri updater plugin with our own signing key (2026-11-06)

Context: PLAT-13's builder wrote a release-feed check, a download and minisign checking by hand in about 1,500 lines of Rust, and left replacing the app bundle to "the Tauri updater plugin when it is added", because no signing key or feed existed. An update could therefore be fetched and never applied. Conductor's updater is a release feed with minisign signatures (native-and-sidecar-map A9).
Chosen: PLAT-13 uses `tauri-plugin-updater`, which checks, downloads, verifies and replaces the bundle. The hand-written download and verification code goes. The signing key pair was made on this Mac with `tauri signer generate`: the private key and its password are in the keychain (services `conducted-updater-key` and `conducted-updater-key-password`), and the public key is committed in the Tauri config. The feed is a `latest.json` on the public repository's GitHub releases, written by `pnpm release`.
Why: the plugin is the maintained implementation of exactly this job, and a second copy of it cannot be kept correct.

## D080. Send feedback opens the repository's new-issue page, and says so (2026-11-06)

Context: Conductor's Send feedback posts to Conductor's own service and then says "Thank you for your feedback!" / "Thanks for making Conductor better." Conducted has no feedback service. APP-09's dialog keeps Conductor's fields (message, optional email, up to five images, "Include recent app logs") and opens the public repository's GitHub new-issue page with them filled in.
Chosen: the toast says what happened: "Opened the feedback page" / "Submit the issue there to send your feedback." Nothing claims feedback was sent before the user submits the issue. The two APP-09 checklist items that quote Conductor's toast are met by this deliberate difference.
Why: a toast that says feedback was sent when it was not would be a false success; the destination is the only one an open-source rebuild has.

## D081. The part-1e follow-ups change four contracts, one feature each (2026-11-06)

Context: the part-1e fixers left loose ends in COMP-04, COMP-06, CHAT-26, CHAT-30, SET-05, REV-11, RUN-09 and PLAT-13. Four of them could not be fixed without changing a shared contract, and the contracts are being changed on another branch today. The lead approved the changes below, each for one feature.
Chosen: the smallest change each fix needs, each in its own commit.

- CHAT-26: `PlanEntry` gains `planId` (`${eventId}:${callIndex}`), and `attachments.addPlan` takes it in place of the turn id (`model.ts`, `api.ts`). A turn that calls exit_plan_mode twice has two plans, and each attaches its own text.
- SET-05: `McpServerView.source` is `"user" | "project" | "local" | "plugin" | null` and `transport` is `"stdio" | "http" | "sse" | null` (`model.ts`). The service passes the sidecar's values through instead of inventing "User" and "stdio", and the screens print a dash for null.
- REV-11: `files.resolveConflicts` takes `seenText`, the text the choices were made on (`api.ts`). The service refuses, unchanged, a file whose disk text differs, in the same read it applies the choices to.
- RUN-09: `Shell.loginEnv` also returns `zdotdir`, the `ZDOTDIR` the app was launched with, or null (`platform.ts`, `shell.rs`). The terminal shim reads the user's dotfiles from it.
  The PR-12 audit fix in the same branch adds a required container input, `reportFailure`, which the app entry fills with its error toast. `container.ts` is not a shared contract; it is named here so the input is not a surprise.
  Why: each change serves one feature, so the kill rule (a contract change that blocks more than one feature) does not apply. Every changed field is filled from a real source; none has a default that hides a missing value.

## D082. RUN-08's spotlighter queues file changes made during a sync (2026-11-06)

Context: `bin/spotlighter.sh` runs watchexec and copies the workspace into the root on each change. Conductor's command line passes no busy-update mode. The installed watchexec 2.3.2 defaults to `do-nothing`, so changes made while a sync runs were dropped and the root ended behind the workspace; the ui-3 fixer checked this by hand.
Chosen: the spotlighter passes `--on-busy-update=queue`, so the root always ends at the workspace's latest state.
Why: the spotlighter exists to keep the root equal to the workspace; Conductor's watchexec flags rely on a default that does not do that with the watchexec we install.

## D083. Cursor's SDK installs on demand from the npm registry (2026-11-06)

Context: AGENT-09 runs Cursor's SDK in process, and D010 keeps its proprietary package out of the app bundle and the repository, so D066 left the runner unable to start. The owner ruled: "AGENT-09: Cursor's SDK installs on demand through PLAT-28, never bundled (D010)." and "PLAT-28: URLs, sizes and SHA-256 from the vendors' official release hosts, each source in the report."
Chosen: the program manager has a managed program `cursor`: @cursor/sdk 1.3.1 and its exact dependency tree, plus the native package of the Mac's CPU, each tarball from registry.npmjs.org, pinned in `release-feed.json` by version, size and SHA-256. The SHA-256s were computed from the downloaded tarballs after each matched npm's published sha512. It installs only from the Advanced page, never at launch. binaries.rs unpacks the tree into `agent-binaries/cursor/<version>/node_modules/` and links `cursor/current`; the sidecar reads that link and imports the SDK at the first Cursor chat (`runners/cursor/load-sdk.ts`). The sidecar is compiled with `--compile-autoload-package-json`: without it a Bun standalone program cannot import a package on disk whose entry sits in a subfolder, which the SDK's dependencies do. The loader and the narrow interface were checked by hand against the real package in a scratch folder: it loads, a missing agent is AgentNotFoundError, and a refused key is the SDK's AuthenticationError. No test downloads the SDK; tests use a fake behind the narrow interface.
Why: the owner's rulings. The visible difference from Conductor, which bundles the SDK, is an Install row for the Cursor SDK on the Advanced page and a Cursor card that points there.

## D084. AGENT-09 is done; Cursor's signed-in state comes from the app's own provider key (2026-11-06)

Context: D066 held AGENT-09 back for two reasons: the SDK could not ship, and the sidecar could not learn whether Cursor is signed in, because the app keeps the key in the Keychain. D083 settles the first. A chat already gets the key: the provider key the user saves in Settings reaches the runner as `CURSOR_API_KEY` in the chat's start environment, and a refused key points the user to Settings.
Chosen: AGENT-09 is done. Showing Cursor as signed in follows the fixer's proposal in D066: the desktop sets Cursor's signed-in state from whether its own provider key for Cursor is saved, a desktop-only change. That change, and removing a deleted workspace's `cursor-sdk-store/<hash>` folder, are follow-ups under APP-16 with the hardening.
Why: a user can install the SDK, pick Cursor and chat with it, which is what the row's title says; the two follow-ups change what the Agents page shows and what is removed, not whether Cursor runs.

## D086. Conductor strings that are not wording on its screens are decided out of the parity spec (2026-11-06)

Context: the parity harness (`docs/plans/parity-harness.md`) maps every entry of Conductor's inventories to our screen or to a decision. The inventories were read from the bundle by pattern, so they also hold strings no person reads as Conductor's wording: a bundled library's default that Conductor replaces (the editor's "Write something …" placeholder, which Conductor's composer never shows), code identifiers the pattern caught, and city names, which both apps use as sample workspace names.
Chosen: such an entry is mapped to D086 with a one-line reason per entry, or through a named rule in `scripts/parity/rules.ts`. It is never used to account for a string of ours. Wording Conductor does show stays a match or a gap, however small.
Why: a gap list that mixes these in hides the real gaps, and matching our text to a library default would let a wrong placeholder pass.

## D087. Terminal scrollback is encrypted with a Keychain key (2026-11-07)

Replaces D014.
Context: D014 stored scrollback as plain owner-only files because it was simpler, though Conductor encrypts its scrollback. That is a security downgrade with no product reason, and D020 asks us to match Conductor where internals do not fix a documented problem. The research gives Conductor's scheme: the local-storage layer keeps a 32-byte key in the macOS Keychain under `local-storage-entry-encryption-key-v1`, and encrypts each entry with AES-GCM, a random 12-byte nonce and the entry's subsystem, id and version as additional authenticated data (services-map.md 4.2.9, native-and-sidecar-map.md A2 and D1).
Chosen: each saved scrollback entry is AES-256-GCM encrypted under that key, created in the Keychain on first use and reused after that. The entry file holds our format magic, the random nonce and the ciphertext with its tag; the terminal id is also the additional authenticated data, and the entry is never read as plain text. A plain entry left by an earlier version is encrypted in place on the first start that opens the history folder. If encryption fails, the file is left and the failure is logged, so nothing is silently dropped and a later start retries. The migration also needs the terminal row id that names the entry, so `PtySpawn` carries `terminalId` into `pty_spawn`.
Why: D020. The user's terminal output can hold secrets, and the Keychain is where the rest of the app's secrets already live. The file format is ours; only the scheme follows the research, as the issue asks.

## D088. The app runs only its own copy of Claude Code, Codex, gh and watchexec (2026-11-07)

Replaces the fallback part of D021 and D024.
Context: D021 and D024 allowed a copy on the user's PATH "when a download is not possible". That is a silent fallback: a failed download hid behind an older PATH copy, and the user could not tell which binary ran (issue #349). Conductor runs its own copy of each, and uses another path only where the user sets one in settings.
Chosen:

- The app runs the program manager's copy (PLAT-28) of Claude Code, Codex, gh and watchexec. The only other program it runs is the one the user chose for Claude Code or Codex in Settings (SET-13). It never chooses one of these programs from the user's PATH.
- A missing copy, or a download that failed, is an error that names the program and says to Retry its download in Settings > Advanced. The agent programs and the helper programs each show their state and Retry there. No feature falls back to a PATH copy by itself.
- The sidecar's agent detection reports a managed agent with no managed copy as not installed, never as a program found on PATH, because a chat would not run it.
- ACP agents (OpenCode and Pi) are not downloaded by the app, so they keep their login-shell PATH lookup. The app's bin folder also stays first on PATH for terminals, scripts and the agents' own commands, where it is the record of the managed copies.
  Why: a program that runs is one the user can see and act on. A silent switch to a PATH copy hides a broken download and makes the failure impossible to explain. OpenCode and Pi have no managed download yet, and removing their PATH lookup would take those agents away.

## D089. Claude's model list comes from a throwaway Claude process (2026-11-07)

Proposed by the sidecar-diff fix PR; not yet ruled on by the owner.
Context: the sidecar differential run (docs/reports/sidecar-diff-2026-11-07.md) found that for `listModels` and `warmAgent`, our Claude runner starts a throwaway Claude process and reads the program's own list (`supportedModels()`, SIDE-14). Conductor has no sidecar call for this: its catalog is hosted, with a bundled copy. `catalog.ts` states the choice, but no decision recorded it. Since this PR, a chat's start also reads the list (`StartOptions.lookUpModel`), because the program's `supportsAdaptiveThinking` decides between adaptive thinking and a token budget (claude-runner.md 1.2).
Chosen: the model catalog reads each agent's list from the agent program, Claude's through a throwaway metadata query of the program and keys the chat's launch names. It caches the list in memory for one hour per launch, the interval at which Conductor refreshes its hosted catalog, so a warmed chat starts without a second listing. A chat started without a warm, on an empty cache, waits for one listing process before its own.
Why: model ids and their abilities change with each Claude release; the installed program knows them, and a table of ours would go stale. The cost is one extra short-lived process per launch per hour.

## D090. The sidecar tells the app the agent's own session id in its own notification (2026-11-07)

Proposed by the sidecar-diff fix PR; not yet ruled on by the owner.
Context: the agent's own session id (Codex's thread id, an ACP session id, Claude's session id) is what a chat resumes with. In Conductor the sidecar reads it off each agent payload (`thread_id`, `session_id`, other-runners.md 3) and every payload carries it to the app. Ours translates payloads into our own format (D005), which has no such field, and the sidecar differential run listed our `agentSessionId` notification as a difference that no decision records.
Chosen: when the agent's session id first becomes known, or changes, the session manager sends one `agentSessionId` notification (`sessionId`, `agentSessionId`). The app stores it in `sessions.agent_session_id` and passes it back as `resume` when it starts the chat's agent again.
Why: the id is a fact about the chat, not about each message, so it travels once; the stored events stay in our neutral format; and the user sees no difference, since resume works the same way.

## D091. The sidecar sends a turn's events before an approval request it causes (2026-11-07)

Context: the sidecar comparison (docs/reports/sidecar-diff-2026-11-07.md) ran Conductor's sidecar beside ours. For Claude tool approvals both send the tool call first. For Codex approvals Conductor's order changed from run to run, which is timing, not a rule. In plan mode Conductor sends the plan approval just before its own ExitPlanMode tool event. Matching that needs a rule for one tool, and sending ours without waiting put the approval ahead of the plan's own text.
Chosen: ours flushes a turn's events before every approval request (#361), plan mode included.
Why: the user sees the plan's text before the card that asks to approve it; one rule for every approval is easier to keep correct than a special case for one tool, and the visible difference is an ordering of a few milliseconds.

## D092. A workspace's host is a value, checked where its folder is handed out (2026-11-07)

Proposed by the CLOUD-01 PR; not yet ruled on by the owner.
Context: the cloud rows need each workspace to say where it lives, and every git, shell, file, terminal and chat call to respect it (services-map 1.2, frontend 3c). Conductor's host is `{ hostingServerUrl, vmId }`, with `"/"` and `""` for the Mac, and a guard runs before shell and git use. D018 planned a `Host` interface with a local and a cloud implementation.
Chosen:

- `Host` is a value in `packages/protocol`: `{ kind: "local" }` or `{ kind: "cloud", url, vmId }`, where `url` is the user's Worker and `vmId` the sandbox. A tag reads more plainly than comparing a URL with a sentinel.
- `Workspace.host` is required. Migration 0009 adds `host_kind`, `host_url` and `host_vm_id`; rows from before it are local, and a half-written cloud row is a read error, never local. A workspace made on the Mac stores the local host.
- The chat's `WorkspaceContext` carries the host to the sidecar, as Conductor's query options do.
- One check, `checkHost(host, door)` in `core/host.ts`, runs where a workspace becomes the folder a call runs in: the lookups (git and pull request contexts, the chat context, file roots, a chat's folder, `workspaceOn`), the terminal service, and the workspace service's setup, branch rename, archive, unarchive, delete and Open in. A local host passes and the call goes to the Platform exactly as before. A cloud host stops at the placeholder of the row that owns that door: CLOUD-03 for git, shell, files and chats (the Worker's routes and relay), CLOUD-09 for terminals and run commands. Nothing falls back to the Mac.
- There is no local host object. It would only pass calls on to the Platform. When CLOUD-03 builds the cloud doors, the check becomes the place that picks them.

Why: the smallest seam that the cloud rows can build on, with no change to what a local workspace does. Every existing test passes with only `host: { kind: "local" }` added to its fixtures.

## D093. The harness spec commits Conductor's on-screen wording and identifiers (2026-11-07)

Context: the parity harness (#347) runs on GitHub, so its spec must be in the repository. D002 forbids copying Conductor's code, prompt text and assets.
Chosen: `tests/parity/spec/` holds Conductor 0.92.1's user-facing wording (labels, aria labels, placeholders, titles, tooltips, text, toasts the user sees) and its identifiers (routes, test ids, sidecar method and tool names, native command names, settings keys, tables), each with its bundle offset. It holds no code and no prompt text. The `conductor-code` guard keeps any of Conductor's code out of the repository.
Why: on-screen wording is what D020 asks us to match and what docs/coverage already quotes; a check that runs where CI runs needs its data beside it.

## D103. Cloud rows are a marked local copy, not a second database (2026-11-07)

Proposed by the CLOUD-13 PR; not yet ruled on by the owner.
Context: Conductor keeps every row that belongs to a remote host in a second database, `cache.db`, and one rule, `Dn({db, cacheDb}, host)`, picks it (services-map 1.2 and 2.6.2). D038 chose one database for us and no `cache.db`; D092 then put the host on the workspace as three columns. The issue's text still describes Conductor's second file, placeholder repositories, identity associations, session feed segments and the startup mover.
Chosen:

- We keep one database. A row that belongs to a cloud workspace is a local copy in `conducted.db`, marked with the same three host columns as its workspace. Migration 0010 adds them to `sessions`, `session_events`, `session_live_state`, `diff_comments` and `terminals`.
- The host is copied from the owning workspace in the insert itself, never passed by a caller, so a row cannot be marked with a host its workspace does not have. A half-written host is a read error, never local.
- Queries that local work runs over read local rows only: the port allocator, the workspace folder-name generator, the archive scan and startup repair. The merged workspace list and the sidebar's unread counts still hold both hosts, as Conductor merges its two database lists.
- Removing a cloud host deletes its rows in every marked table and its workspaces in one transaction (`host-copy.ts`). The local host is refused.
- Because every host has always used one database, no startup mover is needed: no older version stored a cloud row anywhere else.

Not built here, and why: hidden placeholder repositories, `identity_associations`, `client_cache_session_state` and `client_cache_session_segments`, and the cloud workspace revision columns belong to the sync that creates and refreshes cloud workspaces (CLOUD-03) or whose shape the research marks INFERRED. They are left out rather than invented, and named in the CLOUD-13 report.
Why: it follows D038 and D092, keeps a local query from ever returning a cloud row, and needs no second file, second migrator or second statement queue.

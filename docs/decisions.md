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
- No `deprecated_at` on settings (unknown keys are dropped), no worktree layout version (`storage_version`). Repo scripts, prompts and file globs live in `.conducted/settings.toml` and repo-scoped settings, and shared repo settings are read from the checkout. Moving from Conductor, `conductor.json` included, is D100.
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

## D098. The UI is exactly Conductor's; our own features take the most logical place in its layout (2026-11-07)

Replaces the "kept for the owner" lists of the three parity rounds (`ui-parity-report.md`, `parity-round2-report.md`, `parity-round3-report.md`) and narrows D020's last sentence: a visible difference no longer stays because it adds information.
Context: after three parity rounds, our screens still differed from Conductor's in where some controls sat and in decoration Conductor does not have. The owner ruled on 7 November 2026:

- "i told you we're doing the UI exactly like conductor"
- "the feature controls that also exist in conductor should be in the same place as they are in conductor."
- "for decisions me made that are different then conductor, we should find the best, most logical place for these..."
- On the header's folder chip, which in Conductor is the "Open in" button: "we do what conductor does".

Chosen: every item of ours that Conductor does not show is sorted into one of three, by reading Conductor's bundle:

1. A control Conductor also has, in another place in ours, moves to Conductor's place with Conductor's words.
2. A feature of ours that Conductor does not have stays, in the most logical place within Conductor's layout and visual language. `docs/design.md`, "Ours, placed in Conductor's layout", says where each one went and why, and `tests/parity/ours-only.json` maps its words to this decision.
3. A look that carries no feature (a subtitle, a badge, a heading, a hint line, a label) is removed.

Why: the owner's ruling. A rebuild that looks exactly like Conductor is easier to compare and to switch to, and every feature of ours still has a home.

## D100. Moving from Conductor is a read-only, all-or-nothing import (2026-11-07)

Context: the owner asked for a way to move users from Conductor to Conducted, "SAFELY" (#353). D038 had left out any `conductor.json` migration, and D027 sets only `CONDUCTED_*` names.
Chosen: an import that only reads a backup copy of Conductor's database, shows a dry run first, writes Conducted's data in one transaction, checks counts after, and leaves worktrees where they are. Projects, workspaces, chats, settings with a matching key, environment variables (into the Keychain), sidebar sections, favourite models and review comments come over. Repo scripts are written once into a new `.conducted/settings.toml` with `CONDUCTOR_` names renamed to `CONDUCTED_`; script files in the repo are listed with the line to change, never edited. Chat history comes over only if the spike on real data passes its mark. The plan is docs/plans/migrate-from-conductor.md.
Why: the user can always go back to Conductor, because nothing of Conductor's is written; D027 holds without an alias, because the rename happens once on import.

## D101. The cloud Worker and its Durable Object, as CLOUD-03 built them (2026-11-07)

Context: the CLOUD-02 spike settled the sandbox SDK, the model-key swap and R2 backups, and left a short list of gaps (`docs/research/cloud-spike-2026-11-06.md`, "The plan's questions 3, 4 and 7"). CLOUD-03 builds the Worker, the Durable Object, the routes and the relay; several choices the spike left open had to be made to finish it.

Chosen:

- **Turn state comes from the relay.** The Durable Object sets a keep-alive alarm when a `sendMessage` request passes through and clears it on the sidecar's `liveState: idle`. While a turn runs the alarm touches the sandbox's `/health` every 60 seconds, which resets the container's inactivity timer. This is the signal the spike said was missing; it needs no second channel from the sandbox.
- **One pairing token per Mac.** It is stored in the Keychain under `cloud-pairing-token` and read by Rust; the web view never sees it. CLOUD-07 owns the pairing flow and may make it per Worker.
- **A cloud workspace's folder is its absolute path inside the sandbox.** The same string is the `cwd` the Worker receives and the folder the sidecar is given; a cloud workspace's repository root is that folder too. Workspace creation in the cloud (CLOUD-08) must therefore give each cloud workspace a unique sandbox path.
- **A cloud launch carries no secret and no Mac program path.** The router replaces every provider key with `provided-by-worker` and drops `executablePath`, so the sandbox's sidecar finds the product image's managed Claude Code, Codex and gh (CLOUD-04). The Worker's outbound handler swaps the real key for the model API.
- **A cloud "trash" removes the file**, because a sandbox has no macOS Trash. The file commands in the Worker use the Sandbox SDK's own operations.
- **The Worker's tests run in workerd without a container.** `@cloudflare/vitest-plugin` exercises the token, the routes, the Durable Object's state and alarm, and the relay's turn reading. Container-backed route execution needs the image and Docker, so the live run above is its verification until CLOUD-04's image has a CI job.
- **The relay frames lines.** The Rust relay appends the newline and the cloud transport splits incoming frames on newlines, because the sidecar's Unix socket speaks NDJSON and the WebSocket does not.
- **The doors CLOUD-03 does not own keep their own row's placeholder.** A cloud workspace's file search stops at CLOUD-11, Open in at CLOUD-12, and archive, unarchive and delete at CLOUD-08, each through the same `checkHost` check that stops terminals at CLOUD-09. The alternative was letting those calls reach the Mac with a sandbox path, which D092 forbids and which would run the wrong operation on the wrong machine.

Why: each choice either uses the spike's own finding or is the smallest thing that makes the desktop's existing calls work unchanged. The live run on the owner's account passed with these choices (numbers in the research note).

## D102. The sandbox's setup scripts may reach these package hosts (2026-11-07)

Proposed by the CLOUD-04 PR; not yet ruled on by the owner.
Context: `cloud-and-remote.md` Part 1 says the outbound allow-list holds "the package registries the setup script needs", and the CLOUD-02 spike found npm refused (403) inside the sandbox. Neither the plan nor the research names a registry, and Conductor's cloud is not in the research, so there is no reference list to copy (D002: report the gap).
Chosen: `apps/cloud/sandbox/package-allow-list.ts` holds one sorted list of exact host names: npm's and Yarn's registry, PyPI and its file host, crates.io's index and download host, RubyGems, the Go module proxy and checksum database, Maven Central's two hosts, NuGet, Composer's Packagist, and Debian's apt hosts. Matching lowercases the name and removes one trailing root dot; it is exact, so a subdomain or a look-alike suffix does not pass. The Worker's outbound handler (CLOUD-05) adds GitHub and the model gateway and reads this list.
Why: a setup script must be able to install the project's dependencies, and data keeps the answer in one place. The list is our choice; it can grow when a real setup script needs another host.

### CLOUD-04's extra-software checklist item is not built

The checklist item "The sandbox image can include extra installed software chosen in settings" cites `ui-map.md` section 6, where the control lives on the Organization > Cloud computer page ("Install software", "Build computer"). That is an organization (team) setting, and D004 and D018 keep organizations and team features out. The image therefore has no software-install setting; a setup script installs software in the sandbox instead, subject to the hosts above.

## D103. The host has one home on the workspace; cloud rows follow it by reference (2026-11-07)

Proposed by the CLOUD-13 PR; not yet ruled on by the owner.
Context: Conductor keeps every row that belongs to a remote host in a second database, `cache.db`, and one rule, `Dn({db, cacheDb}, host)`, picks it (services-map 1.2 and 2.6.2). D038 chose one database for us and no `cache.db`; D092 put the host on the workspace as three columns. The issue's text still describes Conductor's second file, placeholder repositories, identity associations, session feed segments and the startup mover.
Chosen:

- The host is a fact of the workspace and has one home: `workspaces.host_kind`, `host_url` and `host_vm_id` (migration 0009). A cloud workspace's sessions, events, live state, comments and terminals are its local copy. They follow it by reference: `sessions`, `diff_comments` and `terminals` reference `workspaces(id)` and `session_events` and `session_live_state` reference `sessions(id)`, all `ON DELETE CASCADE` (0001_init.sql, with terminals rebuilt in 0004).
- Queries that local work runs over keep local rows by joining to `workspaces` and filtering `host_kind = 'local'`: the port allocator, the workspace folder-name generator, the archive scan and startup repair. The merged workspace list and the sidebar's unread counts still hold both hosts, as Conductor merges its two database lists.
- Removing a cloud host deletes that host's workspaces in one transaction (`host-copy.ts`); the cascades remove the sessions, events, live state, comments and terminals. The local host is refused.
- Because every host has always used one database, no startup mover is needed: no older version stored a cloud row anywhere else.

Not built here, and why: hidden placeholder repositories, `identity_associations`, `client_cache_session_state` and `client_cache_session_segments`, and the cloud workspace revision columns belong to the sync that creates and refreshes cloud workspaces (CLOUD-03) or whose shape the research marks INFERRED. They are left out rather than invented, and named in the CLOUD-13 report.
Why this differs from Conductor: Conductor's repository code runs against either physical file, so the file is its boundary. We keep one file and one statement queue, and the workspace row is already the boundary every child row reaches through its key. Copying the host onto each child would be six homes for one fact and would add three columns and an index to every event row, our largest table. Cascades also make the host sweep atomic without marking the children.

## D104. The outbound handler's allow-list and credential swap, as CLOUD-05 built it (2026-11-07)

Context: CLOUD-05 builds the Worker entrypoint every request from the sandbox passes through. The plan says the allow-list holds GitHub, the model gateway and the package registries; D102 fixed the package hosts. The research names the key variables and Conductor's local GitHub token settings, but not a Worker-side mapping, and Conductor's cloud backend is not in the research (D002). The live run is in `docs/research/cloud-spike-2026-11-06.md`.

Chosen:

- **The request's hostname picks the secret.** `api.anthropic.com` receives `ANTHROPIC_API_KEY` in `x-api-key`; `api.openai.com` receives `OPENAI_API_KEY` as a bearer token. The desktop's provider choice reaches the Worker as the host the agent calls, so the Worker needs no second setting. Any placeholder the sandbox sent in `authorization` or `x-api-key` is removed first.
- **GitHub's hosts receive the token.** `github.com` and `codeload.github.com` take HTTP basic auth with `x-access-token` and the secret as the password; `api.github.com`, `uploads.github.com`, `raw.githubusercontent.com` and `objects.githubusercontent.com` take a bearer token. The token is added even when the sandbox sent no `authorization`, so `git` and a plain HTTP client reach GitHub without holding it.
- **Redirects are answered, not followed.** A 3xx goes back to the sandbox, so the next hop comes through the same allow-list and swap instead of carrying a credential somewhere new.
- **Exact hosts; credentials over HTTPS only.** A model API or GitHub host over plain HTTP is refused. A package host may use HTTP (Debian's apt sources do) or HTTPS. A look-alike name such as `registry.npmjs.org.example.com` is refused.
- **No Cursor row.** The research names no Cursor API host and CLOUD-04's image has no Cursor SDK, so Cursor's credential swap waits for CLOUD-18, which brings both.
- **`gh` gets a placeholder value.** `gh` makes no request at all without a `GH_TOKEN` value, so the container environment sets `GH_TOKEN=provided-by-worker` (`sandbox-git-env.ts`, spread into `CONTAINER_ENV`). The live run proved both halves: without it `gh` exits 4 asking for `gh auth login`; with it, `gh api user` answers as the Mac's login.
- **Git gets a scrubbed environment.** `SANDBOX_GIT_ENV` also sets `GIT_TERMINAL_PROMPT=0`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, an empty `credential.helper` and `credential.https://github.com.helper`, `core.hooksPath=/dev/null`, and `url.https://github.com/.insteadOf` for `git@github.com:` and `ssh://git@github.com/`. The rewrite sends an SSH remote through the Worker, where the token is added; the rest keeps the user's config, prompts and hooks out of the sandbox.

Why: the host is the only thing the sandbox's HTTP call states about which provider it is talking to, and keying the swap on it keeps every secret in the Worker without a second channel. The live run on the owner's account passed with these choices: Anthropic's `/v1/models` and GitHub's `/user` both answered 200 from a sandbox holding no credential, and a look-alike and an unlisted host both got 403.

### Issue #247's checklist, item by item

Twelve items. (a) is built here, (b) is Conductor's organisation or team UI, which D004 and D018 keep out, and (c) is owned by another open row.

1. **Environment: variable scopes for local and cloud contexts** — (c) CLOUD-17 (#259) lists "Variable scopes include a cloud context beside the local ones" (services-map 4.2.8).
2. **Auth reaches Claude by env or by a brokered OAuth token injected on each spawn** — (a) for the env path: the Worker swaps the Anthropic key whether the launch sent it as `x-api-key` or as the OAuth bearer header. The brokered OAuth token is CLOUD-18 (#260).
3. **A rejected OAuth token, changed credentials or a token expiring in 5 minutes forces a respawn** — (a) for the part a Worker-swapped key has: the handler reads the secret on every request, so a changed credential takes effect on the next one. An API key has no expiry, and a rejected key is returned to the client as the provider sent it. The OAuth token's respawn is CLOUD-18.
4. **An expired token is flagged and refreshed on the next spawn** — (a) for the part a Worker-swapped key has: an API key does not expire and is never cached, and the provider's 401 reaches the client for the app to flag. Refreshing an OAuth token is CLOUD-18.
5. **Internal mode uses brokers for secrets** — (a) the Worker is the broker: the container environment holds no model key, and the outbound handler inserts it per request.
6. **A cloud workspace reaches GitHub without a token inside the sandbox** — (a) `GH_TOKEN` is only the placeholder; the Worker adds the real token to GitHub's hosts.
7. **Git in a sandbox runs with a scrubbed environment** — (a) `SANDBOX_GIT_ENV` in the container environment.
8. **The cloud GitHub token is entered once and kept in the Worker, with a Disconnect** — (b) the entry form and Disconnect are Conductor's organisation GitHub page (ui-map 6 Organization), a team feature kept out by D004 and D018. The Worker secret itself exists and is swapped.
9. **Personal and shared cloud variables go to the Worker as secrets** — (b) for the shared half, which is an organisation feature (D004, D018). The personal half is CLOUD-17 (#259), whose "cloud environment variables" item stores them.
10. **The server keys for Claude, Codex and Cursor credential selection decide which model key the Worker swaps in** — (c) CLOUD-17 (#259) lists "Which model key the Worker uses for cloud runs". The Worker swaps by API host, and Cursor's host is CLOUD-18's.
11. **The server key personalCloudEnvVars holds the user's cloud environment variables** — (c) CLOUD-17 (#259) lists the cloud environment variables.
12. **The gh_cloud token keys are handled by the Worker's outbound token swap** — (a) the Worker's `GITHUB_TOKEN` replaces the `gh_cloud` token for GitHub's hosts, including the placeholder the sandbox's git environment sends.

## D105. A cloud workspace saves its work to R2 at each turn end and restores it when it starts (2026-11-07)

Context: the CLOUD-02 spike proved that the sandbox disk is wiped when it stops, and that an R2 directory backup of `/workspace` and `/root/.claude`, taken explicitly before a restart, brought back the uncommitted work and the transcript Claude resumed (`docs/research/cloud-spike-2026-11-06.md`, criterion 4). It also named two gaps: the backup must run at every turn end, and the Durable Object must learn about a turn end from the sandbox rather than only from a connected desktop. CLOUD-06 builds those parts.
Chosen:

- **What is saved.** `/workspace` (the repository and its uncommitted work), `/root/.claude` (Claude's transcripts) and `/root/.codex` (Codex's threads), one directory backup each. The two transcript folders are the persisted store an agent resumes from: sessions.md section 8 for Claude, other-runners.md for Codex. A directory the agent has not created yet is skipped, not saved as an error. `/workspace` is saved whole, with no gitignore exclude, because a cloud restart has no setup rerun yet, so an installed dependency must survive with the work that needs it.
- **When it is saved.** The sandbox entry reads each line the sidecar sends through the relay. When a `liveState: idle` line leaves no chat working, it posts to `http://conducted.internal/turn-end/<workspace>`. The Worker's outbound handler sends that call to the workspace's Durable Object, which saves the three directories. The turn-end signal is the same relay signal D101 uses for the keep-alive alarm; no second channel from the sidecar is needed.
- **When nobody is connected.** The entry sees the sidecar's lines only through the app's WebSocket. A turn that ends while the desktop is disconnected is therefore not saved at that moment; the next turn end with the app connected saves the whole directory, including that turn's files. If the sandbox stops before then, everything since the last backup is lost. This is the loss the spike recorded, now bounded to that window.
- **When it is restored.** `start` restores the latest record of each directory only when that call started a stopped container; a warm sandbox is never overwritten. A restore that fails makes the start fail, so the app does not show work that did not come back, and a retry restores again.
- **How long it is kept.** The Durable Object stores one record per directory. A new backup is stored before the object it replaces is deleted, so a crash leaves a spare object, never a record that points at nothing. Once a save finishes the bucket holds three objects per workspace, replaced at each turn end. Deleting a workspace (CLOUD-08) and uninstalling the Worker (CLOUD-07) must delete them; neither flow is built yet.
- **What is not saved.** The sidecar's write-ahead event log (`/var/conducted/outbox`) is not part of the backup, so an event the desktop had not stored when the sandbox died can still be lost. The spike's loss list names it. Events remain the desktop's record, as D103 has it.

Why not container snapshots: the spike found no API that lists or deletes them and they expire after 30 days, so they cannot meet the "delete everything" rule (`docs/research/cloud-spike-2026-11-06.md`).
Why: this is the spike's own method, extended to the second agent's transcript store and to the signal the spike said was missing. The bucket's size is bounded by the number of workspaces, not the number of turns.

## D106. Pairing a Mac with a Worker keeps one URL and one token, checked before they are saved (2026-11-07)

Proposed by the CLOUD-07 PR; not yet ruled on by the owner.
Context: D101 stores one pairing token per Mac under `cloud-pairing-token` and leaves the pairing flow to this row. The CLOUD-02 spike kept the token in a mode-600 file and named the Keychain as the product's home (question 4). Conductor has no self-hosted Worker to pair with, so its screens give no place or wording to copy; the flow and its form are ours (D098, D020: report the gap).
Chosen:

- A pairing is a Worker URL and its token. The app sends both to the Worker's `GET /pair` before it saves either. The answer must name the service `conducted-cloud` and report `paired: true`; anything else is refused, so a URL that answers any request is not taken for a Worker. A 401 is its own message.
- The Worker URL is kept in the Keychain under `cloud-pairing-url` and the token under `cloud-pairing-token`, both in the app's service. The URL is written before the token, and only a non-empty token counts as paired. The token never returns to the web view, a log or an event; the URL does, so the app can show which Worker the Mac is paired with.
- One pairing per Mac: pairing another Worker replaces the URL and token. A cloud workspace still names its own Worker URL on its host (D092), so a workspace whose Worker is not the paired one fails with the Worker's own refusal rather than falling back to the Mac.
- The form lives in a "Cloud Workspaces" block on the Connections page, our own page (D098). Unpair removes both items; a Mac that was never paired succeeds.
- The Worker's `/pair` route sits behind the same token check as every other route and touches no Durable Object, so a Mac can pair before the first workspace exists.

Why: the user can check the token with the Worker at the moment they paste it, and a wrong URL or token changes nothing. Keeping the URL makes the state after a restart readable. Per-Worker tokens stay possible later; the Keychain keys can gain a Worker suffix when a second Worker needs its own token.

## D107. Conductor's account controls stay out of the matched screens (2026-11-07)

Context: the second round of D098 found two more Conductor controls that only work with a Conductor account: the organisation switcher at the top of the sidebar and of Settings ("Sam Rivera's Mac", whose menu holds the organisations, "Create organization", "Upgrade to Pro" and "Log out"), and the Loadout's "Share" button on Default models ("Sign in to share a loadout"; it opens a page on Conductor's service).
Chosen: neither is built, by D025. The switcher's one local item, Settings, is the sidebar's gear. Our loadout has no way to share; nothing takes the button's place.
Why: both reach Conductor's own service and account, which D025 leaves out; a control that cannot work would be a look without a feature, which D098 removes.

## D108. Cloud terminals and previews, as CLOUD-09 built them (2026-11-07)

Context: the plan's Part 1 point 7 asks for terminals through the sandbox's exec streaming and a WebSocket terminal, and previews through the Worker's port forwarding. The CLOUD-02 spike left PTY terminals and previews unexercised, and noted that previews need their own hostname so one preview cannot read another's cookies or storage. Research describes Conductor's cloud backend only as a concept, so the wire protocol is ours (D002), not copied.
Chosen:

- **One JSON message per line over the Worker's WebSocket.** A terminal opens `/w/<name>/terminal`; its first message is `start` (folder, size, command, environment), then `input`, `resize` and `kill`. Output is `data` with base64 bytes, plus `exit` and `error`. The Durable Object runs `container.exec` with a PTY and a piped stdin and stdout. A run script uses the same path with `/bin/bash -l -c <script>`; a cloud setup script gets `set -euo pipefail` in front of it.
- **The Rust relay takes a channel.** `cloud_relay_open` accepts `rpc` (the sidecar, the default) or `terminal`, so the app needs no second WebSocket command set and the pairing token still never reaches the web view. The terminal's wire protocol is the stream's content, not a second transport.
- **A dropped stream ends the terminal with "Connection lost."** The app does not claim a process ended when it only lost the connection, and it does not resume a terminal. A `kill` or an `exit` carries the real code.
- **A preview is a capability URL under the Worker's hostname.** `POST /w/<name>/preview-url {port}` returns `/w/<name>/preview/<token>/<port>/...`; the token is HMAC-SHA256 of `${name}:${port}` keyed by the pairing token, so the Worker stores no preview state and the URL can be copied to anyone the user wants to show it to. The proxy forwards any method and a WebSocket upgrade to `container.getTcpPort(port)`. Port 22 is refused, as the research reserves it for SSH.
- **The terminal's text mirror is lines, not a VT screen.** The desktop renderer holds the real screen; the sandbox keeps the last 5,000 lines so `GetTerminalOutput` and a reopened terminal have text.
- **Previews do not have their own hostname.** The spike's isolation note is not met. A dev server that builds absolute asset URLs from `/` will not render through the path. A hostname per preview needs a custom domain with a wildcard route and is not built.

Why: the relay's channel and the JSON-per-line protocol reuse the connection the Worker already authenticates and the Rust shell already owns; the capability token makes previews work from a browser that holds no key, without storing per-port state. Why not a second transport: it would duplicate the relay's close, error and restart handling for no gain.

## D109. The app ships the Worker it deploys; wrangler is installed by the user and Docker builds the image (2026-11-07)

Context: CLOUD-08 was held for the decision its issue asked for. Its checklist is Conductor's cloud collaboration onboarding and its organization's Cloud computer page (ui-map 2 and 6), both of which configure Conductor's own hosted computers and account. D018 replaced those with a Worker each user deploys to their own Cloudflare account, and D004 and D025 keep organizations and hosted-service features out. The self-hosted deploy flow itself had no screen to copy, because Conductor has no self-hosted Worker. The first build took a Worker folder from the user; the lead's review found that a folder a user prepares is not a deploy flow.
Chosen:

- **The app carries what it deploys.** `scripts/cloud/prepare-deploy.ts` builds the sandbox image's inputs (`apps/cloud/sandbox/build.ts`), bundles the Worker with `wrangler deploy --dry-run` against a config that has no containers (so the dry run never builds an image), and writes `worker.js`, `deploy.json`, the sandbox `Dockerfile` and its `build/` output into the Rust shell's git-ignored cloud resources folder, which only a build creates. The release config (`tauri.release.conf.json`) adds that folder to the bundle as `cloud/`, and the release CI and `pnpm dev` run the script first. Rust reads `resource_dir()/cloud`, writes the per-deploy config into a temp folder, and runs the user's `wrangler`; the Web view asks for no folder and saves no setting.
- **The names derive from one.** The bundled default is `conducted-cloud`; the R2 bucket is the Worker name and the container application is `<worker>-sandbox`. The input may override the name, which the live check uses for `conducted-dev-c08-<time>`; the UI passes none.
- **`wrangler` is not a managed program, and its absence says what to install.** D088 says the app runs only its own copies of the programs it runs, and PLAT-35 manages `gh` and `watchexec` as single binaries. Wrangler is an npm package that needs a JavaScript runtime; the app ships a compiled sidecar, not a general Node or Bun runtime it could run wrangler with. Managing it would mean shipping a runtime and resyncing wrangler's own dependencies on every update. So the user installs it, and the missing-wrangler error names the exact steps: install Node.js from https://nodejs.org, run `npm install -g wrangler`, then `wrangler login`.
- **Docker is still required, because Cloudflare's docs do not support a prebuilt image for our scheduling policy.** The Container is started by the Durable Object with `ctx.container.start({ image, instance })`, so it uses the `durable_object` scheduling policy. Under that policy the image must be a digest-pinned reference in the Cloudflare managed registry (`registry.cloudflare.com/<ACCOUNT_ID>/<REPOSITORY>@sha256:<DIGEST>`); Docker Hub, Amazon ECR and Google Artifact Registry are not accepted. That reference is account-scoped, and the docs do not document a cross-account pull, so publishing once from our account and having each user reference it is not a supported path. The deprecated `default` policy does accept Docker Hub, ECR and GAR without Docker, but it fixes one image and instance type application-wide in the Wrangler config and does not let the Durable Object choose them. We keep `durable_object`, and a deploy checks Docker before creating anything and says to install and start it. Sources, read 2026-11-07: https://developers.cloudflare.com/containers/guides/image-management/, https://developers.cloudflare.com/containers/configuration/scheduling-policy/, https://developers.cloudflare.com/containers/guides/deploy/.
- **The pairing token is made in Rust.** 32 random bytes from `/dev/urandom`, base64url, written to a mode-600 file that `wrangler deploy --secrets-file` reads and that is removed whatever the deploy does. The token never reaches the web view. A successful deploy checks the Worker's `/pair` and keeps the URL and token in the Keychain, exactly as CLOUD-07's pairing does.
- **The uninstall removes billing first.** It deletes the Worker, then its container application and its images, then the R2 bucket, and finally unpairs this Mac. Deleting the Worker alone leaves its container application billing (the spike's finding). A resource the account does not have is skipped, so a second uninstall succeeds.
- **Conductor's cloud onboarding and Cloud computer page are left out.** The "Workspaces now run in the cloud" onboarding, its Enter shortcut, the "Set up cloud" step, the send-button coach mark, and the Cloud computer page's build log, Settings, Logs and Activate are Conductor-hosted or organization features (D004, D018, D025), and D002 keeps their wording out too. The deploy and remove controls live on our Connections page instead (D098, D106).
- **A cloud workspace's archive, unarchive and delete belong to its Worker.** Archive reads the branch head through the Worker, saves the work to R2 and stops the sandbox; unarchive moves the row back; delete removes the backups, sandbox and Durable Object storage before the local row is dropped.

Why: the user's own account stays the only home for the Worker and its data, the app carries the code it deploys, no secret enters the web view, and the two outside tools a deploy needs are named when they are missing.

Live verification: one deploy and uninstall through `deploy_worker` and `uninstall_worker` under `conducted-dev-c08-<time>`, with the Worker, container application, images and bucket checked gone afterwards. The numbers and the exact checks are in `docs/research/cloud-spike-2026-11-06.md`.

## D110. Port forwarding from a cloud workspace to the Mac, as CLOUD-10 built it (2026-11-07)

Context: CLOUD-10 finishes the row the CLOUD-09 part started: a cloud workspace's ports reach this Mac. Conductor's own forwarding is built on SSH to its sandboxes (`services-map.md` 5A.3.3, `native-and-sidecar-map.md` A10). Our cloud workspaces are Workers and containers, which have no SSH door, and the research does not describe Conductor's cloud backend beyond the concept (D002). The plan only says previews go "through the Worker's port forwarding".
Chosen:

- **One WebSocket per forwarded connection, through the Worker.** The Rust shell binds `127.0.0.1:<local>` and, for each accepted TCP connection, opens `wss://<worker>/w/<vm>/tunnel?port=<remote>` with the pairing token. The Worker hands the upgrade to the sandbox entry on its existing port (8080), and the entry connects it to `127.0.0.1:<remote>` inside the container. The entry also answers `GET /ports` from `/proc/net/tcp{,6}` and names each port's process from `/proc/<pid>/cmdline` with Conductor's summariser (`node /tmp/server.js` is `server.js`, `node_modules/.bin/vite` is `vite`), not the kernel's `comm`, which for Node is `MainThread`.
- **The pairing token stays in Rust, so there is no token round trip.** Conductor emits `port-forward-token-request` and the screen answers with a short-lived `ws-token`, because its UI holds the cloud login and Rust holds the tunnel. In our design Rust already holds the one pairing token (D101, D106) and the web view must never see it, so `start_port_forward` reads the Keychain itself. The token-request event and the `resolve_port_forward_token`/`reject_port_forward_token` commands are therefore not built; the two commands that remain are `start_port_forward` and `stop_port_forward`, with `list_port_forwards` and `find_available_local_port`.
- **The table and the two workspace switches are migration 0014.** `port_forwards` has the research's columns and unique indexes (one local port per machine, one remote port per workspace); `workspaces.port_forwarding_enabled` and `auto_forward_enabled` are the workspace's switches. Rows are removed when a workspace is archived or deleted and on startup for archived or missing workspaces, as the research's archive and startup sweep say.
- **The four Conductor org-personal keys are local user settings.** `port_forwarding_strategy` (`match`/`range`), `local_port_range_start`/`_end` (20000 to 29999), `port_mappings` (lines of `remote:local`) and `exclusive_port_forwarding_enabled` live in the settings table because this app has no server-side settings store (D018 keeps accounts and organisations out). Conductor's server scope would be an organisation feature; the behaviour is the same on this Mac.
- **Allocation is Conductor's rule, and the Rust command finds the free port.** A manual mapping wins and refuses a taken port with Conductor's message; `match` prefers a usable remote port; otherwise the range start is `start + djb2(workspace) % span`. `find_available_local_port` then scans from that preference, skipping ports below 1024, port 22 and ports the table owns. A bind failure retries up to five times with a new local port, as Conductor does.
- **Discovery polls.** The service reads `/ports` every three seconds while a workspace forwards, and reconciles auto-detected rows: a vanished port is stopped and deleted, a new one is added and started, and a row the user turned off stays off. The Worker has no push channel for listening ports.
- **The UI is where Conductor puts it.** The Ports tab of a cloud workspace shows Start forwarding (Cmd+Y), Waiting for ports, and the Forward ports popover (Ports detected, Ports unavailable, Forwarded ports, a typed remote port, Auto-forwarding, Forward to localhost, Copy preview URL, Cancel forwarding port). A sidebar row shows the Forwarding ports badge. The workspace actions menu has Pause port forwarding with a confirm. Connections gains the four settings. Messages are the research's, including "Enter a valid port (1-65535)" and "Port 22 is reserved for SSH and cannot be forwarded here".
- **Not built, and why.** The SSH forward and the generated `~/.ssh/conductor_config` have no meaning for a Worker sandbox; the tunnel replaces them. Moving a forward up and down in the list is ordering only and is not built. Manual overrides are authored as text lines rather than Conductor's pair editor; the stored shape is the same. A per-preview hostname stays out (D108).
- **Left out under D004 and D018.** Nothing in this row is organisation-only. Exclusive forwarding is described in the research as an org+server setting; here it applies to the Mac's cloud workspaces, which is the same rule without an organisation.

Why: the tunnel reuses the connection the Worker already authenticates and the Rust shell already owns, keeps every secret on the Rust side, and gives raw TCP (SSH, databases, dev servers) rather than only HTTP, which the preview path cannot do. The cost is Conductor's per-connection WebSocket and a three-second poll instead of its multiplexed subscription.

## D111. The local mirror syncs over the Worker's file routes and is text-first (2026-11-07)

Context: CLOUD-11 builds the local mirror of a cloud workspace and its file sync. Conductor's sync is a Rust crate pair (`file_sync_client`, `file_sync_core`) with its own `/files/sync/` endpoints (native-and-sidecar-map A10, services-map 5B.10.1). D018 replaced Conductor's native sync commands with the Host interface, and D101 already gives a cloud workspace's file calls to its Worker's `/files` route. The brief's checklists are Conductor's inventory; this decision records what CLOUD-11 built, what it deliberately did not build, and why.

Chosen:

- **One-way, remote-to-local.** A ready cloud workspace's files are listed through the Worker's new `/files list` operation and each text file is read through `/files read`. The mirror is `<conducted root>/remote-workspace-sync/<repository>/<workspace id>`. The direction is remote to local, the default the research gives (`remoteToLocal` with `files:read`). A local change is not pushed back.
- **The baseline sits beside the mirror.** The list of what was mirrored is `baseline.json` in `<mirror>.sync/`, a sibling folder, so it never appears in the file tree a search reads. The next sync removes a mirrored file the sandbox no longer lists, with `trash`.
- **The path guard is one function.** `guardedRelativePath` refuses an absolute path, NUL, `..` and any `.git` segment. The Worker's walker never follows a symlink. Both the mirror and an upload use it, so a path cannot leave the workspace.
- **Search reads the mirror.** `WorkspaceFilesService.tree`, `quickOpen` and `grep` take a search root: the workspace folder on the Mac, or the mirror of a cloud workspace. The sync runs when the file tree or a search needs it and the last sync is more than five seconds old, which is the research's poll interval. Every other file call (read, save, stat) still goes to the Worker as CLOUD-03 built it.
- **A cloud file opens from the mirror, or from Downloads.** The file tab's Reveal in Finder and Open in another app use the mirror's copy. When the mirror has none, the file's text is written to `~/Downloads` and the toast says "Saved to" with a "Downloads" button. A path outside the mirror answers "File is outside the synced workspace"; a failed reveal answers "Could not open Downloads. Try again.".
- **An upload is a guarded Worker write.** `uploadFile` reads the Mac file and writes it through `/files write`, then updates the mirror. It carries text only, because `/files write` carries text (D101's file route). No Rust command and no crate is added: D018's Host interface plus the Worker route is the door, so `start_remote_file_sync` and its siblings are not rebuilt as Tauri commands.
- **The setting starts the sync for new cloud workspaces.** `auto_sync_files_in_new_cloud_workspaces` (Advanced, default true) is the CLOUD-11 switch. `file_include_globs` keeps its existing one home as the repository's list of files copied into a new workspace (SET-07, WS-03); the cloud upload of that list is not built because no cloud workspace creation flow exists yet to call it.
- **The scripts panel shows the states.** The panel shows Conductor's words: "Sync files is off", "Sync folder unavailable", "Sync files failed", and "Local terminal unavailable" as the title when the mirror folder is unavailable.

Left out, and why:

- **Binary files and files over 2 MiB are left out of the mirror.** The Worker's file route speaks text, and a second binary route would need its own transfer and a new local write door. `baseline.json` names each skipped entry and why; the file tree does not list it.
- **No push signal.** The Worker has no `file-sync:changed` topic and no delta revisions, so every poll lists the whole tree. The mirror is correct but re-reads each file; the research's revision and generation cursors are not built.
- **No snapshot materialisation for a stopped sandbox.** Conductor applies a 64 MiB snapshot patch to a stopped VM with `git worktree add` and a detached ref. Our Worker's list needs a running sandbox, so a stopped workspace keeps the last mirror and reports the failed sync.
- **No local terminal on the mirror.** The scripts panel shows "Local terminal unavailable"; a local PTY in the mirror needs a per-terminal host column and is not built. The existing panel offers only the Cloud terminal (CLOUD-09).
- **Conductor's `start_remote_file_sync` family and its `remote-file-sync-status` events are not rebuilt.** D018 replaced them with the Host interface; the service's store and the hook are the app's status surface.

Contract changes made for this row: `WorkspaceFilesService` gains an optional `searchRootOf`, `cloudOpen` and `hostKindOf`; the `files.reveal` action answers `{ path, downloaded }` and a `files.revealPath` action shows an already-downloaded path; `Queries` gains `useFileSyncStatus`; the settings registry gains `auto_sync_files_in_new_cloud_workspaces`; the Worker's file body gains `list` and a `file-list.ts` walker. The Worker's `/files list` returns at most 20,000 entries and says `truncated`; a bigger tree is not mirrored whole.

Why: the mirror uses the connection the app already owns, the pairing token stays in Rust, and text files are what file search, quick open and the local editor can use. The limits above are reported rather than hidden.

No live Cloudflare run was made for this row, so no number is added to the spike note. The Worker's new walker is proved by a unit test with a fake sandbox; the Worker's routes run in workerd without a container, as D101 has it.

## D117. The Cloud desktop tab is Conductor's hosted computer, and is left out (2026-11-07)

Context: CLOUD-16 (#258) lists six items behind "if the spike shows it is wanted": the centre "Cloud desktop" tab (ui-map 3.2), the git panel's "Desktop" tab (ui-map 3.6) and the "Cloud desktop" dialog (ui-map 3.10), with Reconnect and the notices "You need edit access to use the cloud desktop" and "Cloud desktop is available in cloud workspaces". The research records the labels but not the surface behind them. Conductor's extracted frontend bundle (the `virtual-desktop` component in renderApp, read 2026-11-07) settles it: the tab opens a noVNC (RFB) session. It asks Conductor's own service for the connection (`/direct/desktop`, scope `desktop:connect`) on the workspace host's `hostingServerUrl` and `vmId`, and renders only while the remote computer reports `remoteState.status === "running"` (the states are `initializing` with `building_snapshot`, `preparing` or `updating`, then `running`, `stopped`, `unresponsive`, `restarting` and `deleted`). The "edit access" notice reads the shared workspace's permission level (`write`, `read` or `admin`), and ui-map section 1.2 files the cloud desktop with the cloud (team) features.

Chosen: all six items are left out.

- The centre Cloud desktop tab, including its Reconnect button, the edit-access notice and the notice for workspaces that are not cloud, is not built.
- The git panel's Desktop tab with the cloud desktop stream is not built.
- The Cloud desktop dialog for cloud workspaces is not built.

Why: the cloud desktop is a GUI on Conductor's hosted computers, the service it runs for its own cloud product. D025 already leaves those computers and Conductor's cloud backend out, and D004 keeps the team half out. Our cloud workspaces are headless Cloudflare sandbox containers with an agent, a shell and files (D018, D101); they have no display server, no VNC/RFB endpoint and no hosted computer to stream. Building these items would mean inventing a remote-desktop layer that the research does not describe and the plan does not include, and nothing in the CLOUD-02 spike shows a desktop is wanted. Their wording stays out too (D002).

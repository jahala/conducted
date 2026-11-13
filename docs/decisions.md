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
Since D018 and D127: cloud workspaces are built, and the organisation switcher is taken for this Mac and the paired Worker only.

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

Replaces D004 for cloud workspaces. Team features (organizations, shared workspaces, routines, workspace chat) stay out. D127 takes one organisation feature, the switcher, because it is how Conductor chooses where a workspace runs.
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
- Queries that local work runs over keep local rows by joining to `workspaces` and filtering `host_kind = 'local'`: the port allocator, the archive scan and startup repair. The merged workspace list and the sidebar's unread counts still hold both hosts, as Conductor merges its two database lists. (D127: the folder-name generator reads every host's rows, because the `(repo_id, directory_name)` unique index spans hosts; the lists the screens show follow the active organisation.)
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
- **No Cursor row.** The research names no Cursor API host and CLOUD-04's image has no Cursor SDK, so Cursor's credential swap waits for CLOUD-18, which brings both. (CLOUD-18 added the host, `api2.cursor.sh`; the Linux SDK is still missing. D118.)
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
- **How long it is kept.** The Durable Object stores one record per directory. A new backup is stored before the object it replaces is deleted, so a crash leaves a spare object, never a record that points at nothing. Once a save finishes the bucket holds three objects per workspace, replaced at each turn end. Deleting a workspace (CLOUD-08) and uninstalling the Worker (CLOUD-07) must delete them; D109 built the first, and D138 empties the bucket before the uninstall deletes it.
- **What is not saved.** The sidecar's write-ahead event log (`/var/conducted/outbox`) is not part of the backup, so an event the desktop had not stored when the sandbox died can still be lost. The spike's loss list names it. Events remain the desktop's record, as D103 has it.

Why not container snapshots: the spike found no API that lists or deletes them and they expire after 30 days, so they cannot meet the "delete everything" rule (`docs/research/cloud-spike-2026-11-06.md`).
Why: this is the spike's own method, extended to the second agent's transcript store and to the signal the spike said was missing. The bucket's size is bounded by the number of workspaces, not the number of turns.

## D106. Pairing a Mac with a Worker keeps one URL and one token, checked before they are saved (2026-11-07)

Proposed by the CLOUD-07 PR; its block was moved to the Cloud page by the owner in issue #489.
Context: D101 stores one pairing token per Mac under `cloud-pairing-token` and leaves the pairing flow to this row. The CLOUD-02 spike kept the token in a mode-600 file and named the Keychain as the product's home (question 4). Conductor has no self-hosted Worker to pair with, so its screens give no place or wording to copy; the flow and its form are ours (D098, D020: report the gap).
Chosen:

- A pairing is a Worker URL and its token. The app sends both to the Worker's `GET /pair` before it saves either. The answer must name the service `conducted-cloud` and report `paired: true`; anything else is refused, so a URL that answers any request is not taken for a Worker. A 401 is its own message.
- The Worker URL is kept in the Keychain under `cloud-pairing-url` and the token under `cloud-pairing-token`, both in the app's service. The URL is written before the token, and only a non-empty token counts as paired. The token never returns to the web view, a log or an event; the URL does, so the app can show which Worker the Mac is paired with.
- One pairing per Mac: pairing another Worker replaces the URL and token. A cloud workspace still names its own Worker URL on its host (D092), so a workspace whose Worker is not the paired one fails with the Worker's own refusal rather than falling back to the Mac.
- The form lives in a "Cloud Workspaces" block at the top of the Cloud page, our own page (D098). The owner moved it there in issue #489, where he said the Cloud page is where the user already is; the block holds deploy, remove and pair together. Unpair removes both items; a Mac that was never paired succeeds.
- The Worker's `/pair` route sits behind the same token check as every other route and touches no Durable Object, so a Mac can pair before the first workspace exists.

Why: the user can check the token with the Worker at the moment they paste it, and a wrong URL or token changes nothing. Keeping the URL makes the state after a restart readable. Per-Worker tokens stay possible later; the Keychain keys can gain a Worker suffix when a second Worker needs its own token.

## D107. Conductor's account controls stay out of the matched screens (2026-11-07)

Context: the second round of D098 found two more Conductor controls that only work with a Conductor account: the organisation switcher at the top of the sidebar and of Settings ("Sam Rivera's Mac", whose menu holds the organisations, "Create organization", "Upgrade to Pro" and "Log out"), and the Loadout's "Share" button on Default models ("Sign in to share a loadout"; it opens a page on Conductor's service).
Chosen: neither is built, by D025. The switcher's one local item, Settings, is the sidebar's gear. Our loadout has no way to share; nothing takes the button's place.
D127 narrows this for the switcher: it is built at the top of the sidebar with this Mac and the paired Worker, because it is where Conductor chooses where a workspace runs. Its account and team items stay out.
Why: both reach Conductor's own service and account, which D025 leaves out; a control that cannot work would be a look without a feature, which D098 removes.

## D108. Cloud terminals and previews, as CLOUD-09 built them (2026-11-07)

Context: the plan's Part 1 point 7 asks for terminals through the sandbox's exec streaming and a WebSocket terminal, and previews through the Worker's port forwarding. The CLOUD-02 spike left PTY terminals and previews unexercised, and noted that previews need their own hostname so one preview cannot read another's cookies or storage. Research describes Conductor's cloud backend only as a concept, so the wire protocol is ours (D002), not copied.
Chosen:

- **One JSON message per line over the Worker's WebSocket.** A terminal opens `/w/<name>/terminal`; its first message is `start` (folder, size, command, environment), then `input`, `resize` and `kill`. Output is `data` with base64 bytes, plus `exit` and `error`. The Durable Object runs `container.exec` with a PTY and a piped stdin and stdout. A run script uses the same path with `/bin/bash -l -c <script>`; a cloud setup script gets `set -euo pipefail` in front of it.
- **The Rust relay takes a channel.** `cloud_relay_open` accepts `rpc` (the sidecar, the default) or `terminal`, so the app needs no second WebSocket command set and the pairing token still never reaches the web view. The terminal's wire protocol is the stream's content, not a second transport.
- **A dropped interactive stream reconnects with backoff.** CLOUD-09's finish replaced the first choice in this decision: an interactive cloud terminal reopens its stream at 2 seconds, growing by 1.5 times up to 30 seconds, sends `start` again, and shows "--- Sandbox reconnected ---" before the new shell. The old process ended with its connection, so this is a new shell, not a resumed one, and closing the terminal stops the retries. A one-shot command (setup, run, spotlight, a chat code block) still ends with "Connection lost." and no exit code, because re-running it would repeat its work; the app does not claim such a process ended when it only lost the connection. A `kill` or an `exit` carries the real code.
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
- **The uninstall removes billing first.** It deletes the Worker, then its container application and its images, then the R2 bucket, emptied first (D138), and finally unpairs this Mac. Deleting the Worker alone leaves its container application billing (the spike's finding). A resource the account does not have is skipped, so a second uninstall succeeds.
- **Conductor's cloud onboarding and Cloud computer page are left out.** The "Workspaces now run in the cloud" onboarding, its Enter shortcut, the "Set up cloud" step, the send-button coach mark, and the Cloud computer page's build log, Settings, Logs and Activate are Conductor-hosted or organization features (D004, D018, D025), and D002 keeps their wording out too. The deploy, remove and pair controls live in the Cloud Workspaces block at the top of our Cloud page instead (D098, D106, issue #489).
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
- **The tunnel also carries SSH (CLOUD-12).** A separate `/w/<name>/ssh` route reaches only the sandbox's loopback port 22, and the sandbox entry's `/ssh` route is its only target; an ordinary forward and a preview still refuse port 22 before any listener or token is made. D119 records the key, config and editor halves.
- **Not built, and why.** Manual overrides are authored as text lines rather than Conductor's pair editor; the stored shape is the same. A per-preview hostname stays out (D108). Conductor has no ordering for forwarded ports: its move up and down belongs to the repository's Preview URLs list (#454).
- **Left out under D004 and D018.** Nothing in this row is organisation-only. Exclusive forwarding is described in the research as an org+server setting; here it applies to the Mac's cloud workspaces, which is the same rule without an organisation.

Why: the tunnel reuses the connection the Worker already authenticates and the Rust shell already owns, keeps every secret on the Rust side, and gives raw TCP (SSH, databases, dev servers) rather than only HTTP, which the preview path cannot do. The cost is Conductor's per-connection WebSocket and a three-second poll instead of its multiplexed subscription.

## D111. The local mirror syncs over the Worker's file routes and is text-first (2026-11-07)

Finished by CLOUD-11's second part: binary and large files, the Mac terminal and run variant on the mirror, attachments, and the preview message are built in D120. The text-first limits below record what the first part built.

Context: CLOUD-11 builds the local mirror of a cloud workspace and its file sync. Conductor's sync is a Rust crate pair (`file_sync_client`, `file_sync_core`) with its own `/files/sync/` endpoints (native-and-sidecar-map A10, services-map 5B.10.1). D018 replaced Conductor's native sync commands with the Host interface, and D101 already gives a cloud workspace's file calls to its Worker's `/files` route. The brief's checklists are Conductor's inventory; this decision records what CLOUD-11 built, what it deliberately did not build, and why.

Chosen:

- **One-way, remote-to-local.** A ready cloud workspace's files are listed through the Worker's new `/files list` operation and each text file is read through `/files read`. The mirror is `<conducted root>/remote-workspace-sync/<repository>/<workspace id>`. The direction is remote to local, the default the research gives (`remoteToLocal` with `files:read`). A local change is not pushed back.
- **The baseline sits beside the mirror.** The list of what was mirrored is `baseline.json` in `<mirror>.sync/`, a sibling folder, so it never appears in the file tree a search reads. The next sync removes a mirrored file the sandbox no longer lists, with `trash`.
- **The path guard is one function.** `guardedRelativePath` refuses an absolute path, NUL, `..` and any `.git` segment. The Worker's walker never follows a symlink. Both the mirror and an upload use it, so a path cannot leave the workspace.
- **Search reads the mirror.** `WorkspaceFilesService.tree`, `quickOpen` and `grep` take a search root: the workspace folder on the Mac, or the mirror of a cloud workspace. The sync runs when the file tree or a search needs it and the last sync is more than five seconds old, which is the research's poll interval. Every other file call (read, save, stat) still goes to the Worker as CLOUD-03 built it.
- **A cloud file opens from the mirror, or from Downloads.** The file tab's Reveal in Finder and Open in another app use the mirror's copy. When the mirror has none, the file's text is written to `~/Downloads` and the toast says "Saved to" with a "Downloads" button. A path outside the mirror answers "File is outside the synced workspace"; a failed reveal answers "Could not open Downloads. Try again.".
- **An upload is a guarded Worker write.** `uploadFile` reads the Mac file and writes it through `/files write`, then updates the mirror. It carries text only, because `/files write` carries text (D101's file route). No Rust command and no crate is added: D018's Host interface plus the Worker route is the door, so `start_remote_file_sync` and its siblings are not rebuilt as Tauri commands.
- **The setting starts the sync for new cloud workspaces.** `auto_sync_files_in_new_cloud_workspaces` (Advanced, default true) gives a new cloud workspace's Sync files switch its first value. Since migration 0019 the workspace row keeps the switch (`remote_file_sync_enabled`, Conductor's column), so a restart keeps it (#549). `file_include_globs` keeps its existing one home as the repository's list of files copied into a new workspace (SET-07, WS-03); the cloud upload of that list is not built because no cloud workspace creation flow exists yet to call it.
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

## D112. A cloud agent's command on the Mac, as CLOUD-14 built it (2026-11-07)

Context: CLOUD-14 was `planned` behind CLOUD-03, CLOUD-04 and SIDE-12, whose contract leaves cloud-only app tools out. The research describes RunLocalCommand in Conductor's sidecar and its desktop main process (claude-runner.md section 4.2, ui-map.md 3.3 and 6, services-map.md 5B.2.2 and 5B.6), but Conductor's cloud backend is not in the research (D002). Conductor also has a _routed_ variant (`routedRunLocalCommand`) that sends a command to another user's Mac inside an organisation; D004 and D018 keep organisations and other people's accounts out.
Chosen:

- **The tool follows one switch.** `RunLocalCommand` is in `APP_TOOLS`, enabled by `appTools.localExecution`. The desktop composes that switch into the config it sends at each `sendMessage` and `warmAgent`: on for a cloud workspace while the Advanced setting "Remote execution MCP" (`internal_remote_local_execution_mcp`) is on, which is the default. A local workspace never gets the tool. The sidecar's config-change check names the switch, so turning it on or off restarts the agent at the next message, as the research says the tool flags do.
- **Approval and execution live in the desktop app.** The sidecar inside the sandbox only forwards a `runLocalCommand` request over the existing tunnel. The app checks the workspace is a cloud one and the setting is on, opens a tool-approval interaction with Conductor's title ("Do you want to run this command on your Mac?"), and runs the command with the Mac's own shell (`/bin/bash -lc`) in the agent's cwd, resolved against the Mac's home. The host-routed shell is not used: a command for the Mac must not reach the sandbox.
- **A sandbox asks only for its own chats.** Each cloud tunnel gets its own `runLocalCommand` handler, bound to the host it talks to. The app refuses a request whose chat belongs to another host, and the Mac's own sidecar cannot ask at all. Without this, one sandbox could name a chat in another cloud workspace and use that chat's "Yes for this session".
- **The Mac's card covers the agent's, never cancels it.** A chat shows one card. When a command on the Mac asks while the agent's own card is open, the Mac's card goes on top and the agent's waits under it, still pending; a card the agent opens meanwhile waits the same way. Each comes back when the Mac's card closes.
- **The card's choices are Conductor's.** Yes, "Yes for this session" and "Yes always" ("allow_for_session" and "always_allow" in the protocol; a new generic `allow_for_session` decision was added), and No. A session approval is remembered for that chat until the app quits; "Yes always" writes `always_allow_local_execution`, which outlives it. The Advanced page shows both settings. A request is refused, without a card, for a local workspace or when the setting is off.
- **Limits are the research's.** The request's timeout is 60 s by default, clamped to 120 s, or to 30 minutes when it carries an extended-timeout reason. The approval waits 110 s. A notification with the body "Approve local command: <command>" fires even while the user looks at the chat, as a tool approval does.
- **Long output is saved by the app, not the sidecar.** Above 32,000 characters the app writes the whole output to `.context/conductor/run-local-command-output-<id>.txt` in the workspace, through the host-routed file system, so for a cloud workspace the file lands in its sandbox where the agent can read it; the tool result points there. The research puts this step in Conductor's sidecar; our app tools never touch files (SIDE-12), and the app already owns the workspace folder and its host.
- **The routed variant is left out.** A command always runs on the Mac that owns the workspace. Conductor's target-user, target-client and session-generation checks belong to its organisation-wide remote execution, and its "This command is no longer assigned to this Mac" case cannot happen with one Mac per user. The left-out behaviour is named here, as D004 and D018 require.
- **Our words.** The tool description is written for this app, not copied from Conductor's prompt text (D002).

Why: the approval is the user's and the shell is the Mac's, so both belong where the user and the Mac are; the sidecar's only honest part is forwarding, and a sidecar inside a sandbox could not run a Mac command anyway. The switch reuses the app-tools mechanism SIDE-12 already has, and the per-session and persistent approvals are the two the research names.

## D113. Cloud settings are the Worker's, applied at each start; the organisation pages stay out (2026-11-07)

Proposed by the CLOUD-17 PR; not yet ruled on by the owner.
Context: CLOUD-17's checklist is Conductor's cloud settings pages, which are organisation pages (ui-map 6 Organization: Environment, MCP, Cloud computer), plus the personal Git identity row and the personal cloud variables. D004, D018 and D025 keep organisations out. CLOUD-05's D104 already fixed which Worker secret each model host receives. This records what was built, what belongs to another row, and what was left out.

Chosen:

- **The personal cloud settings live in the Worker.** One object at `settings/user.json` in the Worker's R2 bucket holds `gitIdentity` (`{name, email}`) and `personalCloudEnvVars` (name to value). The desktop reads and writes it at `GET /settings` and `POST /settings` behind the same pairing token as every other route. The reason is the app, not the screen: every sandbox start must read the same identity and variables, and the agent's own commits happen inside the sandbox. Redesigning the local DB would not reach them.
- **Applied twice.** A start merges the settings into the container environment (`GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`, then the variables). The Worker's git route reads them again per call, so an identity saved while a sandbox runs applies to the next desktop commit without a restart.
- **Names are checked in the Worker.** A variable name that is not a shell name, starts with `CONDUCTED_`, is set by the sandbox (`PATH`, `HOME`, the git scrub, `GH_TOKEN`) or is a provider key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, the Codex and Cursor names) is refused with its reason. A provider key in the sandbox is what the plan forbids; the Worker swaps it in at the outbound handler instead.
- **The pages are ours.** The Git identity row is on the Git page, where Conductor puts it (ui-map 6 Git), and appears only on a Mac paired with a Worker. The personal cloud variables are on a new Cloud page, and the deploy, remove and pair block sits at its top (issue #489). Both use Conductor's wording ("Git identity", "Name and email used for commits in cloud workspaces.", "Couldn't update Git identity", "Conductor could not connect to cloud settings. Try again."). Conductor's org Environment and MCP pages are not built (D004, D018).
- **Data privacy mode.** Conductor gates cloud work with `isCloudRestrictedByDataPrivacy = enterprise_data_privacy === "true" && flag !== "true"`, where the flag is PostHog's `cloud-in-data-privacy-mode` (services-map 4.1.2). We run no flag service (D025), so the flag is always off: while `enterprise_data_privacy` is on, a cloud workspace's run calls (`start`, `git`, `exec`, `files`, `terminal`, `preview-url`, and the relay) answer `cloud_data_privacy`, while settings reads, state, stop, remove and archive still reach the Worker. The truth table is tested in `core/cloud/privacy.ts`.
- **The model key choice is already the per-chat provider.** CLOUD-17's "Which model key the Worker uses for cloud runs" is the `cloudClaudeCredentialSelection` family in Conductor. In our design the chat's provider is the choice: the router sends the host, and the Worker swaps that host's secret (D104). No second setting would change anything, so none is invented.
- **The `env_vars` table keeps its two scopes.** Conductor's `env_vars` has a `context` of `local` or `cloud` (services-map 4.2.8). Our DB rows are `global` and `repo` (DATA-01) and the settings files already carry a `[environment_variables.cloud]` table (SET-04). The personal cloud variables are the Worker's object above, not a third DB scope; making the DB row context-aware would be a second home for the same setting.

Left out, and where each item goes:

1. **Port range and forwarding strategy.** "Couldn't update the local port range" and "Couldn't update the forwarding strategy" belong to cloud port forwarding. CLOUD-10 (#252, D110) built them as local settings on the Connections page.
2. **MCP servers for the sandbox.** Installing them with none, OAuth, bearer token or custom headers, the "Import from local" list, and their override of a local server of the same name are Conductor's org MCP page (ui-map 6 Organization). The sandbox-side install stays with CLOUD-17 (#259), still open; the org page stays out under D004 and D018.
3. **The cloud GitHub token entry form.** D104 already records it as the org GitHub page, kept out; the Worker secret exists and the outbound handler swaps it.
4. **Image extras and build status.** Conductor's org Cloud computer page; CLOUD-04 recorded the software setting as out, and the deploy's build is CLOUD-08/D109.

Why: each built piece is the smallest one that makes the cloud work correct, and every unbuilt item names the row or decision that owns it rather than a look without a feature.

Live verification: none needed beyond the unit and composition tests; no Worker was deployed for this change.

## D114. What CLOUD-09's finish leaves out because Conductor's service or organisation owns it (2026-11-07)

Proposed by the CLOUD-09 PR; not yet ruled on by the owner.
Context: CLOUD-09's checklist was generated from `ui-map.md` sections 3.2 and 3.7 and `services-map.md` 5A.1 and 5A.4. Two remaining items describe states that only exist inside Conductor's hosted cloud or its organisation permissions, so no self-hosted Worker on the user's own account can produce them. Every other item was built or named its owning row; the Rust-side PTY mirror commands are not built because D108 chose a JS text mirror instead, and that is recorded there.

Chosen:

- **A preview gets no hostname of its own.** Conductor's hosted service gives a cloud preview a separate hostname, which the spike named as the isolation it could not meet. Here a preview is a capability path under the user's Worker (D108). A hostname per preview needs a custom domain with a wildcard route in the user's Cloudflare account; the deploy flow asks for none, and inventing a domain would not work on an account that has not added one.
- **The read-only workspace refusal is not built.** Conductor refuses a cloud terminal and a cloud run in a read-only workspace ("Terminal unavailable in read-only workspaces", services-map 5A.4.5), and read-only is a permission its organisation gives a member. D004 and D018 keep organisations, accounts and permission levels out, so a Conducted cloud workspace has no read-only state to refuse. A future row that adds permissions would add the refusal with them.

Why: each item is a fact of Conductor's own cloud service or its organisation model, not of a Worker a user deploys. Building a substitute would be made up; naming them keeps the gap visible.

## D116. The cloud workspace header reads status, resources and cost from the sandbox and the local record (2026-11-07)

Proposed by the CLOUD-15 PR; not yet ruled on by the owner.
Context: CLOUD-15's checklist asks the cloud workspace header for a host badge, a status, CPU, memory, disk, "Low disk", "Agent cost" and a Restart that reports "Restarted workspace" (ui-map.md 3.1; inventory toast M3756589). Conductor's frontend gets the status and values from `remoteState`, which it fetches from its hosted Roundhouse backend; its components only format them (`renderApp` `a2o`, `NPi`, `Xgo`, `Zgo`, `Vjt`, `Wjt`). Our design has no Conductor account or backend (D018): the user's Worker and its sandbox are the backend, and the research does not describe how Conductor's backend derives the readings, so its formulas cannot be copied (D002).

Chosen:

- **Status is the Worker's running flag.** `GET /w/<name>/state` answers `running`; the header says "Running" or "Stopped", and "Starting" while a restart is in flight. A Worker that cannot be reached says "Unavailable" and carries the error on hover.
- **Resources come from the running sandbox.** The sandbox entry answers `GET /resources` from `/sys/fs/cgroup/cpu.max`, `cpu.stat`, `memory.max` and `memory.current`, with `/proc/meminfo` as the memory fallback, and disk from `statfs("/workspace")`. CPU capacity is the cgroup quota over its period, so it is the instance's real limit and no instance table is copied. The first reading after a start has no CPU percentage because there is no earlier sample. The Worker's `state` route carries the readings only while the container runs; a state read never starts it.
- **"Low disk" is Conductor's own threshold.** 512 MiB left or less, from `Zmo` in `renderApp`; the trigger shows "Low disk" and the Disk row shows the space left instead of the percentage.
- **Agent cost is the local usage record.** It is the sum of the `usage.costUsd` each agent turn reported, read from `session_events` for the workspace and leaving reverted turns out. It appears only while "Show agent cost" is on, as in Conductor, and when it is above zero.
- **Restart is the Worker's own stop and start.** `/w/<name>/restart` saves `/workspace` and the agents' transcripts to R2, stops the sandbox, starts a new one and restores them (CLOUD-06); the app shows "Restarted workspace" only when the Worker answers that it started, then re-reads the state at once instead of waiting for the poll.
- **The control is the header's identity, and its values open in a popover.** For a cloud workspace the header's left part is one button, as Conductor's cloud header has it: a status icon, the workspace's display name, and "Low disk" when the space left is small. Its accessible name is "<name> · <status>", with " · Low disk space" when low. Clicking it opens a 320px popover that starts with the name and the app's own rename and workspace-actions controls, then a separator, then the labelled rows Environment ("Cloudflare"), Status (Restart and the state), CPU, Memory, Disk and Agent cost. Our cloud is the user's own Cloudflare account, so the Environment row does not use Conductor's brand name. Follow, creator and watcher avatars and the Share dialog stay out as organisation features (D004, D018, D107).

Left out: Conductor's intermediate cloud lifecycle words ("Building", "Preparing", "Updating", "Setting up", "Unresponsive") and its failure fields. Our Worker builds the image at deploy time rather than per workspace, and its sandbox has only running and stopped states; an unreachable Worker is the one failure the header shows. Conductor's repository, created, setup and workspace-id rows in the identity block are left out because they belong to other features and are not in this checklist; so is its low-disk warning box below the rows, because the trigger's "Low disk" and the Disk row carry the warning. No live run measured the `/resources` paths: their unit tests use the files' real text, and `/sys/fs/cgroup/cpu.stat` is the path the CLOUD-02 spike read on the same runtime, but the exact Cloudflare paths are not verified until a dev Worker reports them.

Why: the control sits where Conductor puts it and opens the same kind of popover, so the cloud header behaves as the rest of the matched UI does, while the self-hosted design needs no second hosted service and uses values the app or the sandbox already produces. A reading the sandbox cannot give is left out rather than invented.

## D117. The Cloud desktop tab is Conductor's hosted computer, and is left out (2026-11-07)

Context: CLOUD-16 (#258) lists six items behind "if the spike shows it is wanted": the centre "Cloud desktop" tab (ui-map 3.2), the git panel's "Desktop" tab (ui-map 3.6) and the "Cloud desktop" dialog (ui-map 3.10), with Reconnect and the notices "You need edit access to use the cloud desktop" and "Cloud desktop is available in cloud workspaces". The research records the labels but not the surface behind them. Conductor's extracted frontend bundle (the `virtual-desktop` component in renderApp, read 2026-11-07) settles it: the tab opens a noVNC (RFB) session. It asks Conductor's own service for the connection (`/direct/desktop`, scope `desktop:connect`) on the workspace host's `hostingServerUrl` and `vmId`, and renders only while the remote computer reports `remoteState.status === "running"` (the states are `initializing` with `building_snapshot`, `preparing` or `updating`, then `running`, `stopped`, `unresponsive`, `restarting` and `deleted`). The "edit access" notice reads the shared workspace's permission level (`write`, `read` or `admin`), and ui-map section 1.2 files the cloud desktop with the cloud (team) features.

Chosen: all six items are left out.

- The centre Cloud desktop tab, including its Reconnect button, the edit-access notice and the notice for workspaces that are not cloud, is not built.
- The git panel's Desktop tab with the cloud desktop stream is not built.
- The Cloud desktop dialog for cloud workspaces is not built.

Why: the cloud desktop is a GUI on Conductor's hosted computers, the service it runs for its own cloud product. D025 already leaves those computers and Conductor's cloud backend out, and D004 keeps the team half out. Our cloud workspaces are headless Cloudflare sandbox containers with an agent, a shell and files (D018, D101); they have no display server, no VNC/RFB endpoint and no hosted computer to stream. Building these items would mean inventing a remote-desktop layer that the research does not describe and the plan does not include, and nothing in the CLOUD-02 spike shows a desktop is wanted. Their wording stays out too (D002).

## D118. CLOUD-18's subscription sign-ins are not offered; Cursor's API host joins the outbound allow-list (2026-11-07)

Proposed by the CLOUD-18 PR; not yet ruled on by the owner.

Context: CLOUD-18 asks for a subscription sign-in inside a cloud workspace. Eight checklist items and two items moved from CLOUD-05 describe it, and the plan says a Claude Pro or Max subscription in a cloud machine must be checked against Anthropic's terms before it is offered (`cloud-and-remote.md` Part 1, question 6). Conductor's only implementation of these sign-ins is the "How <agent> authenticates in cloud workspaces" card. Saving a credential there calls a mutation that refuses when there is no Conductor API token ("Not signed in.") and then `PUT`s to `/api/me/provider-api-keys/<name>` with that token and an optional `organizationId` (`Uwe` in `renderApp-DeUrsznk.js`, read 2026-11-07). The export flows themselves run the user's Codex or Cursor login on this Mac and hand the credential to that server. This is Conductor's hosted service and its organisation credentials, not a self-hosted Worker, so it is left out under D004, D018 and D025. The parity map already records the five RPC names under D025 for that reason (`tests/parity/map/sidecar_call.json`).

Anthropic's terms, read 2026-11-07 from `https://docs.claude.com/en/docs/claude-code/legal-and-compliance` and `https://www.anthropic.com/legal/consumer-terms` (effective 8 October 2025):

- "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Ultra, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."
- "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow."
- "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code as described under _Can customers offer Claude Code in their products?_ above."
- The hosted-sandbox conditions: "The Claude Code binary must not be modified"; "Customers may not pay for, resell, or intermediate Claude usage on their end users' behalf. Each end user must authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential".
- The Consumer Terms add: "You may not share your Account login information, Anthropic API key, or Account credentials with anyone else or make your Account available to anyone else", and prohibit reaching the Services "through automated or non-human means" except through an API key.

Chosen:

- **The brokered Claude OAuth token is not built.** CLOUD-05's moved item asks the sidecar to take the user's Claude subscription token, inject it into every cloud spawn and refresh it when rejected or near expiry. That is exactly the collect, store and intermediate of Claude.ai credentials and session tokens the terms forbid, and it routes subscription usage on the user's behalf. A Claude subscription is therefore not offered in a cloud workspace. Claude Cloud chats use an Anthropic API key through the Worker's credential swap, as they already do.
- **No self-serve sign-in inside the sandbox either.** The terms allow an end user to sign in to the unmodified Claude Code binary inside a hosted sandbox, but that needs the sandbox's closed network to reach `claude.ai`, `claude.com` and `platform.claude.com` (the OAuth endpoints named by Claude Code 2.1.308) and to carry the OAuth token in the sandbox, contrary to the plan's "secrets never enter the sandbox". That is an owner decision this row cannot take, and Conductor has no equivalent: it brokers through its hosted service. The item is recorded as a gap rather than invented.
- **The Codex and Cursor export items are left out.** `codexCloudAuthStart`, `codexCloudAuthFinish`, `cursorCloudAuthStart`, `cursorCloudAuthFinish`, `cursorCloudAuthCancel`, the isolated Codex temp home and the `CodexCloudAuthExport` log tag all serve the hosted credential card above, so the app does not build them (D004, D018, D025). Codex Cloud chats still use an OpenAI API key, which the Worker swaps.
- **The "Couldn't update agent credentials" toast is left out.** It is the error of the same hosted mutation (`Fna` in `renderApp-DeUrsznk.js`), which needs Conductor's account and server. There is no local credential update for it to report.
- **Cursor's API host joins the allow-list.** `api2.cursor.sh` is the local `@cursor/sdk` 1.3.1 backend (its default `CURSOR_BACKEND_URL`, read from the package on 2026-11-07); the runner does not use the Cloud API at `api.cursor.com`. The Worker accepts that exact host, refuses plain HTTP and look-alikes, and swaps the sandbox's placeholder for the Worker's `CURSOR_API_KEY`, sent as a bearer token. This is the one moved item that belongs to our self-hosted Worker and is built here.
- **A Cursor chat still cannot run in a cloud workspace.** The sandbox image has no Cursor SDK, and the sidecar's loader names only the macOS native package (`@cursor/sdk-darwin-<cpu>`), so `cursor_sdk_missing` is the answer there. Adding the Linux SDK is a separate change for AGENT-09 and CLOUD-04; the host row waits for it.

Why: the only subscription-sign-in mechanism in the reference is Conductor's hosted credential store, which this app does not have, and the Claude half of it is forbidden by Anthropic's own terms. Building the allowed end-user sign-in would open the sandbox's network and put the subscription token inside it, both of which the plan reserves. The Cursor host is the small, allowed, self-hosted piece, and it matches the credential swap CLOUD-05 already does for the other two model APIs.

## D119. CLOUD-12's SSH door: sshd on loopback, a Mac key installed at start, and the `conducted` config (2026-11-07)

Context: CLOUD-12 opens a cloud workspace in a local editor over SSH, as Conductor does (`services-map.md` 5A.3.3, ui-map 5.4). D110 replaced Conductor's SSH forward with the Worker's raw tunnel and reserved port 22 for SSH, so the door had to be built on our own Worker and sandbox, not on Conductor's hosted service. The reference's client half is in `main-BE1h_1MP.js` and `renderApp-DeUrsznk.js`, read 2026-11-07: the key setting `ssh_key_path`, the files `conductor_config` and `conductor_config.d`, host names `<name>.conductor` on `HostName 127.0.0.1`, the post-quantum exchange `sntrup761x25519-sha512@openssh.com`, and the editor commands below. D002 keeps its code and wording out; the names here are ours.

Chosen:

- **sshd runs in the sandbox image on loopback, key only.** `apps/cloud/sandbox/ssh.ts` holds the one config the entry writes before starting `/usr/sbin/sshd -D -e`: `Port 22`, `ListenAddress 127.0.0.1`, `PubkeyAuthentication yes`, every password and keyboard-interactive path off, `PermitRootLogin prohibit-password`, `AuthorizedKeysFile /root/.ssh/authorized_keys`, `StrictModes no`. Docker installs `openssh-server` and generates host keys with `ssh-keygen -A`. No port is published; `EXPOSE` stays 8080.
- **The Worker's `/w/<name>/ssh` is the only route to port 22.** It is a paired WebSocket into the sandbox entry's own `/ssh` route, which always targets `127.0.0.1:22`. `/tunnel` and previews still refuse port 22, and ordinary forwards keep refusing it in Rust and in the Worker (D110). The sandbox entry's `/tunnel` keeps its old reserved-port rule; `/ssh` is a separate path, so a caller cannot swap the target.
- **The Mac makes and keeps the key.** With no choice made, `~/.conducted/ssh/id_ed25519` is made once with the Mac's `ssh-keygen -t ed25519 -N ""`; only the `.pub` text is read. `ssh_key_path` is a user-scope Advanced setting with Conductor's title, description and placeholder (`~/.ssh/id_ed25519`), a "Browse for SSH key" button (picker "Select SSH private key"), and a "Reset to auto-generated key" button while a path is set. A chosen path is expanded from `~`, and its private file and `.pub` half must both exist; otherwise the save and the SSH door answer Conductor's "Custom SSH public key not found at <path>.pub". Reset clears the setting back to the auto key.
- **The public half is installed at every start.** The desktop POSTs it to `/w/<name>/ssh-key`; the Durable Object stores it and writes `/root/.ssh/authorized_keys` (mode 0600, folder 0700) after each container start. A sandbox that is replaced gets the same key without a second screen action.
- **The local listener is a port forward with the SSH route.** Rust's `start_ssh_forward` binds `127.0.0.1:<local>` and opens `/w/<name>/ssh` per connection, reusing the accept loop, token read and event of CLOUD-10. The forward id carries the workspace and host names (`ssh:<workspaceId>:<host1,host2>`), so the config is rebuilt from the running forwards instead of a second store. The local port is chosen by the same allocator, from the normal range, never below 1024 and never 22.
- **The config is ours, under `conducted` names.** `~/.ssh/conducted_config.d/ssh.config` holds one block per running SSH forward: `Host <folder>.conducted [<branch>.conducted]`, `HostName 127.0.0.1`, the local `Port`, `User root`, `IdentityFile`, the post-quantum `KexAlgorithms` line when `ssh -Q kex` lists it, `WarnWeakCrypto no-pq-kex`, `StrictHostKeyChecking no` and `UserKnownHostsFile /dev/null`. `~/.ssh/conducted_config` includes that file. `~/.ssh/config` gets one `Include ~/.ssh/conducted_config` line in front only when it is absent; an existing file is otherwise untouched. Directory names are sanitised to letters, digits, `-` and `_`; a name another open session holds is dropped, and the branch name joins when it differs.
- **The Durable Object stays awake while a session is open.** `noteSsh(open)` keeps a count in Durable Object storage and sets the CLOUD-03 alarm while it is above zero; the alarm touches the sandbox's `/health` every 60 seconds, as it does for a turn, and clears only when both the count and `turnActive` are zero. The SSH WebSocket is pumped inside the Durable Object (not handed straight to the container) so its close is seen and the count falls.
- **The editor commands are Rust's, on the Mac.** `open_remote` maps `Visual Studio Code` and `Cursor` to `code`/`cursor --remote ssh-remote+<host>.conducted <path>` and `Zed` to the app bundle's `cli` with `ssh://<host>.conducted<path>`; any other app answers `remote_open_unsupported` with Conductor's exact "Remote open is only supported for VS Code, Cursor, and Zed". The Open in menu on a cloud workspace is labelled "Open via SSH", lists only those three, and adds "Copy SSH command" (`ssh <name>.conducted`, toasts "Copied SSH command" / "Failed to copy SSH command"). The sidebar actions menu offers the same copy item. Cmd+Alt+O is `workspace.openRemoteInApp`; Cmd+O and Cmd+Shift+O keep their local meaning on a Mac workspace.
- **Left out, and why.** Conductor's internal diagnostics items (Copy sandbox id, Open sandbox logs, Copy workspace public URL) are not CLOUD-12 and stay out under D004/D098. A second per-app config file and importing other `*.config` files in `conducted_config.d` are not built: only the file this app writes exists in our flow.

Why: the tunnel, the authenticated WebSocket and the pairing token already exist (D110), so SSH rides the same door with one extra Worker route instead of a public port or a second transport. Keeping the key and config generation on the Mac matches Conductor's client half, and the Durable Object alarm is the one keep-alive the Worker already trusts. The whole door is tested without Docker in the Worker's runtime and in the desktop's composition root; the live run is recorded in `docs/research/cloud-spike-2026-11-06.md`.

## D120. CLOUD-11's second part: binary files, the mirror's terminals, attachments and the limits a self-hosted Worker keeps (2026-11-07)

Context: the first part of CLOUD-11 (D111) built a text-only, one-way mirror and recorded the gaps issue #253 left open: binary files and files over 2 MiB, a push signal, a snapshot for a stopped sandbox, a Mac terminal in the mirror, an action's Local variant there, the preview message, attachments, and the optional service dependencies. This row records what the second part built, the contract changes it made, and the two gaps that remain because a self-hosted Cloudflare Worker cannot do them.

Chosen:

- **Binary files are mirrored, up to a measured read limit.** The Worker's `/files` route gains `readBytes` and `writeBytes`, each carrying one base64 string, and the Sandbox SDK's own `readFile`/`writeFile` take and return those bytes. The mirror reads every file with `readBytes` and decides text or binary by decoding it as UTF-8 (`fatal: true`) and refusing a NUL byte. Text is written with the existing atomic text door; binary is written with a new `writeBytes` door. A `readBytes` answer is one base64 string inside one JSON value, and a Durable Object RPC value is capped at 32 MiB, not by the Worker's memory. On the live Worker, a 23 MiB file succeeded and 24 MiB failed at that cap. The limit is **16 MiB** (`CLOUD_MIRROR_FILE_LIMIT_BYTES` in `packages/shared`), a dial with 7 MiB of margin below the measurement; raise it only with a new measurement. A file over it is left out of the mirror, named in `baseline.json` with its size and the limit, and never read again while its listed size stays over it. The Worker's own `readBytes` checks the size first and refuses with the same message, so a caller that skips the mirror's check cannot make the Worker build an answer it can never send. The local read's `MAX_READ_BYTES` (64 MiB) and the list's 20,000-entry cap remain separate bounds.
- **A Mac terminal runs in the mirror.** A terminal row now says which host it runs on (`terminals.host_kind`, migration 0016; `Terminal.hostKind`). In a cloud workspace the scripts panel's New terminal is a menu with "Cloud terminal" and "Local terminal"; the Local one starts a PTY on this Mac in the mirror, with the Mac's program shims, and refuses with "Local terminal unavailable" when the mirror folder is not there. The terminal tab shows the host it runs on.
- **An action's Local variant runs in the mirror.** The refusal that CLOUD-09 put in `run-scripts.ts` now applies only when the mirror is unavailable. When it exists, the action runs on this Mac with `CONDUCTED_WORKSPACE_PATH` set to the mirror, its port scan reads the mirror's processes, and its terminal row says `local`.
- **A chat attachment in a cloud workspace is uploaded into the sandbox.** `materializeForSend` takes the workspace's host; for a cloud workspace it sends the staged file through `uploadFile` to `.context/attachments/<id>/<name>` in the sandbox and records the sandbox path on the row, instead of writing to a Mac folder. Text and binary attachments take the same text/binary branch as the mirror. Conductor materialises attachments before a send through `files/write-stream` (services-map.md 5A.6.2); this is the same step over the Worker's JSON route.
- **The preview message is Conductor's.** Opening a preview of a Local variant whose mirror is not on disk shows "Couldn't open preview: local workspace mirror is unavailable." and opens nothing, as Conductor's preview opener does.
- **The file service's three cloud dependencies are required.** `WorkspaceFilesService` now requires `searchRootOf`, `cloudOpen` and `hostKindOf`, as issue #397's audit asked. The composition root always supplied them; an optional field with a local fallback was a second path nothing used.

Contract changes, each in its own commit or with the change that needs it:

1. `terminals.host_kind` (migration 0016), `Terminal.hostKind`, and the optional `hostKind` on `Actions.terminals.create`.
2. `FileSystem.readBytes` and `FileSystem.writeBytes`, the Tauri commands `fs_read_bytes` and `fs_write_bytes_atomic`, and the Worker's `readBytes`/`writeBytes` file operations. A binary transfer needs a local binary door; the text door cannot carry arbitrary bytes. `CLOUD_MIRROR_FILE_LIMIT_BYTES` in `packages/shared` is the one read limit both the mirror and the Worker ask about, so neither can drift.
3. The Worker file body's two new operations, and `ComposerService.materializeForSend`'s host argument (internal to the services, not the screen API).

Left out, and why:

- **No push signal.** The Worker has no file-change topic and the sandbox has no watcher that reports to its Durable Object. A self-hosted Worker could push over a relay channel, but the research describes Conductor's own service (`file-sync:changed` topics and generation cursors), not a Worker design, and a correct watcher is a new runtime, not a change to the mirror. The sync keeps the five-second poll D111 recorded.
- **No snapshot for a stopped sandbox.** D105's spike found no Sandbox SDK API that lists or deletes container snapshots, and they expire after 30 days, so a snapshot cannot meet the "delete everything" rule. The Worker's file routes also need a running sandbox. A stopped workspace therefore keeps its last mirror and reports the failed sync, as D111 said.

Live verification: `conducted-dev-c11t-183155` on the owner's account (a first try, `conducted-dev-c11t-182835`, was cut at the cold start and is also deleted). The deploy took 32.6 s; the first start after a deploy outlasted Cloudflare's 100-second request window, so the test retries and the three tries took 176.5 s; the text, binary and 3 MiB files took 1.0 s and the terminal command 259 ms; the uninstall took 13.6 s. Every list held no `conducted-dev-c11t` entry afterwards and the local Docker image was removed by id. Numbers and method: docs/research/cloud-spike-2026-11-06.md.

## D121. Cloud MCP servers are personal Worker settings; the sandbox holds placeholders and the Worker swaps the credential (2026-11-07)

Proposed by the CLOUD-17 PR; not yet ruled on by the owner.

Context: the rest of CLOUD-17 (#259) is "MCP servers in the cloud sandbox": installing a server with no auth, OAuth, a bearer token or custom headers; "Import from local"; and a cloud server overriding a local one of the same name. In Conductor this is the Organization > MCP page (ui-map.md 6 Organization: Installed, Recommended, "Import from local", "Select MCP servers", auth types None, OAuth, Bearer token, Custom headers). Its server list comes from Conductor's hosted service (`bXe.list` and `listMcpServers` in `renderApp-DeUrsznk.js`, read 2026-11-07) together with an OAuth callback URL and `oauth_tokens` credentials. D004 and D018 keep organisations and that hosted service out. What the research does name for a sandbox is Conductor's own sidecar variable `CONDUCTOR_INTERNAL_MCP_SERVERS_JSON` (native-and-sidecar-map.md B2) and the rule that its cloud servers override local ones by name (other-runners.md section 5, `inventory:sidecar @309505`). So the personal list and the sandbox side are built here; the organisation page and its hosted OAuth broker are not.

Chosen:

- **One personal list in the Worker.** The settings object at `settings/user.json` gains `mcpServers: Record<name, {url, authType: "none" | "bearer" | "headers", bearerToken?, headers?}>`, beside `gitIdentity` and `envVars`, read and written through the same `GET|POST /settings` route. An object written before this row reads as having no servers. This is the personal home D113 gave the other cloud settings; a server list on the Mac's database would not reach a sandbox start.
- **Servers are remote and HTTPS only.** Conductor's MCP form has a URL, not a command, so a cloud server is an HTTP MCP endpoint; the research shows no stdio form for its cloud page. A URL must be `https:`, with no username or password. Names are 1 to 64 letters, numbers, hyphens or underscores; `conductor` and our own `conducted` are reserved because they would shadow the app tools.
- **The sandbox gets placeholders, never a secret.** At each container start the Worker adds `CONDUCTED_CLOUD_MCP_SERVERS_JSON` to the container environment: for each server, its name, URL, and headers whose values are `provided-by-worker`. The sidecar reads it and gives the servers to every runner: Claude's `Options.mcpServers` as an HTTP server, Codex's `--config mcp_servers.<name>.url` and `http_headers`, Cursor's `mcpServers`, and ACP's `session/new` HTTP servers. Claude's entry sets `alwaysLoad: true` so its tools are in the first turn's prompt; the SDK caps that wait at 5 seconds per server.
- **A cloud server overrides a local one of the same name.** Cursor's local map is merged before the SDK starts, the cloud entry replacing the local one; Codex's later `--config` wins over `config.toml`; Claude's and ACP's session-provided entries take precedence over the agent's own config. The other local servers stay.
- **The Worker's outbound handler is the credential door.** A request whose URL starts with a configured server's origin and path prefix (longest match wins) is allowed even though it is not on CLOUD-05's static allow-list. The Worker replaces the placeholder header values with the real token or header values. A server whose credential the Worker does not hold answers 503; a look-alike host, another port, a sibling path or plain HTTP answers 403. Redirects are still returned to the sandbox, so the next hop is checked too. A settings read that fails leaves the MCP list empty so model, GitHub and package traffic still works.
- **How each auth mode is handled:**
  - None: the host is allowed and no header is touched.
  - Bearer token: the sandbox holds `authorization: Bearer provided-by-worker`; the Worker sets `authorization: Bearer <token>`.
  - Custom headers: the sandbox holds every configured header with the placeholder; the Worker replaces each with the real value.
  - OAuth: not built. Conductor completes it through its hosted service's callback URL and token store, which D004, D018 and D025 keep out, and the research describes no self-hosted OAuth flow. The add panel therefore offers None, Bearer token and Custom headers only, and the gap is reported rather than invented.
- **"Import from local" is a personal action.** It scans this Mac's Claude Code config (`~/.claude.json`: its own servers, each project's servers and each project's `.mcp.json`), Claude Code plugins under `~/.claude/plugins`, Claude Desktop's `claude_desktop_config.json`, Cursor (`~/.cursor/mcp.json` and each project's `.cursor/mcp.json`), OpenCode (`~/.config/opencode/opencode.json` and each project's `opencode.json`) and Codex (`~/.codex/config.toml`). Only remote HTTPS servers are offered; a stdio server, a plain-HTTP one, an entry holding a `${...}` variable, or a Codex entry whose credential comes from the environment is counted and left out. Duplicates (same URL and sorted headers) fold into one candidate naming every source, and the import gives each a unique valid name and saves the chosen ones in one request. The scan registers the Cursor, OpenCode and Codex folders with the Platform's file commands, because they are outside the app's default file scope.
- **The section is Conductor's MCP page, on our Cloud page.** It sits on the Cloud page (D113) and uses Conductor's words and layout, read from its bundle on 2026-11-12 (offsets in `McpServersSection.tsx`): the "MCP" heading; the Installed and Recommended tabs; "Search installed MCPs", "No MCP servers installed" and "No installed MCPs match your search"; newest-first rows that show the name and an actions menu with Edit and Delete; the "Add MCP server"/"Edit MCP server" dialog with its Name, URL and Authentication fields, its choices in Conductor's order (Bearer token, Custom headers, None), its placeholders and messages; the Recommended tab's search and "Import from local" card; and the "Select MCP servers" dialog, which starts with every server chosen. Failed saves toast Conductor's titles ("Couldn't add this MCP server" and its update and delete forms). Our own words are gone. What differs, and why: OAuth is not offered, so a new server starts on None; the Recommended tab holds only the import card; a row's icon is Conductor's fallback initial, because its logos are its assets and its favicons come from Google's service; and an edited bearer server stays on Bearer token, where Conductor, which stores a bearer token as a header, shows Custom headers.
- **A changed list applies at the next start.** The settings are read once when a stopped sandbox starts, as the environment must be fixed then; a running sandbox keeps the list it started with.

Left out, and why:

1. **The organisation MCP page, its servers "Used in your organization", and the Recommended catalogue.** D004 and D018 keep organisations out. The catalogue is a list in Conductor's bundle, and 22 of its 24 servers need OAuth.
2. **OAuth.** Conductor's hosted OAuth callback, token exchange, refresh and `oauth_tokens` store have no self-hosted equivalent in our Worker, and the research does not describe the flow. Building it would mean inventing a security-sensitive protocol, so it is named rather than made up (D002).
3. **Member and "Added by" data.** It belongs to an organisation's members (D004).

Why: this is the smallest design that makes a cloud workspace's agents use MCP servers, keeps every secret in the Worker exactly as CLOUD-05 does for the model keys and GitHub token, and puts what Conductor offers only through its organisation and hosted service outside the app without inventing a replacement.

Live verification (2026-11-12, `pnpm cloud:live-mcp`, the ignored test `apps/desktop/src-tauri/tests/cloud_c17_live.rs`): a throwaway Worker and sandbox on the owner's account, and a test MCP server on this Mac behind a Cloudflare quick tunnel that answers only a bearer token the run made in memory. Claude in the sandbox listed the server as `connected` with its one tool; after a warm start it fetched the server's prompt when sent `/mcp__c17probe__probe`; and a `tools/call` sent from inside the sandbox with only `provided-by-worker` was answered. Every request reached the server with the real token and none without it, so the Worker's swap works. A hash search of 17,533 files and 6 processes found the token 0 times and a planted decoy once; 5 processes held the placeholder; no relayed line held the token. The run deleted everything it made, checked by wrangler's lists and Docker's. A turn's model call was not made: the Worker held no model key, so Claude's tool use after the prompt was not exercised. The first attempt (2026-11-07), cut short by Cloudflare's outage, and this run's numbers are in `docs/research/cloud-spike-2026-11-06.md`.

## D123. The sandbox image carries Cursor's Linux SDK, and the loader follows the running platform (2026-11-07)

Proposed by the fixer; not yet ruled on by the owner.

Context: D118 recorded that a Cursor chat could not run in a cloud workspace: CLOUD-04's image had no Cursor SDK, and AGENT-09's loader named only `@cursor/sdk-darwin-<cpu>`. Issue #450 asked first whether Cursor publishes a Linux build. `npm view @cursor/sdk@1.3.1 optionalDependencies`, read 2026-11-07, lists `@cursor/sdk-linux-x64` and `@cursor/sdk-linux-arm64` at 1.3.1. `npm view @cursor/sdk-linux-x64` shows `os: ["linux"]`, `cpu: ["x64"]`, and the ripgrep binary and tree-sitter folder the loader already points the SDK at. The image builds for linux/amd64.

Chosen: CLOUD-04's Dockerfile installs `@cursor/sdk` 1.3.1 and `@cursor/sdk-linux-x64` 1.3.1, with the app's release feed's exact dependency tree, into the managed-program layout the app uses (`agent-binaries/cursor/1.3.1/node_modules/`) and links `cursor/current`. AGENT-09's loader takes the platform as a process fact and names `@cursor/sdk-<platform>-<cpu>`, so the Mac keeps the darwin package and the sandbox picks the Linux one. This supersedes D118's "A Cursor chat still cannot run in a cloud workspace" note.

Why: Cursor publishes the Linux build at the same version, so the sandbox runs the same SDK as the Mac and the Worker's `api2.cursor.sh` key swap reaches it. No live model run was needed to verify the layout: the image test checks the Dockerfile against the loader's own platform rule, and a composition test starts a Cursor chat with the sandbox's Linux facts.

## D124. How APP-17 imports from Conductor (2026-11-07)

Proposed by the APP-17 PR; not yet ruled on by the owner.

Context: D100 and docs/plans/migrate-from-conductor.md set the import's safety rules. Building it showed that some of the plan's facts do not hold, and left choices the plan does not make. The work used only the column definitions of Conductor's schema and made-up data, never the owner's database.

Chosen:

- **The copy is made from bytes, not with SQLite's backup API.** A test showed that opening a database with SQLite, even read-only, creates `-wal` and `-shm` files beside it when no other connection is open, and writes read marks into its `-shm` when Conductor runs. The Rust shell copies `conductor.db` and its write-ahead log as plain files (a clone on APFS, so a 12 GB database copies at once), compares their size and modified time before and after, and takes it again when Conductor wrote meanwhile (three tries, then `conductor_import_busy`). Only the copy is opened. The copy is the import's scratch file under app data `conductor-import/`, removed with `remove_file` when the import ends, fails or is cancelled, and at each start.
- **Imported rows keep Conductor's ids.** That is how each row records where it came from (rule 7): a second import skips an id that is there, and our GitHub sync, which uses Conductor's `github-<thread>-<comment>` ids, updates an imported GitHub comment instead of adding a copy. No migration is needed. An id that could not be part of a file or ref name is left out. A project Conducted already has in the same folder is reused, and its Conductor workspaces join it. Settings and variables are matched by key and name, and a value Conducted already has is kept.
- **Repository scripts come from where Conductor reads them.** After its own file migration Conductor reads scripts from `.conductor/settings.toml` and `.conductor/settings.local.toml`, and its `repos` columns keep stale copies (services-map.md 4.2.5); `conductor.json` is no longer read. The import copies the `[scripts]` table of the shared file into a new `.conducted/settings.toml` and of the local file into a new `.conducted/settings.local.toml` (excluded from git, as a saved local setting is), with every `CONDUCTOR_` name renamed. Before Conductor's migration (its marker key is absent) the columns go into the local file, as Conductor's migration would put them. A file Conducted already has is never changed.
- **Environment variables with no value in the database stay behind.** In Conductor's release builds `env_vars.value` is NULL and the value is in Conductor's own Keychain item (services-map.md 4.2.8); the research has not verified that item's service name, so the import does not read it. Such a variable is listed, with the advice to enter it again. A variable with a value moves into our Keychain inside the Rust shell; values never reach the web view. Cloud variables stay behind.
- **Settings by a written key map, table to table.** Only keys both apps keep in their database come over (`CONDUCTOR_SETTING_KEYS`), with Conductor's follow-up words mapped to ours. A row for a key Conductor reads from its settings.toml is stale and stays, as do Conductor's onboarding step, announcement, keybinding ids and project filter. `~/.conductor/settings.toml` is not read; the dry run says so.
- **A workspace's folder comes from git.** A live workspace's folder is the repository worktree that `git worktree list` names with the workspace's folder name (or its recorded path); none means the workspace stays behind. An archived workspace keeps its recorded path, or the place Conducted would restore it to. Conductor's `setting_up` is ready; `initializing` and `failed` stay behind, as Conductor deletes them at start; cloud workspaces stay behind.
- **An imported workspace is never renamed or cleaned up by Conducted on its own.** Its branch is not a placeholder, so no branch Conductor still uses is renamed; it has no setup log path, because Conductor's log is in Conductor's folder; it has no archive time, so the archived-data jobs leave it alone. Workspace ports are chosen inside the port service's queue for the whole import.
- **Chats come over without their messages.** A chat keeps its title, agent, model, effort, fast mode, plan mode and the agent's session id, and resumes from the agent's transcript (D006). A hidden Conductor chat comes over closed, at its last change. An unread workspace shows unread through its newest chat. OpenCode and Pi chats stay behind until Conductor's `acp_config` is read. A chat with no agent type ran Claude, the only agent Conductor had then.
- **Chat history waits for the spike, as its own row (APP-18).** The mapping is `packages/sidecar/src/import/conductor-history.ts` (issue #512 moved it from `session_events` to `session_messages` on 2026-11-11), beside the Claude translator it uses, and `scripts/conductor-import/spike.ts` measures it on a copy, printing counts only. Codex payloads and Conductor's checkpoint events (snapshots under Conductor's own refs) count as unmapped. History comes over only if the lead's run meets D100's pass mark.
- **Favourites take their agent from the agents' model lists**, since Conductor's favourite names only a model; at most four are kept, as the model picker keeps. Review comments come over for open workspaces only, as the plan says.
- **Where it sits (D098).** Conductor has no import, so it sits on General after Sync agent configs, which also brings things in from elsewhere, and on the first-run project step when Conductor's database is on this Mac. The `our-name` guard exempts the import's own files, which must name Conductor to the user.

Why: each choice keeps rule 1 (nothing of Conductor's is written) and rule 7 (once per item) true by construction rather than by care, or follows what Conductor itself reads. The deviations from the plan's letter are facts the plan's author did not have.
Since D130: chats bring their history; the bullets "Chats come over without their messages" (as to messages) and "Chat history waits for the spike" are replaced.

## D125. Large services are split along their feature ids when next changed, with no size gate (2026-11-08)

Proposed by the lead, closing #397; not yet ruled on by the owner.

Context: the system audit (docs/reports/audits/system-2026-11-07.md, item 10) found services that own many features: `GithubService` (12 feature ids, 42 public methods), `SessionsService` (65 public methods), `WorkspaceService`, `GitService`, `binaries.rs`, and `createContainer` as one long function. It asked for each to be split along its feature ids when it is next changed, with no behaviour change in the split, and for a failing test first.

Chosen:

- **When a change touches one of these, the change's PR first moves the feature it touches into its own service or module**, in a commit of its own that changes no behaviour. The rest of the change follows in later commits. The feature ids in the file headers (`@feature`) name the seams; one feature per new module.
- **No size or method-count gate.** The owner's rule is that counts show where to look and are never a target, a gate or a measure of progress (CLAUDE.md, "No theater"). A line or method limit would make builders shape code to the number. The audit's list is where to look.
- **Nothing holds this rule yet beyond review.** A split commit is checked by the lead's diff read: the moved feature's tests pass unchanged, and no test changes in the split commit. This is said here, as the owner's rules require for a rule with no guard.

Why: a split done on its own, all at once, is a large change with no user-visible gain and a high chance of breaking something; done when a feature is next touched, each split is small and its tests already exercise it. A size gate would measure the wrong thing.

## D126. Screens depend on core's API and pure helpers, never its services, and Biome holds the line (2026-11-08)

Proposed by the lead, closing #396; not yet ruled on by the owner.

Context: `docs/architecture.md` said `features` and `ui` may import only `core/hooks.ts`, `core/api.ts`, `core/model.ts`, `ui`, `shared` and protocol types. Biome banned only `@tauri-apps/**` and `core/db`, so in practice the screens imported `core/services/*` about 50 times and other core internals about 80 times, each time reaching around the stated boundary.

Chosen: `features` and `ui` may import `core/context.tsx`, `core/model.ts`, `core/hooks.ts`, `core/api.ts`, anything under `core/registries/`, `core/status/` and `core/async/`, the pure helper modules under `core/` outside `core/services/`, other features, `ui`, `shared`, protocol types and `app/command-dispatcher.ts`. They must not import `core/services/**`, `core/container.ts`, `core/db/**`, `core/cloud/**`, `core/git/**`, `core/conductor-import/**` or `@tauri-apps/**`. Test files and `src/test/**` are exempt because they wire real containers. Each pure helper, constant or type a screen needed moved out of its service file into a `core/` module named for what it holds, with the service importing it from there; a helper that does I/O stays in its service and the screen reaches it through `Actions` or a hook. Biome's `noRestrictedImports` carries the ban, and `scripts/guards/boundaries.test.ts` probes every banned path and one allowed import.

Why: the boundary is what stops a screen from reading the database or a service's internals, and stating it in prose alone let it erode. Moving the pure parts gives each value one home, so the screens and the services cannot drift apart.

## D127. The organisation switcher chooses this Mac or the paired Worker, and the new-workspace page creates there (2026-11-11)

Proposed by the lead, closing #491; not yet ruled on by the owner.

Context: the cloud stack was built (the Worker, pairing, deploy, sandboxes, the host seam), but nothing created a workspace with a cloud host: `WorkspaceService` always wrote the local host, and the owner asked "HOW DO I USE A CLOUD WORKSPACE??". In Conductor 0.92.1 the control is the organisation switcher above Home (renderApp `CRt`, `U9a` @10381031). While a cloud organisation is active, the new-workspace page works out a cloud hosting target (`BXa` @11497335) and every new workspace is created in the cloud (main `aV` @1109999), and the lists show only that organisation's workspaces (main `Ttn`, `Nst` @922363). D004, D018 and D107 had left organisations out.

Chosen:

- **The switcher, where Conductor has it.** The first row of the sidebar's top block is Conductor's "Account menu" trigger with the active entry's icon and name. Its menu lists "My Mac" (Conductor's personal label when the account has no name) and, only on a paired Mac, the Worker by its host name, marked "Cloud organization"; a check marks the active one. While data privacy is on it adds "Organizations are unavailable when enterprise data privacy is enabled.", then Settings. Choosing an entry writes the hidden user setting `active_organization`, so it survives restarts; a stored cloud choice on an unpaired Mac reads as this Mac, as Conductor falls back to the personal organisation. Choosing reopens the last workspace open in that entry, as Conductor does, while the sidebar stays mounted.
- **The sidebar follows the active entry.** Its workspace list holds this Mac's workspaces for the local entry and that Worker's cloud workspaces for the cloud entry, as Conductor's sidebar filters them (main `Nst`). A stored local choice does not wait for the pairing read. Conductor scopes Home, the palette and its other lists the same way; ours still list both hosts there, because the project-removal confirmation counts every workspace a removal deletes and the ask was the sidebar. Scoping those lists is the owner's call.
- **The new-workspace page in the cloud.** The hosting target is the Worker once it is ready and data privacy is off. Conductor's readiness checks map to the Worker: a Worker that does not answer `GET /readiness` is "Computer isn't ready yet." (with "View computer", which opens Connections); no `GITHUB_TOKEN` is "Connect GitHub to create a cloud workspace." ("GitHub isn't connected."); no model key is "Set up an agent to create a cloud workspace." ("No agent set up yet."); no project with a GitHub remote is "Add a repo to the computer to create a workspace." ("No repositories yet.", with "Add one"). "Checking organization..." shows while a stored cloud choice waits for the pairing, and the data-privacy text and "Cloud disabled" while data privacy is on. Create is off with the reason as its tooltip. When ready, the project picker becomes Conductor's repository picker ("Repository", "Select repo", "Repository on <Worker>", "Add repository"), listing the projects the Worker can clone, named by repository; the create-from control stays. The branch picker Conductor hides in the cloud (`CXa`) has no counterpart on our page.
- **One create path.** `NewWorkspaceInput.cloudUrl` names the Worker, as Conductor's create call takes `hostingServerUrl`. The same `WorkspaceService` create gives the row a sandbox name (`ws-` and an id, a Durable Object name) and the folder `/workspace/<name>`, so no two cloud workspaces share a folder (D101). It starts the sandbox (`POST /w/<name>/start`), clones `https://github.com/<owner>/<repo>.git` into that folder through the Worker's git route, checks out the new branch from `origin/<base>` (a pull request's head is fetched first), sets `push.autoSetupRemote` when that setting is on, keeps `.context/` out of git, counts the files and runs setup; the section and the first chat are shared with the local path. A sandbox that does not start says Conductor's "Cloud workspace isn't reachable right now. Try again in a moment.".
- **The Worker answers what it holds.** `GET /readiness` returns `{ github, agents: { anthropic, openai, cursor } }` as booleans, behind the pairing token, starting no Durable Object.
- **Folder names span hosts.** The `(repo_id, directory_name)` unique index covers every host, so the place-name generator now reads every host's names (D103 had kept it local).

Left out, and why:

- The account email, single sign-on marks, "Create organization", "Upgrade to Pro", "Log out", the copy-info context menus and the new-organisation callouts ("Join <org>!", "Switch to <org>!", "Click here to set up your new cloud organization") are Conductor's accounts and teams (D004, D025).
- The `org.switchTo1` to `org.switchTo9` shortcuts (Ctrl+1 to Ctrl+9) are hidden commands in Conductor; our registry has no hidden commands, so adding them would show them in the palette. Not built.
- The switcher at the top of Settings, and the cloud organisation's move of `/` to Home, are not built.
- Conductor's "Connect GitHub" and "Set up an agent" actions and "Couldn't check agent setup." have no counterpart: the Worker's GitHub token and model key are Worker secrets the app cannot set (the user runs `wrangler secret put`), and one readiness call answers every check.
- The restricted-access toggle and the cloud backlog are team and service features; the page hides "Add to backlog" in the cloud because a backlog row has no host.
- A cloud create does not copy the Mac's included files (such as `.env`) into the sandbox, so no secret enters it (cloud-and-remote.md, "Secrets never enter the sandbox"), and the clone names its remote `origin` whatever the project's `remote_name` says.

Why: it is Conductor's own control in Conductor's place, the smallest set of its behaviour that one local and one cloud entry need, and it reuses the create path and the Worker routes that exist, adding only the readiness route.

## D128. A pull request runs the tests its changes can reach; main runs every test (2026-11-11)

Proposed by the lead; not yet ruled on by the owner, apart from the rules the brief quoted: money, data-loss and security tests run on every pull request, and a flaky test gets a root cause.

Context: main's last green CI run (43030758742) took 12 minutes, 9.5 of them in `pnpm test`, every test on every pull request whatever it changed. The desktop's Vitest files alone took 514 s. The TypeScript job also installed zsh from Ubuntu's mirror for one test, and the mirror was unreachable that day (#540).

Chosen:

- Pull requests run `pnpm test:changed --since HEAD^1` (`scripts/run-tests.ts`): each runner's own import graph picks the tests the changed files reach, files read by name count as reached, and `scripts/test-rules.ts` holds the run-everything list, the folder rules and the always-run tests. Code that changed with no test reaching it runs everything. Main runs every test after each merge, the net under the selection.
- The bun-tested folders walk Bun's resolver over their imports instead of `bun test --changed`, which missed every import of a workspace package by name.
- Tests that need a program only macOS ships are their own Vitest project (`*.macos.test.ts`) and run in CI's macOS job, so no job installs zsh.
- Not done: a fixture cache, because Vitest puts the desktop's time in jsdom per file (environment 41 to 43%) and module loading (24%), with setup at 1%; and shared workers, because they first need proof that the 830 desktop files leave no global state behind. A desktop change still selects about half of the desktop files, since most tests reach the real container, so shared workers are where the next gain is.

Why: run only what a change can break, and keep one net that catches what that misses (the owner's test-setup method).

## D129. A background helper's late work shows inside the card that started it (2026-11-11)

Ruled by the owner. The lead proposed: "keep all the data, and show a helper's late work inside the card that started it. Conductor shows that finish notice where it arrives, and we'd keep it there, so you can see the helper is done and find its card." The owner answered "go".

Context: a Task or Agent call can start a helper that keeps working after its turn ends. Its later messages name the call in `parent_tool_use_id`, but each row is saved under the turn running when it arrives (main-BE1h_1MP.js `Mmt` @1440920). Conductor builds each turn from its own rows only (`wp` @1423850). It takes every message that names a parent out of the main transcript (`vmt`), and makes a card only for a call of the same turn (`_mt` @1427823). So it shows a helper's late work nowhere. Ours showed it at the top level of the later turn.

Chosen:

- **Keep every row, and put late work in its card.** A sub-agent's text, thinking, todo list or call whose parent call is in an earlier turn goes inside that call's card, after what the card already holds, in arrival order. A late result goes to its call. The later turn shows only its own work. The turn builder finishes turns in order and keeps one index of their calls, so the build stays linear in the events.
- **Unknown parents stay where they are.** A sub-agent message whose parent call never arrived stays at the top level of the turn it arrives in. The ruling moves late work; it hides nothing.
- **The finish notice: neither app draws one.** Conductor keeps the `task_notification` row in the later turn's main transcript, but its system view draws nothing for it: renderApp `Ipa` @9596117 draws a system row only when it has `content`, and the SDK's notification has none (checked in SDK 0.3.321's type and in the CLI that emits it). Our Claude translator drops the row. The proposal's premise that Conductor shows it was wrong, and Conductor has no wording to copy, so no notice is added. Showing one would be a further departure, and that is the owner's call.
- **Only changed turns redraw.** `reuseUnchangedTurns` keeps every turn whose content did not change the same object, matched by id, so a past turn that gains late work redraws and the turns after it do not. It replaces the differ that reused only the turns before the first change.
- **The history check leaves the ruled difference out.** The spike compares each turn's main transcript. Conductor leaves late work out of it, and now so do we; a known-case test reads `match`. Work whose parent call is stored in no row is the other ruled difference: Conductor takes every sub-agent message out of the main transcript (`vmt` @1427544) and shows none of it, ours keeps it at the top level. The spike leaves those entries out of the comparison and prints how many (`scripts/conductor-import/spike.ts`, `withoutOrphanedWork`). On the owner's backup copy, 63 parent ids are stored in no row.

Why: the owner's ruling. Late work stays visible, in the card it belongs to, where Conductor loses it.

## D130. How APP-18 brings chat history from Conductor (2026-11-11)

Decided by the lead under the owner's rule "Match Conductor. Nothing made up; gaps are reported." Replaces D124's two bullets on chat history.

Context: the lead's spike run on a copy of the owner's database met D100's pass mark: all 288 Claude chats read the same as in Conductor, and 100% of 3,172,282 rows map (#555). One chat has about 400,000 rows, and the spike held a whole chat in memory at about 426 MB per 200,000 rows. The work used only Conductor's schema and made-up data.

Chosen:

- **After the rows, one chat at a time.** History is written once the import's rows have committed, in one transaction per chat that counts the events and reads the first back. A chat whose history fails comes over without it and is named with the reason; the others go on.
- **Which chats.** A chat brings its history when its agent has a mapping (`CONDUCTOR_MAPPED_AGENTS` in the protocol, Claude today) and it is in Conducted with no event of its own: one the import brings now, or one an earlier import brought without history. A chat with any event is never added to. A second import adds nothing, a failed chat gets its history on the next import, and a chat the user used since the dry run is left as it is.
- **Two reads, memory bounded by one.** The Rust shell pages a chat's sent rows by rowid without their content, then fetches rows by rowid. Neither needs an index on Conductor's table, whose indexes are not known. The sidecar's mapper keeps a few numbers per row, sets the order Conductor shows, and maps the rows a read at a time. The desktop cannot import the sidecar, so it reaches the mapper over RPC. The spike runs the same mapper over rows in memory, so it measures what ships.
- **Each turn ends.** The mapping adds a `turn_ended` event to each shown turn, decided by its last result as our runner decides it (`resultErrorItem`). A turn with no result ends `unrecorded`: it has ended, and nothing records how. The chat shows nothing for it, as Conductor shows nothing, and claims neither success nor a crash. On the owner's copy that is 1,505 of 19,200 turns in 157 chats (17,249 end in success, 446 in an error). Without an end, every imported turn would show "This turn stopped before it finished.", and startup repair would add an end to each.
- **Times.** An event's `at` is Conductor's time. It is received at the import's time, so the data lifetime job, which ages events by when they were received and scans from a watermark, treats imported events as events received at import.

Why: the owner's rule "Match Conductor. Nothing made up; gaps are reported." The history matches Conductor's chat by the spike's measure; a turn whose end the rows do not record shows nothing, as in Conductor, without inventing how it ended.
Since D136: a chat's events are staged outside its transaction, and the transaction copies them into the chat in one statement.

## D131. File icons draw Conductor's tinted brand glyphs, from their own packages (2026-11-12)

Decided by the lead under the owner's rule "Match Conductor. Nothing made up; gaps are reported." The second package (react-icons) is needed because 11 of Conductor's glyphs are not Simple Icons. How the app shows the CC BY 4.0 credit that Font Awesome and codicons require is the owner's call (#577).

Context: Conductor 0.92.1 looks a file up in a hand-made table before the Material Icon Theme (renderApp `x8i` @2480863): 22 names, a Dockerfile prefix and 84 reachable extensions, drawn with 43 glyphs in 30 tints. Its glyphs come from react-icons. Matched path for path, 32 are Simple Icons, 8 are Font Awesome 5's solid file shapes, 2 are VS Code codicons (`json`, `settings-gear`) and 1 is Devicons' `java`. The issue assumed all were Simple Icons.

Chosen:

- **The table is ours, the art is theirs.** `ui/file-icon.ts` holds the table, hand-read and checked entry for entry against Conductor's. `ui/file-icon.tsx` draws the 32 brand glyphs from `simple-icons` 14.15.0 (CC0; every 14.x release matches all 32, 13.0.0 and 15.0.0 do not), and the other 11 from `react-icons` 5.5.0 (MIT wrapper; Font Awesome and codicons are CC BY 4.0, Devicons MIT; 5.6.0 and 5.7.0 redraw some). Both are pinned exactly, and each glyph is imported by name.
- **Tints are tokens.** `--color-file-<tint>` in `styles.css` holds Conductor's colours unchanged: Tailwind 4's palette and Conductor's own grays. Only `documentation` (Markdown) changes in dark mode.
- **Conductor's quirks are kept.** The table reads the text a caller gives, so the file tree's bare name matches a name and the path chip's path matches only by extension, as in Conductor. C# draws Simple Icons' `sharp` glyph, as Conductor's does.
- **Left out.** Conductor's first rule draws a `[LINEAR]-` or `[GITHUB]-` attachment with its own Linear and GitHub images; we have neither image. Folders keep our own glyph; Conductor draws codicons' folder in the muted colour.

Why: the owner's rule. Every glyph comes from its published package, never from Conductor's bundle (D002), and is checked against Conductor's at the same version.

## D132. The import from Conductor fits on the disk (2026-11-12)

Decided by the lead after measuring the import at full size (#556). The dialog's new lines are ours, since Conductor has no import from us, and are the owner's to judge.

Context: the lead counted the chat history import on a copy of the owner's database. 288 Claude chats map to 2,128,838 events. Stored as our events they take 12.12 GB of JSON, and 3.77 GB without each agent message's `raw`. The owner's Mac has 15 GiB free, so the import as built could fill the disk.

Chosen:

- **Imported agent events keep no `raw`.** `raw` keeps the original SDK message so a later translator can read an event again. For an imported chat, that original is Conductor's own row. It stays in Conductor's database, and the import can run again from it. The mapper drops `raw` (`packages/sidecar/src/import/conductor-history.ts`). Events our own runner writes keep it.
- **The dry run measures the history it brings.** It reads and maps each chat as the import does, and sizes each event as the writer stores it (`storedEventBytes` in `core/db/session-events.ts`). It writes nothing. So the dry run now takes about as long as the import's history step.
- **SQLite's overhead is computed from its file format.** `TablePages` in `core/conductor-import/plan.ts` packs the rows into 4 KiB pages as SQLite appends them: a page takes rows until the next one does not fit, and a row larger than a page holds fills overflow pages. The table's four indexes take their entries' bytes at 85% fill; they measured 88% to 89% full with random UUID ids, as Conductor's are. On made-up chats of four shapes the estimate is 0.2% to 2.7% above what the database grew by, and the test allows 0% to 5% (`conductor-import.space.container.test.ts`). A flat allowance on the rows' bytes missed by up to 90%, because how full a page gets depends on the rows' sizes. A test lists the table's indexes, so a new index fails until the estimate counts it.
- **What must be free.** The history, plus the largest chat a second time, plus a margin of 2 GiB. The largest chat counts twice because SQLite's journal holds a chat's whole transaction before it is copied into the database, and keeps that size until the app closes. The margin keeps the Mac working after the import. With no history to write, the import asks for nothing.
- **Free space comes from Rust.** `app.databaseFreeBytes` asks `statfs` for the disk that holds `conducted.db`, and answers the available blocks as `df` shows them. A disk that cannot be asked is `db_free_space_failed`.
- **The import refuses before it writes.** It reads the free space again when it starts. If the disk no longer has room, it stops with both numbers, changes nothing and drops its copy, so the next try starts from a new dry run.
- **What the dialog says.** Under "Chat history": "Takes about <size> of disk space", then "<size> is free." When the space is not there, a red notice reads "There is not enough free disk space. The import needs <size> free, and <size> is free. Free up space, then try again.", and Try again takes Import's place. Sizes are decimal GB with one decimal, as Finder shows a disk, and whole MB below 1 GB.
- **The measure script checks the estimate on real data.** It prints the dry run's figures beside the scratch database's file and journal, before and after the import. The Node stand-in clones Conductor's database as Rust does, so on APFS neither copy takes space.

Why: the owner's disk must not fill. `raw` was most of the weight, and the original stays in Conductor's database. The dry run already promises to say what the import will do before it does it, and the space it takes is part of that.
Since D136: the largest chat counts three times, once more for its staging.

## D133. Claude Code follows its newest compatible release between app updates (2026-11-12)

Asked for by the owner in #541. Extends D021 and D088; D088's rule stays.
Context: the app ran only the Claude Code its release feed pinned (D088), so a model that needs a newer Claude Code arrived only with an app release. Conductor pins its Claude Code the same way. Claude Code's release host publishes `https://downloads.claude.ai/claude-code-releases/latest`, the newest version as plain text, and `<version>/manifest.json` with each platform's SHA-256 and size and `sdkCompat.testedWrapperVersions`, the Claude Agent SDK versions that release was tested with. Claude Code's own installer (`https://claude.ai/install.sh`) reads the same two files.
Chosen:

- **When.** At launch, and whenever a day has passed on the wall clock, looked at once an hour (`apps/desktop/src-tauri/src/binaries/follow.rs`).
- **Which release.** The `latest` version, when it is newer than the copy that runs and its manifest lists the SDK the sidecar pins. `build.rs` reads that pin from `packages/sidecar/package.json`, its one home. A release that does not list it is never installed, and the Advanced page names it.
- **How it installs.** From `<version>/darwin-arm64/claude` or `<version>/darwin-x64/claude`, through a temporary file that replaces nothing until its size and SHA-256 match the manifest. A refused or cut-off download leaves the copy that runs, and no temporary file or empty version folder. Claude Code stays Ready meanwhile, so the send gate never holds a chat for it.
- **The floor.** The release feed's version is the oldest the app runs and the answer when the host is out of reach. A first install and Re-download take the newest compatible release, or the floor. After a restart a followed copy runs only while it is newer than the floor and its install record lists the SDK, so an app update that moves either goes back to the floor until the next check.
- **Chats.** A new chat resolves the bin link and gets the new copy. A running chat keeps the path it started with: every version that was ready during this app run stays on disk until the next launch, which moves the others to the Trash with their install records.
- **What stays.** A program chosen in Settings still wins (SET-13). The app never runs a copy from PATH (D088); what changes is that its managed Claude Code is no longer fixed per app version. Codex, gh, watchexec and the cloud sandbox's programs keep their pins.
- **Codex has no signal.** Its GitHub release gives each file a SHA-256 digest and ships a config schema and an SDK tarball at the same version, but nothing says which client or protocol version it works with. The sidecar speaks Codex's app-server protocol directly, so nothing can gate a move.
- **Limits.** Only `latest` is read: the host publishes no list of versions (`/claude-code-releases/` answers 404), so a compatible release between the one that runs and an incompatible `latest` is never seen. The manifest is trusted over HTTPS from the vendor's host, as the installer trusts it. The host also publishes `<version>/manifest.json.sig`, but no public key for it is documented, so it is not checked. The floor's checksum is still reviewed in a pull request; a followed version's comes from the host at run time.

Why: the owner's request. New models reach the user without an app release, and the SDK gate keeps the app on releases Claude Code's own tests cover for the SDK the sidecar runs.

## D134. A system dialog's title is checked by a test, not a catalogue state (2026-11-12)

Decided in the parity work under the owner's rule "Match Conductor. Nothing made up; gaps are reported."

Context: Conductor titles its system folder pickers "Select project directory", "Select directory to link" and "Select Conductor root directory" (renderApp @1717947, @5685048, @10967435). macOS draws those windows outside the page, so no catalogue state can show them, and the parity harness's check b never sees them. Ours passes the same titles to `Platform.dialogs.pickFolder`, with our product name in the third (D012).

Chosen: a parity entry that is the title of a system dialog is mapped to D134. Its note names the screen that opens the dialog and the test that asserts the title the Platform receives. The test drives the real screen, so changing the title fails it. A dialog the app draws itself stays a catalogue match.

Why: the words are on screen and must match Conductor's. Only a test can see them, so the decision names the test that holds them.

## D135. End-to-end tests drive the real app through its own WebDriver server (2026-11-12)

Decided by the lead's brief for part 1 of #564, under the owner's plan in the issue ("The app runs in a debug build with Tauri's WebdriverIO service ... The plugin is compiled only into the test build. A check fails if it's in the release bundle.").

Context: Tauri's own driver (`tauri-driver`) has no macOS support. On macOS, WebdriverIO reaches WKWebView only through `tauri-plugin-wdio-webdriver`, an HTTP WebDriver server compiled into the app, which lets any local process drive the window.

Chosen:

- **A Cargo feature, `e2e`, compiles the server in.** Nothing but `pnpm test:e2e` turns it on. `verifyBundle` fails a release whose app binary holds the server's markers, and each e2e run proves the same scan finds them in the test build.
- **The test build is a debug `.app` bundle** with the release config's bundled sidecar. A bare debug binary finds no resources in production mode, and a dev build needs a dev server on a fixed port.
- **WebdriverIO's `remote()` talks to the server directly.** The harness starts the app itself, so it owns the process ids, the environment and the folder; `@wdio/tauri-service` would start the app for it.
- **Everything the app keeps is in the fresh folder.** `HOME` and `CFFIXED_USER_HOME` point there; the first launch of a probe without `CFFIXED_USER_HOME` read three stored keys of another copy of the app from the shared WebKit store, so it is required. The app runs under the sidecar differential run's sandbox profile.
- **Data is written by the app's own repositories** while the app is stopped, after its first launch ran the migrations.

Why: the owner's plan names the plugin and the release check; a check that cannot reach the owner's data or another copy's is the only kind that may run on the owner's Mac.

## D136. A chat's history is read outside its transaction, so the import keeps the database queue free (2026-11-12)

Proposed by the #598 PR; not yet ruled on by the owner.

Context: the lead's measure on a copy of the owner's database (#598) showed each chat's history written in one transaction on the app's one database queue, which the longest chat held for 79 s, and the import's process at 2.4 GB. On a made-up chat of 200,900 rows and 608 million characters the measure showed 15.7 s and 1.7 GB. Sampling each stage apart showed where the memory went. The peak belonged to the measure's own last step: it opens the largest chat, and `sessions.open` loads every event of it. The import's own peak was about 540 MB, with its retained heap flat. The measure's relay of the sidecar's lines also joined and split its whole buffer again on every chunk, which allocated 79 GB during the import and lengthened the hold by a third. The Rust shell's framer has no such cost. The hold itself was mostly the chat's reads and mapping, which ran inside the transaction.

Chosen:

- **Stage, then copy in one statement.** A chat's reads and mapping run outside any transaction. Each read's events go into a staging in one statement, and the app's own writes take their turn between those statements. The staging is a temporary database (`ATTACH DATABASE '' AS conductor_history`), so no reader of `session_events` sees it, and SQLite deletes its file when the import detaches it after each chat, or when the connection closes. The chat's transaction then copies the staged events with one `INSERT ... SELECT`, counts them and reads the first back.
- **All or nothing still holds per chat (rule 3).** A chat whose reads fail leaves only its staging, which is detached. A failed copy rolls back. A crash takes the temporary file with the connection. A reader sees none of a chat's history or all of it. The staging lives on the connection the queue uses. If the SQL plugin's pool, which nothing pins to one connection (platform/tauri.ts), replaced it mid-chat, the staging would be gone and the chat would fail as any chat fails.
- **What still holds the queue.** The copy, because a reader must see the whole chat or none of it, and SQLite has one writer. On the made-up chat it held the queue 4.0 to 4.7 s, against 10.3 s with the reads inside and the relay fixed. Detaching the staging takes about 0.5 s as one statement. Each staging statement takes about 10 ms.
- **A chat used meanwhile.** The chat is counted before its reads and again inside its transaction. A chat that gained an event in between is left as it is, as before.
- **Disk.** While the largest chat is copied, its staging holds it once more, so the space check asks for the history, the largest chat twice more, and the margin. The staging holds the same rows without the chat's id and indexes, so it takes less than the chat does in the database. It sits in the system's temporary folder, which on a Mac is on the disk that holds the database.
- **The measure tells its stages apart.** It prints peak memory for the dry run, the import, and the open of the largest chat; the longest statement outside a transaction beside the longest transaction; and its relay joins a line once. Its test runs a chat of 200,700 rows and 338 million characters and bounds how far each process's memory rises while the import runs.

Why: rule 3 is kept per chat, and the app's own writes wait at most for SQLite's copy of one chat, never for its reads. On the made-up chat the peak memory the measure reported was its own open of the chat, which the import does not do; the lead's run on the copy shows whether that holds for the owner's chats.
Since D142: opening a chat reads its last turns only, so the measure's open no longer raises the peak.

## D137. The app's database is one connection that nothing replaces while the app runs (2026-11-12)

Decided by the agent fixing issue #616, which the owner filed. Replaces "An explicit pool pin is PLAT-27" in `platform/tauri.ts`.

Context: a transaction is BEGIN IMMEDIATE, its statements and COMMIT, each sent to the Rust shell as its own call (`platform/queued-database.ts`). The app sent them through tauri-plugin-sql 2.6.0, which opens a sqlx pool with `Pool::connect(db_url)` (`wrapper.rs:102`) and so with sqlx 0.8's defaults: up to 10 connections, an idle one closed after 10 minutes, and any one closed when it is released after 30 minutes of life (`sqlx-core-0.8.6/src/pool/connection.rs`, `return_to_pool`). A connection closed inside a transaction rolls it back, and the transaction's later statements then save one by one on a new connection. A TEMP table or an ATTACH vanished with the connection too. A test through the real Rust side showed both on main: the second insert of a transaction saved on its own and COMMIT failed with "no transaction is active", and a TEMP table was gone after the UI's open ran a second time, because the plugin's `load` replaces the pool it holds.

Chosen:

- **Our own commands over one connection.** `database.rs` holds one sqlx `SqliteConnection` from the first `db_open` until the app exits. `db_execute` and `db_select` run on it. There is no pool, so nothing closes the connection while the app runs and nothing opens a second one. Once it is closed (at exit) every database command fails with `db_closed`, and a connection SQLite can no longer use fails each statement the same way. No later statement of a transaction can save on its own.
- **What the UI sends stays the same.** Values bind as the plugin bound them (null, text, every number as a REAL, a boolean, array or object as its JSON text), and rows come back keyed by column name in column order. A test runs the same statements through the plugin on main and through our commands, with the same answers. The migrations run through sqlx's migrator with the same versions and checksums, so a database the plugin migrated opens unchanged; this was checked on a file the plugin migrated.
- **The plugin is removed.** `tauri-plugin-sql`, `@tauri-apps/plugin-sql` and the `sql:` permissions are gone, so no web page can load or close a pool under the app. The live parity harness seeds through `db_open`, `db_select` and `db_execute`, and the parity map records Conductor's `sql|*` commands under this decision.
- **The stand-ins are held to it.** The contract case `db.one-connection` loses the connection between BEGIN and COMMIT and requires the transaction's later statements, its commit and every statement after it to fail. The memory Platform and the Node stand-in both run it; a stand-in that opens a new connection fails it.

Why the other ways were not enough:

- **Pool options through the plugin.** It has none: `Pool::connect` takes only the URL, and SQLite's URL options do not reach the pool.
- **A pool the app builds and puts in the plugin's `DbInstances`.** One connection with no lifetime and no idle timeout stops the 30-minute close, but sqlx still opens a new connection after one fails its ping. The only hook that can refuse it (`after_connect`) makes every later statement wait the 30-second acquire timeout. And any call to the plugin's `load` replaces the pool with a default one.

The test: `apps/desktop/src-tauri/tests/plat_02_database.rs`.

## D138. The uninstall empties the bucket through Cloudflare's API with wrangler's login (2026-11-12)

Decided by the agent fixing issue #635, which the owner filed.

Context: Remove deployment (`uninstall_worker`) deleted the Worker, its container application and images, then ran `wrangler r2 bucket delete`. Cloudflare refuses to delete a bucket that holds anything (code 10008), so every user who saved a cloud setting (`settings/user.json`) or had a backup kept the bucket and its data, and the uninstall reported a failure. The CLOUD-17 live run met it. wrangler 4.158 can get, put and delete one object by its key, but it has no command that lists a bucket's objects.

Chosen:

- **Cloudflare's API, with the login wrangler already holds.** After the Worker, container and images are gone, the shell asks `wrangler auth token --json` for its login (an OAuth token, which wrangler refreshes first, or the `CLOUDFLARE_API_TOKEN` or API key it was given) and calls `https://api.cloudflare.com/client/v4` itself. The login goes in a request header only; it is never logged, returned to the web view or put in an error.
- **Only the bucket the deploy made.** The bucket is the one named exactly as the Worker (D109), looked up by that name with `GET /accounts/{account}/r2/buckets/{name}`; no bucket list is matched by prefix. The account is the one `CLOUDFLARE_ACCOUNT_ID` names, which wrangler also obeys. Without it, the shell asks every account the login reaches and uses the one that holds a bucket of that name. Two accounts that both hold one are refused (`cloud_bucket_account_unclear`), and nothing is deleted.
- **Emptied page by page, then deleted.** The objects are listed 1,000 at a time with Cloudflare's cursor and deleted one by one. An object that is gone when its delete arrives is skipped. The Worker is deleted first, so nothing writes to the bucket meanwhile. If Cloudflare still answers 10008, the bucket is emptied again, up to three rounds. A key with a `.` or `..` segment is refused, because a URL parser folds it into another key.
- **The uninstall says what it removed.** `cloud_uninstall` returns whether the Worker, the container application and the bucket were deleted, how many images and how many objects. The Cloud page's toast names them, with the bucket's file count.

Why not the Worker: the Worker has the bucket binding and could empty it, but it must still be running to do so. A retry after a half-finished uninstall would then find no Worker and could never empty the bucket, and a sandbox could write a backup between the emptying and the Worker's delete.

Left unverified on a real account: that the OAuth token from `wrangler login` may list objects (`GET .../objects`), and the exact HTTP status Cloudflare pairs with 10008. The code reads the error code, not the status. The tests run against a stand-in for the API in `cloud.rs`; the next `pnpm cloud:live-mcp` run checks it live, because its teardown is now the app's uninstall alone.

## D139. CI's macOS job runs on a pull request only when the change can reach it (2026-11-12)

Decided by the agent fixing issue #641, which the owner filed.

Context: the `rust` job runs on `macos-latest`. On 2026-11-12 GitHub's arm64 Macs were short, and the job was cancelled after 15 minutes without a runner on seven pull requests and the v0.4.0 release, including #638, which changed only `scripts/e2e` and docs.

Chosen: an Ubuntu job, `macos-changes`, compares the pull request with main (`scripts/macos-job.ts`) against `MACOS_JOB` in `scripts/test-rules.ts`, the paths the job checks, reads or installs. The `rust` job runs when one changed, when `macos-changes` failed, and on every push to main. Otherwise its condition skips it, and GitHub reports a job skipped by its condition as a success, so the required check passes. `scripts/macos-job.test.ts` holds the list to the paths the crate names and the files the macOS tests import.

Why not skip the job's steps inside the job: the job would still wait for a macOS runner, which is the shortage. Why not a `paths` filter on the workflow: a required check whose workflow never starts holds the pull request forever.

## D140. The app writes its own SSH files under `~/.ssh` and reaches the user's config through one command (2026-11-12)

Decided by the agent fixing issue #611, which the owner filed. The owner's rule for it: the smallest reach that does the job, and the user's other SSH files are never read or changed.

Context: Copy SSH command and Open in for a cloud workspace failed in the real app with `fs_out_of_scope`. `core/cloud/ssh.ts` wrote `~/.ssh/conducted_config.d/ssh.config`, `~/.ssh/conducted_config` and `~/.ssh/config` through the file commands, and `~/.ssh` is outside their scope (PLAT-29). The tests ran the in-memory Platform without the scope, so they passed. Conductor reaches the same files without a scope: `main-BE1h_1MP.js` `SH` @3850539 makes both folders with `mkdir -p` through its shell, writes its per-app file and its `conductor_config` with `write_file_async`, and `Nrn` @3851271 reads `~/.ssh/config` with `cat`, returns when the text already holds the include line anywhere (`includes`), and otherwise writes the line, a blank line and the old text with `write_file_async`.

Chosen:

- **Two default roots, for the entries the app owns.** `home_roots` in files.rs and `defaultFileRoots` in memory.ts add `~/.ssh/conducted_config` (one file) and `~/.ssh/conducted_config.d` (one folder). `~/.ssh` itself, `~/.ssh/config`, keys, `known_hosts` and a sibling such as `conducted_config.bak` stay out of scope.
- **One command for the include line.** `fs_include_ssh_config` (`Platform.fs.includeSshConfig`) takes no path and no text. Rust builds `Include <home>/.ssh/conducted_config`, reads `~/.ssh/config` as bytes and, when the line's text is not anywhere in it, writes the line, a blank line and every old byte through the atomic write, which keeps the mode and writes through a link to its target. It answers whether the file changed. The web view never reads the file and can put nothing else in it.
- **Conductor's check, Conductor's layout.** The line counts as present when its text appears anywhere, so a commented-out line is left as the user left it. The cases both runtimes answer are `packages/shared/fixtures/ssh-include.json`; files.rs and the TypeScript stand-ins read the same fixture.
- **A config that cannot be read is an error.** Conductor treats a failed `cat` as an empty file and would then replace the config with the line alone. Here only a missing file counts as empty; any other read failure is returned and the file is left alone.
- **A root under a linked folder matches before it exists.** `root_for_compare` now resolves a root the way a path is resolved, from its deepest existing folder, so a `~/.ssh` that links into a dotfiles folder reaches `conducted_config.d` on the first write.

Why not register `~/.ssh` as a root: the web view could then read and write every key and `known_hosts`. Why not write the line through the shell, as Conductor does: the shell can reach anything, so it would not narrow the reach at all. Why not one command for all three files: the config text and the host rules are core logic with their tests in TypeScript, and the two files the app owns need no more than a root.

The tests: `workspace.cloud-12.test.ts` runs the door with the file scope on, files.rs's `cloud_12_*` tests hold the roots and the command, and the contract case `fs.include-ssh-config` runs on the stand-in and the Node-backed bindings.

## D141. The UI's programs are checked against the Rust allowlist by a guard, not a Rust test (2026-11-12)

Decided by the agent fixing issue #647, which the owner filed.

Context: the Rust test `git_16_every_program_the_ui_starts_is_allowed` in `shell.rs` read every UI source file for `program: "..."` literals and checked each against `ALLOWED_PROGRAMS`. So every UI change could reach CI's macOS job (D139), and 33 of main's last 80 merges ran the job for that reason alone (issue #647).

Chosen: the `programs` guard in `scripts/guards/structure.ts` already ran the same scan on Linux on every pull request. It now also checks the programs the UI starts through a variable (zsh and the three helper scripts), and fails when the scan finds no `program: "git"`, so a scan of the wrong folder cannot pass. The Rust UI scan is gone; `git_16_allows_the_xcode_licence_programs`, which reads only Rust, stays. `MACOS_JOB` names only the desktop files the job reads: the two the Rust tests read (`platform/tauri.ts`, `core/app-paths.ts`), the macOS tests, the Vitest setup files and what they import. Replayed over main's last 80 merges, 38 skip the job, up from 10.

Why not a TypeScript test: it would repeat the guard's scan, and the guard runs on every pull request whatever changed. Why not compute the macOS tests' imports when `scripts/macos-job.ts` runs: it would end the list's drift, but the list is short and `scripts/macos-job.test.ts` fails on main when a macOS test starts importing a file the list misses.

## D142. "Overwrite file" saves over the file as the last save left it (2026-11-12)

Decided by the agent fixing issue #622, which the owner filed. It departs from Conductor in one detail, which the owner may overrule.

Context: Conductor's invalid-file toast offers "Overwrite file" when its writer holds a last-known-good parse of the file. It keeps that parse when a save reads the file, before the save's change is applied (readSettingsFileDataForWrite, main @416200), and a forced save writes that parse with the new change over the file. The parse is never updated after a write. So after save A, save B, a hand edit that breaks the file and an overwrite with change C, Conductor's file holds A and C: B is lost without a word, though the user saw it saved.

Chosen:

- **Shown exactly when Conductor shows it.** The button appears when a save into the file was refused because it does not parse, and an earlier save in this run read the file (or found none). The periodic reload keeps no copy, as in Conductor, so a file that was broken before the app's first save offers no button. A forced save never offers a second one.
- **Pressing it does what Conductor's does.** No confirmation and no backup copy. The same save runs forced: the file on disk is not read, and the kept text with the change applied replaces it. With no kept text the save fails as "Failed to save setting". After a forced save into the user's file, the store reads that file again, as Conductor reads every layer again after a write.
- **The kept text is the file as the last save read it or, once written, as it wrote it.** This is the departure: an overwrite keeps the last save's own change. The text is kept, rather than a parsed copy, so the overwrite goes through the same path as any save and keeps that text's comments (SET-14).
- **The refusal carries whether it can be overwritten** (`SettingsFileRefusal.overwritable`, read by `settingsFileOverwritable`), so the screen that toasts knows without asking the service again. The screen passes the same save with `overwrite`, because only it knows what it was saving.

Why not match the lost change: it reverts a setting the user saw saved, which is the defect the button exists to avoid.

Not covered: settings saved on the user's behalf (`last_clone_directory`, `always_allow_local_execution`) live in the settings table, so they never meet an invalid file. A setting's Reset, a project's config pages and a project's env file list show this toast too, as Conductor's do (issue #654).

## D143. A dialog holds app shortcuts unless Conductor keeps it off its dialog store, and the menu carries only Conductor's keys (2026-11-12)

Decided by the agent fixing issue #610, which the owner filed. The owner's rulings: "Match Conductor. Nothing made up; gaps are reported", and on changes people see, "whatever conductor does?".

Context: Conductor holds app shortcuts only while its dialog store has an active id (renderApp @681094). Its 23 `F0` dialogs and 8 alert dialogs set one; 15 dialogs on the bare root `S_` and 19 alert dialogs with their own state, many on Settings pages, do not. Its Settings registers Cmd+F as a plain handler, so the key waits under a store dialog. Its native menu gives a key only to Settings, Quit, Send Feedback, Debug and Close Window, and its page acts on every menu event it hears. Ours held app shortcuts under every modal, ran Settings' Cmd+F behind any dialog over Settings, and gave every menu item the registry's key, so Cmd+B and Cmd+W ran under any dialog through the menu.

Chosen: a dialog holds app shortcuts unless it carries `letShortcutsThrough` (ui/dialog-shortcuts.ts); the eleven dialogs Conductor keeps off its store carry it, listed with their evidence in ui-map.md 5.4 and by a test. Under a holding dialog, a command not marked `overDialogs` runs only `modal` handlers, which is where every dialog registers its own keys, and Settings registers at `base`. The menu carries keys only for Send Feedback, Debug and Close Window (Settings and Quit stay fixed in Rust). A menu pick runs under a dialog, as Conductor's listeners do, except Close Window, which Conductor's page never hears and ours sends to the tab close: it follows the key's rule. The View menu's sidebar toggles no longer show a key.

Why a mark on the dialogs that let shortcuts through, not on those that hold them: most of Conductor's dialogs hold, and ours with no Conductor counterpart keep today's behaviour. Why the `modal` priority, not a context that binds a handler to the dialog it sits in, as Conductor's `Kn` does: our dialogs register their keys in the component that draws the dialog, outside its content, so a context would miss them; the priority already marks them.

## D144. A chat opens on its last five turns and loads older ones as the list reaches its top (2026-11-12)

Decided by the agent fixing issue #617, which the owner filed, under the owner's rule "Match Conductor. Nothing made up; gaps are reported."

Context: `sessions.open` loaded every event of a chat into memory. On a made-up chat of 200,700 rows and 608 million characters, the import's measure saw opening it take the process from 527 MB to 1,907 MB, in 1.59 s. Measured stage by stage, the parsed events the store kept were about 1.3 GB, twice their text; the rows' text read from SQLite was another 640 MB while it lasted; the turns built from them shared the events' strings and added about 50 MB. Each later rebuild of the turns, on every streamed event, also wrote every turn out as text to compare it, about 1.6 GB of garbage and 370 ms. The owner's longest imported chat has about 344,000 events. Conductor's chat reads a window of turns instead (frontend.md 5, "History in pages").

Chosen:

- **The last five turns, then one at a time.** The open reads the list of every turn the chat shows (its id, where its first event is, and the first 200 characters of the message that began it) and the events of the last five turns. While older turns are stored, the list's header says "Loading messages…" and loads one more turn each time its top is within 800 pixels. A failed load says "Couldn't load messages" with Retry. The list stays hidden under the loading skeleton until its turns fill it, nothing older is stored, a load failed or 5 seconds pass. Older turns join through Virtuoso's `firstItemIndex`, so the turns on screen stay still.
- **The outline lists every turn.** A turn that is not loaded shows the start of its message, and its plan is not marked until it loads, as in Conductor. Find in the chat searches the loaded turns, as in Conductor.
- **The gap: a picked turn loads every turn back to it.** Conductor loads the picked turn alone and leaves a gap marker that fills as the user scrolls into it. Ours loads every turn from the picked one to the first loaded one, so what is loaded is always one run of turns to the end. A gap filled from below inserts a turn above what the user reads, which Virtuoso, without the paid message list Conductor uses, does not hold still, and that could not be checked in a real window. A jump far back in a long chat therefore costs memory in proportion to the turns after the picked one. This is filed as #652.
- **Late work stays in its card (D129).** A loaded turn can hold a background helper's work for a call in a turn that is not loaded. The open asks SQLite which of the call ids the loaded events name are calls in the other turns, and the turn builder leaves that work and its result out of the loaded turn, as a build of every turn does. The lookup reads the chat's agent events, so it runs only for ids not asked before.
- **An event of a turn that is not loaded waits in the database.** Alone it would show as a turn of its own; it comes when its turn loads. One stored while its turn is being read is kept.
- **What needs the whole chat reads it and keeps nothing.** Copying the transcript, attaching a chat to another (CHAT-26), reading one of its plans and the tab strip's fork build every turn from the stored events each time, as Conductor reads every row to copy a transcript.

Why: the owner's rule. The chat behaves as Conductor's does, and opening it costs memory near what the screen shows: on the made-up chat the open now leaves the process's peak where the import left it and takes 0.12 s, and a test at 223,000 events keeps 5.6 MB where loading everything kept 403 MB.

The tests: `apps/desktop/src/core/services/sessions.chat-06-memory.container.test.ts` (the bound), `sessions.chat-06.container.test.ts` and `features/chat/MessageList.chat-06.test.tsx` (the behaviour), and the measure's bound on the open in `scripts/conductor-import/measure.test.ts`.

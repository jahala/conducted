# Decision log

Each decision with its context, what was chosen and why. Newest last. A decision is changed by a new entry that names the one it replaces, never by editing the old one.

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

## D039. How the first overnight build runs (2026-11-04)

Context: the owner set a goal for the night and is away until morning.
Chosen:

- Builders and fixers: OpenCode with DeepSeek V4.1 Flash (`deepseek/deepseek-flash`), one fresh worker per feature, through a pleach cast in `.context/overnight/pleach.config.ts` that passes the key by name.
- Work is planned in steps and batches by `scripts/overnight/plan-batches.ts` (`docs/plans/batches.md`). CI runs once per step on GitHub; no tests and no Rust builds run on the Mac. Each node passes only the quick gate `scripts/overnight/node-gate.ts`.
- pleach's enforced red-green phases are not used: they need a test run per node. The step's CI run and the batch audit stand in for them.
- Money: the night's spend is measured from the DeepSeek balance at the start (20.99 USD), and no step starts once it passes 15 USD.
- The step-1 sidecar, data and git features gained the dependencies they have in fact (for example SIDE-03 needs SIDE-02), so they build in order instead of against each other's empty code.
  Why: the owner asked for batches, CI on GitHub only, and DeepSeek Flash.

## D040. The next step is recomputed after every merge (2026-11-05)

Context: `plan-batches.ts` counts dependency steps among the features still open. Once a step's features are done, the remaining ones move up.
Chosen: after each step merges, the conductor regenerates `docs/plans/batches.md` from the open first-slice features and runs its step 1, which is exactly the work whose dependencies are all done. Batch ids therefore describe the night's current state, not a fixed schedule.
Why: one rule for "what is ready", with no second list to keep in sync.

## D041. How a step's PR finishes its features (2026-11-05)

Context: the first step's CI failed on "Placeholders match the backlog", because the finished rows were still `stub` while their placeholders were gone. `pnpm stubs` requires both to change in the same PR. The sync script never closes issues, by design. The batch audit also found checklist items that belong to features not built yet.
Chosen:

- Before the step's first CI run, the conductor sets each finished feature's backlog row to `done` on the step branch (`drive.ts mark-done`). A feature taken out of the step goes back to `stub` with its placeholders.
- The step PR's body carries one `Closes #N` line per finished feature, so the merge closes the issues. `sync.ts --check` then confirms that rows and issues agree.
- A checklist item that another feature owns (a screen, a runner, the composition root) moves to that feature in `docs/plans/items/` before the row turns `done`. When the move leaves wiring undone, the conductor adds an item for it to the feature that owns the wiring.
- A red CI run caused by the conductor's own process does not count as a feature's fix round.
  Why: one record of what is done (the backlog), issues closed by the merge that finishes them, and no "done" that hides unbuilt items.

## D042. A composition root built beside its modules gets an integration fix (2026-11-05)

Context: in step 2, SIDE-01 (the sidecar's composition root) was built in parallel with the modules it composes. Each node passed its gate alone, but the merged batch failed typecheck, because three modules had changed their constructor inputs. pleach's land gate refused the whole batch.
Chosen: the conductor merges the batch's verified branches in a scratch worktree and gives the typecheck output to one fresh fixer for the composition root. It changes only the composition root and its test. The conductor runs every feature's gate on the result before the step branch takes it.
Why: the composition root depends on every module's inputs, so making it wait for all of them would hold it back to the last step. One integration fix per step costs less.

## D043. What a batch audit's findings become (2026-11-05)

Context: the step-2 audits returned about 100 findings for 15 features. Many name behaviour that needs a feature not built yet (a handler, a screen, wiring in the composition root). A feature's row must turn `done` in the PR that removes its placeholders, so "keep it open" is not an option once the code is in.
Chosen: one fresh fixer per feature, or per group of files, sorts each finding:

- Fixed now: a bug, a header that claims what the code does not do, a banned pattern (compatibility alias, invented default, fake success, silent fallback), duplicated logic, an unsafe read or write. Each fix gets a test that fails without it.
- Built now: missing behaviour the feature owns and can build in its own files.
- Moved: behaviour that needs another feature's code. The conductor moves the checklist item to the owner in `docs/plans/items/`, or adds an item there for the wiring.
- Later: work in the feature's own scope too large for the night. It becomes a new backlog row, listed in the morning report.
- Refused: a finding the fixer shows is wrong from the research, with the section cited.

Fixers that share a file never run at once. The composition root (`modes/sidecar-mode.ts`) is fixed last, by one fixer, with the wiring the others asked for.

Why: every finding ends in a fix, an owner or a visible row, and none is lost in a chat log.

## D044. Biome's React rules are switched on by name (2026-11-05)

Context: two features (WS-09, COMP-01) passed their node gate's `pnpm lint` and then failed it on the step branch, both on `useExhaustiveDependencies`. The same commit passed lint inside a worktree under `.git/` (where pleach puts its worktrees) and failed outside it. Biome switches its React rules on only when it detects React, and it does not detect it from inside `.git/`.
Chosen: `biome.json` turns the React domain on by name (`linter.domains.react: "recommended"`). Checked on the known case: with the setting, the same file fails lint inside `.git/` too.
Why: a gate must check the same rules wherever it runs.

## D045. From step 3, audits rank findings and the LATER ones stay in the repo (2026-11-05)

Context: step 2's audits returned about 140 findings, and fixing every one cost a fixer per feature and most of an hour. Many were test gaps and wording that do not change behaviour.
Chosen: each audit marks every finding MUST (a bug, a false header claim, a banned pattern, duplicated logic, an unsafe read or write) or LATER (everything else). Fixers handle every MUST. LATER findings are committed unchanged in `docs/reports/audits/` beside the step's PR, so a later contributor can take them up. A MOVE line from a fixer that names a backlog id becomes a checklist item on that feature, added by script; one without an owner goes to the morning report.
Why: the night's money and time go to behaviour, and nothing an audit found is lost.

## D046. The night stops after step 5 (2026-11-05)

Context: the night had a 15 USD DeepSeek ceiling and a 07:00 stop. After step 4 it had spent 12.3 USD at 04:56. Step 5 (10 features) fit under both: its builds cost about 1 USD and it merged before 06:30. A sixth step would cost about 2 to 3 USD more, past the ceiling, and could not finish its audit and CI rounds before 07:00.
Chosen: step 5 is the night's last. The 10 remaining first-slice features stay open for the next run, which regenerates the batches (`bun scripts/overnight/plan-batches.ts --write`).
Why: the stop rules come before the goal's "done when". A half-built step would leave an unmerged branch and unclosed issues.

## D047. NAV-03 is quarantined from step 5 (2026-11-05)

Context: after step 5's two CI fix rounds, two NAV-01 shell tests still failed. NAV-03 rebuilt the sidebar's workspace list to read the workspace store. The shell test's container has no workspace store, so the list region falls back to "This part failed to load" and the "No projects yet" text the test looks for never shows. The fix is most likely in the test fixture, but the rules allow no third fix round.
Chosen: NAV-03 leaves step 5. Its files go back to their `main` versions with its placeholders, its row goes back to `stub` and its issue stays open. Its built work and its audit fixes are kept on the branch `quarantine/nav.03` (pushed) for the next run. The next run should start from that branch and give the NAV-01 shell test a workspace store.
Why: the rule is two fix rounds, then quarantine. A red test that is probably wrong is still red.

## D048. A second run finishes the first slice (2026-11-05)

Context: the overnight run stopped with 11 first-slice features open (D046, D047). The owner asked in the morning to finish the slice, with about 7 USD left on the DeepSeek account.
Chosen: one more run with the night's process (D039 to D047). It runs in two steps: nine features including NAV-03, then CHAT-18 and NAV-10. It stops if the DeepSeek balance falls below 1 USD. Before step 1, `core/hooks.ts` is split by hook group into `core/hooks/`. `core/hooks.ts` stays the one module screens import, so the layering rule does not change, and each feature edits its own group file instead of one shared file. That shared file caused land conflicts in every step of the night. NAV-03 starts from the code it had before quarantine (commit `7ba45d3`). Its node also gives the NAV-01 shell test the workspace store it lacked.
Why: the owner's request, within the money left. The split removes the cost the night measured.

## D049. What the audits kept finding becomes rules the agents read (2026-11-05)

Context: the first overnight build's audits returned about 280 MUST findings in steps 3 to 6. They fell into a few repeated patterns:

- a file header claiming what the code does not do (about 38%);
- duplicated logic (15%);
- a late async answer overwriting newer state (15%);
- silent failures (13%);
- tests that check nothing or use fakes that repeat ids (11%);
- code nothing calls;
- listeners never removed.

Several of these had no rule in the docs, and agents read only the docs and their issue. Screen tests also kept failing because each hand-built a partial container.
Chosen: `docs/engineering.md` states each pattern as a rule. `docs/architecture.md` lists the shared helpers to use before writing one. A shared `createTestContainer` and `openTestDatabase` replace hand-built test containers and five copies of a SQLite adapter. The builder and fixer prompts in `scripts/overnight/drive.ts` repeat the rules, and the audit prompt checks headers and each rule by name.
Why: the agents start from the docs, so the docs must name what the audits were catching. The prompt carries it too, because a rule in a doc nobody quotes drifts. Nothing checks the header rule by script yet; the audit does.

## D050. The fixed umbel and pleach, checked before slice 2 (2026-11-05)

Context: the overnight build filed issues against umbel (#167 to #170) and pleach (#174 to #179). Both agents reported their fixes on master, and the local tools run from those versions: the global `umbel` is rebuilt, and the global `pleach` links to the checkout that holds the merge. Slice 2 runs about 100 features on them, so a 2-feature trial checked them first (AGENT-05 and AGENT-06, started side by side).
Found:

- pleach #174: node worktrees and the land stack live under `~/.cache/pleach/worktrees/`, outside `.git/`. Both nodes verified and landed. One empty base folder stays behind after the run (reported on #174).
- pleach #175, #177 and #124: not exercised; the trial had no conflict, no failed spawn and no refused land.
- umbel #169: two opencode workers spawned at the same moment without a database lock, so there was no retry to see. #170: `prune --prefix --repo` removed 227 dead sessions of this repository and kept live ones. #168: `logs` prints `<timestamp> <event>`. But `read` fails on a finished pleach worker, because the export runs in the removed worktree (reported on #168).
  Chosen: slice 2 runs on the fixed tools. The night's workarounds stay where a fix is not proven: workers write their final message to a file, and the conductor merges conflicting nodes by hand when a land is refused.
  Why: what the trial proved is used, and what it did not prove keeps its workaround.

## D051. Every slice ends with a hardening pass (2026-11-05)

Context: the first slice's hardening found bugs that would have broken real use: the first message of every chat deadlocked, every installed agent showed as not installed, and no shortcut or menu worked because the dispatcher was never mounted. The batch audits during the build had not caught them, because each audit sees one batch, not how the parts work together. The owner asked to repeat the pass after slice 2.
Chosen: when the last step of a slice merges, five fresh Sonnet workers harden the code by area, as after slice 1: Rust shell, sidecar, desktop core, desktop UI, tests and scripts. Besides the rules in docs/engineering.md, each judges whether the code has the right shape for the whole plan, not only for what calls it today. It reads docs/plans/backlog.md, the item map and the open issues of its area, every priority and the cloud and Remote Control rows included.

- Over-engineered: more shape than the roadmap needs. Examples are a general mechanism where the backlog has one case, configuration nobody will set, and a layer that only passes calls on. A seam later features need is right, for example the runner contract for four agents, the Platform interface or the planned cloud host.
- Under-engineered: less shape than the roadmap needs. Examples are a feature that hard-codes what its own later siblings will need to vary, a one-off where several backlog features will want the same thing, and missing error paths and limits.
- Each finding of either kind names the backlog features it checked. "Over-engineered" holds only when none of them uses the extra shape. Each fixes what it finds in its area, in one PR per area, and lists the rest for its owners. The slice's report follows the hardening.
  Why: the foundation is checked after every slice, while what was just built is still small enough to change.

## D052. Batch audits start before the step's CI (2026-11-05)

Context: slice 2's first step runs nine batches, and the last ones finish long after the first. In slice 1 every audit waited for the whole step to land and for CI to go green. Four of the first five batches also met landing conflicts. In each case two features of one batch wrote the same file: AGENT-11 and AGENT-12 each wrote `acp-runner.ts`, and GIT-05, GIT-06 and GIT-07 all edit `agent-instructions.ts`. pleach pins such nodes for a rebuild on the clean stack of their siblings, kept under `refs/pleach/rebuild/<node>`.
Chosen: a batch's audit starts as soon as its code is merged. It reads the landed branch, or a detached worktree of the batch's clean stack when the land was refused. Pinned nodes are rebuilt by pleach, not merged by hand, and are audited after they land. The audit prompt says that CI has not run, so the auditor leaves types, lint and failing tests to CI. CI still runs once for the whole step, and fixers check each audit finding against the code before acting on it.
Why: audits are read-only, so they can run while other batches build, and that removes the wait. A rebuild is better than a hand merge when both sides wrote the same file from scratch: a hand merge of two separate designs would itself need review.

## D053. A test quality review before slice 2's second step (2026-11-05)

Context: the owner asked for professional tests with no theater. Five Sonnet reviewers read every test file of slice 1 and slice 2's first step (448 files) against the code it tests. Each file got a verdict (REAL, WEAK or THEATER) and each finding names the mutation the tests would miss. A new coverage workflow measured main for the first time: desktop 86.9% lines and 75.2% branches, sidecar 90.6% lines, Rust 69.9% lines.
Found: 224 files REAL, 219 WEAK and 5 THEATER. Pure logic is tested well, and the seams between parts are not. Line coverage hides it: a screen with a theater test shows 100%. Two confirmed bugs mean no chat can run on main: the sidecar exits at start, because a startup step calls a SIDE-13 placeholder that throws, and every send fails, because the container passes no agent launch (SIDE-21).
Chosen: the plan is [docs/plans/test-quality.md](plans/test-quality.md), and the reports are in [docs/reports/test-quality/](reports/test-quality/). Guards, test kit fixes, the UI fix batch and the theater rewrites land between slice 2's first and second steps, so the step-2 builders inherit them. SIDE-21 builds first in step 2, accepted by a real-container test that sends one message. The test work uses Sonnet workers on the subscription. DeepSeek builds only the features that own a fix.
Why: the bugs that hurt most lived where parts meet, and each new step adds more parts. Fixing the test kit before the next build stops every new feature from copying the weak patterns.

## D054. Done means reachable through the real composition root (2026-11-05)

Context: the slice-1 hardening found the dispatcher was never mounted. The test review found the same class again, more widely. The container passes no `launchFor`, `repoConfig` or `defaultConfig`. Nothing calls `GitService.watch` or `GithubService.watch`, and `onMerged` is never wired. Ten UI components are built and tested, but nothing imports them. Each feature's own tests passed, because each test supplied the missing part itself.
Chosen: a feature is done when its code runs from the real composition root (`core/container.ts` or the sidecar's `sidecar-mode.ts`), with one test over `createTestContainer` or the real sidecar host. Two guards hold this (docs/plans/test-quality.md, batch 4a). Guard 5 fails on code whose only importers are tests. Guard 6 compares what each composition root passes with each service's `Deps` type, and an optional dependency left out needs an `// unwired: <ID>` marker naming a stub row. Builder and audit prompts carry the rule.
Why: a part that only tests call is not a feature, and an audit of one batch cannot see what the composition root forgot.

## D055. Guard baselines may only shrink, and there are no known-red marks (2026-11-05)

Context: the new test-quality guards flag hundreds of existing violations, and the plan's first draft also proposed marking real failing tests as expected to fail (`it.fails`, `test.failing`) until their owner builds.
Chosen: each guard reads a committed baseline of today's violations per file. A guard fails when a count rises, and also when the baseline is higher than the real count, so every fix lowers the file. There are no expected-failure marks. A test that fails because the product is broken lands in the same change as its fix, or is the acceptance test of the feature build that owns the fix, written test first in that build.
Why: a baseline that can only fall lets the guards start today without hiding anything new. An expected-failure mark is a skip by another name, which the project's rules and weeder (T3) refuse.

## D056. The DeepSeek budget has no fixed cap (2026-11-05)

Context: the goal for slice 2 stopped DeepSeek spend at 35 USD. After slice 2's first step, the rest of the slice needed about as much as the cap had left, with no margin.
Chosen: the owner raised the budget and set no fixed cap. One floor stays: a step does not start when the balance is under 3 USD, and the owner is asked to top up instead.
Why: the floor keeps a step from running out of credit with workers half done, which would leave work to clean up by hand.

## D057. A red step is fixed at its cause, not quarantined (2026-11-05)

Context: D039 gave each step two CI fix rounds, then quarantine for the features still red. Quarantine kept main green by leaving a feature out. The owner asked for every failure to be understood and fixed instead. So far, every red run had a cause that could be fixed: a real bug, or two merged changes meeting for the first time.
Chosen: CI failures get root-cause fixes, however many rounds that takes. After two rounds, the conductor diagnoses the failure itself, or hands it to an Opus agent with the full logs, before trying again. Quarantine remains only for a feature that cannot be built yet, for example one waiting on a contract change the owner must approve, and that case goes into the report for the owner.
Why: leaving a broken feature out moves the problem into the next step, and main must stay green without features quietly dropped.

## D058. Each batch ends in a joining node, and SIDE-21 builds first in step 2 (2026-11-05)

Context: slice 2's first step planned every batch as independent features with no node that joins them. Four of its nine batches conflicted on landing and needed seven rebuilds and fifteen merges by hand. The test review then found features that nothing in the running app reaches (D054). The pleach-plan skill already asks for one integration node per plan, and the plans did not have one (pleach #181). Separately, SIDE-21, which gives every chat send its agent launch, waited on PLAT-28 (the agent program manager), although only three of its checklist items need that manager.
Chosen: a batch of two or more features in core, UI or sidecar gets a joining node. It needs every feature node, merges them, wires each feature into the composition root, removes duplicated logic and adds one integration test (docs/plans/overnight-build.md). `node-gate.ts` checks several feature ids, so the joining node's gate covers the whole batch. Every builder prompt now carries the D054 rule. SIDE-21's three program-manager items move to PLAT-28, and its dependency on PLAT-28 is dropped. SIDE-21 also owns the desktop composition root's `launchFor`, accepted by a test that sends one message. SET-04 now waits for SIDE-21 and adds its variables to the launch.
Why: the conflicts and the missing wiring both live where parallel features meet, and only a node that sees them merged can fix that inside the plan. Until SIDE-21 lands, no chat can send, so it goes first.

## D059. The app does not edit the user's Codex config (2026-11-05)

Context: SIDE-13 hands Codex the app tools server through Codex's own config. Conductor writes its server entry into the user's or the repository's Codex config file when one is missing, and replaces a clashing entry. A check against codex-cli 0.154.0 showed that when that config already defines a server with the same name, Codex rejects its whole config.
Chosen: Conducted passes its server through the launch arguments and never writes to the user's or the repository's Codex config. When either file already defines a server named `conducted`, the app leaves its own server out for that chat and logs a warning that names the file. This differs from Conductor (D020) on purpose.
Why: a user's config file is theirs, and an app that rewrites it can break their setup outside the app. The cost is that a user who named a server `conducted` gets no app tools in Codex until they rename it; the warning says so.

## D060. How the overnight build runs from slice 2 step 2 on (2026-11-05)

Context: the owner's updated machine rules allow at most three agents at once on the Mac, have Opus write anything that lands in a repo, and want every agent brief written the same way. Step 2 also showed that pleach rebuilds a pinned node on the stack recorded when its land was refused, so batches landed in parallel kept conflicting with each other's rebuilt joining nodes.
Chosen: at most three agents at once: DeepSeek builders, Sonnet auditors (read-only) and Opus fixers together. Each batch audit's MUST findings go to one Opus fixer whose brief comes from `.context/overnight/mkbrief.py`, built on the agent-brief skill and the machine rules. The lead reads each fixer's whole diff before merging. Once batches touch the same files, they land one at a time, and a conflict that only touches a generated baseline or a few headers is merged by hand rather than rebuilt. For tonight the owner chose normal pace for this repo: pushes and PRs go on, because its CI runs on GitHub's machines.
Why: the three-agent limit and the Opus rule come from the owner. Landing one batch at a time ends the rebuild chase, and a hand merge of a baseline costs less than another rebuild.

## D061. The guards run when rows are set to done, and a step runs one batch plan at a time (2026-11-06)

Context: slice 2 step 2's preflight passed, and then its rows were set to done. The test-only-exports guard skips the files of a stub feature, so setting DATA-02, CHAT-15 and COMP-04 to done brought five test-only exports into its scope, and CI went red on a check that preflight had passed. Separately, D060 caps all agents at three, DeepSeek builders included, and step 3 has three batch plans.
Chosen: `drive.ts mark-done` runs the guards on the tree after it writes the rows and fails loudly, through the same `runQuickChecks` helper preflight uses. Each step runs its batch plans one after another, each with up to three workers, and the joining node of a plan runs before the next plan starts. Slice 2's remaining 13 features regenerate into two steps (3 and 4), not the four the night's goal estimated.
Why: a check that can only go red after a status change has to run after that change. One plan at a time keeps the three-agent cap without idle slots, and it lands each batch on a step branch that already holds the batch before it, which D060 asks for once batches touch the same files.

## D062. PLAT-28 is planned until its release feed exists (2026-11-06)

Context: slice 2 step 3 built PLAT-28's program manager: install, re-download, retry, remove, prune, launch preparation and the Advanced page, reached from the composition root. Every install still ends with `program_release_missing`, because nothing produces the pinned release feed. That feed needs the darwin-arm64 download URL, size and SHA-256 of Claude Code 2.1.308 and Codex 0.164.0 from the vendors' official hosts, and it should ship inside the app bundle. None of those values is in the repository, and inventing them is not allowed. `pnpm stubs` requires a `stub` row to have a placeholder, and the feed's absence is a runtime error, not a placeholder.
Chosen: PLAT-28's backlog row is `planned`, not `stub` or `done`. Its issue stays open. The night's batches leave it alone. The feed and its packaging go to the owner as a product and release question. The built code stays on main.
Why: `done` would close the issue over a feature no user can use; a placeholder written only to satisfy the stubs check would be theater. `planned` is the status for work that needs a spike or a decision before it can be built.

## D063. A feature waits for needs that are not done or being built (2026-11-06)

Context: plan-batches read only the stub rows and dropped any need outside them, so a need on a planned row counted as met. After D062 set PLAT-28 to planned, it offered PLAT-35 (gh and watchexec), which needs PLAT-28 and the same missing release feed.
Chosen: `buildableRows` keeps a stub row only when every need is done or is itself buildable, repeated until nothing changes. A need on a planned row, a stub beyond the priority, or a missing row keeps the feature waiting, with everything that needs it. Slice 2 step 4 is REV-10 and SET-10; PLAT-35 waits for PLAT-28's feed.
Why: building a feature whose dependency cannot work yet repeats PLAT-28's blocked state and spends a step on code no user can reach (D054).

## D064. A quit stops the app first, for at most five seconds (2026-11-06)

Context: the core hardening found that `Container.stop()` ran only in tests. A real quit called `app_quit` at once, so a composer draft on its debounce, chat events being stored, terminals and runs got no orderly end. Running the stop first can hang on one step (a stuck disk write, a sidecar that never answers), and then Cmd+Q would do nothing.
Chosen: a quit runs the container's stop and then quits, and quits anyway after `QUIT_STOP_LIMIT_MS` (5 seconds) if the stop has not ended, with a log line. The research gives no limit; 5 seconds is our dial.
Why: an orderly stop keeps the user's last edit and every stored event; a quit that never happens is worse than one that skips the last step.

## D065. Slice 3's large first step lands in parts of a few batches (2026-11-06)

Context: slice 3 is 65 features. plan-batches puts 54 of them in its first step, in 8 batches. Under the three-agent cap (D060), with one plan building at a time (D061), that step cannot be built, audited, fixed and through CI as one PR before the morning. The night's goal asks that a step that starts either merges or stops cleanly.
Chosen: the first step lands in parts, each its own branch and PR (`slice3/step-1a`, `-1b`, ...), with one to three batches each and one CI run per part. A part starts only when the balance is above 3 USD and the part before it has merged or stopped cleanly. The rust batch starts while the last slice-2 hardening runs, because its files do not overlap.
Why: a part that merges is finished work in the morning; a 54-feature PR left half built is not.

## D066. AGENT-09 is planned until Cursor's SDK can ship (2026-11-06)

Context: slice 3 built AGENT-09, the Cursor runner that runs Cursor's SDK inside the sidecar: the loader, the run, the translation (AGENT-10), the store folder and the app tools, reached from the composition root. It cannot run in the app, because the SDK is not bundled, and D010 forbids bundling it. The loader now reports "Cursor's SDK is not installed" instead of a false "not installed" for a broken package. Its sign-in check also cannot read the key the app keeps in the Keychain.
Chosen: AGENT-09's backlog row is `planned` and its issue stays open, as with PLAT-28 (D062). AGENT-10, the translation, is done: it is complete and tested on its own. Whether and how the SDK ships, and how the sidecar learns that Cursor is signed in, go to the owner. For the second, the fixer's proposal is that the app sets Cursor's signed-in state from its own provider keys, a desktop-only change.
Why: `done` would close the issue over a runner no user can start.

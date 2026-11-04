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

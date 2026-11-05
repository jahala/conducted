# Item map

Every behaviour of Conductor 0.92.1 that the coverage check in `docs/coverage/` found, one row each, with the backlog id that owns it. `ui.tsv` holds what the user sees and does (screens, controls, shortcuts, messages). `system.tsv` holds what runs underneath (Rust shell, sidecar, agents, data, git, cloud).

Columns: `id` (a backlog id in `docs/plans/backlog.md`), `kind`, `item` (our own words, D002), `research` (relative to `docs/research/conductor/`, or an `inventory:` source), `status` (`covered`, `partly` or `missing` in the scaffold). The issue sync (`scripts/issues/sync.ts`) turns each feature's rows into the checklist of its GitHub issue, and fails when a row names an id the backlog lacks.

## How the ids were assigned

The coverage reports proposed new ids independently, so the same number often meant different things. The merge on 2026-11-04 gave each feature one final id, numbered on from the highest id in the backlog, and wrote `NEW-<prefix>` placeholders to final ids. Two features never share an id. Placeholders that turned out to be part of an existing feature took that feature's id.

| Placeholder or report proposal                                                                            | Final id                                                            |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| NEW-AGENT agent program download manager                                                                  | PLAT-28                                                             |
| NEW-AGENT decide on a bundled gh                                                                          | PLAT-35 (D024)                                                      |
| NEW-AGENT Codex goal calls                                                                                | AGENT-13                                                            |
| NEW-AGENT Muse Code agent, AGENT-19                                                                       | left out (D025)                                                     |
| NEW-APP async helpers / start-up screens / send feedback / callouts                                       | APP-11 / APP-08 / APP-09 / APP-10                                   |
| NEW-CHAT more tool cards / start chat with context / image menu / fork to workspace                       | CHAT-20 / CHAT-26 / CHAT-29 / CHAT-21                               |
| NEW-CLOUD cloud terminals, run scripts and previews                                                       | CLOUD-09                                                            |
| NEW-CLOUD port forwarding (and the port 22 notice)                                                        | CLOUD-10                                                            |
| NEW-CLOUD mirror a cloud workspace, download a file                                                       | CLOUD-11                                                            |
| NEW-CLOUD open a cloud workspace in a local editor                                                        | CLOUD-12                                                            |
| NEW-CLOUD host-scoped local data                                                                          | CLOUD-13                                                            |
| NEW-CLOUD cloud agents run commands on the Mac                                                            | CLOUD-14                                                            |
| NEW-CLOUD cloud workspace header / desktop tab / settings page                                            | CLOUD-15 / CLOUD-16 / CLOUD-17                                      |
| NEW-COMP snippets / Codex goal bar                                                                        | COMP-09 / COMP-10                                                   |
| NEW-DATA env var unset marker                                                                             | SET-04                                                              |
| NEW-DATA one home for the repo's remote name                                                              | DATA-09                                                             |
| NEW-DATA remember the active chat per workspace                                                           | NAV-02 (column in DATA-08)                                          |
| NEW-GIT branch lists and switch branch                                                                    | GIT-12                                                              |
| NEW-GIT continue after merge and detached HEAD (was part of GIT-12)                                       | GIT-17                                                              |
| NEW-GIT local-git forge / optional git extras                                                             | GIT-14 / GIT-15                                                     |
| NEW-NAV shortcut dispatcher / surface layer                                                               | NAV-14 / NAV-15                                                     |
| NEW-PLAT keep the Mac awake                                                                               | PLAT-21 (no Rust module needed: `caffeinate` through `shell_start`) |
| NEW-PLAT system facts and window controls                                                                 | PLAT-23 (window look) and PLAT-32 (system facts)                    |
| NEW-PLAT full disk access / navigation guard / startup hardening / webview limits                         | PLAT-24 / PLAT-22 / PLAT-27 / PLAT-29                               |
| NEW-PLAT bundle metadata, entitlements and signing                                                        | PLAT-25                                                             |
| NEW-PLAT focus and network events                                                                         | PLAT-31 and PLAT-26                                                 |
| NEW-PLAT native HTTP download                                                                             | PLAT-30 (was "decide Platform.http")                                |
| NEW-PLAT Platform doors for dropped files, attachments, menu shortcuts                                    | PLAT-33                                                             |
| NEW-PLAT verify bundled helper programs at launch                                                         | PLAT-34                                                             |
| NEW-PLAT terminal screen snapshot                                                                         | PLAT-08                                                             |
| NEW-PLAT quit hand-shake, devtools feature                                                                | PLAT-15                                                             |
| NEW-PR link by URL / issues and PRs list / stack catch-up                                                 | PR-10 / PR-11 / PR-12                                               |
| NEW-PRJ repo icon                                                                                         | PRJ-05                                                              |
| NEW-RC Remote Control settings                                                                            | RC-04                                                               |
| NEW-REV artifacts tab                                                                                     | REV-10                                                              |
| NEW-REV resolve conflicts in the editor                                                                   | REV-11                                                              |
| NEW-REV comment states and the message link                                                               | REV-12                                                              |
| NEW-REV PR comments with no file, author avatar                                                           | REV-13                                                              |
| NEW-RUN zsh shell integration                                                                             | RUN-09                                                              |
| NEW-SET app data folder                                                                                   | SET-02 (Advanced page)                                              |
| NEW-SET sync agent configs / executable path prefix                                                       | SET-08 / SET-13                                                     |
| NEW-SIDE program paths, per-agent environment and provider settings; apply changed settings to idle chats | SIDE-21                                                             |
| NEW-SIDE one-shot utility prompts                                                                         | SIDE-24 (design in D030)                                            |
| NEW-SIDE slash command cache                                                                              | SIDE-22                                                             |
| NEW-SIDE sidecar log hygiene                                                                              | SIDE-18 (folded repeats) and PLAT-18 (file cap)                     |
| NEW-AGENT ACP per-chat config options                                                                     | AGENT-17                                                            |
| NEW-WS backlog workspaces / copy ignored files                                                            | WS-11 / WS-03                                                       |
| Report SET-08 "change root path"                                                                          | SET-02                                                              |
| Report PLAT-23 "Xcode licence"                                                                            | GIT-16                                                              |
| Report WS-11 "copy ignored files"                                                                         | WS-03                                                               |

Report numbers that differed from the final ones (for example the inventory reports' CHAT-20 to CHAT-28, SIDE-20, SIDE-21 and AGENT-13 to AGENT-16) were matched by title to the rows above.

## Rows that left the map

Service-only behaviours, not built (D025): the Codex organisation-policy clamp; Help menu Best Practices and Submit a Prompt; Conductor's cloud backend (multiplexed websocket, session feed sync, standby sandboxes); the phone relay (pairing offers, paired devices and their change notice, relayed requests, the pairing-code error, the iPhone control route); staff and analytics calls to the sidecar (staff flag, logger address, crash test, PostHog id, external logging switch, the Sentry `Global` tag); the five hosted-computer tools; snippet sharing ("Visible to"); and the Muse Code agent (5 rows).

Replaced by D026: 21 rows that described Conductor's logger server (its HTTP routes, ring buffer, size caps, secure paths, discovery file and the logger variables).

Judged internal or replaced when the UI map was made, and never added: the Internal settings page and its switches, PostHog feature flags and holdouts, the `conductor.json` migration banners, the legacy file preview setting, `local_git_forge_enabled` (GIT-14 owns the behaviour), the branded sprite loader, Kanban status colour tokens, the SSH key path, KaTeX, and tooltip and decorative tokens. Add a row and an id if one is wanted.

# Overnight report, 6 to 7 November 2026

The night ran from 22:00 to 08:00. 20 pull requests merged (#345 to #372), and 23 issues closed. The backlog is at 247 of 264 features done, and the only two placeholders in the code are CLOUD-01's named stops for the next cloud rows. Every step ran as far as the goal's rules allowed. What waits for the morning is the first run of Conductor's own frontend on our data, which is a browser run.

## What needs Jan

1. **Install v0.2.2.** The night found that the built app could not talk to its sidecar: every message was refused for a trailing newline (fixed in #361). The installed v0.2.1 starts but cannot chat. v0.2.2 is a build, and builds on this Mac wait for 08:00. Then the walk-through: add a project, create a workspace, chat, see the diff.
2. **Controls Conductor lacks, kept for your yes.** Nothing you see was removed. The lists are in `docs/reports/parity-gaps-2026-11-07.md` under "For the owner". The main ones:
   - **Agents page:** the subtitle and the "Recommended" badge.
   - **Appearance:** its four section headings, where Conductor shows one list.
   - **Empty sidebar:** the "Add a project" button.
   - **Settings rows:** our descriptions where Conductor shows none.
   - **Approval card:** "Yes always", the suggested rules, the No message box, and the card sitting above the composer, where Conductor replaces the text box.
   - **Plan bar:** the feedback box and "Reject plan".
   - **Checks tab:** the PR summary header, reviewers and counts.
   - **Home:** its hint lines.
   - **Advanced page:** the "Helper programs" section for gh and watchexec.
3. **A look to judge.** In Conductor, the workspace header's folder chip is the "Open in" button. Ours draws a separate "Copy folder path" chip.
4. **Two open questions:**
   - Moving users from Conductor safely (#353), including the `CONDUCTOR_*` script variables (D027).
   - The product page and README (#356).

## Steps

| Step                             | PRs                                      | Result                                                                          |
| -------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| 1. ui/parity merged              | #345                                     | Three rounds of screen parity, CI green, shots read beside the captures         |
| 2. Step 2 rows                   | #354                                     | REV-13, APP-06, PR-10, RUN-05 done; issues closed                               |
| 3a. Stage 1                      | #346                                     | Stand-in, server, guard and run script built; first run at 08:00 (browser)      |
| 3b, 3c. Stage 2 and paired shots |                                          | Wait for browser runs (D095)                                                    |
| 3d. Sidecar against Conductor's  | #359, #361                               | Ran sealed; five bugs found and fixed, plus the line-framing bug                |
| 4. Parity harness                | #347                                     | Built; finds all three known misses on the old commit                           |
| 5. Gaps worked down              | #363, #366                               | See the counts below                                                            |
| 6. Hardening                     | #357, #358, #360, #362, #364, #367, #369 | Issues #348 to #352 done; APP-16's follow-ups mostly done                       |
| 7. PLAT-36, SIDE-25, CLOUD-01    | #365, #368, #370                         | All three done; CLOUD-01's host seam stops cloud calls at CLOUD-03 and CLOUD-09 |
| 8. Stubs and this report         | this PR                                  | `pnpm stubs` passes; open rows have D085 and D097                               |

## The parity harness's counts

After round 3 (#372, merged 06:59):

|                                                     |         First run |   Now |
| --------------------------------------------------- | ----------------: | ----: |
| Matched                                             |               703 | 1,073 |
| Decided                                             |                57 |   865 |
| Shown nowhere yet (in our code, no screen draws it) |               891 |   718 |
| Wording that differs                                |        not sorted |     0 |
| A feature or behaviour we lack                      | 2,163, not sorted | 1,165 |

Of the 1,883 remaining gaps, 709 name their backlog row and checklist item, 298 name a row only, and 876 have no owner yet. Each of those 876 needs someone to read its region of Conductor's code. The 298 row-only gaps can get generated checklist items; that is the next run's first bookkeeping task. All seven flows the catalogue can drive pass. Our strings with no Conductor counterpart fell from 1,209 to 507 (264 of them are the shortcut page's accessible names).

## Bugs the night found, each fixed with a failing test first

- The built app sent nothing to its sidecar: the tunnel ended lines with a newline that the Rust shell refuses (#361).
- A Claude reply without a message id left the chat working until a 120-second watchdog (#361).
- An API error showed twice and ended its turn as a success (#361).
- Every Claude model was asked for adaptive thinking; models without it now get a token budget (#361).
- A new workspace dropped the agent, effort and fast mode chosen on the create page, so picking Codex started a Claude chat (#367).
- An archived workspace sent you to Home; it now opens read-only with an archived notice (#367).
- A new workspace opened on "No tab is open" (#363).
- A saved PR description briefly showed the old text again (#347).
- Terminals replayed no history, and the 14-day scrollback cleanup could not find its files (#360).
- The question card's hidden answer field took focus back on every redraw (#366).

## Findings by area

- **Rust:**
  - Terminal scrollback is now encrypted with a Keychain key (D087).
  - Command tests run through a mock Tauri app (PLAT-36).
- **Sidecar:**
  - Adapters live in their own modules (SIDE-25).
  - Codex's managed requirements narrow the approval policy and sandbox, as Conductor does.
  - Research to do: Codex start-up parameters Conductor sends and we don't (other-runners.md 8).
- **Desktop:**
  - No silent PATH fallback for agents, gh or watchexec (D088).
  - The Codex visualization frames are still blocked by the content security policy, which needs a browser check.
- **Tests and scripts:**
  - A guard for header claims (194 findings in a baseline that may only shrink).
  - Test containers are now real.
  - Two toast-timer leaks fixed; a general guard for toasts is still to do.
  - Every LATER audit finding has an outcome, and 394 became checklist items.

## Decisions

Product log:

- D086: non-wording strings are out of the parity spec.
- D087: encrypted scrollback.
- D088: the app's own program copies only.
- D089: Claude's model list.
- D090: the agent session id notification.
- D091: events before approvals.
- D092: the host seam.
- D093: the harness spec.

Process log:

- D094: DeepSeek audits and fixers under the one-Claude rule.
- D095: the harness before stage 2.
- D096: Conductor's code runs only sealed.
- D097: why each open row is open.

## Spend

DeepSeek went from 16.36 to 13.49 US dollars (2.87 spent). Claude agents ran on the subscription, one at a time after 22:00.

## Stale branches

The local `node/*` and `quarantine/*` pleach branches, and `harden/h351-0` to `-3` (cherry-picked into #369), hold merged work. `spike/cloud` is pushed, and its write-up is on main.

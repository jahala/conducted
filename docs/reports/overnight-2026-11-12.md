# Overnight report, 11 to 12 November 2026

From noon on the 11th to 08:00 on the 12th, 47 pull requests merged and 37 issues closed. The headline is chat history. Conducted now imports each Claude chat's whole history from Conductor (#557), and on a copy of the owner's database all 288 Claude chats read the same as in Conductor (#555, counts only). The backlog is at 271 of 273 features done; the two left (CLOUD-17, PLAT-42) wait for the owner. Seven issues are open.

## What needs Jan

1. **Claude Code following its newest compatible release (#541).** Conductor pins Claude Code, as we do. Following new releases on its own would change what the app does and depart from Conductor, so it waits for your yes.
2. **The Cloud settings page's live run (#259, draft #511).** It needs one run on your Cloudflare account, which costs a few cents.
3. **A Homebrew install that follows each release (PLAT-42).** This publishes a tap repository under your GitHub account, so it waits for your go.
4. **One removal, for the record.** #563 added a "Variables" heading above the environment variables table. Conductor draws that heading only when given a title (renderApp `Cnr` @10702552, @10704425), so #560 removed it a few hours later. Nothing that was there before last night was removed.
5. **Credits for the icon sets (#577).** Font Awesome and VS Code's codicons (CC BY 4.0) ask for credit, and the app has no third-party notices yet. Where the credits show is your call.
6. **Pictures to look at.** Quiet mode kept browser runs off your Mac, so CI drew every new catalogue state, without a failure. Worth a look side by side with Conductor: the file icons (`git-files-glyphs-1` to `-8`, #578), the terminal drag (`workspace-terminal-drag`, #565), and the background helper's card (`chat-subagent-late-work`, #552).

## Steps

| Step                                       | PRs                                      | Result                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI that does not depend on Ubuntu's mirror | #543, #544, #553, #558, #559, #575       | Browser jobs run in Microsoft's Playwright image. A PR runs only the tests its change can reach, and main runs every test. Time limits are hang-sized, not slowness-sized. A hung upload fails in 5 minutes. The screenshots run in three parts. A flaky deploy test was fixed at its cause: temp names that repeated within one clock tick. |
| Bugs from the owner's list                 | #516 to #537, #539                       | 27 of the 33 issues filed on the 11th were fixed and closed.                                                                                                                                                                                                                                                                                 |
| Chat history (APP-18)                      | #545, #546, #547, #552, #554, #555, #557 | From 2 of 24 sampled chats matching to 288 of 288, then the import itself. D129 and D130 record the two departures and the rule behind them.                                                                                                                                                                                                 |
| Parity work                                | #548, #550, #551, #560, #562, #563, #576 | See the counts below.                                                                                                                                                                                                                                                                                                                        |
| Owner's issues                             | #561 (#549), #565 (#527), #578 (#534)    | The Sync files switch survives a restart. Terminals drag between the panel and the centre. File icons draw Conductor's tinted glyphs for its 107 kinds (D131).                                                                                                                                                                               |
| Drawing what we had                        | #579                                     | 72 catalogue states, menus that stay open for the picture, and a fix to "checked by hand" marks that had frozen 201 map gaps: undrawn entries 423 -> 263.                                                                                                                                                                                    |
| Data safety                                | #582                                     | The data lifetime job's two JSON writes survive SQLite 3.54.1 (#581, above).                                                                                                                                                                                                                                                                 |
| Dependencies                               | #566, #567, #574                         | Three green Dependabot PRs merged. Six wait: #568 adds a second copy of the `muda` menu crate beside Tauri's own; #569, #570 and #571 (Rust crates with new APIs), #572 (an npm group) and #573 (jsdom 31) fail CI and need code changes.                                                                                                    |
| Agent programs                             | #542                                     | Claude Code 2.1.322, Codex 0.167.1, and a daily PR that keeps them current.                                                                                                                                                                                                                                                                  |

Spend: the DeepSeek balance went from 3.20 to 1.44 USD over the day (six parity builders). New DeepSeek work stopped at the 2 USD floor. Claude work ran on the subscription, one agent at a time.

## The parity harness's counts

From CI's harness run on #579, merged at 07:38 (main with every PR of the night):

| Inventory            |   Entries |   Matched |   Decided |    Gaps |
| -------------------- | --------: | --------: | --------: | ------: |
| text                 |       853 |       445 |       255 |     153 |
| label                |       498 |       196 |       250 |      52 |
| aria_label           |       189 |       107 |        47 |      35 |
| placeholder          |        70 |        44 |        19 |       7 |
| title                |       462 |       305 |       107 |      50 |
| tooltip              |        25 |        15 |         7 |       3 |
| description          |       281 |       133 |       113 |      35 |
| toast                |       253 |        30 |        83 |     140 |
| literal              |       381 |       212 |        99 |      70 |
| route                |        95 |        12 |        72 |      11 |
| test_id              |        18 |         9 |         2 |       7 |
| sidecar_rpc_method   |        87 |         7 |        23 |      57 |
| sidecar_tool_name    |        13 |         7 |         6 |       0 |
| sidecar_call         |        78 |         7 |        16 |      55 |
| tauri_command        |       105 |        12 |        26 |      67 |
| tauri_plugin_command |       151 |       144 |         0 |       7 |
| tauri_event          |        40 |         0 |         2 |      38 |
| settings_key         |       193 |       114 |        65 |      14 |
| table                |        29 |        11 |         0 |      18 |
| **Total**            | **3,821** | **1,810** | **1,192** | **819** |

At noon on the 11th: 1,475 matched, 1,166 decided, 1,180 gaps.

What's left, by kind:

- 529 behaviours we lack (447 already owned by a backlog item);
- 263 we have but no catalogue state draws (87 of them failure toasts, which need a write that fails on demand);
- 27 wording or placement differences.

Most of the backend lists (sidecar calls, Tauri commands and events) differ by design, because our sidecar and shell are our own. They wait for decisions in bulk.

## Findings

- **What the tests missed, and why.** Most bugs this week came from the gap between our tests and the real app: dead drags, a setting lost on restart, a wrong link destination, and layout faults. None of our tests runs the Tauri window. #564 proposes end-to-end tests in the real app (journeys, a crawler that clicks every control, and a restart check), with four known bugs it must catch first.
- **Changed-only CI pays for itself, and catches what builders miss.** It caught broken tests the builders never ran (the sidebar's 16 tests on #562, five workspace tests on #561), because it selects by what a change reaches, not by what files it touches.
- **A newer SQLite found a data bug.** At 06:02, CI's Node moved from 26.13.0 to 26.13.1, which bundles SQLite 3.54.1. There, a JSON array built in a subquery loses its JSON type, and the data lifetime job stored a chat's items as a string. The app runs the same statements, so cutting old tool outputs or compacting archived chats would have corrupted chats on any SQLite with this behaviour. #582 wraps both subqueries in `json(...)`; proven on 26.13.1 (#581). CI follows the newest Node 26 release and this Mac runs 26.8.1, which is how this showed up first on CI.
- **Builders must not add words.** The parity builders mostly copied Conductor's wording, and each PR was checked against the bundle. Three made-up items still slipped through and were removed: a "Custom command" label, two toast titles, and the Variables heading.

## Decisions recorded

- **D129.** A background helper's late work shows inside the card that started it; work whose parent is stored nowhere stays visible. The history check leaves both out of its comparison. (Ruled by the owner.)
- **D130.** How chat history comes over: one chat at a time, after the rows commit. A turn with no recorded end ends `unrecorded`, and shows nothing, as in Conductor. Decided under the owner's rule "Match Conductor. Nothing made up".
- **D131.** File icons draw Conductor's tinted glyphs from Simple Icons and react-icons, never from Conductor's bundle.

## Open issues

- **#541** Claude Code follows new releases (needs Jan).
- **#259** the Cloud settings page (needs Jan's OK for a live run).
- **#577** credits for the icon sets (needs Jan).
- **#556** time the history import at full size in the real app.
- **#564** end-to-end tests in the real app.
- **#276, #277** epics; they close when the issues under them do.

## Stale branches

- **161** remote branches belong to squash-merged pull requests and can be deleted. GitHub's "Automatically delete head branches" setting would do this for every future merge.
- **1** belongs to a pull request closed without merging: `ci/typescript-timeout` (#538, folded into #544).
- **1** never had a pull request: `spike/cloud`.
- **11** belong to open pull requests: Dependabot's nine and draft #511.

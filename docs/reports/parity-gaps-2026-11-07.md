# Parity gaps, 7 November 2026

The gap report of the parity harness (`docs/plans/parity-harness.md`) after step 5's third pass (#372). The counts below come from the Parity workflow's dump of commit 6816ddba (run 42347440362), seeded and checked with this branch's harness and map; the spec did not change in round 3. Mode `report`: the gaps do not fail a pull request yet. The reports of c8860c66, e996940e and 3871650d are in this file's history.

## Before and after

|                                                          |               At c8860c66 | After round 1 (e996940e) | After round 2 (3871650d) | Now (6816ddba) |
| -------------------------------------------------------- | ------------------------: | -----------------------: | -----------------------: | -------------: |
| Conductor entries                                        |                     3,814 |                    3,814 |                    3,821 |          3,821 |
| Matched to a catalogue state or a name of ours           |                       703 |                    1,007 |                    1,018 |          1,073 |
| a. Decided                                               |                        57 |                      847 |                      847 |            865 |
| b. Unshown: our source has it, no state draws it         |                       891 |                      771 |                      770 |            718 |
| c. Wording or placement differs on a screen we draw      |                not sorted |                        6 |                        6 |              0 |
| d. A feature or behaviour we lack                        | 2,163 missing, not sorted |                    1,183 |                    1,180 |          1,165 |
| Gaps owned by a backlog row and its item                 |                         - |                        - |                        - |            709 |
| Gaps owned by a backlog row only                         |                         - |                        - |                        - |            298 |
| Gaps with no owner                                       |                         - |                        - |                        - |            876 |
| Catalogue states                                         |                        50 |                       64 |                       68 |             81 |
| Strings of ours with no Conductor counterpart (distinct) |          256 in 50 states |         514 in 64 states |         507 in 68 states | 536 in 81 states |
| Flows that pass, of 7 drivable                           |                         5 |                        7 |                        7 |              7 |

Decided now: D002 31, D004 233, D025 310, D029 21, D086 270. Owned is still a gap: the owner is the backlog row and the checklist item in `docs/plans/items/` that build or draw the entry, so the plan holds the work and nothing pretends to be built. The 29 new strings of ours come from the 13 new states (the providers dialog's "Credentials", the slash menu's commands, the sound menu's "Default chime" and others), listed by state below.

## Round 3 (#372)

### Every gap names its owner, or is listed without one

`scripts/parity/owners.ts` writes each gap's owner; the plan's section 2, "Owning a gap", gives the rules and the measurement behind the neighbour rule. Check a now fails as broken when an owner names a row the backlog lacks or an item the row does not hold.

| Class | Entries | Cited by an item | Quoted by an item | Named by an item | Neighbour (row only) | By hand (row only) | No owner |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| b. Unshown | 718 | 94 | 291 | 0 | 68 | 0 | 265 |
| d. Feature, UI | 862 | 60 | 73 | 0 | 139 | 0 | 590 |
| d. Feature, backend names | 303 | 111 | 0 | 80 | 0 | 91 | 21 |

Backend names the items do not name were read one by one: 91 have the row that runs them (window events to PLAT-23, file drops to PLAT-33, menu events to PLAT-15, keychain to PLAT-10, file sync to CLOUD-11, agent programs to PLAT-28), and 10 are decided: pokes and routine webhooks (D004), Conductor's API token (D025), its GitHub App client id (D029), and six sidecar "methods" that are values its code holds (PAGER `cat`, TERM `dumb`, a library's attribute), read in the bundle (D086). The 21 left are Conductor's own config migrations and its migrations table, its identity and tombstone tables, `frontendRelay`, `get_db_uri`, `is_cef_runtime`, and settings whose job the bundle does not say (`garry_mode`, `read_aloud_enabled`, `user_message_footer_enabled`, `mention_notifications_enabled`, `experimental_agent_progress`).

### Catalogue states added (class b)

Thirteen states, each verified by the dump: the completion sound, code theme, accessible colours and Markdown style selects open; the Claude output style, Claude effort level, Codex thinking level and Codex personality selects open; Claude Code's providers dialog on Amazon Bedrock with AWS access keys; the Feedback dialog; the composer's slash command menu; and the pull request header for a draft and for a failed check. They match 52 entries that were unshown. One more entry, "Warning: appears to sometimes cause performance issues", matched on the Experimental page from a change already on main.

### The six settings-search copies (class c)

Reading each in the bundle showed two kinds. Conductor's repository Scripts and Actions pages read "Runs when a new workspace is created", "Runs before a workspace is archived" and "Shortcuts for quick actions, like running your dev server or test suite" with no full stop (renderApp @11026712, @11027050, @11264887); ours added one, which is dropped, and the three are matched. The other three are copies in Conductor's settings search registry ("Font used for code and diffs.", "Rendering style for markdown files.", "Terminal font", @11300535 to @11300934), whose page copies ours matches. A person reads them in search results, so they are feature gaps owned by a new SET-02 item, not decisions.

The stopped "Runs when a new workspace is created." that round 2 matched to our Scripts page is in Conductor's organisation repository settings (@11719492 to @11729114: its components take the organisation's id and keep the setup script under org/<repo>/setup.sh). It and the region's seven missing entries are decided under D004.

### Left for a later round

- 590 UI feature gaps and 265 unshown gaps have no owner. Most sit where no research cites an offset within 20,000 characters ("Unplaced"), or in a coverage audit section whose table predates the final backlog ids. Owning them needs a person to read each bundle region, as rounds 1 and 2 did for the decided regions.
- 298 gaps have a row but no item. A new checklist item per row would make them owned; that adds items to the plan the issue sync turns into checklists, so it waits for a ruling on whether machine-written items belong there.
- Unshown entries whose state the catalogue cannot draw yet: the queue box and its failures, the chat banners (session limit, compacted history), the Open in menu's app list, the Git header's PR states (draft, conflicts, changes requested, no internet), the Linear and GitHub issue dialogs. Each needs a seed the catalogue lacks (a queued message, a failed turn, detected apps, PR states).


The spec grew by seven entries: rebuilding it finds the strings our UI source now shares with the bundle ("PR is in draft", "Re-run", "Copy plan to clipboard", "Enter your plan adjustments here...", and three from other changes on main). Of those, "Enter your plan adjustments here..." is matched; the rest are unshown because no catalogue state draws a draft pull request, a failing check or an open tooltip.

How each class is sorted is in the plan, section 2, "Sorting the gaps". Most of round 2's work does not move the counts: a screen that takes Conductor's structure and wording for strings the inventories never caught (the approval card's button stack, the question card's dots, the Git status rows) shows up only in the ours-only list, and some of Conductor's own words are still reported as ours because no inventory holds them ("Hand off", "No PR open", "Waiting for PR review").

## Screens fixed (class c)

### Round 2 (#366)

Each is its own commit on #366, with Conductor's bundle offsets in the message.

- Approval card (renderApp @8830523, @104412): one column of full-width buttons, each with its live key: "Yes", the second choice, "No". The second choice is Conductor's per request: "Allow all edits during this session" for an edit, "Yes, and don't ask again for: <rule>" (cut at 40 characters) for a suggested rule, "Always allow <tool name>" for an MCP tool, WebSearch or WebFetch. The line listing the keys is replaced by the keycaps.
- Question card (@8144303): header and question beside a close button "Cancel agent"; option rows with their number (role radio, or checkbox on a multi-select question); the "Other…" row numbered 0, named "Other response", with the tick "Select other response"; dots "Question N" between "Previous question" and "Next question"; an icon Submit with its key in the tooltip. A secret answer is typed in the Other row, masked.
- Plan review bar (@9259644): Conductor's row of small buttons, Copy (tooltip "Copy plan to clipboard"), Hand off, Approve with its live key; the feedback box takes "Enter your plan adjustments here..." in place of its label and placeholder; the line explaining Approve and Hand off is dropped because the tooltips carry it.
- Checks tab (@2254553-2276000): Git status in both views, with Conductor's rows and wording in its order (`git-status-rows.ts`): Ready to merge, No PR open, PR is in draft, N uncommitted changes, N commits behind remote, N commits ahead of remote, Merge conflicts detected, Incompatible with remote, Waiting for PR review, PR changes requested. Sections in Conductor's order: Git status, Deployments, Checks, Comments. "Re-run" (tooltip "Re-run failed checks") and "Fix errors" sit quietly beside "Checks"; check and deployment rows end with "Open externally".
- Home (@10274108-10277200): the search is named "Search", the project filter "In all projects"; the empty grid is Conductor's one block, "No matching workspaces" with "Create a workspace" or "Clear filters". Four catalogue states open the project, archive, sort and Display menus.

### Round 1 (#363)

Each is its own commit on #363, with Conductor's bundle offsets in the message.

- Settings: General, Appearance, Default models, Git, Experimental, Advanced, Environment, Account (Linear line), the repository Misc, Scripts, Actions and Prompts pages: Conductor's titles, descriptions, placeholders and option labels.
- Keyboard shortcuts and the command registry: 104 command titles take Conductor's ("Command palette", "Toggle left sidebar", "Create PR").
- Agents: "Run claude /login" and "Run codex login" while the CLI is the sign-in, connected or not; every agent's tab (Cursor, OpenCode, Pi); Conductor's warning under a custom program path.
- App shell: the sidebar button is "Toggle left sidebar".
- New workspace: it opens on its first chat; it opened on "No tab is open".
- Catalogue states added for every settings page, the diff's View options, the workspace actions menu and a chat tab's menu (class b).
- The harness reads "Conductor" as "Conducted" (D012), so wording that names the product matches.

## The two flows

- Open settings from the palette: the flow was wrong. It typed "Open settings", which matches no item; the item is "Settings", as Conductor's is. Typing "Settings" also finds canyon (branch `sam/dark-mode-settings`), and the Workspaces group comes first, so Enter opened canyon. The flow now picks the Settings item and passes. Whether Conductor ranks the action above a workspace for that query is not known.
- Create a workspace: both were wrong, and it passes now. The catalogue did not answer the target branch's fetch, `worktree add`, the first message (`sendMessage`), the naming run (`runUtilityPrompt`), `gh pr list --head` or `git branch -m`, and its `for-each-ref` made the checkpoint prune try to delete `origin/main`; each is scripted now. Then the flow's screenshot showed the app's own fault: the new workspace opened on "No tab is open", because creating the first chat never made it the workspace's remembered tab. It does now (test in `workspace.test.ts`), so the workspace opens on its chat, as Conductor's does.
- Create a pull request had started failing when the catalogue began answering `sendMessage`; the catalogue now logs the messages it answers, and it passes.

## Sidecar event order

Measured again in four runs (details in `docs/reports/sidecar-diff-2026-11-07.md`, "Event order, measured again"). Claude tool approvals: Conductor and ours send the `tool_use` first, every run. Codex approvals: Conductor's order changed from run to run (before `item.started` twice, after it once, before `turn.started` once), so it is timing; ours keeps events first. Plan mode: Conductor sends the plan approval one event ahead of ExitPlanMode's own `tool_use`, every run. Sending ours without waiting put it ahead of `system/init` too and raised the differences from 9 to 11, so ours keeps events first. No change to the sidecar.

## For the owner

From round 3:

- To rule on: may a machine-written checklist item own a gap? 298 gaps have a backlog row but no item, and one item per row and bundle region would make them owned. The issue sync turns items into the checklists of GitHub issues, so this adds rows there.
- Nothing was removed or hidden. The full stops dropped from the Scripts and Actions pages follow Conductor's own copy.

Kept from round 2, each needs your yes before it goes (Conductor shows none of them):

- Approval card: "Yes always" on a command with no suggested rule (Conductor offers no second choice there), and a choice the second one displaced kept as an extra button; the suggested rules list ("The agent suggests these rules:"); the optional message on No ("Message to the agent (optional)", "Why are you denying this?"); the wrench icon; the reason shown above the tool card. Conductor also draws the card in place of the composer's text box; ours stays in the dock above the composer.
- Question card: the group name "Agent question" and the option preview.
- Plan review bar: the feedback box and "Reject plan" in the bar (Conductor takes feedback in the composer), the accessible name "Plan feedback", the title "Review plan" over the plan, the plan text with "Show all" and the plan file link (Conductor shows the plan in the chat's tool card).
- Checks tab: the PR summary header ("Base: main", "Pull request menu"), the reviewers list ("Reviewers", "No reviewers requested."), "No review comments from GitHub.", and the failed, pending and total counts beside "Checks". The git header's "Waiting for a reviewer" note, where Conductor shows nothing.
- Home: the hint lines under the empty block ("Try a different search, or clear the filters to see everything.", "Create one to give a task its own copy of the code and its own chats."), and "No PR open" shown even when the branch has no changes.

Not built (no data for it yet): the Checks tab's merge queue row and "N commits behind <target branch>", which need fields GitState does not carry.

To rule on: the sidecar event order for plan mode (above).

Shared contract changes: none needed in round 2.

### Still open from round 1

Removals, none done (each needs your yes):

- Agents page: the subtitle "Install status, versions and sign-in for each agent program." and the "Recommended" badge; Conductor's capture shows neither.
- Appearance: our four section headings ("Theme and colours", "Display", "Fonts and code", "Live preview") and the row order they impose; Conductor shows one list.
- The empty sidebar's "Add a project" button; Conductor shows only "Add a project to get started."
- Descriptions of ours where Conductor shows none: Restart automatically on update, Arrange workspaces manually, the "absolutely right" switch, Review model, Codex personality, Terminal Font Size, and other settings rows.

Decided by round 1, to confirm: the model names and the OpenCode provider list in Conductor's bundle are mapped to D086 as catalogue data, not wording; D086 was written for library defaults, code and city names.

Contract changes needed (not made):

- The program path row inside each agent's tab, as in Conductor's capture, needs the Agents page to check a path: a hook in `core/hooks.ts` or an action in `core/api.ts`. The row stays on the Advanced page.
- From the earlier parity rounds, still open: "Open settings.toml", the sound "Test" button, the Account page's photo and display name, and new-workspace attachments.

Other open items:

- Conductor's four suggested environment variables we lack (ANTHROPIC_VERTEX_PROJECT_ID, AI_GATEWAY_API_KEY, OPENAI_ORG, OPENAI_PROJECT) and Conductor's Preview URLs description, whose promises (+1 to +9 ports, URL detection) nobody has checked against ours.
- Conductor's own Big terminal settings page; ours keeps its rows on Experimental.
- "Run claude /login" runs Conductor's command in an embedded terminal; ours opens our sign-in dialog.
- A pre-existing flake on main: `UpdateNotice.test.tsx` leaves a sonner toast timer that fires after jsdom is torn down ("window is not defined"), which failed CI once on this branch.

Invented wording of ours, by state, is in the "Gaps by screen" tables below (code `ours-only`).

## Inventories

| Inventory | Entries | Matched | of them unsure | Decided | Gaps |
| --- | ---: | ---: | ---: | ---: | ---: |
| text | 853 | 182 | 0 | 175 | 496 |
| label | 498 | 102 | 0 | 222 | 174 |
| aria_label | 189 | 52 | 0 | 36 | 101 |
| placeholder | 70 | 14 | 0 | 13 | 43 |
| title | 462 | 244 | 0 | 64 | 154 |
| tooltip | 25 | 3 | 0 | 2 | 20 |
| description | 281 | 90 | 0 | 97 | 94 |
| toast | 253 | 1 | 0 | 27 | 225 |
| literal | 381 | 87 | 0 | 76 | 218 |
| route | 95 | 4 | 0 | 50 | 41 |
| test_id | 18 | 4 | 0 | 0 | 14 |
| sidecar_rpc_method | 87 | 7 | 0 | 21 | 59 |
| sidecar_tool_name | 13 | 7 | 0 | 6 | 0 |
| sidecar_call | 78 | 7 | 0 | 15 | 56 |
| tauri_command | 105 | 8 | 0 | 13 | 84 |
| tauri_plugin_command | 151 | 144 | 0 | 0 | 7 |
| tauri_event | 40 | 0 | 0 | 0 | 40 |
| settings_key | 193 | 108 | 0 | 48 | 37 |
| table | 29 | 9 | 0 | 0 | 20 |
| Total | 3821 | 1073 | 0 | 865 | 1883 |

## Gaps by class

Owned means the map names the backlog row and the checklist item in `docs/plans/items/` that build or draw it. Owned is still a gap: the work is planned, not done.

| Class | Entries | Owned by a row and item | Row only | No owner |
| --- | ---: | ---: | ---: | ---: |
| a. Decided (D002 31, D004 233, D025 310, D029 21, D086 270) | 865 | | | |
| b. Unshown: our source has it, no catalogue state draws it | 718 | 385 | 68 | 265 |
| c. Wording or placement differs on a screen we draw | 0 | 0 | 0 | 0 |
| d. A feature or behaviour we lack | 1165 | 324 | 230 | 611 |

## Findings by check

| Check | Code | Gaps | Broken |
| --- | --- | ---: | ---: |
| a. Map completeness | gap-missing | 1165 | 0 |
| a. Map completeness | gap-unshown | 718 | 0 |
| b. Text and controls | ours-only | 1771 | 0 |
| d. Flows | flow-step | 3 | 0 |
| e. Backend lists | backend-ours-only | 141 | 0 |

## Gaps by screen

### App shell (15)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| b | ours-only | first-run, first-run-home | Add a project | span text: [data-testid="sidebar"] > div > aside > div:nth-of-type(2) > div > div:nth-of-type(1) > div > button > span |
| b | ours-only | first-run, sidebar | Add a project, then give each task its own workspace. Pick a workspace in the sidebar to continue where you left off. | p text: [data-testid="main-content"] > div > main > div > div:nth-of-type(2) > section > p |
| b | ours-only | first-run, first-run-home, sidebar | Sidebar | aside aria-label: [data-testid="sidebar"] > div > aside |
| b | ours-only | first-run, first-run-home, sidebar | Main | nav aria-label: [data-testid="sidebar"] > div > aside > div:nth-of-type(2) > div > nav |
| b | ours-only | first-run-home | Create one to give a task its own copy of the code and its own chats. | p text: [data-testid="main-content"] > div > main > div > div > div > div > p |
| b | ours-only | sidebar, sidebar | Create workspace in atlas | link aria-label: [data-testid="sidebar"] > div > aside > div:nth-of-type(2) > div > div:nth-of-type(1) > div > section:nth-of-type(1) > div > div:nth-of-type(1) |
| b | ours-only | sidebar, sidebar | Create workspace in relay | link aria-label: [data-testid="sidebar"] > div > aside > div:nth-of-type(2) > div > div:nth-of-type(1) > div > section:nth-of-type(2) > div > div:nth-of-type(1) |

### Backend (444)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| a | gap-missing (feature) | sidecar_rpc_method:S193897 | steer | CHAT-03: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S193913 | claudeAuth | SIDE-15: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S193940 | codexAuth | SIDE-15: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S194212 | fetchAvailableMCP | SIDE-16: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S194254 | fetchSlashCommands | SIDE-16: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S194298 | fetchPreWorkspaceCompletions | SIDE-22: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S194363 | contextUsage | SIDE-17: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S194394 | warmShellEnv | SIDE-10: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S194481 | codexRollback | AGENT-06: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S194514 | codexCompact | AGENT-14: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S194545 | codexGoalSet | AGENT-13: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S194577 | codexGoalClear | AGENT-13: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S194613 | codexGoalGet | AGENT-13: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S194685 | getHarnessVersions | SIDE-15: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S194729 | answerUserQuestion | SIDE-11: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S194773 | startAgentationProxy | RUN-05: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S194821 | listLocalhostPorts | RUN-03: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S194865 | listAcpModels | SIDE-02: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S194899 | fetchAcpSessionConfigOptions | AGENT-17: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S194965 | syncAcpSessionModel | AGENT-17: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S195012 | setAcpSessionConfigOption | AGENT-17: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S195072 | listCodexModels | SIDE-02: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S195110 | acpOneShotPrompt | SIDE-24: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S195151 | cursorOneShotPrompt | SIDE-24: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S195198 | remoteControlStart | RC-01: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S195242 | remoteControlStop | RC-02: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S195284 | remoteControlStatus | RC-02: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S195623 | query | CHAT-02: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S195639 | updatePermissionMode | AGENT-04: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S195687 | setClaudeEditAutoAccept | AGENT-04: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S195743 | resetGenerator | SIDE-07: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S195778 | setVerboseLogging | SIDE-18: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S196032 | setModelCatalog | SIDE-14: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S196070 | persistedSessionEvent | SIDE-06: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S196120 | remoteControlChanges | RC-02: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S196177 | message | SIDE-05: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S196197 | queryError | SIDE-05: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S196224 | sessionEventNotification | SIDE-05: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S196267 | sessionStatusNotification | SIDE-05: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S196312 | sessionStateNotification | SIDE-05: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S196355 | enterPlanModeNotification | SIDE-20: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S196401 | fastModeUnavailableNotification | SIDE-05: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S196459 | checkpointCreated | SIDE-08: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S196500 | shellEnvCaptureNotification | SIDE-10: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S196550 | harnessVersionsNotification | SIDE-15: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S196599 | codexMcpConsentDeliveryFailed | AGENT-08: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S196667 | keepAwake | PLAT-21: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S196821 | deliverSessionEvent | SIDE-06: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S196867 | exitPlanMode | CHAT-12: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S196899 | askUserQuestion | CHAT-10: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S196937 | codexMcpElicitation | AGENT-08: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S196983 | codexPermissionApproval | AGENT-08: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S197037 | toolApproval | AGENT-04: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S197068 | getDiff | SIDE-12: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S197127 | diffComment | SIDE-12: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S197198 | frontendRelay | not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S982464 | router | NAV-02: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S982482 | plugin | PLAT-30: not in our UI |
| a | gap-missing (feature) | sidecar_rpc_method:S4668000 | native | PLAT-12: not in our UI |
| a | gap-missing (feature) | sidecar_call:codexGoalClear | codexGoalClear | AGENT-13: not in our UI |
| a | gap-missing (feature) | sidecar_call:codexGoalGet | codexGoalGet | AGENT-13: not in our UI |
| a | gap-missing (feature) | sidecar_call:codexGoalSet | codexGoalSet | AGENT-13: not in our UI |
| a | gap-missing (feature) | sidecar_call:message | message | SIDE-05: not in our UI |
| a | gap-missing (feature) | sidecar_call:queryError | queryError | SIDE-05: not in our UI |
| a | gap-missing (feature) | sidecar_call:codexMcpConsentDeliveryFailed | codexMcpConsentDeliveryFailed | AGENT-08: not in our UI |
| a | gap-missing (feature) | sidecar_call:sessionEventNotification | sessionEventNotification | SIDE-05: not in our UI |
| a | gap-missing (feature) | sidecar_call:deliverSessionEvent | deliverSessionEvent | SIDE-06: not in our UI |
| a | gap-missing (feature) | sidecar_call:sessionStatusNotification | sessionStatusNotification | SIDE-05: not in our UI |
| a | gap-missing (feature) | sidecar_call:sessionStateNotification | sessionStateNotification | SIDE-05: not in our UI |
| a | gap-missing (feature) | sidecar_call:fastModeUnavailableNotification | fastModeUnavailableNotification | SIDE-05: not in our UI |
| a | gap-missing (feature) | sidecar_call:shellEnvCaptureNotification | shellEnvCaptureNotification | SIDE-10: not in our UI |
| a | gap-missing (feature) | sidecar_call:exitPlanMode | exitPlanMode | CHAT-12: not in our UI |
| a | gap-missing (feature) | sidecar_call:askUserQuestion | askUserQuestion | CHAT-10: not in our UI |
| a | gap-missing (feature) | sidecar_call:codexMcpElicitation | codexMcpElicitation | AGENT-08: not in our UI |
| a | gap-missing (feature) | sidecar_call:codexPermissionApproval | codexPermissionApproval | AGENT-08: not in our UI |
| a | gap-missing (feature) | sidecar_call:toolApproval | toolApproval | AGENT-04: not in our UI |
| a | gap-missing (feature) | sidecar_call:getDiff | getDiff | SIDE-12: not in our UI |
| a | gap-missing (feature) | sidecar_call:diffComment | diffComment | SIDE-12: not in our UI |
| a | gap-missing (feature) | sidecar_call:enterPlanModeNotification | enterPlanModeNotification | SIDE-20: not in our UI |
| a | gap-missing (feature) | sidecar_call:checkpointCreated | checkpointCreated | SIDE-08: not in our UI |
| a | gap-missing (feature) | sidecar_call:frontendRelay | frontendRelay | not in our UI |
| a | gap-missing (feature) | sidecar_call:keepAwake | keepAwake | PLAT-21: not in our UI |
| a | gap-missing (feature) | sidecar_call:query | query | CHAT-02: not in our UI |
| a | gap-missing (feature) | sidecar_call:steer | steer | CHAT-03: not in our UI |
| a | gap-missing (feature) | sidecar_call:updatePermissionMode | updatePermissionMode | AGENT-04: not in our UI |
| a | gap-missing (feature) | sidecar_call:setClaudeEditAutoAccept | setClaudeEditAutoAccept | AGENT-04: not in our UI |
| a | gap-missing (feature) | sidecar_call:resetGenerator | resetGenerator | SIDE-07: not in our UI |
| a | gap-missing (feature) | sidecar_call:setVerboseLogging | setVerboseLogging | SIDE-18: not in our UI |
| a | gap-missing (feature) | sidecar_call:setModelCatalog | setModelCatalog | SIDE-14: not in our UI |
| a | gap-missing (feature) | sidecar_call:claudeAuth | claudeAuth | SIDE-15: not in our UI |
| a | gap-missing (feature) | sidecar_call:codexAuth | codexAuth | SIDE-15: not in our UI |
| a | gap-missing (feature) | sidecar_call:fetchAvailableMCP | fetchAvailableMCP | SIDE-16: not in our UI |
| a | gap-missing (feature) | sidecar_call:fetchSlashCommands | fetchSlashCommands | SIDE-16: not in our UI |
| a | gap-missing (feature) | sidecar_call:fetchPreWorkspaceCompletions | fetchPreWorkspaceCompletions | SIDE-22: not in our UI |
| a | gap-missing (feature) | sidecar_call:listAcpModels | listAcpModels | SIDE-02: not in our UI |
| a | gap-missing (feature) | sidecar_call:fetchAcpSessionConfigOptions | fetchAcpSessionConfigOptions | AGENT-17: not in our UI |
| a | gap-missing (feature) | sidecar_call:syncAcpSessionModel | syncAcpSessionModel | AGENT-17: not in our UI |
| a | gap-missing (feature) | sidecar_call:setAcpSessionConfigOption | setAcpSessionConfigOption | AGENT-17: not in our UI |
| a | gap-missing (feature) | sidecar_call:listCodexModels | listCodexModels | SIDE-02: not in our UI |
| a | gap-missing (feature) | sidecar_call:warmShellEnv | warmShellEnv | SIDE-10: not in our UI |
| a | gap-missing (feature) | sidecar_call:persistedSessionEvent | persistedSessionEvent | SIDE-06: not in our UI |
| a | gap-missing (feature) | sidecar_call:remoteControlChanges | remoteControlChanges | RC-02: not in our UI |
| a | gap-missing (feature) | sidecar_call:remoteControlStart | remoteControlStart | RC-01: not in our UI |
| a | gap-missing (feature) | sidecar_call:remoteControlStop | remoteControlStop | RC-02: not in our UI |
| a | gap-missing (feature) | sidecar_call:remoteControlStatus | remoteControlStatus | RC-02: not in our UI |
| a | gap-missing (feature) | sidecar_call:codexRollback | codexRollback | AGENT-06: not in our UI |
| a | gap-missing (feature) | sidecar_call:codexCompact | codexCompact | AGENT-14: not in our UI |
| a | gap-missing (feature) | sidecar_call:contextUsage | contextUsage | SIDE-17: not in our UI |
| a | gap-missing (feature) | sidecar_call:acpOneShotPrompt | acpOneShotPrompt | SIDE-24: not in our UI |
| a | gap-missing (feature) | sidecar_call:cursorOneShotPrompt | cursorOneShotPrompt | SIDE-24: not in our UI |
| a | gap-missing (feature) | sidecar_call:answerUserQuestion | answerUserQuestion | SIDE-11: not in our UI |
| a | gap-missing (feature) | sidecar_call:startAgentationProxy | startAgentationProxy | RUN-05: not in our UI |
| a | gap-missing (feature) | sidecar_call:listLocalhostPorts | listLocalhostPorts | RUN-03: not in our UI |
| a | gap-missing (feature) | sidecar_call:getHarnessVersions | getHarnessVersions | SIDE-15: not in our UI |
| a | gap-missing (feature) | sidecar_call:harnessVersionsNotification | harnessVersionsNotification | SIDE-15: not in our UI |
| a | gap-missing (feature) | tauri_command:get_db_uri | get_db_uri | not in our UI |
| a | gap-missing (feature) | tauri_command:configure_http_proxy | configure_http_proxy | PLAT-30: HTTP from the native side, through the user's proxy. |
| a | gap-missing (feature) | tauri_command:is_cef_runtime | is_cef_runtime | not in our UI |
| a | gap-missing (feature) | tauri_command:native_http_fetch_cancel | native_http_fetch_cancel | PLAT-30: HTTP from the native side, through the user's proxy. |
| a | gap-missing (feature) | tauri_command:native_http_fetch | native_http_fetch | PLAT-30: HTTP from the native side, through the user's proxy. |
| a | gap-missing (feature) | tauri_command:native_http_upload_cancel | native_http_upload_cancel | PLAT-30: HTTP from the native side, through the user's proxy. |
| a | gap-missing (feature) | tauri_command:native_http_upload_file | native_http_upload_file | PLAT-30: HTTP from the native side, through the user's proxy. |
| a | gap-missing (feature) | tauri_command:materialize_local_path_attachment | materialize_local_path_attachment | PLAT-20: not in our UI |
| a | gap-missing (feature) | tauri_command:list_file_tree | list_file_tree | PLAT-06: not in our UI |
| a | gap-missing (feature) | tauri_command:list_workspace_artifacts | list_workspace_artifacts | REV-10: not in our UI |
| a | gap-missing (feature) | tauri_command:fuzzy_filter_files | fuzzy_filter_files | PLAT-06: not in our UI |
| a | gap-missing (feature) | tauri_command:grep_workspace | grep_workspace | PLAT-06: not in our UI |
| a | gap-missing (feature) | tauri_command:rpc_to_sidecar | rpc_to_sidecar | PLAT-09: not in our UI |
| a | gap-missing (feature) | tauri_command:send_native_notification | send_native_notification | PLAT-11: not in our UI |
| a | gap-missing (feature) | tauri_command:pty_ack_bytes | pty_ack_bytes | PLAT-07: not in our UI |
| a | gap-missing (feature) | tauri_command:pty_write_mirror | pty_write_mirror | CLOUD-09: not in our UI |
| a | gap-missing (feature) | tauri_command:pty_persist_terminal_history | pty_persist_terminal_history | PLAT-08: not in our UI |
| a | gap-missing (feature) | tauri_command:pty_create_mirror | pty_create_mirror | CLOUD-09: not in our UI |
| a | gap-missing (feature) | tauri_command:pty_resize_mirror | pty_resize_mirror | CLOUD-09: not in our UI |
| a | gap-missing (feature) | tauri_command:pty_delete_mirror | pty_delete_mirror | CLOUD-09: not in our UI |
| a | gap-missing (feature) | tauri_command:raw_websocket_send_text | raw_websocket_send_text | CLOUD-03: A WebSocket from the native side to the user's Worker. |
| a | gap-missing (feature) | tauri_command:raw_websocket_ping | raw_websocket_ping | CLOUD-03: A WebSocket from the native side to the user's Worker. |
| a | gap-missing (feature) | tauri_command:raw_websocket_close | raw_websocket_close | CLOUD-03: A WebSocket from the native side to the user's Worker. |
| a | gap-missing (feature) | tauri_command:raw_websocket_open | raw_websocket_open | CLOUD-03: A WebSocket from the native side to the user's Worker. |
| a | gap-missing (feature) | tauri_command:get_user_shell | get_user_shell | PLAT-04: The login shell and its PATH. |
| a | gap-missing (feature) | tauri_command:pty_load_terminal_history | pty_load_terminal_history | PLAT-08: not in our UI |
| a | gap-missing (feature) | tauri_command:set_remote_file_sync_foreground | set_remote_file_sync_foreground | CLOUD-11: File sync of a cloud workspace. |
| a | gap-missing (feature) | tauri_command:start_remote_file_sync | start_remote_file_sync | CLOUD-11: not in our UI |
| a | gap-missing (feature) | tauri_command:resolve_remote_file_sync_direct_info | resolve_remote_file_sync_direct_info | CLOUD-11: File sync of a cloud workspace. |
| a | gap-missing (feature) | tauri_command:reject_remote_file_sync_direct_info | reject_remote_file_sync_direct_info | CLOUD-11: File sync of a cloud workspace. |
| a | gap-missing (feature) | tauri_command:trigger_remote_file_sync | trigger_remote_file_sync | CLOUD-11: File sync of a cloud workspace. |
| a | gap-missing (feature) | tauri_command:cleanup_remote_file_sync | cleanup_remote_file_sync | CLOUD-11: File sync of a cloud workspace. |
| a | gap-missing (feature) | tauri_command:stop_remote_file_sync | stop_remote_file_sync | CLOUD-11: File sync of a cloud workspace. |
| a | gap-missing (feature) | tauri_command:get_path_env | get_path_env | PLAT-04: The login shell and its PATH. |
| a | gap-missing (feature) | tauri_command:start_on_device_speech | start_on_device_speech | PLAT-12: not in our UI |
| a | gap-missing (feature) | tauri_command:stop_on_device_speech | stop_on_device_speech | PLAT-12: not in our UI |
| a | gap-missing (feature) | tauri_command:cancel_on_device_speech | cancel_on_device_speech | PLAT-12: not in our UI |
| a | gap-missing (feature) | tauri_command:on_device_speech_available | on_device_speech_available | PLAT-12: On-device dictation. |
| a | gap-missing (feature) | tauri_command:get_agent_binary_state | get_agent_binary_state | PLAT-28: The agent program manager. |
| a | gap-missing (feature) | tauri_command:request_agent_binary_download | request_agent_binary_download | PLAT-28: The agent program manager. |
| a | gap-missing (feature) | tauri_command:execute_shell_command_cancellable | execute_shell_command_cancellable | PLAT-03: not in our UI |
| a | gap-missing (feature) | tauri_command:cancel_shell_command | cancel_shell_command | PLAT-03: not in our UI |
| a | gap-missing (feature) | tauri_command:execute_shell_command | execute_shell_command | PLAT-03: not in our UI |
| a | gap-missing (feature) | tauri_command:configure_verbose_logging | configure_verbose_logging | PLAT-18: not in our UI |
| a | gap-missing (feature) | tauri_command:write_file_async | write_file_async | PLAT-05: not in our UI |
| a | gap-missing (feature) | tauri_command:find_available_local_port | find_available_local_port | CLOUD-10: not in our UI |
| a | gap-missing (feature) | tauri_command:start_port_forward | start_port_forward | CLOUD-10: not in our UI |
| a | gap-missing (feature) | tauri_command:stop_port_forward | stop_port_forward | CLOUD-10: not in our UI |
| a | gap-missing (feature) | tauri_command:resolve_port_forward_token | resolve_port_forward_token | CLOUD-10: Port forwarding from a cloud workspace. |
| a | gap-missing (feature) | tauri_command:reject_port_forward_token | reject_port_forward_token | CLOUD-10: Port forwarding from a cloud workspace. |
| a | gap-missing (feature) | tauri_command:list_port_forwards | list_port_forwards | CLOUD-10: not in our UI |
| a | gap-missing (feature) | tauri_command:get_or_create_local_storage_encryption_key | get_or_create_local_storage_encryption_key | PLAT-10: Keychain read and write. |
| a | gap-missing (feature) | tauri_command:get_keychain_setting | get_keychain_setting | PLAT-10: Keychain read and write. |
| a | gap-missing (feature) | tauri_command:set_keychain_setting | set_keychain_setting | PLAT-10: Keychain read and write. |
| a | gap-missing (feature) | tauri_command:delete_keychain_setting | delete_keychain_setting | PLAT-10: Keychain read and write. |
| a | gap-missing (feature) | tauri_command:submit_app_logs | submit_app_logs | PLAT-18: not in our UI |
| a | gap-missing (feature) | tauri_command:fuzzy_match_files | fuzzy_match_files | PLAT-06: not in our UI |
| a | gap-missing (feature) | tauri_command:get_file_metadata | get_file_metadata | PLAT-05: not in our UI |
| a | gap-missing (feature) | tauri_command:update_window_vibrancy | update_window_vibrancy | PLAT-23: not in our UI |
| a | gap-missing (feature) | tauri_command:open_devtools | open_devtools | PLAT-15: not in our UI |
| a | gap-missing (feature) | tauri_command:get_binary_verification_errors | get_binary_verification_errors | PLAT-34: not in our UI |
| a | gap-missing (feature) | tauri_command:write_encoded_image_to_clipboard | write_encoded_image_to_clipboard | PLAT-02: not in our UI |
| a | gap-missing (feature) | tauri_command:sync_agent_path_overrides | sync_agent_path_overrides | PLAT-28: not in our UI |
| a | gap-missing (feature) | tauri_command:native_http_download_file | native_http_download_file | PLAT-30: HTTP from the native side, through the user's proxy. |
| a | gap-missing (feature) | tauri_command:get_resource_usage | get_resource_usage | PLAT-14: not in our UI |
| a | gap-missing (feature) | tauri_command:export_app_logs | export_app_logs | PLAT-18: not in our UI |
| a | gap-missing (feature) | tauri_command:prefetch_agent_binaries_from_updater_endpoint | prefetch_agent_binaries_from_updater_endpoint | PLAT-28: The agent program manager. |
| a | gap-missing (feature) | tauri_command:get_installed_manual_update | get_installed_manual_update | PLAT-13: not in our UI |
| a | gap-missing (feature) | tauri_command:check_for_updates | check_for_updates | PLAT-13: not in our UI |
| a | gap-missing (feature) | tauri_command:check_codex_auth | check_codex_auth | SIDE-15: not in our UI |
| a | gap-missing (feature) | tauri_command:get_openai_api_key_from_env | get_openai_api_key_from_env | SIDE-21: An agent key found in the environment. |
| a | gap-missing (feature) | tauri_command:get_anthropic_api_key_from_env | get_anthropic_api_key_from_env | SIDE-21: An agent key found in the environment. |
| a | gap-missing (feature) | tauri_command:check_full_disk_access | check_full_disk_access | PLAT-24: not in our UI |
| a | gap-missing (feature) | tauri_command:set_agent_binary_failure_injection | set_agent_binary_failure_injection | PLAT-28: The agent program manager. |
| a | gap-missing (feature) | tauri_command:remove_agent_binary | remove_agent_binary | PLAT-28: The agent program manager. |
| a | gap-missing (feature) | tauri_command:redownload_agent_binary | redownload_agent_binary | PLAT-28: The agent program manager. |
| a | gap-missing (feature) | tauri_command:check_sidecar_http_health | check_sidecar_http_health | PLAT-09: not in our UI |
| a | gap-missing (feature) | tauri_command:get_sidecar_log_path | get_sidecar_log_path | PLAT-09: not in our UI |
| a | gap-missing (feature) | tauri_command:update_traffic_light_position | update_traffic_light_position | PLAT-23: not in our UI |
| a | gap-missing (feature) | tauri_command:take_pending_notification_deep_links | take_pending_notification_deep_links | PLAT-11: not in our UI |
| a | gap-missing (feature) | tauri_command:quit_app | quit_app | PLAT-15: not in our UI |
| a | gap-missing (feature) | tauri_command:get_db_version_warning | get_db_version_warning | PLAT-17: not in our UI |
| a | gap-missing (feature) | tauri_command:is_running_under_rosetta | is_running_under_rosetta | PLAT-32: A system fact: the build's CPU. |
| a | gap-missing (feature) | tauri_command:ensure_sidecar_started | ensure_sidecar_started | PLAT-09: not in our UI |
| a | gap-missing (feature) | tauri_plugin_command:http\|fetch | http\|fetch | PLAT-30: HTTP from the native side. |
| a | gap-missing (feature) | tauri_plugin_command:http\|fetch_cancel | http\|fetch_cancel | PLAT-30: HTTP from the native side. |
| a | gap-missing (feature) | tauri_plugin_command:http\|fetch_send | http\|fetch_send | PLAT-30: HTTP from the native side. |
| a | gap-missing (feature) | tauri_plugin_command:http\|fetch_read_body | http\|fetch_read_body | PLAT-30: HTTP from the native side. |
| a | gap-missing (feature) | tauri_plugin_command:os\|hostname | os\|hostname | PLAT-32: A system fact. |
| a | gap-missing (feature) | tauri_plugin_command:process\|exit | process\|exit | PLAT-15: Quit the app. |
| a | gap-missing (feature) | tauri_plugin_command:process\|restart | process\|restart | PLAT-13: Restart after an update. |
| a | gap-missing (feature) | tauri_event:tauri://resize | tauri://resize | PLAT-23: The window's size, place, scale or theme changed. |
| a | gap-missing (feature) | tauri_event:tauri://move | tauri://move | PLAT-23: The window's size, place, scale or theme changed. |
| a | gap-missing (feature) | tauri_event:tauri://close-requested | tauri://close-requested | PLAT-15: The window asks to close: the quit hand-shake. |
| a | gap-missing (feature) | tauri_event:tauri://drag-enter | tauri://drag-enter | PLAT-33: Files dragged onto the window. |
| a | gap-missing (feature) | tauri_event:tauri://drag-over | tauri://drag-over | PLAT-33: Files dragged onto the window. |
| a | gap-missing (feature) | tauri_event:tauri://drag-drop | tauri://drag-drop | PLAT-33: Files dragged onto the window. |
| a | gap-missing (feature) | tauri_event:tauri://drag-leave | tauri://drag-leave | PLAT-33: Files dragged onto the window. |
| a | gap-missing (feature) | tauri_event:tauri://focus | tauri://focus | PLAT-31: not in our UI |
| a | gap-missing (feature) | tauri_event:tauri://blur | tauri://blur | PLAT-31: not in our UI |
| a | gap-missing (feature) | tauri_event:tauri://scale-change | tauri://scale-change | PLAT-23: The window's size, place, scale or theme changed. |
| a | gap-missing (feature) | tauri_event:tauri://theme-changed | tauri://theme-changed | PLAT-23: The window's size, place, scale or theme changed. |
| a | gap-missing (feature) | tauri_event:rpc_from_sidecar | rpc_from_sidecar | PLAT-09: not in our UI |
| a | gap-missing (feature) | tauri_event:pty-ready | pty-ready | PLAT-07: not in our UI |
| a | gap-missing (feature) | tauri_event:pty-data | pty-data | PLAT-07: not in our UI |
| a | gap-missing (feature) | tauri_event:pty-exit | pty-exit | PLAT-07: not in our UI |
| a | gap-missing (feature) | tauri_event:raw-websocket-event | raw-websocket-event | CLOUD-03: not in our UI |
| a | gap-missing (feature) | tauri_event:remote-file-sync-direct-info-request | remote-file-sync-direct-info-request | CLOUD-11: File sync of a cloud workspace. |
| a | gap-missing (feature) | tauri_event:remote-file-sync-status | remote-file-sync-status | CLOUD-11: File sync of a cloud workspace. |
| a | gap-missing (feature) | tauri_event:agent_binary_progress | agent_binary_progress | PLAT-28: not in our UI |
| a | gap-missing (feature) | tauri_event:port-forward-token-request | port-forward-token-request | CLOUD-10: not in our UI |
| a | gap-missing (feature) | tauri_event:port-forward-event | port-forward-event | CLOUD-10: not in our UI |
| a | gap-missing (feature) | tauri_event:deep-link://new-url | deep-link://new-url | PLAT-16: The OS hands a conducted:// link to the app. |
| a | gap-missing (feature) | tauri_event:binary_verification_errors | binary_verification_errors | PLAT-34: not in our UI |
| a | gap-missing (feature) | tauri_event:tauri://destroyed | tauri://destroyed | PLAT-02: Tauri's own window life-cycle events. |
| a | gap-missing (feature) | tauri_event:tauri://error | tauri://error | PLAT-02: Tauri's own window life-cycle events. |
| a | gap-missing (feature) | tauri_event:open_settings_page | open_settings_page | PLAT-15: not in our UI |
| a | gap-missing (feature) | tauri_event:open_keyboard_shortcuts_dialog | open_keyboard_shortcuts_dialog | PLAT-15: An app menu item sent to the UI. |
| a | gap-missing (feature) | tauri_event:open_feedback_dialog | open_feedback_dialog | PLAT-15: An app menu item sent to the UI. |
| a | gap-missing (feature) | tauri_event:open_documentation_url | open_documentation_url | PLAT-15: An app menu item sent to the UI. |
| a | gap-missing (feature) | tauri_event:open_best_practices_url | open_best_practices_url | PLAT-15: An app menu item sent to the UI. |
| a | gap-missing (feature) | tauri_event:open_changelog_url | open_changelog_url | PLAT-15: An app menu item sent to the UI. |
| a | gap-missing (feature) | tauri_event:open_diagnostics_page | open_diagnostics_page | PLAT-15: An app menu item sent to the UI. |
| a | gap-missing (feature) | tauri_event:open_submit_prompt_dialog | open_submit_prompt_dialog | PLAT-15: An app menu item sent to the UI. |
| a | gap-missing (feature) | tauri_event:toggle_left_sidebar | toggle_left_sidebar | PLAT-15: An app menu item sent to the UI. |
| a | gap-missing (feature) | tauri_event:toggle_right_sidebar | toggle_right_sidebar | PLAT-15: An app menu item sent to the UI. |
| a | gap-missing (feature) | tauri_event:manual_update_status | manual_update_status | PLAT-13: not in our UI |
| a | gap-missing (feature) | tauri_event:notification-deep-link-click | notification-deep-link-click | PLAT-11: A click on a native notification opens its link. |
| a | gap-missing (feature) | tauri_event:quit_requested | quit_requested | PLAT-15: not in our UI |
| a | gap-missing (feature) | tauri_event:tauri://created | tauri://created | PLAT-02: Tauri's own window life-cycle events. |
| a | gap-missing (feature) | tauri_event:network-changed | network-changed | PLAT-26: not in our UI |
| a | gap-missing (feature) | settings_key:ssh_key_path | ssh_key_path | CLOUD-12: SSH into a cloud workspace. |
| a | gap-missing (feature) | settings_key:always_allow_local_execution | always_allow_local_execution | CLOUD-14: Cloud agents running commands on the Mac. |
| a | gap-missing (feature) | settings_key:auto_sync_files_in_new_cloud_workspaces | auto_sync_files_in_new_cloud_workspaces | CLOUD-11: not in our UI |
| a | gap-missing (feature) | settings_key:claude_subscription_sign_in_enabled | claude_subscription_sign_in_enabled | SET-09: Agent sign-in forms. |
| a | gap-missing (feature) | settings_key:codex_goals_disabled | codex_goals_disabled | AGENT-13: Codex goals. |
| a | gap-missing (feature) | settings_key:codex_api_key | codex_api_key | SIDE-15: not in our UI |
| a | gap-missing (feature) | settings_key:codex_base_url | codex_base_url | SIDE-21: An agent setting that reaches the sidecar. |
| a | gap-missing (feature) | settings_key:queue_messages_disabled | queue_messages_disabled | CHAT-04: The follow-up queue. |
| a | gap-missing (feature) | settings_key:user_message_footer_enabled | user_message_footer_enabled | not in our UI |
| a | gap-missing (feature) | settings_key:read_aloud_enabled | read_aloud_enabled | not in our UI |
| a | gap-missing (feature) | settings_key:opencode_provider_api_keys | opencode_provider_api_keys | SIDE-15: not in our UI |
| a | gap-missing (feature) | settings_key:conductor_config_repo_root_migration_complete | conductor_config_repo_root_migration_complete | not in our UI |
| a | gap-missing (feature) | settings_key:conductor_json_migration_dismissed_repos | conductor_json_migration_dismissed_repos | not in our UI |
| a | gap-missing (feature) | settings_key:conductor_root_path | conductor_root_path | SET-02: The app data folder on the Advanced page. |
| a | gap-missing (feature) | settings_key:default_thinking_enabled | default_thinking_enabled | AGENT-16: Chat options the settings offer. |
| a | gap-missing (feature) | settings_key:experimental_agent_progress | experimental_agent_progress | not in our UI |
| a | gap-missing (feature) | settings_key:experimental_legacy_file_preview_and_editing | experimental_legacy_file_preview_and_editing | REV-08: The file viewer and editor. |
| a | gap-missing (feature) | settings_key:first_time_onboarding_step | first_time_onboarding_step | DATA-05: not in our UI |
| a | gap-missing (feature) | settings_key:garry_mode | garry_mode | not in our UI |
| a | gap-missing (feature) | settings_key:gh_pat_expires_at | gh_pat_expires_at | PR-01: GitHub access. |
| a | gap-missing (feature) | settings_key:gh_pat_token | gh_pat_token | PR-01: GitHub access. |
| a | gap-missing (feature) | settings_key:gh_token | gh_token | PR-01: GitHub access. |
| a | gap-missing (feature) | settings_key:gh_token_expires_at | gh_token_expires_at | PR-01: GitHub access. |
| a | gap-missing (feature) | settings_key:gh_token_source | gh_token_source | PR-01: GitHub access. |
| a | gap-missing (feature) | settings_key:http_proxy | http_proxy | PLAT-30: HTTP through the user's proxy. |
| a | gap-missing (feature) | settings_key:local_repositories_without_github_enabled | local_repositories_without_github_enabled | GIT-14: Repos without GitHub. |
| a | gap-missing (feature) | settings_key:model_catalog_cache | model_catalog_cache | SIDE-14: The model catalog. |
| a | gap-missing (feature) | settings_key:mention_notifications_enabled | mention_notifications_enabled | not in our UI |
| a | gap-missing (feature) | settings_key:onboarding_workspace_id | onboarding_workspace_id | APP-02: First-run onboarding. |
| a | gap-missing (feature) | settings_key:review_thinking_enabled | review_thinking_enabled | AGENT-16: Chat options the settings offer. |
| a | gap-missing (feature) | settings_key:repo_conductor_config_file_migration_complete | repo_conductor_config_file_migration_complete | not in our UI |
| a | gap-missing (feature) | settings_key:repo_conductor_config_file_migration_v2_complete | repo_conductor_config_file_migration_v2_complete | not in our UI |
| a | gap-missing (feature) | settings_key:repo_custom_prompt_file_migration_complete | repo_custom_prompt_file_migration_complete | not in our UI |
| a | gap-missing (feature) | settings_key:repo_local_settings_file_migration_complete | repo_local_settings_file_migration_complete | not in our UI |
| a | gap-missing (feature) | settings_key:sample_project_onboarding_seed_status | sample_project_onboarding_seed_status | APP-02: First-run onboarding. |
| a | gap-missing (feature) | settings_key:terminal_max_buffered_lines | terminal_max_buffered_lines | RUN-06: Terminal tabs. |
| a | gap-missing (feature) | settings_key:file_backed_settings_migration_complete | file_backed_settings_migration_complete | not in our UI |
| a | gap-missing (feature) | table:identity_associations | identity_associations | not in our UI |
| a | gap-missing (feature) | table:symlinks_pending_deletion | symlinks_pending_deletion | WS-05: not in our UI |
| a | gap-missing (feature) | table:session_messages_outbox | session_messages_outbox | CHAT-04: not in our UI |
| a | gap-missing (feature) | table:session_pending_messages_state | session_pending_messages_state | CHAT-04: The follow-up queue. |
| a | gap-missing (feature) | table:session_pending_messages | session_pending_messages | CHAT-04: The follow-up queue. |
| a | gap-missing (feature) | table:session_assets_outbox | session_assets_outbox | CHAT-04: not in our UI |
| a | gap-missing (feature) | table:client_cache_session_state | client_cache_session_state | DATA-07: The cache for a fast restart. |
| a | gap-missing (feature) | table:session_messages | session_messages | DATA-01: not in our UI |
| a | gap-missing (feature) | table:client_cache_session_segments | client_cache_session_segments | DATA-07: The cache for a fast restart. |
| a | gap-missing (feature) | table:session_state | session_state | SIDE-05: not in our UI |
| a | gap-missing (feature) | table:session_messages_outbox_state | session_messages_outbox_state | CHAT-04: not in our UI |
| a | gap-missing (feature) | table:terminal_sessions | terminal_sessions | PLAT-08: not in our UI |
| a | gap-missing (feature) | table:port_forwards | port_forwards | CLOUD-10: not in our UI |
| a | gap-missing (feature) | table:navigation_sections | navigation_sections | NAV-04: not in our UI |
| a | gap-missing (feature) | table:navigation_section_memberships | navigation_section_memberships | NAV-04: not in our UI |
| a | gap-missing (feature) | table:_sqlx_migrations | _sqlx_migrations | not in our UI |
| a | gap-missing (feature) | table:identity_acceptances | identity_acceptances | not in our UI |
| a | gap-missing (feature) | table:local_workspace_deletion_tombstones | local_workspace_deletion_tombstones | not in our UI |
| a | gap-missing (feature) | table:local_workspace_revision_counter | local_workspace_revision_counter | not in our UI |
| a | gap-missing (feature) | table:migration_rollbacks | migration_rollbacks | PLAT-17: not in our UI |
| e | backend-ours-only |  | addDiffComments | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | agentConfigChanged | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | agentInstallsChanged | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | agentSessionId | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | answerInteraction | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | cancelAgentLogin | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | changeGoal | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | compact | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | deliverEvent | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | eventPersisted | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | finishAgentLogin | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | getAgentInstalls | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | getContextUsage | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | getGoal | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | getWorkspaceDiff | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | goalChanged | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | interactionClosed | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | listAcpConfigOptions | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | listAgentProviders | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | listMcpServers | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | listModels | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | listSlashCommands | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | liveState | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | progress | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | requestInteraction | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | resetAgent | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | runUtilityPrompt | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | sendMessage | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | sessionEvent | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | setAcpConfigOption | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | setAgentPrograms | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | setAutoApproveEdits | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | setGoal | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | setLogLevel | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | setTargetBranch | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | shellEnvFailed | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | startAgentLogin | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | updateConfig | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | app_info | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | app_quit | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | attachment_materialize | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | attachment_write_bytes | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | clipboard_read_file_paths | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | db_version_check | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | deep_link_launch | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | fs_mkdirp | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | fs_paths | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | fs_read_dir | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | fs_read_text | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | fs_register_root | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | fs_stat | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | fs_trash | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | fs_write_text_atomic | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | full_disk_access_check | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | full_disk_access_open_settings | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | health | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | http_cancel | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | http_download | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | http_fetch | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | image_resize | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | installed_apps | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | keychain_delete | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | keychain_get | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | keychain_set | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | log_set_level | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | log_write | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | logs_export | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | menu_set_shortcuts | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | network_status | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | notification_take_pending | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | notify | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | open_with | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | program_install | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | program_redownload | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | program_remove | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | programs_prefetch | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | programs_state | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | programs_sync_path_overrides | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | programs_verification_errors | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | pty_ack | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | pty_load_history | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | resource_usage | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | reveal_in_finder | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | search_fuzzy | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | search_grep | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | search_list_artifacts | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | search_list_tree | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | shell_cancel | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | shell_login_env | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | shell_run | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | shell_start | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | sidecar_ensure_started | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | sidecar_log_path | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | sidecar_send | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | speech_available | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | speech_cancel | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | speech_start | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | speech_stop | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | system_info | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | updater_check | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | updater_install | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | updater_installed_update | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | updater_relaunch | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | window_set_traffic_lights | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | window_set_vibrancy | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | window_toggle_inspector | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | menu\|* | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | tray\|* | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | window-state\|* | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | app://deep-link | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | app://deep-link-rejected | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | app://quit-requested | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | menu://command | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | network://changed | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | notification://clicked | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | programs://status | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | programs://verification-errors | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | pty://exit | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | shell://done | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | sidecar://line | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | sidecar://ready | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | sidecar://restart | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | updater://status | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | conducted_root_path | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | dismissed_callouts | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | expand_tool_calls | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | include_workspace_link_in_pr | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | remote_control_new_chats | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | remote_name | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | reset_chat_also_reset_files | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | sidebar_manual_order | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | theme | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | backlog_workspaces | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | model_context_windows | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | provider_keys | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | queued_messages | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | section_members | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | sections | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | session_live_state | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | snippets | ours only: no Conductor name is matched to it |
| e | backend-ours-only |  | terminals | ours only: no Conductor name is matched to it |

### Composer (126)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| b | ours-only | composer-empty, composer-draft, composer-slash-menu, composer-model-picker | Ask the agent to change something, or start with one of these. | p text: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(1) > div > div:nth-of-type(2) > p |
| b | ours-only | composer-empty, composer-draft, composer-slash-menu, composer-model-picker | Fix a known bug | button text: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(1) > div > div:nth-of-type(3 |
| b | ours-only | composer-empty, composer-draft, composer-slash-menu, composer-model-picker | Read the docs | button text: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(1) > div > div:nth-of-type(3 |
| b | ours-only | composer-empty, composer-draft, composer-model-picker | ⌘L to focus | div text: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(6) > div > |
| b | ours-only | composer-empty, composer-draft, composer-slash-menu, composer-model-picker | 5files changed | span text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div:nth-of-type(1) > span:nth-of-type(1) |
| b | ours-only | composer-empty, composer-empty, composer-draft, composer-draft, composer-slash-menu, composer-slash-menu, composer-model-picker, composer-model-picker | added | span text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div:nth-of-type(2) > div > div:nth-of-type(1) > div > s |
| b | ours-only | composer-empty, composer-empty, composer-draft, composer-draft, composer-slash-menu, composer-slash-menu, composer-model-picker, composer-model-picker | modified | span text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div:nth-of-type(2) > div > div:nth-of-type(2) > div > s |
| b | ours-only | composer-empty, composer-draft, composer-slash-menu, composer-model-picker | Dev | span text: [data-testid="scripts-panel"] > div > div > div > div:nth-of-type(2) > div:nth-of-type(2) > div > div:nth-of-type(1) > button:nth-of-type(1) > span |
| b | ours-only | composer-empty, composer-draft, composer-slash-menu, composer-model-picker | Sidebar | aside aria-label: [data-testid="sidebar"] > div > aside |
| b | ours-only | composer-empty, composer-draft, composer-slash-menu, composer-model-picker | Main | nav aria-label: [data-testid="sidebar"] > div > aside > div:nth-of-type(2) > div > nav |
| b | ours-only | composer-empty, composer-empty, composer-draft, composer-draft, composer-slash-menu, composer-slash-menu, composer-model-picker, composer-model-picker | Create workspace in atlas | link aria-label: [data-testid="sidebar"] > div > aside > div:nth-of-type(2) > div > div:nth-of-type(1) > div > section:nth-of-type(1) > div > div:nth-of-type(1) |
| b | ours-only | composer-empty, composer-empty, composer-draft, composer-draft, composer-slash-menu, composer-slash-menu, composer-model-picker, composer-model-picker | Create workspace in relay | link aria-label: [data-testid="sidebar"] > div > aside > div:nth-of-type(2) > div > div:nth-of-type(1) > div > section:nth-of-type(2) > div > div:nth-of-type(1) |
| b | ours-only | composer-empty, composer-draft, composer-slash-menu, composer-model-picker | atlas icon | img aria-label: [data-testid="main-content"] > div > div > div:nth-of-type(1) > div > div > div:nth-of-type(1) > span:nth-of-type(1) |
| b | ours-only | composer-empty, composer-draft, composer-slash-menu, composer-model-picker | composer | textbox aria-label: [data-testid="composer-editor"] > div > div |
| b | ours-only | composer-empty, composer-draft, composer-slash-menu, composer-model-picker | Model picker | button aria-label: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(6 |
| b | ours-only | composer-empty, composer-draft, composer-slash-menu, composer-model-picker | Claude Code: change agent | button title: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(6) > d |
| b | ours-only | composer-empty, composer-draft, composer-slash-menu, composer-model-picker | Changes and scripts | aside aria-label: [data-testid="right-panel"] > div > aside |
| b | ours-only | composer-empty, composer-draft, composer-slash-menu, composer-model-picker | Review options | button aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > button:nth-of-type(2) |
| b | ours-only | composer-empty, composer-draft, composer-slash-menu, composer-model-picker | Search changed files | button aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(1) > button:nth-of-type(1) |
| b | ours-only | composer-empty, composer-draft, composer-slash-menu, composer-model-picker | Diff scope | button aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(1) > button:nth-of-type(3) |
| b | ours-only | composer-empty, composer-draft, composer-slash-menu, composer-model-picker | Changed files | grid aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div:nth-of-type(2) |
| b | ours-only | composer-empty, composer-draft, composer-slash-menu, composer-model-picker | Collapse panel | button aria-label: [data-testid="scripts-panel"] > div > div > div > div:nth-of-type(1) > button:nth-of-type(1) |
| b | ours-only | composer-empty, composer-draft, composer-slash-menu, composer-model-picker | No preview URL yet | button title: [data-testid="scripts-panel"] > div > div > div > div:nth-of-type(2) > div:nth-of-type(2) > div > div:nth-of-type(1) > div > button:nth-of-type(1) |
| b | ours-only | composer-draft | server.log | span text: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(6) > div  |
| b | ours-only | composer-slash-menu | /add-dir | span text: div:nth-of-type(2) > div > div > div:nth-of-type(1) > span:nth-of-type(1) |
| b | ours-only | composer-slash-menu | /agents | span text: div:nth-of-type(2) > div > div > div:nth-of-type(2) > span:nth-of-type(1) |
| b | ours-only | composer-slash-menu | /clear | span text: div:nth-of-type(2) > div > div > div:nth-of-type(3) > span:nth-of-type(1) |
| b | ours-only | composer-slash-menu | /compact | span text: div:nth-of-type(2) > div > div > div:nth-of-type(4) > span:nth-of-type(1) |
| b | ours-only | composer-slash-menu | /fast | span text: div:nth-of-type(2) > div > div > div:nth-of-type(5) > span:nth-of-type(1) |
| b | ours-only | composer-slash-menu | Turn fast mode on or off | span text: div:nth-of-type(2) > div > div > div:nth-of-type(5) > span:nth-of-type(2) |
| b | ours-only | composer-slash-menu | /hooks | span text: div:nth-of-type(2) > div > div > div:nth-of-type(6) > span:nth-of-type(1) |
| b | ours-only | composer-slash-menu | /mcp | span text: div:nth-of-type(2) > div > div > div:nth-of-type(7) > span:nth-of-type(1) |
| b | ours-only | composer-slash-menu | /mcp-status | span text: div:nth-of-type(2) > div > div > div:nth-of-type(8) > span:nth-of-type(1) |
| b | ours-only | composer-slash-menu | /memory | span text: div:nth-of-type(2) > div > div > div:nth-of-type(9) > span:nth-of-type(1) |
| b | ours-only | composer-slash-menu | /permissions | span text: div:nth-of-type(2) > div > div > div:nth-of-type(10) > span:nth-of-type(1) |
| b | ours-only | composer-slash-menu | /plan | span text: div:nth-of-type(2) > div > div > div:nth-of-type(11) > span:nth-of-type(1) |
| b | ours-only | composer-slash-menu | Enter plan mode or exit plan mode | span text: div:nth-of-type(2) > div > div > div:nth-of-type(11) > span:nth-of-type(2) |
| b | ours-only | composer-slash-menu | /plugins | span text: div:nth-of-type(2) > div > div > div:nth-of-type(12) > span:nth-of-type(1) |
| b | ours-only | composer-slash-menu | /restart | span text: div:nth-of-type(2) > div > div > div:nth-of-type(13) > span:nth-of-type(1) |
| b | ours-only | composer-slash-menu | Restart the agent process to pick up config changes | span text: div:nth-of-type(2) > div > div > div:nth-of-type(13) > span:nth-of-type(2) |
| b | ours-only | composer-slash-menu | /review | span text: div:nth-of-type(2) > div > div > div:nth-of-type(14) > span:nth-of-type(1) |
| b | ours-only | composer-slash-menu | /ultracode | span text: div:nth-of-type(2) > div > div > div:nth-of-type(15) > span:nth-of-type(1) |

### Flow: Add a project: Open GitHub project (1)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| d | flow-step | add-project-github | Drive it in the catalogue | not drivable: no catalogue state scripts gh repo list or git clone (ui-map.md 3.9) |

### Flow: Add a project: Open project (1)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| d | flow-step | add-project-open | Drive it in the catalogue | not drivable: the catalogue's folder dialog has no answer queued and no state scripts git for a new folder (ui-map.md 3.9 and 7.1) |

### Flow: Add a project: Quick start (1)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| d | flow-step | add-project-quick-start | Drive it in the catalogue | not drivable: no catalogue state scripts the template copy and git init (ui-map.md 3.9) |

### Git panel (245)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| b | ours-only | git-changes, git-scope-menu, git-files, git-changes-clean, git-changes-error, git-checks, git-checks-empty | 3 tool calls, 2 messages | span text: [data-testid="virtuoso-item-list"] > div > div > button > span > span:nth-of-type(1) |
| b | ours-only | git-changes, git-scope-menu, git-files, git-changes-clean, git-changes-error, git-checks, git-checks-empty | ⌘L to focus | div text: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(6) > div > |
| b | ours-only | git-changes, git-diff, git-diff-view-options, git-scope-menu | 5files changed | span text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div:nth-of-type(1) > span:nth-of-type(1) |
| b | ours-only | git-changes, git-changes, git-diff, git-diff, git-diff-view-options, git-diff-view-options, git-scope-menu, git-scope-menu | added | span text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div:nth-of-type(2) > div > div:nth-of-type(1) > div > s |
| b | ours-only | git-changes, git-changes, git-diff, git-diff, git-diff-view-options, git-diff-view-options, git-scope-menu, git-scope-menu | modified | span text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div:nth-of-type(2) > div > div:nth-of-type(2) > div > s |
| b | ours-only | git-changes, git-diff, git-diff-view-options, git-scope-menu, git-files, git-changes-clean, git-changes-error, git-checks, git-checks-empty | Dev | span text: [data-testid="scripts-panel"] > div > div > div > div:nth-of-type(2) > div:nth-of-type(2) > div > div:nth-of-type(1) > button:nth-of-type(1) > span |
| b | ours-only | git-changes, git-diff, git-diff-view-options, git-scope-menu, git-files, git-changes-clean, git-changes-error, git-checks, git-checks-empty | Sidebar | aside aria-label: [data-testid="sidebar"] > div > aside |
| b | ours-only | git-changes, git-diff, git-diff-view-options, git-scope-menu, git-files, git-changes-clean, git-changes-error, git-checks, git-checks-empty | Main | nav aria-label: [data-testid="sidebar"] > div > aside > div:nth-of-type(2) > div > nav |
| b | ours-only | git-changes, git-changes, git-diff, git-diff, git-diff-view-options, git-diff-view-options, git-scope-menu, git-scope-menu, git-files, git-files, git-changes-cl | Create workspace in atlas | link aria-label: [data-testid="sidebar"] > div > aside > div:nth-of-type(2) > div > div:nth-of-type(1) > div > section:nth-of-type(1) > div > div:nth-of-type(1) |
| b | ours-only | git-changes, git-changes, git-diff, git-diff, git-diff-view-options, git-diff-view-options, git-scope-menu, git-scope-menu, git-files, git-files, git-changes-cl | Create workspace in relay | link aria-label: [data-testid="sidebar"] > div > aside > div:nth-of-type(2) > div > div:nth-of-type(1) > div > section:nth-of-type(2) > div > div:nth-of-type(1) |
| b | ours-only | git-changes, git-diff, git-diff-view-options, git-scope-menu, git-files, git-changes-clean, git-changes-error, git-checks, git-checks-empty | atlas icon | img aria-label: [data-testid="main-content"] > div > div > div:nth-of-type(1) > div > div > div:nth-of-type(1) > span:nth-of-type(1) |
| b | ours-only | git-changes, git-scope-menu, git-files, git-changes-clean, git-changes-error, git-checks, git-checks-empty | Expand 3 tool calls, 2 messages | button aria-label: [data-testid="virtuoso-item-list"] > div > div > button |
| b | ours-only | git-changes, git-scope-menu, git-files, git-changes-clean, git-changes-error, git-checks, git-checks-empty | Turn details | button aria-label: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(3) > button |
| b | ours-only | git-changes, git-scope-menu, git-files, git-changes-clean, git-changes-error, git-checks, git-checks-empty | Files changed in this turn | section aria-label: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(3) > section |
| b | ours-only | git-changes, git-scope-menu, git-files, git-changes-clean, git-changes-error, git-checks, git-checks-empty | Modified: src/auth/sign-in.ts | button title: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(3) > section > button:nth-of-type(1) |
| b | ours-only | git-changes, git-scope-menu, git-files, git-changes-clean, git-changes-error, git-checks, git-checks-empty | Added: src/auth/safe-next.ts | button title: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(3) > section > button:nth-of-type(2) |
| b | ours-only | git-changes, git-scope-menu, git-files, git-changes-clean, git-changes-error, git-checks, git-checks-empty | Added: src/auth/safe-next.test.ts | button title: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(3) > section > button:nth-of-type(3) |
| b | ours-only | git-changes, git-scope-menu, git-files, git-changes-clean, git-changes-error, git-checks, git-checks-empty | composer | textbox aria-label: [data-testid="composer-editor"] > div > div |
| b | ours-only | git-changes, git-scope-menu, git-files, git-changes-clean, git-changes-error, git-checks, git-checks-empty | Model picker | button aria-label: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(6 |
| b | ours-only | git-changes, git-scope-menu, git-files, git-changes-clean, git-changes-error, git-checks, git-checks-empty | Claude Code: change agent | button title: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(6) > d |
| b | ours-only | git-changes, git-diff, git-diff-view-options, git-scope-menu, git-files, git-changes-clean, git-changes-error, git-checks, git-checks-empty | Changes and scripts | aside aria-label: [data-testid="right-panel"] > div > aside |
| b | ours-only | git-changes, git-diff, git-diff-view-options, git-scope-menu, git-files, git-changes-clean, git-changes-error, git-checks, git-checks-empty | Review options | button aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > button:nth-of-type(2) |
| b | ours-only | git-changes, git-diff, git-diff-view-options, git-scope-menu, git-changes-clean, git-changes-error | Search changed files | button aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(1) > button:nth-of-type(1) |
| b | ours-only | git-changes, git-diff, git-diff-view-options, git-scope-menu, git-scope-menu, git-changes-clean, git-changes-error | Diff scope | button aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(1) > button:nth-of-type(3) |
| b | ours-only | git-changes, git-diff, git-diff-view-options, git-scope-menu | Changed files | grid aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div:nth-of-type(2) |
| b | ours-only | git-changes, git-diff, git-diff-view-options, git-scope-menu, git-files, git-changes-clean, git-changes-error, git-checks, git-checks-empty | Collapse panel | button aria-label: [data-testid="scripts-panel"] > div > div > div > div:nth-of-type(1) > button:nth-of-type(1) |
| b | ours-only | git-changes, git-diff, git-diff-view-options, git-scope-menu, git-files, git-changes-clean, git-changes-error, git-checks, git-checks-empty | No preview URL yet | button title: [data-testid="scripts-panel"] > div > div > div > div:nth-of-type(2) > div:nth-of-type(2) > div > div:nth-of-type(1) > div > button:nth-of-type(1) |
| b | ours-only | git-scope-menu | Current branch sam/fix-login-redirect | div text: div:nth-of-type(2) > div > div:nth-of-type(1) > div:nth-of-type(1) |
| b | ours-only | git-scope-menu | 2 files changed | span text: div:nth-of-type(2) > div > div:nth-of-type(1) > div:nth-of-type(3) > span:nth-of-type(2) > span > span:nth-of-type(2) |
| b | ours-only | git-scope-menu | 5e6f7a8 Sam RiveraNov 2 | span text: div:nth-of-type(2) > div > div:nth-of-type(3) > div:nth-of-type(1) > span:nth-of-type(2) > span:nth-of-type(2) |
| b | ours-only | git-scope-menu | 9c0d1e2 Sam RiveraNov 2 | span text: div:nth-of-type(2) > div > div:nth-of-type(3) > div:nth-of-type(2) > span:nth-of-type(2) > span:nth-of-type(2) |
| b | ours-only | git-scope-menu | Commits | group aria-label: div:nth-of-type(2) > div > div:nth-of-type(3) |
| b | ours-only | git-files | Workspace files | tree aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) |
| b | ours-only | git-files | Expand docs | button aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div > div:nth-of-type(1) > div > button |
| b | ours-only | git-files | Changed | img aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div > div:nth-of-type(1) > div > span:nth-of-type( |
| b | ours-only | git-files | Changed from the target branch | img title: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div > div:nth-of-type(1) > div > span:nth-of-type(3) |
| b | ours-only | git-files | Expand src | button aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div > button |
| b | ours-only | git-changes-clean, git-changes-clean | No changes | button text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(1) > div > button |
| b | ours-only | git-checks | Waiting for a reviewer | span text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(1) > span |
| b | ours-only | git-checks | Base: main | span text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > section:nth-of-type(1) > div:nth-of-type(2) > span:nth-of-type(1) |
| b | ours-only | git-checks | Waiting for PR review | span text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > section:nth-of-type(2) > ul > li > span |
| b | ours-only | git-checks | Checks 0 failed · 1 pending · 3 total | heading text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > section:nth-of-type(3) > div > h3 |
| b | ours-only | git-checks | lint | span text: [data-testid="check-row"] > div > button:nth-of-type(1) > span:nth-of-type(1) |
| b | ours-only | git-checks | No review comments from GitHub. | p text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > section:nth-of-type(4) > p |
| b | ours-only | git-checks, git-checks | Reviewers | heading text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > section:nth-of-type(5) > div > h3 |
| b | ours-only | git-checks | No reviewers requested. | p text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > section:nth-of-type(5) > p |
| b | ours-only | git-checks | Pull request menu | button aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > section:nth-of-type(1) > div:nth-of-type(1) > button:nth-of-type(2) |
| b | ours-only | git-checks-empty | No PR open | span text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > section > ul > li > span |

### inventory-controls Agents (2)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| a | gap-missing (feature) | label:M321253 | GPT-5.5 | Checked by hand: not a match. Ours shows the sample value "gpt-5.5" in composer-model-picker, which is data, not this wording. |
| a | gap-unshown (unshown) | label:M322421 | Auto | no catalogue state shows it |

### inventory-controls App shell (22)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| a | gap-unshown (unshown) | text:R10359782 | Resources | APP-07: no catalogue state shows it |
| a | gap-missing (feature) | text:R10362249 | Memory | not in our UI |
| a | gap-missing (feature) | text:R11656536 | Drop images here | not in our UI |
| a | gap-missing (feature) | text:R11657459 | Click to preview | not in our UI |
| a | gap-missing (feature) | text:R11660855 | Prompt a coding agent to build what you want to see in Conductor. If we like your prompt, we'll run it and merge the result. | not in our UI |
| a | gap-missing (feature) | text:R11661522 | Your name (if we use your prompt, we'll credit you in the changelog) | not in our UI |
| a | gap-unshown (unshown) | label:R10363513 | Mem | no catalogue state shows it |
| a | gap-missing (feature) | label:R11667589 | Reconnect | CLOUD-16: not in our UI |
| a | gap-unshown (unshown) | aria_label:R10374081 | Dismiss macOS version warning | APP-08: no catalogue state shows it |
| a | gap-missing (feature) | placeholder:R11661267 | Describe what you'd like to see built... | not in our UI |
| a | gap-missing (feature) | placeholder:R11661650 | Jane Doe | not in our UI |
| a | gap-missing (feature) | description:R11652399 | Thanks for making Conductor better. | APP-09: not in our UI |
| a | gap-missing (feature) | description:R11660399 | Thanks for your suggestion. | not in our UI |
| a | gap-missing (feature) | description:R11660558 | Please try again later. | not in our UI |
| a | gap-missing (feature) | toast:R11660192 | Please enter a prompt | not in our UI |
| a | gap-missing (feature) | toast:R11660369 | Prompt submitted! | not in our UI |
| a | gap-missing (feature) | toast:R11660524 | Failed to submit prompt | not in our UI |
| a | gap-unshown (unshown) | literal:R10361135 | Copy resource usage | APP-07: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R11652846 | Failed to open app logs. | APP-09: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R11653021 | Please select image files only. | APP-09: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R11653153 | Maximum 5 images allowed. | APP-09: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R11654231 | Please drop image files only. | no catalogue state shows it |

### inventory-controls Chat view (38)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| a | gap-missing (feature) | text:R9521544 | Sent via | CHAT-06: not in our UI |
| a | gap-unshown (unshown) | text:R9525735 | Chat history compacted | CHAT-06: no catalogue state shows it |
| a | gap-missing (feature) | text:R9534245 | This content could not be displayed. | not in our UI |
| a | gap-unshown (unshown) | text:R9539350 | Interrupted by user | CHAT-06: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R9540417 | Claude Code session limit reached | CHAT-06: no catalogue state shows it |
| a | gap-missing (feature) | text:R9542567 | Codex authentication required | CHAT-06: not in our UI |
| a | gap-missing (feature) | text:R9542747 | Please configure Codex authentication in Settings to use Codex. | CHAT-06: not in our UI |
| a | gap-missing (feature) | text:R9543479 | Cursor API key required | CHAT-06: not in our UI |
| a | gap-missing (feature) | text:R9543653 | Add a Cursor API key in provider settings to use Cursor. | not in our UI |
| a | gap-unshown (unshown) | text:R9544396 | Image too large | COMP-07: no catalogue state shows it |
| a | gap-missing (feature) | text:R9544627 | Exceeds Claude Code's size limit (5MB). Please revert to a previous user message by hovering over it, otherwise this chat will fail going forward. | not in our UI |
| a | gap-unshown (unshown) | text:R9544970 | This message could not be displayed. | CHAT-06: no catalogue state shows it |
| a | gap-missing (feature) | text:R9546417 | Sent from | CHAT-06: not in our UI |
| a | gap-unshown (unshown) | text:R9547376 | Sent from another session | CHAT-06: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R9557324 | Cancelled | no catalogue state shows it |
| a | gap-missing (feature) | text:R9637583 | Unsaved changes | not in our UI |
| a | gap-missing (feature) | text:R9637908 | Retry update | not in our UI |
| a | gap-missing (feature) | text:R9638032 | Update failed. Retry | not in our UI |
| a | gap-missing (feature) | text:R9638941 | This file has been modified. Click to view the latest changes. | not in our UI |
| a | gap-unshown (unshown) | label:R9406451 | Add chat transcripts: | CHAT-26: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R9406669 | Add plans: | CHAT-26: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R9537511 | Retry now | CHAT-27: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R9627220 | Download file | CHAT-29: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R9640929 | View raw SVG code | REV-08: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R9640965 | View rendered SVG | REV-08: no catalogue state shows it |
| a | gap-unshown (unshown) | aria_label:R9413717 | Table of contents | CHAT-25: no catalogue state shows it |
| a | gap-missing (feature) | aria_label:R9627873 | Download progress | CHAT-29: not in our UI |
| a | gap-missing (feature) | aria_label:R9637465 | Unsaved changes | not in our UI |
| a | gap-missing (feature) | aria_label:R9637821 | Update failed. Retry | not in our UI |
| a | gap-unshown (unshown) | placeholder:R9420608 | Find in messages and thinking | CHAT-17: no catalogue state shows it |
| a | gap-unshown (unshown) | tooltip:R9523634 | Copy message | no catalogue state shows it |
| a | gap-unshown (unshown) | tooltip:R9525824 | Copy summary | CHAT-06: no catalogue state shows it |
| a | gap-missing (feature) | tooltip:R9535913 | Copy error details | CHAT-27: not in our UI |
| a | gap-unshown (unshown) | toast:R9406094 | Failed to attach plan | CHAT-26: no catalogue state shows it |
| a | gap-missing (feature) | toast:R9549716 | Failed to copy user info | not in our UI |
| a | gap-missing (feature) | toast:R9549768 | Copied user info | not in our UI |
| a | gap-unshown (unshown) | literal:R9536630 | Retry in new chat | CHAT-27: no catalogue state shows it |
| a | gap-missing (feature) | route:R9542870 | /settings/user/general | CHAT-06: not in our UI |

### inventory-controls Composer (87)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| a | gap-missing (feature) | text:R8839892 | Unable to load comment | not in our UI |
| a | gap-missing (feature) | text:R8840402 | Preview unavailable | not in our UI |
| a | gap-missing (feature) | text:R8840488 | Open the file to inspect this attachment. | not in our UI |
| a | gap-unshown (unshown) | text:R8855401 | Loading usage… | no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8859618 | Context | no catalogue state shows it |
| a | gap-missing (feature) | text:R8860458 | Window used | not in our UI |
| a | gap-unshown (unshown) | text:R8868546 | Context window size not yet available. | CHAT-14: no catalogue state shows it |
| a | gap-missing (feature) | text:R8868777 | Opus 4.8 is capped at 200k on Foundry. For 1M, use Opus 4.6/4.7 or another provider. | CHAT-14: not in our UI |
| a | gap-missing (feature) | text:R8869123 | [1m] | CHAT-14: not in our UI |
| a | gap-missing (feature) | text:R8869549 | Loading details… | not in our UI |
| a | gap-unshown (unshown) | text:R9383052 | This workspace is archived. | APP-04: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R9502437 | Prompt | no catalogue state shows it |
| a | gap-missing (feature) | text:R9511048 | Logged in | CHAT-06: not in our UI |
| a | gap-unshown (unshown) | text:R9511126 | Authentication required | CHAT-06: no catalogue state shows it |
| a | gap-missing (feature) | text:R9511468 | Sign in to Claude in the workspace terminal, then retry your message. | CHAT-06: not in our UI |
| a | gap-missing (feature) | text:R9511562 | To resolve, sign in to Claude. Conductor will validate the login automatically. | CHAT-06: not in our UI |
| a | gap-missing (feature) | text:R9512686 | ChatGPT login expired | CHAT-06: not in our UI |
| a | gap-missing (feature) | text:R9512754 | Your ChatGPT login has expired. Reconnect ChatGPT, then send your message again. | CHAT-06: not in our UI |
| a | gap-missing (feature) | text:R11508077 | Enter a new name for this workspace | not in our UI |
| a | gap-missing (feature) | text:R11510910 | Section not found | not in our UI |
| a | gap-unshown (unshown) | text:R11515751 | Couldn't load snippets | COMP-09: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R11524020 | Keyword | no catalogue state shows it |
| a | gap-unshown (unshown) | text:R11525602 | Prompt snippet | no catalogue state shows it |
| a | gap-missing (feature) | text:R11527318 | Discard changes? | REV-06: not in our UI |
| a | gap-missing (feature) | text:R11528266 | This permanently deletes the snippet. | REV-06: not in our UI |
| a | gap-missing (feature) | text:R11533432 | Use in chat | not in our UI |
| a | gap-missing (feature) | text:R11534506 | Title | not in our UI |
| a | gap-missing (feature) | text:R11534878 | Instructions | not in our UI |
| a | gap-missing (feature) | label:R8853002 | Auth | CHAT-28: Checked by hand: not a match. Ours shows the sample value "auth" in file-viewer, which is data, not this wording. |
| a | gap-missing (feature) | label:R8853292 | Organization | CHAT-28: not in our UI |
| a | gap-unshown (unshown) | label:R8853353 | Email | CHAT-28: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R8853853 | Plan | CHAT-28: no catalogue state shows it |
| a | gap-missing (feature) | label:R8857286 | Input | Checked by hand: the wording differs. Ours reads "Input:" (text) in chat-working. |
| a | gap-unshown (unshown) | label:R8857310 | Cached input | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R8857359 | Output | no catalogue state shows it |
| a | gap-missing (feature) | label:R8857397 | Reasoning output | not in our UI |
| a | gap-unshown (unshown) | label:R8863884 | Service tier | no catalogue state shows it |
| a | gap-missing (feature) | label:R8864825 | Speed | not in our UI |
| a | gap-missing (feature) | label:R9354304 | Open settings | not in our UI |
| a | gap-unshown (unshown) | label:R9371127 | Pause goal | COMP-10: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R9371331 | Resume goal | COMP-10: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R9371721 | Edit goal | COMP-10: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R9372025 | Clear goal | COMP-10: no catalogue state shows it |
| a | gap-missing (feature) | label:R9380779 | Fix a TODO | not in our UI |
| a | gap-missing (feature) | aria_label:R8842839 | Edit in diff viewer | not in our UI |
| a | gap-unshown (unshown) | aria_label:R9387590 | Dismiss fast mode warning | CHAT-30: no catalogue state shows it |
| a | gap-missing (feature) | aria_label:R11510611 | Loading sections | not in our UI |
| a | gap-unshown (unshown) | aria_label:R11513606 | Section name | no catalogue state shows it |
| a | gap-unshown (unshown) | aria_label:R11515814 | Loading snippets | COMP-09: no catalogue state shows it |
| a | gap-unshown (unshown) | placeholder:R9369318 | Goal | COMP-10: no catalogue state shows it |
| a | gap-unshown (unshown) | placeholder:R11515575 | Search snippets... | COMP-09: no catalogue state shows it |
| a | gap-missing (feature) | title:R8864204 | Requested | not in our UI |
| a | gap-missing (feature) | title:R8864972 | Returned | not in our UI |
| a | gap-missing (feature) | tooltip:R8843427 | Copy file contents to clipboard | not in our UI |
| a | gap-missing (feature) | description:R8846191 | Restart the agent process. Useful to pick up config changes. | not in our UI |
| a | gap-missing (feature) | description:R8846498 | Choose Codex's personality for this session and future ones | not in our UI |
| a | gap-unshown (unshown) | description:R8846651 | Set the objective Codex should keep working toward | no catalogue state shows it |
| a | gap-unshown (unshown) | description:R8847728 | Compact the context window | no catalogue state shows it |
| a | gap-missing (feature) | description:R11533583 | This permanently deletes the template. Artifacts started from it keep their content. | not in our UI |
| a | gap-unshown (unshown) | toast:R9357302 | Failed to delete queued message | CHAT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R9357937 | Failed to reorder queued messages | CHAT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R9360051 | Failed to resume queue | CHAT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R9360203 | Failed to retry message | CHAT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R9360437 | Failed to steer queued message | CHAT-04: no catalogue state shows it |
| a | gap-missing (feature) | toast:R9390844 | Failed to change the message target. | not in our UI |
| a | gap-missing (feature) | toast:R9392485 | Failed to prepare the message for editing. | not in our UI |
| a | gap-missing (feature) | toast:R9392792 | Failed to discard attachment changes. | not in our UI |
| a | gap-missing (feature) | toast:R9510796 | Workspace path unavailable. | CHAT-06: not in our UI |
| a | gap-missing (feature) | toast:R9513542 | Failed to copy request | CHAT-06: not in our UI |
| a | gap-missing (feature) | toast:R11511925 | Couldn't edit section | NAV-04: not in our UI |
| a | gap-missing (feature) | toast:R11512041 | Section no longer exists | NAV-04: not in our UI |
| a | gap-missing (feature) | toast:R11512106 | Couldn't create section | NAV-04: not in our UI |
| a | gap-unshown (unshown) | literal:R9352425 | Waiting for agent | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9352645 | Queue paused | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9367029 | Pursuing goal | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9367052 | Paused goal | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9367074 | Blocked goal | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9367102 | Usage-limited goal | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9367137 | Budget-limited goal | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9367168 | Completed goal | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9368492 | Failed to update goal. | COMP-10: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9378722 | In progress | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9381975 | Fast mode is disabled because extra usage is out of credits. | CHAT-30: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9387065 | Add credit | CHAT-30: no catalogue state shows it |
| a | gap-missing (feature) | literal:R11510134 | New section | Checked by hand: the wording differs. Ours reads "New section..." (text) in sidebar. |
| a | gap-unshown (unshown) | literal:R11521402 | New snippet | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R11521421 | Edit snippet | no catalogue state shows it |

### inventory-controls Diff and files (3)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| a | gap-unshown (unshown) | label:R1329480 | Accept current change | REV-11: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R1329561 | Accept incoming change | REV-11: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R1329639 | Accept both | REV-11: no catalogue state shows it |

### inventory-controls Platform (34)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| a | gap-unshown (unshown) | label:R629189 | Run for me | GIT-16: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R11634023 | Go to setting | NAV-17: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R11634784 | Connect Linear | PR-09: no catalogue state shows it |
| a | gap-missing (feature) | description:R629105 | Run `sudo xcodebuild -license accept` in terminal to continue | GIT-16: not in our UI |
| a | gap-missing (feature) | description:R11632319 | Browser deep links must include an http:// or https:// URL. | NAV-17: not in our UI |
| a | gap-missing (feature) | description:R11632466 | Open a workspace first, or include workspace-id in the browser deep link. | NAV-17: not in our UI |
| a | gap-missing (feature) | description:R11632861 | Something went wrong. Try again, or open the browser from a workspace. | NAV-17: not in our UI |
| a | gap-missing (feature) | description:R11633125 | The authentication callback was invalid. | not in our UI |
| a | gap-missing (feature) | description:R11633250 | The authentication token could not be validated. | not in our UI |
| a | gap-missing (feature) | description:R11634706 | Please connect your Linear account to use this feature. | not in our UI |
| a | gap-missing (feature) | description:R11634951 | Please add a repository before creating workspaces from Linear issues. | not in our UI |
| a | gap-missing (feature) | description:R11637139 | Please add a repository before creating workspaces from async plans. | NAV-17: not in our UI |
| a | gap-missing (feature) | description:R11637518 | The plan could not be decoded. It may be corrupted. | NAV-17: not in our UI |
| a | gap-missing (feature) | description:R11637630 | The plan content is empty. | NAV-17: not in our UI |
| a | gap-missing (feature) | description:R11638444 | Something went wrong. Try again, or open it from the sidebar. | NAV-17: not in our UI |
| a | gap-missing (feature) | toast:R11632434 | No workspace selected | not in our UI |
| a | gap-unshown (unshown) | toast:R11632825 | Couldn't open browser tab | PLAT-16: no catalogue state shows it |
| a | gap-missing (feature) | toast:R11633100 | Sign-in failed | not in our UI |
| a | gap-missing (feature) | toast:R11633632 | Sign in to equip a loadout | not in our UI |
| a | gap-unshown (unshown) | toast:R11633876 | Setting cannot be enabled by link | PLAT-16: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R11634162 | Failed to enable setting | PLAT-16: no catalogue state shows it |
| a | gap-missing (feature) | toast:R11634668 | Linear integration required | not in our UI |
| a | gap-missing (feature) | toast:R11634917 | No repository available | not in our UI |
| a | gap-missing (feature) | toast:R11635178 | Linear issue not found | PR-09: not in our UI |
| a | gap-unshown (unshown) | toast:R11637313 | Repository not found | PLAT-16: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R11637490 | Invalid plan data | PLAT-16: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R11637609 | Empty plan | PLAT-16: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R11638410 | Couldn't open workspace | PLAT-16: no catalogue state shows it |
| a | gap-missing (feature) | toast:R11639651 | GitHub sign-in failed: invalid or expired request | not in our UI |
| a | gap-missing (feature) | toast:R11639957 | GitHub authenticated successfully | not in our UI |
| a | gap-missing (feature) | toast:R11640060 | Failed to save GitHub token | not in our UI |
| a | gap-missing (feature) | toast:R11640519 | Waiting for a GitHub admin to approve the installation | not in our UI |
| a | gap-missing (feature) | toast:R11640585 | GitHub connected | not in our UI |
| a | gap-unshown (unshown) | toast:R11641905 | Invalid deep link | PLAT-16: no catalogue state shows it |

### inventory-controls Settings (22)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| a | gap-missing (feature) | text:R10692019 | Cmd+Shift+. | not in our UI |
| a | gap-unshown (unshown) | text:R10699838 | Locally overwritten | SET-04: no catalogue state shows it |
| a | gap-missing (feature) | text:R10725742 | OAuth | not in our UI |
| a | gap-missing (feature) | text:R10725877 | Bearer token | not in our UI |
| a | gap-missing (feature) | text:R10725931 | Custom headers | not in our UI |
| a | gap-missing (feature) | text:R10726669 | Advanced client identity | not in our UI |
| a | gap-missing (feature) | text:R10726955 | OAuth callback URL | not in our UI |
| a | gap-missing (feature) | label:R10727056 | Client ID | not in our UI |
| a | gap-missing (feature) | label:R10727344 | Client secret | not in our UI |
| a | gap-missing (feature) | label:R10727824 | Token | Checked by hand: not a match. Ours shows the sample value "TOKEN" in settings-environment, which is data, not this wording. |
| a | gap-missing (feature) | label:R10728254 | Headers | not in our UI |
| a | gap-unshown (unshown) | aria_label:R10693791 | Cancel adding env file | SET-04: no catalogue state shows it |
| a | gap-missing (feature) | title:R10691516 | Select env file | not in our UI |
| a | gap-missing (feature) | title:R10693409 | Browse for env file. Press Cmd+Shift+. to show hidden files. | SET-04: not in our UI |
| a | gap-missing (feature) | title:R10718705 | Inherited from Repo shared | not in our UI |
| a | gap-missing (feature) | title:R10718848 | Inherited from User | not in our UI |
| a | gap-missing (feature) | tooltip:R10720405 | Copy OAuth callback URL | not in our UI |
| a | gap-missing (feature) | description:R10709703 | Selects the GCP project for Vertex AI requests. | SET-11: not in our UI |
| a | gap-missing (feature) | description:R10710192 | Authenticates Codex with the Vercel AI Gateway. | SET-11: not in our UI |
| a | gap-missing (feature) | description:R10710274 | Associates Codex API requests with an OpenAI organization. | SET-11: not in our UI |
| a | gap-missing (feature) | description:R10710371 | Associates Codex API requests with an OpenAI project. | SET-11: not in our UI |
| a | gap-unshown (unshown) | toast:R10694452 | Failed to update env files | SET-04: no catalogue state shows it |

### inventory-controls Settings: Agents (23)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| a | gap-missing (feature) | text:R10926386 | Authorize Conductor to use your ChatGPT subscription. | SET-03: not in our UI |
| a | gap-missing (feature) | text:R10926628 | Personal plan | not in our UI |
| a | gap-missing (feature) | text:R10926760 | Business plan | not in our UI |
| a | gap-missing (feature) | text:R10927168 | Enable device code authorization for Codex. | not in our UI |
| a | gap-missing (feature) | text:R10927644 | Open the OpenAI device authorization page. | not in our UI |
| a | gap-missing (feature) | text:R10928079 | Enter this code when OpenAI asks for it: | not in our UI |
| a | gap-missing (feature) | text:R10932513 | Connected to | not in our UI |
| a | gap-missing (feature) | text:R10933927 | Checking login status... | not in our UI |
| a | gap-unshown (unshown) | text:R10945315 | No providers match your search. | SET-03: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R10948699 | Loaded from env | SET-03: no catalogue state shows it |
| a | gap-missing (feature) | label:R10918784 | Manage usage | SET-03: not in our UI |
| a | gap-missing (feature) | label:R10929522 | ChatGPT | SET-09: not in our UI |
| a | gap-missing (feature) | aria_label:R10928433 | Copy Codex verification code | not in our UI |
| a | gap-unshown (unshown) | aria_label:R10948284 | Validation failed | SET-03: no catalogue state shows it |
| a | gap-unshown (unshown) | aria_label:R10948372 | API key configured | SET-03: no catalogue state shows it |
| a | gap-unshown (unshown) | placeholder:R10958311 | Filter models | SET-10: no catalogue state shows it |
| a | gap-missing (feature) | description:R10921020 | Restart workspaces to pick up new agent credentials. | not in our UI |
| a | gap-unshown (unshown) | toast:R10918731 | Codex now uses your ChatGPT plan | SET-03: no catalogue state shows it |
| a | gap-missing (feature) | toast:R10923050 | Conductor could not connect to cloud settings. Try again. | CLOUD-17: not in our UI |
| a | gap-unshown (unshown) | toast:R10925387 | Copied Codex verification code. | SET-03: no catalogue state shows it |
| a | gap-missing (feature) | toast:R10925446 | Failed to copy Codex verification code. | SET-03: not in our UI |
| a | gap-unshown (unshown) | toast:R10954108 | API key saved | SET-03: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R10954503 | API key removed | SET-03: no catalogue state shows it |

### inventory-controls Settings: General (25)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| a | gap-missing (feature) | text:R11130319 | Loading remotes... | not in our UI |
| a | gap-missing (feature) | text:R11130377 | No remote found. | not in our UI |
| a | gap-unshown (unshown) | text:R11137042 | Graphite | no catalogue state shows it |
| a | gap-missing (feature) | text:R11138708 | Custom | not in our UI |
| a | gap-missing (feature) | text:R11140791 | Delete the local branch when archiving a workspace. | not in our UI |
| a | gap-missing (feature) | text:R11141184 | configure it on GitHub | not in our UI |
| a | gap-missing (feature) | text:R11141442 | Warning: archived workspaces will be unrecoverable | not in our UI |
| a | gap-unshown (unshown) | text:R11143599 | gh stack | CLOUD-09: no catalogue state shows it |
| a | gap-missing (feature) | text:R11143929 | Pause port forwarding? | CLOUD-09: not in our UI |
| a | gap-missing (feature) | label:R11117716 | ⌘ Enter | not in our UI |
| a | gap-unshown (unshown) | label:R11118427 | Queue | no catalogue state shows it |
| a | gap-missing (feature) | placeholder:R11117637 | Custom | not in our UI |
| a | gap-missing (feature) | placeholder:R11129925 | Select remote... | not in our UI |
| a | gap-unshown (unshown) | placeholder:R11133908 | Email | CLOUD-17: no catalogue state shows it |
| a | gap-missing (feature) | placeholder:R11138955 | e.g. feature/ or myname- | not in our UI |
| a | gap-missing (feature) | title:R11118865 | @ notifications | not in our UI |
| a | gap-missing (feature) | title:R11122198 | Workspace API access | not in our UI |
| a | gap-missing (feature) | title:R11134725 | Git identity | CLOUD-17: not in our UI |
| a | gap-missing (feature) | description:R11134746 | Name and email used for commits in cloud workspaces. | CLOUD-17: not in our UI |
| a | gap-missing (feature) | description:R11135262 | Each workspace is an isolated copy of your codebase. | CLOUD-17: not in our UI |
| a | gap-missing (feature) | toast:R11117343 | Failed to reset message send key | not in our UI |
| a | gap-missing (feature) | toast:R11117511 | Failed to update message send key | not in our UI |
| a | gap-missing (feature) | toast:R11120183 | Couldn't open System Settings. Go to Privacy & Security > Full Disk Access to grant it manually. | PLAT-24: not in our UI |
| a | gap-missing (feature) | toast:R11126591 | Couldn't update Git identity | CLOUD-17: not in our UI |
| a | gap-missing (feature) | toast:R11128301 | Couldn't update pull request workspace links | not in our UI |

### inventory-controls Settings: Repository (11)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| a | gap-missing (feature) | text:R11274850 | Using .worktreeinclude from this repository. Remove that file to edit these patterns here. | not in our UI |
| a | gap-missing (feature) | text:R11277107 | Could not preview files to copy. | SET-07: not in our UI |
| a | gap-unshown (unshown) | text:R11277413 | Detecting files to copy... | SET-07: no catalogue state shows it |
| a | gap-missing (feature) | text:R11277725 | No matching gitignored files found. | SET-07: not in our UI |
| a | gap-missing (feature) | text:R11281817 | Emoji failed to load | PRJ-05: not in our UI |
| a | gap-unshown (unshown) | text:R11282175 | No emoji found | PRJ-05: no catalogue state shows it |
| a | gap-missing (feature) | text:R11285835 | No favicon detected | not in our UI |
| a | gap-missing (feature) | aria_label:R11276904 | Refresh files to copy preview | SET-07: not in our UI |
| a | gap-unshown (unshown) | aria_label:R11281401 | Remove emoji | PRJ-05: no catalogue state shows it |
| a | gap-unshown (unshown) | placeholder:R11281056 | Search emoji | PRJ-05: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R11285199 | Use favicon | no catalogue state shows it |

### inventory-controls Sidebar (7)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| a | gap-missing (feature) | text:R10435354 | Forwarding ports | CLOUD-09: not in our UI |
| a | gap-missing (feature) | label:R10415253 | Usage | not in our UI |
| a | gap-missing (feature) | label:R10415566 | Total | not in our UI |
| a | gap-missing (feature) | aria_label:R10434919 | Forwarding ports | CLOUD-09: not in our UI |
| a | gap-missing (feature) | test_id:R10434951 | workspace-port-forwarding-indicator | CLOUD-09: not in our UI |
| a | gap-missing (feature) | test_id:R10441458 | left-sidebar-workspace-item | not in our UI |
| a | gap-missing (feature) | test_id:R10441716 | workspace-leading-visual | not in our UI |

### inventory-controls Workspaces (10)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| a | gap-missing (feature) | text:R5533444 | Enter a GitHub pull request URL or number | PR-10: not in our UI |
| a | gap-unshown (unshown) | text:R10128649 | Tabs failed to load | NAV-10: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R10145998 | Create in section | NAV-04: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R10150844 | Recover prompt | WS-01: no catalogue state shows it |
| a | gap-unshown (unshown) | aria_label:R10145652 | Create in section | NAV-04: no catalogue state shows it |
| a | gap-unshown (unshown) | placeholder:R5533685 | PR URL or number | PR-10: no catalogue state shows it |
| a | gap-unshown (unshown) | title:R10145685 | Create in section | NAV-04: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R5531377 | Detached HEAD | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R5534203 | Link | PR-10: no catalogue state shows it |
| a | gap-missing (feature) | test_id:R10139472 | center-panel-drag-ghost | not in our UI |

### inventory-messages-sidecar Gap and Research only: toast messages and behaviours (197)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| a | gap-missing (feature) | text:R2202229 | Couldn't load this stack. Open the PR on GitHub to see it. | not in our UI |
| a | gap-missing (feature) | text:R5543955 | Loading sections… | not in our UI |
| a | gap-missing (feature) | text:R5544139 | Couldn't load sections | not in our UI |
| a | gap-unshown (unshown) | text:R8136350 | Message not sent | CHAT-02: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8138015 | Editing queued message | CHAT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8173658 | Network access | CHAT-11: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8174862 | Deny | no catalogue state shows it |
| a | gap-missing (feature) | text:R8176460 | Structured response (JSON) | not in our UI |
| a | gap-missing (feature) | text:R8178859 | Open authorization page | not in our UI |
| a | gap-unshown (unshown) | text:R9083099 | Attach current terminal output | COMP-04: no catalogue state shows it |
| a | gap-missing (feature) | text:R9397918 | This workspace is read-only. | not in our UI |
| a | gap-unshown (unshown) | text:R9736615 | Suggested change | REV-03: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R9740205 | You | REV-03: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R9741101 | Only whitespace changes found | REV-02: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R9741520 | Show whitespace changes | REV-02: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R9756537 | Binary file changed | REV-02: no catalogue state shows it |
| a | gap-missing (feature) | text:R10962716 | Review the provider setup, then refresh. | not in our UI |
| a | gap-missing (feature) | text:R10967695 | Changing this removes all existing repos and workspaces from Conductor, but leaves their files on disk. | not in our UI |
| a | gap-unshown (unshown) | text:R10971526 | Changing this may cause issues if the executable is not compatible with Conductor. | no catalogue state shows it |
| a | gap-missing (feature) | text:R11264124 | output style | not in our UI |
| a | gap-missing (feature) | text:R11291806 | Upload a PNG, JPEG, GIF, WebP, or SVG image. Conductor resizes it to icon size. | PRJ-05: not in our UI |
| a | gap-unshown (unshown) | text:R11292135 | Icons | PRJ-05: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R11292330 | Emoji | PRJ-05: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R11292529 | Favicon | PRJ-05: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R11292729 | Upload | PRJ-05: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R11385000 | No results found | NAV-08: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R11405274 | Discard file changes? | REV-06: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R11406943 | Change root path? | SET-02: no catalogue state shows it |
| a | gap-missing (feature) | text:R11407412 | Old root path: | SET-02: not in our UI |
| a | gap-missing (feature) | text:R11407755 | New root path: | SET-02: not in our UI |
| a | gap-missing (feature) | text:R11455832 | No pull requests found | not in our UI |
| a | gap-missing (feature) | text:R11456439 | Open settings | not in our UI |
| a | gap-missing (feature) | text:R11456954 | In use | not in our UI |
| a | gap-missing (feature) | text:R11457027 | Select | not in our UI |
| a | gap-missing (feature) | text:R11458209 | No branches found | not in our UI |
| a | gap-unshown (unshown) | text:R11464130 | PRs | no catalogue state shows it |
| a | gap-unshown (unshown) | text:R11464188 | Branches | no catalogue state shows it |
| a | gap-unshown (unshown) | text:R11464249 | Issues | no catalogue state shows it |
| a | gap-missing (feature) | text:R11502876 | Cloud disabled | not in our UI |
| a | gap-missing (feature) | text:R11502916 | Cloud workspaces are unavailable when enterprise data privacy is enabled. | not in our UI |
| a | gap-missing (feature) | text:R11504834 | Draft the first message, then create and send it. | WS-01: not in our UI |
| a | gap-unshown (unshown) | text:R11647782 | Connect GitHub | SET-02: no catalogue state shows it |
| a | gap-missing (feature) | text:R11647820 | This action needs GitHub access. Sign in with the GitHub CLI to continue. | SET-02: not in our UI |
| a | gap-missing (feature) | text:R11648197 | Other sign-in options | SET-02: not in our UI |
| a | gap-missing (feature) | label:M363480 | user shared | not in our UI |
| a | gap-missing (feature) | label:M364103 | repository local | not in our UI |
| a | gap-missing (feature) | label:M364646 | repository shared | not in our UI |
| a | gap-missing (feature) | label:M383118 | feature flag | not in our UI |
| a | gap-missing (feature) | label:M383242 | legacy database | not in our UI |
| a | gap-unshown (unshown) | label:R2206903 | Vercel | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R2206958 | Cloudflare | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R2207031 | Netlify | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R2207088 | Render | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R2207145 | Railway | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R2207202 | Fly.io | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R2207254 | AWS Amplify | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R2207318 | Heroku | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R2207376 | GitHub Pages | no catalogue state shows it |
| a | gap-missing (feature) | label:R9079981 | Run tab | not in our UI |
| a | gap-missing (feature) | label:R9080051 | to exit | not in our UI |
| a | gap-missing (feature) | label:R9080097 | Terminal panel | not in our UI |
| a | gap-unshown (unshown) | label:R9080270 | Commands | no catalogue state shows it |
| a | gap-missing (feature) | label:R9081765 | to select command | not in our UI |
| a | gap-missing (feature) | label:R9083009 | to select tab | COMP-04: not in our UI |
| a | gap-unshown (unshown) | label:R9278910 | Skills | COMP-06: no catalogue state shows it |
| a | gap-missing (feature) | label:R9301900 | add directory | not in our UI |
| a | gap-missing (feature) | label:R11644260 | flush local storage before shutdown | not in our UI |
| a | gap-missing (feature) | label:R11644447 | prepare restart | not in our UI |
| a | gap-missing (feature) | label:R11644517 | prepare terminal shutdown | not in our UI |
| a | gap-missing (feature) | label:R11644626 | flush local storage after terminal shutdown | not in our UI |
| a | gap-missing (feature) | label:R11644788 | restart Conductor | not in our UI |
| a | gap-missing (feature) | label:R11644907 | quit Conductor | not in our UI |
| a | gap-unshown (unshown) | aria_label:R8148495 | Select other response | no catalogue state shows it |
| a | gap-missing (feature) | aria_label:R9068829 | Loading preview | not in our UI |
| a | gap-unshown (unshown) | aria_label:R9734762 | Edit comment | REV-03: no catalogue state shows it |
| a | gap-unshown (unshown) | aria_label:R9735022 | Delete comment | REV-03: no catalogue state shows it |
| a | gap-missing (feature) | aria_label:R11269882 | Move preview URL up | not in our UI |
| a | gap-missing (feature) | aria_label:R11270077 | Move preview URL down | not in our UI |
| a | gap-missing (feature) | aria_label:R11270292 | Remove preview URL | not in our UI |
| a | gap-missing (feature) | aria_label:R11462165 | Clear create from selection | not in our UI |
| a | gap-missing (feature) | aria_label:R11613952 | Setup steps | not in our UI |
| a | gap-missing (feature) | placeholder:R8170318 | Select an option | not in our UI |
| a | gap-missing (feature) | placeholder:R11267721 | Add custom instructions for all agents working in this repo. | not in our UI |
| a | gap-unshown (unshown) | placeholder:R11389948 | Search shortcuts... | NAV-09: no catalogue state shows it |
| a | gap-unshown (unshown) | title:R10967435 | Select Conductor root directory | no catalogue state shows it |
| a | gap-missing (feature) | title:R10970126 | Browse for executable | not in our UI |
| a | gap-missing (feature) | title:R11264843 | Custom actions | RUN-02: not in our UI |
| a | gap-missing (feature) | title:R11266402 | Code review preferences | RUN-02: not in our UI |
| a | gap-missing (feature) | title:R11266590 | Create PR preferences | RUN-02: not in our UI |
| a | gap-missing (feature) | title:R11266781 | Fix errors preferences | RUN-02: not in our UI |
| a | gap-missing (feature) | title:R11266999 | Resolve conflicts preferences | not in our UI |
| a | gap-missing (feature) | title:R11267212 | Branch rename preferences | not in our UI |
| a | gap-unshown (unshown) | title:R11301147 | Appearance settings | SET-02: no catalogue state shows it |
| a | gap-missing (feature) | title:R11301365 | Claude Code harness | SET-02: not in our UI |
| a | gap-missing (feature) | title:R11301736 | Codex harness | SET-02: not in our UI |
| a | gap-missing (feature) | title:R11301935 | Cursor harness | not in our UI |
| a | gap-missing (feature) | title:R11302128 | Agent settings | not in our UI |
| a | gap-missing (feature) | title:R11302401 | Environment settings | not in our UI |
| a | gap-missing (feature) | title:R11302737 | Repository scripts | not in our UI |
| a | gap-missing (feature) | title:R11302969 | Big terminal settings | not in our UI |
| a | gap-missing (feature) | title:R11304233 | MCPs | not in our UI |
| a | gap-missing (feature) | title:R11399995 | Archive workspace? | Checked by hand: the wording differs. Ours reads "Archive workspace" (text) in command-palette. |
| a | gap-missing (feature) | title:R11624198 | Add a harness | not in our UI |
| a | gap-missing (feature) | title:R11624393 | Start a workspace | not in our UI |
| a | gap-missing (feature) | description:R11263033 | Choose which models you want to use | AGENT-16: not in our UI |
| a | gap-missing (feature) | description:R11266434 | Add custom instructions sent to the agent when you click the Review button. | RUN-02: not in our UI |
| a | gap-missing (feature) | description:R11266620 | Add custom instructions sent to the agent when you click the Create PR button. | RUN-02: not in our UI |
| a | gap-missing (feature) | description:R11266812 | Add custom instructions sent to the agent when you click the Fix errors button. | not in our UI |
| a | gap-missing (feature) | description:R11267037 | Add custom instructions sent to the agent when you click the Resolve conflicts button. | not in our UI |
| a | gap-missing (feature) | description:R11267246 | Add custom instructions for generating branch names from your messages. | not in our UI |
| a | gap-missing (feature) | description:R11300296 | Syntax highlighting theme for code and diffs. | SET-02: not in our UI |
| a | gap-missing (feature) | description:R11300941 | Font family and size for the terminal. | SET-02: not in our UI |
| a | gap-missing (feature) | description:R11301175 | Theme, typography, color, and editor appearance. | SET-02: not in our UI |
| a | gap-missing (feature) | description:R11301393 | Configure Claude Code authentication and behavior. | SET-02: not in our UI |
| a | gap-missing (feature) | description:R11301758 | Configure Codex authentication and behavior. | SET-02: not in our UI |
| a | gap-missing (feature) | description:R11301958 | Configure Cursor authentication and behavior. | not in our UI |
| a | gap-missing (feature) | description:R11302151 | Configure Claude Code, Codex, Cursor, and ACP agents. | not in our UI |
| a | gap-missing (feature) | description:R11302430 | Environment variables, files, and preview URLs. | not in our UI |
| a | gap-missing (feature) | description:R11302764 | Setup and archive scripts for the selected repository. | not in our UI |
| a | gap-missing (feature) | description:R11302999 | Configure the experimental center-pane terminal. | not in our UI |
| a | gap-missing (feature) | description:R11303660 | Configure personal and shared cloud environment variables. | not in our UI |
| a | gap-missing (feature) | description:R11303886 | Custom instructions for the Review, Create PR, and Resolve conflicts buttons. | not in our UI |
| a | gap-missing (feature) | description:R11304246 | Configure MCP servers for cloud workspaces. | not in our UI |
| a | gap-missing (feature) | description:R11400022 | Agents are still running in this workspace. Archiving will stop them and end any in-progress work. | not in our UI |
| a | gap-missing (feature) | description:R11624015 | Your cloud agents use your GitHub account to clone repos, push branches, and open pull requests. | not in our UI |
| a | gap-missing (feature) | description:R11624220 | Add at least one agent subscription or API key so your cloud workspaces can run agents. | not in our UI |
| a | gap-missing (feature) | description:R11624419 | Press ⌘N any time to open the dispatcher and put an agent to work. | not in our UI |
| a | gap-missing (feature) | toast:M367652 | Couldn't update Git to ignore your local settings file — it may not be excluded from commits | DATA-05: not in our UI |
| a | gap-unshown (unshown) | toast:M3686044 | Pulled latest changes. You're up to date! | GIT-06: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:M3686824 | Comment resolved on GitHub | REV-04: no catalogue state shows it |
| a | gap-missing (feature) | toast:M3691270 | Please check out a branch before renaming | GIT-09: not in our UI |
| a | gap-unshown (unshown) | toast:R629044 | Xcode license is not accepted | GIT-16: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R675642 | Image saved | CHAT-29: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R677318 | Copied image to clipboard | CHAT-29: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R677447 | Failed to copy to clipboard | CHAT-29: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R2213309 | Failed to attach continue context | GIT-17: no catalogue state shows it |
| a | gap-missing (feature) | toast:R5545832 | Couldn't remove workspace from section | NAV-04: not in our UI |
| a | gap-unshown (unshown) | toast:R5545905 | Couldn't move workspace | NAV-04: no catalogue state shows it |
| a | gap-missing (feature) | toast:R5547610 | Workspace created, but couldn't add it to the section. Move it from the sidebar. | WS-01: not in our UI |
| a | gap-unshown (unshown) | toast:R5554252 | No ready repository. Pick one to start this workspace. | WS-11: no catalogue state shows it |
| a | gap-missing (feature) | toast:R5555455 | Copied workspace info | not in our UI |
| a | gap-missing (feature) | toast:R5555506 | Failed to copy workspace info | not in our UI |
| a | gap-missing (feature) | toast:R5555688 | Copied workspace public URL | not in our UI |
| a | gap-missing (feature) | toast:R5555745 | Failed to copy workspace public URL | not in our UI |
| a | gap-missing (feature) | toast:R5563508 | Copied SSH command | CLOUD-12: not in our UI |
| a | gap-missing (feature) | toast:R5563556 | Failed to copy SSH command | CLOUD-12: not in our UI |
| a | gap-missing (feature) | toast:R8137573 | Failed to copy message | not in our UI |
| a | gap-unshown (unshown) | toast:R8156106 | Could not send answers. Try again. | CHAT-10: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R8191557 | Couldn't save snippet | COMP-09: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R8192988 | Couldn't delete snippet | COMP-09: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R9088088 | Couldn’t load saved model options | AGENT-17: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R9088384 | Some saved model options could not be loaded. Choose those options again. | AGENT-17: no catalogue state shows it |
| a | gap-missing (feature) | toast:R9100673 | Couldn't update agent credentials | CLOUD-18: not in our UI |
| a | gap-unshown (unshown) | toast:R9284738 | Attachments not available | COMP-07: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R9291600 | Failed to attach terminal output | COMP-04: no catalogue state shows it |
| a | gap-missing (feature) | toast:R9292765 | Couldn’t copy attachments into this workspace | PLAT-20: not in our UI |
| a | gap-unshown (unshown) | toast:R9294783 | Wait for attachments to finish processing. | COMP-07: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R9296109 | Codex goals are not available in this chat. | COMP-10: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R9299261 | This command isn't available in this workspace. | COMP-06: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R9299441 | Plan mode is not available in this chat. | COMP-06: no catalogue state shows it |
| a | gap-missing (feature) | toast:R9299633 | Session not found | not in our UI |
| a | gap-unshown (unshown) | toast:R9299687 | Enter a goal first. | COMP-10: no catalogue state shows it |
| a | gap-missing (feature) | toast:R9300528 | Configuration refreshed. | not in our UI |
| a | gap-unshown (unshown) | toast:R9300822 | No terminal output available for this workspace | COMP-04: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R9310207 | Failed to save PR context | COMP-05: no catalogue state shows it |
| a | gap-missing (feature) | toast:R9312315 | Failed to copy plan | not in our UI |
| a | gap-unshown (unshown) | toast:R9405672 | No messages in this chat | CHAT-26: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R9405805 | Failed to attach chat transcript | CHAT-26: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R9754440 | Failed to save conflict resolution | REV-11: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R10966069 | Conductor root path changed successfully | SET-02: no catalogue state shows it |
| a | gap-missing (feature) | toast:R11249174 | Could not open your loadout. Try again. | not in our UI |
| a | gap-missing (feature) | toast:R11262540 | Claude output style updated. New chats will use it; existing chats won’t change. | AGENT-16: not in our UI |
| a | gap-unshown (unshown) | toast:R11265782 | Failed to update spotlight testing | RUN-02: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R11290713 | Choose a PNG, JPEG, GIF, WebP, or SVG image | PRJ-05: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R11290828 | Image is too large. Choose one under 10MB. | PRJ-05: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R11291063 | Failed to set the icon. Try a different image. | PRJ-05: no catalogue state shows it |
| a | gap-missing (feature) | toast:R11298129 | Repository removed successfully | not in our UI |
| a | gap-unshown (unshown) | toast:R11392647 | An update check is already in progress. | APP-06: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R11404745 | Reverting to a turn is not supported yet. | CHAT-15: no catalogue state shows it |
| a | gap-missing (feature) | toast:R11405085 | Failed to attach revert context | REV-09: not in our UI |
| a | gap-unshown (unshown) | toast:R11472551 | Could not load that pull request | WS-02: no catalogue state shows it |
| a | gap-missing (feature) | toast:R11482621 | Cannot create workspace from this issue | PR-09: not in our UI |
| a | gap-unshown (unshown) | toast:R11482877 | No repository selected | WS-02: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R11500137 | Added to backlog | WS-11: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R11632289 | Invalid browser URL | PLAT-16: no catalogue state shows it |
| a | gap-missing (feature) | toast:R11647565 | GitHub isn't connected yet. Finish the sign-in and try again. | SET-02: not in our UI |
| a | gap-missing (feature) | toast:R11652358 | Thank you for your feedback! | APP-09: not in our UI |
| a | gap-unshown (unshown) | literal:R2202503 | Can't merge this stack yet | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R5545591 | Remove from section | NAV-08: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R5558100 | Mark as read | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R5558580 | Unpin | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R8137322 | Copied | APP-13: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9294532 | Set a goal | COMP-07: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9744963 | Previous comment | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9745476 | Next comment | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9755407 | SVG preview | REV-11: no catalogue state shows it |
| a | gap-missing (feature) | route:R11298182 | /settings/user/git | not in our UI |

### inventory-ui-text Chat and tool cards (77)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| a | gap-unshown (unshown) | text:R8047584 | Rendering diagram... | CHAT-24: no catalogue state shows it |
| a | gap-missing (feature) | text:R8047788 | Failed to render diagram | CHAT-24: not in our UI |
| a | gap-unshown (unshown) | text:R8049769 | Mermaid diagram | no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8061041 | Clear output | CHAT-23: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8750078 | Claude Code has to retry the file edit because of a bug in its permissions logic. Just a moment! | CHAT-08: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8750377 | Error | CHAT-08: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8754647 | Open in editor | CHAT-08: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8778272 | No todos | CHAT-09: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8779913 | Todo completed | CHAT-09: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8780546 | Todo started | CHAT-09: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8784090 | No tasks | CHAT-20: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8786178 | Task created | CHAT-20: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8789191 | Task details | CHAT-20: no catalogue state shows it |
| a | gap-missing (feature) | text:R8789608 | Loading task... | CHAT-20: not in our UI |
| a | gap-missing (feature) | text:R8791800 | Status: | not in our UI |
| a | gap-missing (feature) | text:R8792002 | Subject: | not in our UI |
| a | gap-missing (feature) | text:R8792236 | Blocked by: | not in our UI |
| a | gap-missing (feature) | text:R8792501 | Blocks: | not in our UI |
| a | gap-unshown (unshown) | text:R8795249 | Glob | CHAT-08: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8796070 | List files | CHAT-08: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8799662 | Enter plan mode | CHAT-12: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8799937 | Propose plan | CHAT-12: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8802449 | Formatted | CHAT-08: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8803962 | Skill activated | CHAT-08: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8806931 | Slash command | CHAT-08: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8807889 | User input | CHAT-08: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8811680 | Code review comments | CHAT-08: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8812957 | Workspace diff | CHAT-08: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8813616 | Review comments | CHAT-08: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8815338 | Get terminal output | CHAT-08: no catalogue state shows it |
| a | gap-missing (feature) | text:R8822048 | Failed to load image | CHAT-20: not in our UI |
| a | gap-unshown (unshown) | text:R8822365 | Loading image | CHAT-20: no catalogue state shows it |
| a | gap-missing (feature) | text:R8823423 | Purpose:  | not in our UI |
| a | gap-missing (feature) | text:R8824972 | To:  | CHAT-20: not in our UI |
| a | gap-unshown (unshown) | text:R8825965 | Node REPL | CHAT-20: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8831385 | Subagent | CHAT-08: no catalogue state shows it |
| a | gap-missing (feature) | text:R8833980 | Waiting for workspace | CLOUD-03: not in our UI |
| a | gap-missing (feature) | text:R8834124 | Error loading attachment | CLOUD-03: not in our UI |
| a | gap-unshown (unshown) | text:R9498625 | Visualization is outside the workspace: | CHAT-22: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R9498978 | Couldn’t load visualization | CHAT-22: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R8822100 | Preview image | CHAT-20: no catalogue state shows it |
| a | gap-unshown (unshown) | aria_label:R8060854 | Clear output | CHAT-08: no catalogue state shows it |
| a | gap-missing (feature) | aria_label:R8075890 | Seek | not in our UI |
| a | gap-missing (feature) | aria_label:R9494117 | Loading artifact | REV-10: not in our UI |
| a | gap-missing (feature) | title:M3792513 | Submit plan response | not in our UI |
| a | gap-missing (feature) | title:M3793241 | Select answer 1 | not in our UI |
| a | gap-missing (feature) | title:M3793390 | Select answer 2 | not in our UI |
| a | gap-missing (feature) | title:M3793539 | Select answer 3 | not in our UI |
| a | gap-missing (feature) | title:M3793688 | Select answer 4 | not in our UI |
| a | gap-missing (feature) | title:M3793837 | Select answer 5 | not in our UI |
| a | gap-missing (feature) | title:M3793986 | Select answer 6 | not in our UI |
| a | gap-missing (feature) | title:M3794135 | Select answer 7 | not in our UI |
| a | gap-missing (feature) | title:M3794284 | Select answer 8 | not in our UI |
| a | gap-missing (feature) | title:M3794433 | Select answer 9 | not in our UI |
| a | gap-unshown (unshown) | title:R8048580 | Expand diagram | CHAT-24: no catalogue state shows it |
| a | gap-unshown (unshown) | title:R8050707 | Reset view | no catalogue state shows it |
| a | gap-missing (feature) | title:R8062469 | Tip | not in our UI |
| a | gap-missing (feature) | title:R8062604 | Important | not in our UI |
| a | gap-missing (feature) | title:R8062746 | Warning | not in our UI |
| a | gap-missing (feature) | title:R8062882 | Caution | not in our UI |
| a | gap-unshown (unshown) | tooltip:R8048058 | Copy Mermaid source | CHAT-24: no catalogue state shows it |
| a | gap-unshown (unshown) | tooltip:R8800031 | Copy plan | CHAT-12: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R8730441 | Failed to save image | CHAT-29: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R8057713 | Stop command | CHAT-23: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R8768165 | Read image | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R8768197 | Reading | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R8798002 | Show less | NAV-05: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R8798014 | Show more | NAV-05: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R8816971 | Output: | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R8820980 | Generated image | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R8830609 | Do you want to run this command on your Mac? | CHAT-08: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R8830720 | Do you want to make these changes? | CHAT-08: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R8830802 | Do you want to run this agent? | CHAT-08: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R8830857 | Do you want to do this search? | CHAT-08: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R8830911 | Do you want to fetch this page? | CHAT-08: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R8830959 | Do you want to run this tool? | CHAT-08: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9482757 | Waiting for background task | no catalogue state shows it |

### inventory-ui-text Cloud (research only, no planned row yet) (106)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| a | gap-missing (feature) | text:R2556165 | Desktop | CLOUD-16: not in our UI |
| a | gap-unshown (unshown) | text:R2557374 | Edit before sending | REV-05: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R2978975 | Workspace initialization failed | WS-03: no catalogue state shows it |
| a | gap-missing (feature) | text:R2979610 | Setup did not start | WS-03: not in our UI |
| a | gap-unshown (unshown) | text:R2979782 | Detecting setup script... | WS-03: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R2980149 | Stopping setup script... | WS-03: no catalogue state shows it |
| a | gap-missing (feature) | text:R2980413 | Setup script failed — fix it? | WS-03: not in our UI |
| a | gap-unshown (unshown) | text:R2980653 | Cancelled setup script | WS-03: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R2982552 | Couldn’t load the logs. | no catalogue state shows it |
| a | gap-unshown (unshown) | text:R2982812 | No logs were recorded, or they have expired. | no catalogue state shows it |
| a | gap-unshown (unshown) | text:R2984256 | Recover prompt | WS-01: no catalogue state shows it |
| a | gap-missing (feature) | text:R2990037 | Reconnect | CLOUD-16: not in our UI |
| a | gap-missing (feature) | text:R2991628 | Cloud desktop | not in our UI |
| a | gap-missing (feature) | text:R4420842 | Start forwarding | CLOUD-09: not in our UI |
| a | gap-missing (feature) | text:R4421898 | Waiting for ports | CLOUD-09: not in our UI |
| a | gap-missing (feature) | text:R5584687 | Sync files | not in our UI |
| a | gap-missing (feature) | text:R5584915 | Keeps this cloud workspace's files mirrored to a local folder so local tools can inspect and edit them. | not in our UI |
| a | gap-missing (feature) | text:R5585079 | Changes continue syncing in the background while the switch is on. | not in our UI |
| a | gap-missing (feature) | text:R5587920 | Mirrors this cloud workspace to a local folder for local tools. | not in our UI |
| a | gap-missing (feature) | text:R5588145 | Local folder | not in our UI |
| a | gap-missing (feature) | text:R5589114 | Sync to a local directory | not in our UI |
| a | gap-missing (feature) | text:R5591397 | Sync failed | not in our UI |
| a | gap-missing (feature) | text:R5592461 | Internal sync error | not in our UI |
| a | gap-missing (feature) | text:R5623840 | Low disk | CLOUD-15: not in our UI |
| a | gap-missing (feature) | text:R9626830 | Downloads | CLOUD-11: not in our UI |
| a | gap-missing (feature) | text:R10976147 | Reset to auto-generated key | not in our UI |
| a | gap-unshown (unshown) | text:R10978033 | git push | no catalogue state shows it |
| a | gap-unshown (unshown) | text:R11097816 | Always approve | no catalogue state shows it |
| a | gap-missing (feature) | text:R11104016 | Learn more | not in our UI |
| a | gap-missing (feature) | label:R4397785 | Restored | APP-08: not in our UI |
| a | gap-missing (feature) | label:R4397900 | Starting | APP-08: not in our UI |
| a | gap-missing (feature) | label:R4398180 | Failed to start | APP-08: not in our UI |
| a | gap-missing (feature) | label:R4400634 | Using saved workspace snapshot | not in our UI |
| a | gap-missing (feature) | label:R4400746 | Sync failed | not in our UI |
| a | gap-missing (feature) | label:R4400952 | Syncing… | not in our UI |
| a | gap-missing (feature) | label:R4401198 | Copies files that are tracked in git | not in our UI |
| a | gap-missing (feature) | label:R4401280 | Sync files is off. Local files may be outdated. | not in our UI |
| a | gap-unshown (unshown) | label:R5600192 | Status | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R5629122 | Created | no catalogue state shows it |
| a | gap-missing (feature) | aria_label:R2990489 | Open cloud desktop | CLOUD-16: not in our UI |
| a | gap-missing (feature) | aria_label:R2991910 | Close cloud desktop | not in our UI |
| a | gap-missing (feature) | aria_label:R2996778 | Show message actions | not in our UI |
| a | gap-missing (feature) | aria_label:R4421044 | Start forwarding | CLOUD-09: not in our UI |
| a | gap-missing (feature) | aria_label:R4421815 | Waiting for ports | CLOUD-09: not in our UI |
| a | gap-missing (feature) | aria_label:R11083786 | Upload progress | not in our UI |
| a | gap-missing (feature) | aria_label:R11088269 | Edit photo | not in our UI |
| a | gap-missing (feature) | aria_label:R11090623 | Display name | not in our UI |
| a | gap-missing (feature) | placeholder:R10975212 | ~/.ssh/id_ed25519 | not in our UI |
| a | gap-missing (feature) | title:R2987505 | Waiting for workspace | CLOUD-03: not in our UI |
| a | gap-missing (feature) | title:R2987644 | Cloud desktop is available in cloud workspaces | CLOUD-16: not in our UI |
| a | gap-missing (feature) | title:R2990233 | Couldn't connect to the cloud desktop | CLOUD-16: not in our UI |
| a | gap-missing (feature) | title:R4405982 | Local terminal unavailable | CLOUD-11: not in our UI |
| a | gap-missing (feature) | title:R4407471 | Sync files is off | CLOUD-11: not in our UI |
| a | gap-missing (feature) | title:R4407601 | Sync folder unavailable | CLOUD-11: not in our UI |
| a | gap-missing (feature) | title:R4409943 | Sync files failed | CLOUD-11: not in our UI |
| a | gap-missing (feature) | title:R9608858 | This chat turn failed to render | CHAT-06: not in our UI |
| a | gap-missing (feature) | title:R9617731 | Error loading messages | not in our UI |
| a | gap-missing (feature) | title:R10975658 | Browse for SSH key | not in our UI |
| a | gap-missing (feature) | title:R10976627 | Select SSH private key | not in our UI |
| a | gap-missing (feature) | title:R11092223 | Account and integrations | not in our UI |
| a | gap-missing (feature) | title:R11099567 | SSH private key path | not in our UI |
| a | gap-missing (feature) | title:R11099826 | Remote execution MCP | CLOUD-14: not in our UI |
| a | gap-missing (feature) | title:R11100102 | Always allow local commands | CLOUD-14: not in our UI |
| a | gap-missing (feature) | title:R11100407 | Enable file sync in new cloud workspaces | CLOUD-11: not in our UI |
| a | gap-missing (feature) | title:R11103087 | Use default internal and experimental settings | not in our UI |
| a | gap-missing (feature) | title:R11106695 | Use legacy file preview and editing | not in our UI |
| a | gap-missing (feature) | tooltip:R2973448 | Copy logs | not in our UI |
| a | gap-missing (feature) | tooltip:R5588285 | Copy sync folder path | not in our UI |
| a | gap-missing (feature) | tooltip:R5591578 | Copy sync error | not in our UI |
| a | gap-missing (feature) | tooltip:R5592527 | Copy internal sync error | not in our UI |
| a | gap-missing (feature) | description:R2990279 | Try again to start a new connection. | CLOUD-16: not in our UI |
| a | gap-missing (feature) | description:R4406017 | Sync files needs to be ready before this terminal starts. | CLOUD-11: not in our UI |
| a | gap-missing (feature) | description:R4407497 | Runs against a synced copy on your Mac. | CLOUD-11: not in our UI |
| a | gap-missing (feature) | description:R4407633 | The local sync folder was removed. Sync files will recreate it when it resumes. | CLOUD-11: not in our UI |
| a | gap-missing (feature) | description:R4409379 | The workspace is not ready yet. | CLOUD-11: not in our UI |
| a | gap-missing (feature) | description:R4409969 | The local terminal cannot start until Sync files recovers. | CLOUD-11: not in our UI |
| a | gap-missing (feature) | description:R4410270 | Restart sync to recreate the local folder. | CLOUD-11: not in our UI |
| a | gap-unshown (unshown) | description:R9608898 | Other turns are still available. | CHAT-06: no catalogue state shows it |
| a | gap-missing (feature) | description:R11099596 | Use your own SSH key for cloud workspace access. Leave empty to auto-generate a key. | not in our UI |
| a | gap-missing (feature) | description:R11099855 | Let remote agents request approved one-shot commands on this Mac. Each command still requires your approval. | not in our UI |
| a | gap-missing (feature) | description:R11100138 | Run local commands from remote agents without asking. Turned on when you choose Yes always on a local command approval. | not in our UI |
| a | gap-missing (feature) | description:R11103142 | Internal setting. Makes Conductor behave as if internal and experimental settings are set to their defaults without changing saved values. | not in our UI |
| a | gap-missing (feature) | toast:R2976926 | No active session to attach setup logs to | WS-03: not in our UI |
| a | gap-unshown (unshown) | toast:R2977083 | Failed to attach setup logs | WS-03: no catalogue state shows it |
| a | gap-missing (feature) | toast:R2984332 | Failed to copy prompt | WS-01: not in our UI |
| a | gap-missing (feature) | toast:R2984388 | Copied prompt to clipboard | WS-01: not in our UI |
| a | gap-unshown (unshown) | toast:R2985423 | Setup script failed | WS-03: no catalogue state shows it |
| a | gap-missing (feature) | toast:R2994853 | Couldn't send message | CHAT-02: not in our UI |
| a | gap-missing (feature) | toast:R5643180 | No workspace selected to archive | not in our UI |
| a | gap-missing (feature) | toast:R9626762 | Could not open Downloads. Try again. | CLOUD-11: not in our UI |
| a | gap-missing (feature) | toast:R11086629 | Select an area of the photo first. | not in our UI |
| a | gap-missing (feature) | toast:R11087057 | Profile photo updated. | not in our UI |
| a | gap-missing (feature) | toast:R11088975 | Choose a JPEG, PNG, or WebP image. | not in our UI |
| a | gap-missing (feature) | toast:R11089075 | Choose a photo smaller than 10 MB. | not in our UI |
| a | gap-missing (feature) | toast:R11089522 | Could not open that photo. | not in our UI |
| a | gap-missing (feature) | toast:R11090181 | Display name updated. | not in our UI |
| a | gap-missing (feature) | toast:R11090230 | Could not update display name. Try again. | not in our UI |
| a | gap-missing (feature) | toast:R11090392 | Enter a display name. | not in our UI |
| a | gap-missing (feature) | toast:R11090450 | Display names can be at most 100 characters. | not in our UI |
| a | gap-unshown (unshown) | literal:R2557248 | Get an AI code review | REV-05: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2972645 | Show | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R5601737 | Unavailable | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R11088872 | Images | no catalogue state shows it |
| a | gap-missing (feature) | route:R2983757 | /settings/user/providers | WS-01: not in our UI |
| a | gap-missing (feature) | test_id:R2987806 | virtual-desktop-surface | not in our UI |
| a | gap-missing (feature) | test_id:R5587249 | remote-file-sync-button | not in our UI |

### inventory-ui-text Git, review and files (34)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| a | gap-missing (feature) | text:R2184278 | View PR status | not in our UI |
| a | gap-unshown (unshown) | text:R2186426 | Switch branch? | PR-08: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R2186860 | Switch anyway | PR-08: no catalogue state shows it |
| a | gap-missing (feature) | text:R2213837 | Continue on a new branch with the same chats | GIT-17: not in our UI |
| a | gap-missing (feature) | text:R2224224 | Checks pending... | not in our UI |
| a | gap-missing (feature) | text:R3983808 | Switch to | not in our UI |
| a | gap-unshown (unshown) | text:R4005057 | Loading artifacts… | REV-10: no catalogue state shows it |
| a | gap-missing (feature) | text:R4005165 | Some files couldn’t be included. | REV-10: not in our UI |
| a | gap-unshown (unshown) | text:R4008336 | Select working directories | COMP-04: no catalogue state shows it |
| a | gap-missing (feature) | text:R4011003 | Import details | not in our UI |
| a | gap-missing (feature) | label:R3977413 | Code changes | not in our UI |
| a | gap-unshown (unshown) | label:R3978313 | Closed | no catalogue state shows it |
| a | gap-missing (feature) | aria_label:R3983288 | Branch options | not in our UI |
| a | gap-unshown (unshown) | aria_label:R3991063 | Upload files | REV-10: no catalogue state shows it |
| a | gap-unshown (unshown) | aria_label:R4004238 | Loading artifacts | REV-10: no catalogue state shows it |
| a | gap-missing (feature) | title:R3975899 | Preview unavailable. Open the file to try again. | not in our UI |
| a | gap-unshown (unshown) | title:R3989871 | Preview URL | CLOUD-09: no catalogue state shows it |
| a | gap-missing (feature) | title:R3990668 | Forwarded port | not in our UI |
| a | gap-unshown (unshown) | title:R3991091 | Upload files | REV-10: no catalogue state shows it |
| a | gap-missing (feature) | toast:R3992715 | File picker is not available on this device | not in our UI |
| a | gap-unshown (unshown) | literal:R2180430 | Open in Linear | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2180468 | Open in Graphite | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2182206 | Copy number | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2195770 | Needs rebase | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2195902 | Not ready | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2195969 | Blocked downstack | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2215964 | Connecting | CHAT-23: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2216204 | Stopped | CHAT-23: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2216274 | Deleted | CHAT-23: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2216298 | Unknown | CHAT-23: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2223970 | View checks | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2224794 | Disable auto-merge | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2226671 | Merge stack | GIT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R4011805 | Checking… | no catalogue state shows it |

### inventory-ui-text Projects and workspaces (25)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| a | gap-missing (feature) | text:R1944728 | ✔️ | not in our UI |
| a | gap-unshown (unshown) | text:R1957512 | Create a private GitHub repo? | PRJ-03: no catalogue state shows it |
| a | gap-missing (feature) | text:R1957806 | git init | PRJ-03: not in our UI |
| a | gap-unshown (unshown) | text:R1959093 | Owner | no catalogue state shows it |
| a | gap-missing (feature) | text:R1960086 | Open GitHub settings | PRJ-03: not in our UI |
| a | gap-unshown (unshown) | text:R1960727 | Repository name | PRJ-03: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R1961386 | Loading GitHub owners... | PRJ-03: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R1961474 | Repository name must include letters or numbers. | PRJ-03: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R1961592 | Couldn't check repository availability. | PRJ-03: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R1961706 | Checking repository availability... | PRJ-03: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R1961805 | This repository already exists. | PRJ-03: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R1961905 | Repository name is available. | PRJ-03: no catalogue state shows it |
| a | gap-missing (feature) | text:R10179244 | Docs | Checked by hand: not a match. Ours shows the sample value "docs" in git-files, which is data, not this wording. |
| a | gap-missing (feature) | text:R10179596 | Best practices | not in our UI |
| a | gap-missing (feature) | text:R10179959 | Changelog | not in our UI |
| a | gap-missing (feature) | text:R10180754 | Discord | not in our UI |
| a | gap-missing (feature) | text:R10181093 | Submit a prompt | not in our UI |
| a | gap-unshown (unshown) | text:R10181424 | Diagnostics | no catalogue state shows it |
| a | gap-unshown (unshown) | aria_label:R1959218 | Owner | no catalogue state shows it |
| a | gap-missing (feature) | placeholder:R1959277 | Select an owner | not in our UI |
| a | gap-missing (feature) | placeholder:R10182992 | Search... | Checked by hand: the wording differs. Ours reads "Search" (text) in first-run. |
| a | gap-missing (feature) | placeholder:R10189388 | Select repo | not in our UI |
| a | gap-missing (feature) | placeholder:R10195168 | Describe what you want to build | WS-01: not in our UI |
| a | gap-missing (feature) | route:R1960039 | /settings/user/account | PRJ-03: not in our UI |
| a | gap-unshown (unshown) | route:R10181173 | /diagnostics | no catalogue state shows it |

### inventory-ui-text Settings and agents (43)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| a | gap-missing (feature) | text:R10982001 | Checking | not in our UI |
| a | gap-missing (feature) | text:R10985659 | This version can return empty ACP turns in Conductor. | SET-03: not in our UI |
| a | gap-unshown (unshown) | text:R11028395 | Repository not found | PLAT-16: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R11048106 | That doesn't look like a GitHub token. Are you sure? | PR-01: no catalogue state shows it |
| a | gap-missing (feature) | text:R11570220 | Connected with a setup token. | SET-03: not in our UI |
| a | gap-unshown (unshown) | text:R11570668 | Paste code from Claude | SET-03: no catalogue state shows it |
| a | gap-missing (feature) | text:R11571676 | claude setup-token | SET-03: not in our UI |
| a | gap-missing (feature) | text:R11574947 | Sign-in expired. | not in our UI |
| a | gap-unshown (unshown) | text:R11585847 | Bedrock API key | SET-09: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R11587101 | Use the key from this Mac | SET-09: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R11590939 | Custom provider | SET-09: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R11595958 | Workspace ID (optional) | no catalogue state shows it |
| a | gap-missing (feature) | text:R11601498 | Manual | not in our UI |
| a | gap-missing (feature) | label:R10992153 | Cursor API key | SET-09: not in our UI |
| a | gap-missing (feature) | label:R11001202 | Anthropic API key | SET-09: not in our UI |
| a | gap-missing (feature) | label:R11004561 | ChatGPT account | SET-09: not in our UI |
| a | gap-missing (feature) | label:R11006264 | OpenAI API key | SET-09: not in our UI |
| a | gap-unshown (unshown) | label:R11433415 | Copy image | CHAT-29: no catalogue state shows it |
| a | gap-missing (feature) | label:R11571757 | Claude Code subscription | SET-09: not in our UI |
| a | gap-unshown (unshown) | label:R11585934 | Bedrock API key | SET-09: no catalogue state shows it |
| a | gap-missing (feature) | placeholder:R11570753 | Paste here | SET-03: not in our UI |
| a | gap-unshown (unshown) | title:R10994173 | Codex config | SET-12: no catalogue state shows it |
| a | gap-missing (feature) | title:R11006890 | Codex personality for new chats | SET-09: not in our UI |
| a | gap-missing (feature) | title:R11057103 | gh CLI auth | not in our UI |
| a | gap-unshown (unshown) | title:R11415905 | Slash commands | SET-08: no catalogue state shows it |
| a | gap-unshown (unshown) | title:R11416042 | Skills | COMP-06: no catalogue state shows it |
| a | gap-missing (feature) | title:R11425962 | Restore to new branch? | not in our UI |
| a | gap-missing (feature) | title:R11591831 | Subscription | SET-09: not in our UI |
| a | gap-unshown (unshown) | title:R11594431 | Custom provider | SET-09: no catalogue state shows it |
| a | gap-unshown (unshown) | tooltip:R11579984 | Copy command | no catalogue state shows it |
| a | gap-missing (feature) | description:R11006930 | Style to use when a new chat starts with a Codex model | SET-09: not in our UI |
| a | gap-missing (feature) | description:R11415794 | Agent tool server definitions. | SET-08: not in our UI |
| a | gap-missing (feature) | description:R11415928 | Direct slash command prompt files. | SET-08: not in our UI |
| a | gap-missing (feature) | description:R11416057 | Reusable skill folders with SKILL.md files. | SET-08: not in our UI |
| a | gap-unshown (unshown) | toast:R10998780 | API key imported from env | SET-03: no catalogue state shows it |
| a | gap-missing (feature) | toast:R11014233 | Action names must be unique | not in our UI |
| a | gap-unshown (unshown) | toast:R11050680 | Couldn't refresh GitHub | PR-01: no catalogue state shows it |
| a | gap-missing (feature) | toast:R11050766 | Some GitHub details couldn't be updated | PR-01: not in our UI |
| a | gap-missing (feature) | toast:R11429681 | Update Conductor to equip this loadout. | not in our UI |
| a | gap-missing (feature) | toast:R11429745 | Some models in this loadout need a newer version of Conductor. | not in our UI |
| a | gap-missing (feature) | toast:R11431112 | Loadout equipped | not in our UI |
| a | gap-unshown (unshown) | toast:R11583093 | Enter all required Bedrock fields. | SET-03: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R11034934 | Disconnect GitHub? | no catalogue state shows it |

### inventory-ui-text Shortcuts (1)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| a | gap-missing (feature) | title:M3781724 | Protect page from select all | not in our UI |

### inventory-ui-text Terminal, run and files (28)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| a | gap-unshown (unshown) | placeholder:R4379343 | Find | no catalogue state shows it |
| a | gap-missing (feature) | title:M3799889 | Save routine | not in our UI |
| a | gap-missing (feature) | title:M3800221 | Open code editor search | not in our UI |
| a | gap-missing (feature) | title:M3801366 | Play or pause | not in our UI |
| a | gap-missing (feature) | title:M3801514 | Back 10 seconds | not in our UI |
| a | gap-missing (feature) | title:M3801662 | Forward 10 seconds | not in our UI |
| a | gap-missing (feature) | title:M3801856 | Previous frame | not in our UI |
| a | gap-missing (feature) | title:M3802039 | Next frame | not in our UI |
| a | gap-missing (feature) | title:M3802186 | Decrease playback speed | not in our UI |
| a | gap-missing (feature) | title:M3802346 | Increase playback speed | not in our UI |
| a | gap-missing (feature) | title:M3802500 | Mute or unmute | not in our UI |
| a | gap-missing (feature) | title:M3802657 | Toggle fullscreen | not in our UI |
| a | gap-missing (feature) | title:M3802979 | New terminal tab | not in our UI |
| a | gap-missing (feature) | title:M3805156 | Next onboarding slide | not in our UI |
| a | gap-missing (feature) | title:M3805321 | Continue onboarding | not in our UI |
| a | gap-missing (feature) | title:M3805477 | Continue cloud onboarding | not in our UI |
| a | gap-missing (feature) | title:M3805636 | Select menu item 1 | not in our UI |
| a | gap-missing (feature) | title:M3805769 | Select menu item 2 | not in our UI |
| a | gap-missing (feature) | title:M3805902 | Select menu item 3 | not in our UI |
| a | gap-missing (feature) | title:M3806035 | Select menu item 4 | not in our UI |
| a | gap-missing (feature) | title:M3806168 | Select menu item 5 | not in our UI |
| a | gap-missing (feature) | title:M3806301 | Select menu item 6 | not in our UI |
| a | gap-missing (feature) | title:M3806434 | Select menu item 7 | not in our UI |
| a | gap-missing (feature) | title:M3806567 | Select menu item 8 | not in our UI |
| a | gap-missing (feature) | title:M3806700 | Select menu item 9 | not in our UI |
| a | gap-missing (feature) | title:R4363426 | Open link? | not in our UI |
| a | gap-missing (feature) | description:M3799728 | Shows changes that have not been committed. | not in our UI |
| a | gap-unshown (unshown) | literal:R4381706 | Tabs | no catalogue state shows it |

### Overlays and panels (170)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| b | ours-only | command-palette, feedback-dialog, scripts-run, scripts-run-ended | 3 tool calls, 2 messages | span text: [data-testid="virtuoso-item-list"] > div > div > button > span > span:nth-of-type(1) |
| b | ours-only | command-palette, feedback-dialog, scripts-run, scripts-run-ended | ⌘L to focus | div text: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(6) > div > |
| b | ours-only | command-palette, file-viewer-missing, scripts-run, scripts-run-ended | 5files changed | span text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div:nth-of-type(1) > span:nth-of-type(1) |
| b | ours-only | command-palette, command-palette, file-viewer-missing, file-viewer-missing, scripts-run, scripts-run, scripts-run-ended, scripts-run-ended | added | span text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div:nth-of-type(2) > div > div:nth-of-type(1) > div > s |
| b | ours-only | command-palette, command-palette, file-viewer-missing, file-viewer-missing, scripts-run, scripts-run, scripts-run-ended, scripts-run-ended | modified | span text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div:nth-of-type(2) > div > div:nth-of-type(2) > div > s |
| b | ours-only | command-palette, feedback-dialog, file-viewer, file-viewer-missing, scripts-run, scripts-run-ended | Dev | span text: [data-testid="scripts-panel"] > div > div > div > div:nth-of-type(2) > div:nth-of-type(2) > div > div:nth-of-type(1) > button:nth-of-type(1) > span |
| b | ours-only | command-palette | Open chat | span text: div:nth-of-type(3) > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div:nth-of-type(2) > div > span:nth-of-type(2) |
| b | ours-only | command-palette | /Users/sam/code/atlas | span text: div:nth-of-type(3) > div > div:nth-of-type(3) > div > div:nth-of-type(3) > div:nth-of-type(2) > div:nth-of-type(1) > span:nth-of-type(2) |
| b | ours-only | command-palette | /Users/sam/code/relay | span text: div:nth-of-type(3) > div > div:nth-of-type(3) > div > div:nth-of-type(3) > div:nth-of-type(2) > div:nth-of-type(2) > span:nth-of-type(2) |
| b | ours-only | command-palette | Link pull request | span text: div:nth-of-type(3) > div > div:nth-of-type(3) > div > div:nth-of-type(4) > div:nth-of-type(2) > div:nth-of-type(7) > span:nth-of-type(1) |
| b | ours-only | command-palette | Switch tabs | span text: div:nth-of-type(3) > div > div:nth-of-type(4) > span:nth-of-type(1) |
| b | ours-only | command-palette | Choose | span text: div:nth-of-type(3) > div > div:nth-of-type(4) > span:nth-of-type(2) |
| b | ours-only | command-palette, feedback-dialog, file-viewer, file-viewer-missing, scripts-run, scripts-run-ended | Sidebar | aside aria-label: [data-testid="sidebar"] > div > aside |
| b | ours-only | command-palette, feedback-dialog, file-viewer, file-viewer-missing, scripts-run, scripts-run-ended | Main | nav aria-label: [data-testid="sidebar"] > div > aside > div:nth-of-type(2) > div > nav |
| b | ours-only | command-palette, command-palette, feedback-dialog, feedback-dialog, file-viewer, file-viewer, file-viewer-missing, file-viewer-missing, scripts-run, scripts-run | Create workspace in atlas | link aria-label: [data-testid="sidebar"] > div > aside > div:nth-of-type(2) > div > div:nth-of-type(1) > div > section:nth-of-type(1) > div > div:nth-of-type(1) |
| b | ours-only | command-palette, command-palette, feedback-dialog, feedback-dialog, file-viewer, file-viewer, file-viewer-missing, file-viewer-missing, scripts-run, scripts-run | Create workspace in relay | link aria-label: [data-testid="sidebar"] > div > aside > div:nth-of-type(2) > div > div:nth-of-type(1) > div > section:nth-of-type(2) > div > div:nth-of-type(1) |
| b | ours-only | command-palette, feedback-dialog, file-viewer, file-viewer-missing, scripts-run, scripts-run-ended | atlas icon | img aria-label: [data-testid="main-content"] > div > div > div:nth-of-type(1) > div > div > div:nth-of-type(1) > span:nth-of-type(1) |
| b | ours-only | command-palette, feedback-dialog, scripts-run, scripts-run-ended | Expand 3 tool calls, 2 messages | button aria-label: [data-testid="virtuoso-item-list"] > div > div > button |
| b | ours-only | command-palette, feedback-dialog, scripts-run, scripts-run-ended | Turn details | button aria-label: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(3) > button |
| b | ours-only | command-palette, feedback-dialog, scripts-run, scripts-run-ended | Files changed in this turn | section aria-label: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(3) > section |
| b | ours-only | command-palette, feedback-dialog, scripts-run, scripts-run-ended | Modified: src/auth/sign-in.ts | button title: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(3) > section > button:nth-of-type(1) |
| b | ours-only | command-palette, feedback-dialog, scripts-run, scripts-run-ended | Added: src/auth/safe-next.ts | button title: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(3) > section > button:nth-of-type(2) |
| b | ours-only | command-palette, feedback-dialog, scripts-run, scripts-run-ended | Added: src/auth/safe-next.test.ts | button title: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(3) > section > button:nth-of-type(3) |
| b | ours-only | command-palette, feedback-dialog, scripts-run, scripts-run-ended | composer | textbox aria-label: [data-testid="composer-editor"] > div > div |
| b | ours-only | command-palette, feedback-dialog, scripts-run, scripts-run-ended | Model picker | button aria-label: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(6 |
| b | ours-only | command-palette, feedback-dialog, scripts-run, scripts-run-ended | Claude Code: change agent | button title: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(6) > d |
| b | ours-only | command-palette, feedback-dialog, file-viewer, file-viewer-missing, scripts-run, scripts-run-ended | Changes and scripts | aside aria-label: [data-testid="right-panel"] > div > aside |
| b | ours-only | command-palette, feedback-dialog, file-viewer, file-viewer-missing, scripts-run, scripts-run-ended | Review options | button aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > button:nth-of-type(2) |
| b | ours-only | command-palette, feedback-dialog, file-viewer-missing, scripts-run, scripts-run-ended | Search changed files | button aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(1) > button:nth-of-type(1) |
| b | ours-only | command-palette, feedback-dialog, file-viewer-missing, scripts-run, scripts-run-ended | Diff scope | button aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(1) > button:nth-of-type(3) |
| b | ours-only | command-palette, file-viewer-missing, scripts-run, scripts-run-ended | Changed files | grid aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div:nth-of-type(2) |
| b | ours-only | command-palette, feedback-dialog, file-viewer, file-viewer-missing, scripts-run, scripts-run-ended | Collapse panel | button aria-label: [data-testid="scripts-panel"] > div > div > div > div:nth-of-type(1) > button:nth-of-type(1) |
| b | ours-only | command-palette, feedback-dialog, file-viewer, file-viewer-missing, scripts-run, scripts-run-ended | No preview URL yet | button title: [data-testid="scripts-panel"] > div > div > div > div:nth-of-type(2) > div:nth-of-type(2) > div > div:nth-of-type(1) > div > button:nth-of-type(1) |
| b | ours-only | feedback-dialog | The repository settings are still loading. Try again in a moment. | p text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > section > p |
| b | ours-only | feedback-dialog | Attach images | span text: div:nth-of-type(3) > form > div:nth-of-type(4) > button:nth-of-type(1) > span |
| b | ours-only | feedback-dialog | Loading git state | status aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(1) |
| b | ours-only | file-viewer | Workspace files | tree aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) |
| b | ours-only | file-viewer | Expand docs | button aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div > div:nth-of-type(1) > div > button |
| b | ours-only | file-viewer | Changed | img aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div > div:nth-of-type(1) > div > span:nth-of-type( |
| b | ours-only | file-viewer | Changed from the target branch | img title: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div > div:nth-of-type(1) > div > span:nth-of-type(3) |
| b | ours-only | file-viewer | Expand http | button aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div > div:nth-of-type(8) > div > button |
| b | ours-only | file-viewer-missing, file-viewer-missing | This file was deleted, so there is nothing to edit. | note text: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(1) > p |
| b | ours-only | file-viewer-missing, file-viewer-missing | Couldn't load this file | heading text: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > section > h2 |
| b | ours-only | file-viewer-missing | fatal: path 'src/auth/old-login.ts' does not exist | p text: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > section > p |
| b | ours-only | scripts-run-ended | Shell exited with status 0. | p text: div > div > div:nth-of-type(3) > div > div > div:nth-of-type(2) > div:nth-of-type(1) > p |

### Pages (98)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| b | ours-only | home, home-no-match, home-archived, home-projects-menu, home-archive-menu, home-sort-menu, home-display-menu, new-workspace, new-workspace-project-menu, create- | Sidebar | aside aria-label: [data-testid="sidebar"] > div > aside |
| b | ours-only | home, home-no-match, home-archived, home-projects-menu, home-archive-menu, home-sort-menu, home-display-menu, new-workspace, new-workspace-project-menu, create- | Main | nav aria-label: [data-testid="sidebar"] > div > aside > div:nth-of-type(2) > div > nav |
| b | ours-only | home, home, home-no-match, home-no-match, home-archived, home-archived, home-projects-menu, home-projects-menu, home-archive-menu, home-archive-menu, home-sort- | Create workspace in atlas | link aria-label: [data-testid="sidebar"] > div > aside > div:nth-of-type(2) > div > div:nth-of-type(1) > div > section:nth-of-type(1) > div > div:nth-of-type(1) |
| b | ours-only | home, home, home-no-match, home-no-match, home-archived, home-archived, home-projects-menu, home-projects-menu, home-archive-menu, home-archive-menu, home-sort- | Create workspace in relay | link aria-label: [data-testid="sidebar"] > div > aside > div:nth-of-type(2) > div > div:nth-of-type(1) > div > section:nth-of-type(2) > div > div:nth-of-type(1) |
| b | ours-only | home-no-match | Try a different search, or clear the filters to see everything. | p text: [data-testid="main-content"] > div > main > div > div > div > div > p |
| b | ours-only | new-workspace, new-workspace, new-workspace-project-menu, new-workspace-project-menu, create-project, create-project | First message | label text: div:nth-of-type(3) > form > div > label |
| b | ours-only | new-workspace, new-workspace-project-menu, create-project | Project: atlas | button aria-label: div:nth-of-type(3) > form > header > button:nth-of-type(1) |
| b | ours-only | new-workspace, new-workspace-project-menu, create-project | More options | button aria-label: div:nth-of-type(3) > form > header > button:nth-of-type(2) |
| b | ours-only | new-workspace, new-workspace-project-menu, create-project | Model picker | button aria-label: div:nth-of-type(3) > form > footer > button:nth-of-type(1) |
| b | ours-only | new-workspace, new-workspace-project-menu, create-project | Claude Code: change agent | button title: div:nth-of-type(3) > form > footer > button:nth-of-type(1) |
| b | ours-only | new-workspace, new-workspace-project-menu, create-project | Plan mode and more | button title: div:nth-of-type(3) > form > footer > button:nth-of-type(2) |
| b | ours-only | new-workspace-project-menu | ~/code/atlas | span text: div:nth-of-type(4) > div > div:nth-of-type(5) > span:nth-of-type(2) |
| b | ours-only | new-workspace-project-menu | ~/code/relay | span text: div:nth-of-type(4) > div > div:nth-of-type(6) > span:nth-of-type(2) |
| b | ours-only | create-project | gstack | span text: div:nth-of-type(5) > div:nth-of-type(1) > fieldset > div > button:nth-of-type(3) > span:nth-of-type(3) > span:nth-of-type(1) |
| b | ours-only | backlog | atlas · Unstarted | span text: [data-testid="main-content"] > div > main > div > ul > li:nth-of-type(1) > div > button:nth-of-type(1) > span:nth-of-type(2) |

### Pull request header (219)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| b | ours-only | pr-none, pr-loading, pr-open, pr-draft, pr-failing, pr-ready, pr-merged | 3 tool calls, 2 messages | span text: [data-testid="virtuoso-item-list"] > div > div > button > span > span:nth-of-type(1) |
| b | ours-only | pr-none, pr-loading, pr-open, pr-draft, pr-failing, pr-ready, pr-merged | ⌘L to focus | div text: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(6) > div > |
| b | ours-only | pr-none, pr-loading, pr-open, pr-draft, pr-failing, pr-ready, pr-merged | 3files changed | span text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div:nth-of-type(1) > span:nth-of-type(1) |
| b | ours-only | pr-none, pr-none, pr-loading, pr-loading, pr-open, pr-open, pr-draft, pr-draft, pr-failing, pr-failing, pr-ready, pr-ready, pr-merged, pr-merged | added | span text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div:nth-of-type(2) > div > div:nth-of-type(1) > div > s |
| b | ours-only | pr-none, pr-none, pr-loading, pr-loading, pr-open, pr-open, pr-draft, pr-draft, pr-failing, pr-failing, pr-ready, pr-ready, pr-merged, pr-merged | modified | span text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div:nth-of-type(2) > div > div:nth-of-type(3) > div > s |
| b | ours-only | pr-none, pr-loading, pr-open, pr-draft, pr-failing, pr-ready, pr-merged | Dev | span text: [data-testid="scripts-panel"] > div > div > div > div:nth-of-type(2) > div:nth-of-type(2) > div > div:nth-of-type(1) > button:nth-of-type(1) > span |
| b | ours-only | pr-none, pr-loading, pr-open, pr-draft, pr-failing, pr-ready, pr-merged | Sidebar | aside aria-label: [data-testid="sidebar"] > div > aside |
| b | ours-only | pr-none, pr-loading, pr-open, pr-draft, pr-failing, pr-ready, pr-merged | Main | nav aria-label: [data-testid="sidebar"] > div > aside > div:nth-of-type(2) > div > nav |
| b | ours-only | pr-none, pr-none, pr-loading, pr-loading, pr-open, pr-open, pr-draft, pr-draft, pr-failing, pr-failing, pr-ready, pr-ready, pr-merged, pr-merged | Create workspace in atlas | link aria-label: [data-testid="sidebar"] > div > aside > div:nth-of-type(2) > div > div:nth-of-type(1) > div > section:nth-of-type(1) > div > div:nth-of-type(1) |
| b | ours-only | pr-none, pr-none, pr-loading, pr-loading, pr-open, pr-open, pr-draft, pr-draft, pr-failing, pr-failing, pr-ready, pr-ready, pr-merged, pr-merged | Create workspace in relay | link aria-label: [data-testid="sidebar"] > div > aside > div:nth-of-type(2) > div > div:nth-of-type(1) > div > section:nth-of-type(2) > div > div:nth-of-type(1) |
| b | ours-only | pr-none, pr-loading, pr-open, pr-draft, pr-failing, pr-ready, pr-merged | atlas icon | img aria-label: [data-testid="main-content"] > div > div > div:nth-of-type(1) > div > div > div:nth-of-type(1) > span:nth-of-type(1) |
| b | ours-only | pr-none, pr-loading, pr-open, pr-draft, pr-failing, pr-ready, pr-merged | Expand 3 tool calls, 2 messages | button aria-label: [data-testid="virtuoso-item-list"] > div > div > button |
| b | ours-only | pr-none, pr-loading, pr-open, pr-draft, pr-failing, pr-ready, pr-merged | Turn details | button aria-label: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(3) > button |
| b | ours-only | pr-none, pr-loading, pr-open, pr-draft, pr-failing, pr-ready, pr-merged | Files changed in this turn | section aria-label: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(3) > section |
| b | ours-only | pr-none, pr-loading, pr-open, pr-draft, pr-failing, pr-ready, pr-merged | Modified: src/auth/sign-in.ts | button title: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(3) > section > button:nth-of-type(1) |
| b | ours-only | pr-none, pr-loading, pr-open, pr-draft, pr-failing, pr-ready, pr-merged | Added: src/auth/safe-next.ts | button title: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(3) > section > button:nth-of-type(2) |
| b | ours-only | pr-none, pr-loading, pr-open, pr-draft, pr-failing, pr-ready, pr-merged | Added: src/auth/safe-next.test.ts | button title: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(3) > section > button:nth-of-type(3) |
| b | ours-only | pr-none, pr-loading, pr-open, pr-draft, pr-failing, pr-ready, pr-merged | composer | textbox aria-label: [data-testid="composer-editor"] > div > div |
| b | ours-only | pr-none, pr-loading, pr-open, pr-draft, pr-failing, pr-ready, pr-merged | Model picker | button aria-label: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(6 |
| b | ours-only | pr-none, pr-loading, pr-open, pr-draft, pr-failing, pr-ready, pr-merged | Claude Code: change agent | button title: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(6) > d |
| b | ours-only | pr-none, pr-loading, pr-open, pr-draft, pr-failing, pr-ready, pr-merged | Changes and scripts | aside aria-label: [data-testid="right-panel"] > div > aside |
| b | ours-only | pr-none, pr-loading, pr-open, pr-draft, pr-failing, pr-ready, pr-merged | Review options | button aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > button:nth-of-type(2) |
| b | ours-only | pr-none, pr-loading, pr-open, pr-draft, pr-failing, pr-ready, pr-merged | Search changed files | button aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(1) > button:nth-of-type(1) |
| b | ours-only | pr-none, pr-loading, pr-open, pr-draft, pr-failing, pr-ready, pr-merged | Diff scope | button aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(1) > button:nth-of-type(3) |
| b | ours-only | pr-none, pr-loading, pr-open, pr-draft, pr-failing, pr-ready, pr-merged | Changed files | grid aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div:nth-of-type(2) |
| b | ours-only | pr-none, pr-loading, pr-open, pr-draft, pr-failing, pr-ready, pr-merged | Collapse panel | button aria-label: [data-testid="scripts-panel"] > div > div > div > div:nth-of-type(1) > button:nth-of-type(1) |
| b | ours-only | pr-none, pr-loading, pr-open, pr-draft, pr-failing, pr-ready, pr-merged | No preview URL yet | button title: [data-testid="scripts-panel"] > div > div > div > div:nth-of-type(2) > div:nth-of-type(2) > div > div:nth-of-type(1) > div > button:nth-of-type(1) |
| b | ours-only | pr-open, pr-failing | Waiting for a reviewer | span text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(1) > span |

### Settings (643)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| b | ours-only | settings-general, settings-general-sound-menu | Use ⇧↵ for new lines | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(1) > div > div > p:nth-of-type(2) |
| b | ours-only | settings-general, settings-general-sound-menu | Use ⌘↵ to queue | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div > p:nth-of-type(2) |
| b | ours-only | settings-general, settings-general-sound-menu | Default chime | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(4) > div > fieldset > button > span |
| b | ours-only | settings-general, settings-general-sound-menu | Let you drag workspaces into your own order in the sidebar. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(6) > div > div > p |
| b | ours-only | settings-general, settings-general-sound-menu | Strip "You're absolutely right!" from AI messages | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(8) > div > div > p |
| b | ours-only | settings-general, settings-general-sound-menu | Install a downloaded update and restart once no agent is working. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(11) > div > div > p |
| b | ours-only | settings-general, settings-general, settings-general-sound-menu, settings-general-sound-menu | Dismissible hints | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > aside > div > p |
| b | ours-only | settings-general, settings-general-sound-menu | Hints explain a control once. Dismiss this one, then choose Reset callout dismissals to bring it back. | div text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > aside > div > div |
| b | ours-only | settings-general, settings-general-sound-menu | Bring back every hint you dismissed. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(16) > div > div > p:nth-of-type(2) |
| b | ours-only | settings-general, settings-general-sound-menu | No dismissed hints | status text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(16) > div > div > p:nth-of-type(3) |
| b | ours-only | settings-agents, settings-agents-bedrock | CLI | button text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(2) > section > div:nth-of-type(1) > div >  |
| b | ours-only | settings-agents, settings-agents-bedrock | /Users/sam/Library/Applica...port/Conducted/bin/claude | code text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(2) > section > div:nth-of-type(2) > dl > div |
| b | ours-only | settings-agents, settings-agents-bedrock | claude.ai | dd text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(2) > section > div:nth-of-type(2) > dl > div:n |
| b | ours-only | settings-agents, settings-agents-bedrock | /Users/sam/Library/Application Support/Conducted/bin/claude | code title: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(2) > section > div:nth-of-type(2) > dl > di |
| b | ours-only | settings-agents-loading | Loading agents | status aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) |
| b | ours-only | settings-agents-error, settings-agents-error | Couldn't load agents | heading text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > section:nth-of-type(1) > h2 |
| b | ours-only | settings-agents-error | getAgentInstalls failed: the agent program did not answer. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > section:nth-of-type(1) > p |
| b | ours-only | settings-account | Signed in to github.com with gh | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(1) > div > p:nth-of-type(2) |
| b | ours-only | settings-account | Signed in as sam on github.com | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > section:nth-of-type(1) > div:nth-of-type(2) > p |
| b | ours-only | settings-account | Generated chat titles are turned off. | li text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > fieldset > ul > li:nth-of-type(1) |
| b | ours-only | settings-account | Custom MCP servers are turned off. | li text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > fieldset > ul > li:nth-of-type(2) |
| b | ours-only | settings-account | How Codex asks for approval before running tools. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(4) > div > div > p |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Theme and colours | heading text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(1) > h2 |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Fonts and code | heading text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(3) > h2 |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Text size in points for terminals. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(3) > div:nth-of-type(6) > div > div > p |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Live preview | heading text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(4) > h2 |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Code | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(4) > div > figure:nth-of-type(1) > figcaption > s |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | type Place name string const greet place Place , times = 1 string // Say hello. return `Hello, place.name | pre text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(4) > div > figure:nth-of-type(1) > pre |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | $ conducted --preview | pre text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(4) > div > figure:nth-of-type(2) > pre |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Black | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(4) > div > figure:nth-of-type(2) > pre > span:nth |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Red | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(4) > div > figure:nth-of-type(2) > pre > span:nth |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Green | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(4) > div > figure:nth-of-type(2) > pre > span:nth |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Yellow | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(4) > div > figure:nth-of-type(2) > pre > span:nth |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Blue | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(4) > div > figure:nth-of-type(2) > pre > span:nth |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Magenta | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(4) > div > figure:nth-of-type(2) > pre > span:nth |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Cyan | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(4) > div > figure:nth-of-type(2) > pre > span:nth |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | White | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(4) > div > figure:nth-of-type(2) > pre > span:nth |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Bright black | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(4) > div > figure:nth-of-type(2) > pre > span:nth |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Bright red | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(4) > div > figure:nth-of-type(2) > pre > span:nth |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Bright green | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(4) > div > figure:nth-of-type(2) > pre > span:nth |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Bright yellow | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(4) > div > figure:nth-of-type(2) > pre > span:nth |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Bright blue | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(4) > div > figure:nth-of-type(2) > pre > span:nth |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Bright magenta | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(4) > div > figure:nth-of-type(2) > pre > span:nth |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Bright cyan | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(4) > div > figure:nth-of-type(2) > pre > span:nth |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Bright white | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(4) > div > figure:nth-of-type(2) > pre > span:nth |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Mono Font style | combobox aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(3) > div:nth-of-type(2) > div > fieldse |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Terminal Font style | combobox aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(3) > div:nth-of-type(5) > div > fieldse |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Code preview | figure aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(4) > div > figure:nth-of-type(1) |
| b | ours-only | settings-appearance, settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Terminal preview | figure aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > section:nth-of-type(4) > div > figure:nth-of-type(2) |
| b | ours-only | settings-key-bindings | Change | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(1) > div > di |
| b | ours-only | settings-key-bindings | Open diagnostics | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(10) > div > div: |
| b | ours-only | settings-key-bindings | Open the changelog | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(13) > div > div: |
| b | ours-only | settings-key-bindings | Open the documentation | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(14) > div > div: |
| b | ours-only | settings-key-bindings | Open the place name map | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(15) > div > div: |
| b | ours-only | settings-key-bindings | Go to the next unread workspace | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(3) > div:nth-of-type(4) > div > div:n |
| b | ours-only | settings-key-bindings | Create a section | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(14) > div > div: |
| b | ours-only | settings-key-bindings | Move the workspace to a section | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(15) > div > div: |
| b | ours-only | settings-key-bindings | Mark the pull request ready for review | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(32) > div > div: |
| b | ours-only | settings-key-bindings | Link a pull request | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(36) > div > div: |
| b | ours-only | settings-key-bindings | Create a snippet | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(15) > div > div: |
| b | ours-only | settings-key-bindings | Pick an answer option by number | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(38) > div > div: |
| b | ours-only | settings-key-bindings, settings-key-bindings | Search commands | textbox aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(1) > input |
| b | ours-only | settings-key-bindings | Change shortcut for Command palette | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(1) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Command palette | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(1) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Toggle theme (dark/light) | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(2) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Toggle theme (dark/light) | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(2) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Shortcuts help | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(3) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Shortcuts help | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(3) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Settings | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(4) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Settings | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(4) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Quit | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(5) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Quit | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(5) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Send feedback | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(6) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Send feedback | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(6) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Open debug tools | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(7) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Open debug tools | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(7) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Open app log viewer | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(8) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Open app log viewer | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(8) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Close diagnostics | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(11) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Close diagnostics | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(11) > |
| b | ours-only | settings-key-bindings | Change shortcut for Confirm dialog | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(16) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Confirm dialog | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(16) > |
| b | ours-only | settings-key-bindings | Change shortcut for Search settings | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(17) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Search settings | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(17) > |
| b | ours-only | settings-key-bindings | Change shortcut for Close settings | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(18) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Close settings | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(18) > |
| b | ours-only | settings-key-bindings | Change shortcut for Next tab (Command palette) | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(19) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Next tab (Command palette) | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(19) > |
| b | ours-only | settings-key-bindings | Change shortcut for Previous tab (Command palette) | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(20) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Previous tab (Command palette) | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(20) > |
| b | ours-only | settings-key-bindings | Change shortcut for Edit highlighted item (Command palette) | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(21) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Edit highlighted item (Command palette) | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(21) > |
| b | ours-only | settings-key-bindings | Change shortcut for Delete highlighted item (Command palette) | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(22) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Delete highlighted item (Command palette) | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(22) > |
| b | ours-only | settings-key-bindings | Change shortcut for Toggle Garry mode (expand tool calls) | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(23) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Toggle Garry mode (expand tool calls) | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(1) > div:nth-of-type(23) > |
| b | ours-only | settings-key-bindings | Change shortcut for Toggle left sidebar | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(2) > div:nth-of-type(1) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Toggle left sidebar | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(2) > div:nth-of-type(1) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Toggle right sidebar | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(2) > div:nth-of-type(2) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Toggle right sidebar | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(2) > div:nth-of-type(2) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Toggle terminal panel | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(2) > div:nth-of-type(3) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Toggle terminal panel | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(2) > div:nth-of-type(3) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Toggle zen mode | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(2) > div:nth-of-type(4) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Toggle zen mode | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(2) > div:nth-of-type(4) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Zoom in | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(2) > div:nth-of-type(5) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Zoom in | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(2) > div:nth-of-type(5) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Zoom out | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(2) > div:nth-of-type(6) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Zoom out | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(2) > div:nth-of-type(6) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Reset zoom | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(2) > div:nth-of-type(7) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Reset zoom | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(2) > div:nth-of-type(7) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Navigate back | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(3) > div:nth-of-type(1) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Navigate back | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(3) > div:nth-of-type(1) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Navigate forward | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(3) > div:nth-of-type(2) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Navigate forward | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(3) > div:nth-of-type(2) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Go to Home | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(3) > div:nth-of-type(3) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Go to Home | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(3) > div:nth-of-type(3) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Go to previous tab | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(3) > div:nth-of-type(6) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Go to previous tab | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(3) > div:nth-of-type(6) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Go to next tab | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(3) > div:nth-of-type(7) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Go to next tab | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(3) > div:nth-of-type(7) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Close tab | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(3) > div:nth-of-type(8) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Close tab | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(3) > div:nth-of-type(8) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Reopen closed tab | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(3) > div:nth-of-type(9) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Reopen closed tab | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(3) > div:nth-of-type(9) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Split tab | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(3) > div:nth-of-type(10) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Split tab | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(3) > div:nth-of-type(10) > |
| b | ours-only | settings-key-bindings | Change shortcut for Quick open file | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(3) > div:nth-of-type(11) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Quick open file | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(3) > div:nth-of-type(11) > |
| b | ours-only | settings-key-bindings | Change shortcut for Search in files | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(3) > div:nth-of-type(12) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Search in files | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(3) > div:nth-of-type(12) > |
| b | ours-only | settings-key-bindings | Change shortcut for Add repository | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(3) > div:nth-of-type(13) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Add repository | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(3) > div:nth-of-type(13) > |
| b | ours-only | settings-key-bindings | Change shortcut for Create new workspace | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(1) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Create new workspace | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(1) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Create new workspace from PR, branch, or issue | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(2) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Create new workspace from PR, branch, or issue | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(2) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Toggle create-from picker | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(3) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Toggle create-from picker | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(3) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Add to backlog | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(4) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Add to backlog | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(4) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Start workspace | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(5) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Start workspace | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(5) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Next tab (Create workspace page) | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(6) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Next tab (Create workspace page) | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(6) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Previous tab (Create workspace page) | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(7) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Previous tab (Create workspace page) | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(7) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Archive workspace | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(8) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Archive workspace | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(8) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Open in app | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(9) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Open in app | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(9) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Open in menu | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(10) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Open in menu | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(10) > |
| b | ours-only | settings-key-bindings | Change shortcut for Copy link | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(11) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Copy link | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(11) > |
| b | ours-only | settings-key-bindings | Change shortcut for Start or stop action | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(12) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Start or stop action | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(12) > |
| b | ours-only | settings-key-bindings | Change shortcut for Toggle port forwarding | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(13) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Toggle port forwarding | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(13) > |
| b | ours-only | settings-key-bindings | Change shortcut for Toggle file edit mode | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(16) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Toggle file edit mode | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(16) > |
| b | ours-only | settings-key-bindings | Change shortcut for Switch to workspace 1 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(17) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Switch to workspace 1 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(17) > |
| b | ours-only | settings-key-bindings | Change shortcut for Switch to workspace 2 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(18) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Switch to workspace 2 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(18) > |
| b | ours-only | settings-key-bindings | Change shortcut for Switch to workspace 3 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(19) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Switch to workspace 3 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(19) > |
| b | ours-only | settings-key-bindings | Change shortcut for Switch to workspace 4 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(20) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Switch to workspace 4 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(20) > |
| b | ours-only | settings-key-bindings | Change shortcut for Switch to workspace 5 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(21) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Switch to workspace 5 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(21) > |
| b | ours-only | settings-key-bindings | Change shortcut for Switch to workspace 6 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(22) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Switch to workspace 6 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(22) > |
| b | ours-only | settings-key-bindings | Change shortcut for Switch to workspace 7 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(23) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Switch to workspace 7 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(23) > |
| b | ours-only | settings-key-bindings | Change shortcut for Switch to workspace 8 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(24) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Switch to workspace 8 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(24) > |
| b | ours-only | settings-key-bindings | Change shortcut for Switch to workspace 9 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(25) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Switch to workspace 9 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(25) > |
| b | ours-only | settings-key-bindings | Change shortcut for Previous workspace | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(26) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Previous workspace | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(26) > |
| b | ours-only | settings-key-bindings | Change shortcut for Next workspace | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(27) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Next workspace | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(27) > |
| b | ours-only | settings-key-bindings | Change shortcut for Create PR | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(28) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Create PR | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(28) > |
| b | ours-only | settings-key-bindings | Change shortcut for Commit and push | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(29) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Commit and push | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(29) > |
| b | ours-only | settings-key-bindings | Change shortcut for Pull latest from main | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(30) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Pull latest from main | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(30) > |
| b | ours-only | settings-key-bindings | Change shortcut for Merge PR | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(31) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Merge PR | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(31) > |
| b | ours-only | settings-key-bindings | Change shortcut for Fix errors | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(33) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Fix errors | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(33) > |
| b | ours-only | settings-key-bindings | Change shortcut for Open PR | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(34) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Open PR | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(34) > |
| b | ours-only | settings-key-bindings | Change shortcut for Start review | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(37) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Start review | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(37) > |
| b | ours-only | settings-key-bindings | Change shortcut for Find in file | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(38) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Find in file | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(38) > |
| b | ours-only | settings-key-bindings | Change shortcut for Show uncommitted changes | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(39) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Show uncommitted changes | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(39) > |
| b | ours-only | settings-key-bindings | Change shortcut for Toggle read state | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(42) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Toggle read state | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(42) > |
| b | ours-only | settings-key-bindings | Change shortcut for Toggle pin | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(43) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Toggle pin | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(4) > div:nth-of-type(43) > |
| b | ours-only | settings-key-bindings | Change shortcut for New tab | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(1) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for New tab | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(1) >  |
| b | ours-only | settings-key-bindings | Change shortcut for New line in chat | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(2) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for New line in chat | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(2) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Submit message | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(3) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Submit message | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(3) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Submit with opposite follow-up behavior | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(4) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Submit with opposite follow-up behavior | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(4) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Paste copied files as paths | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(5) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Paste copied files as paths | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(5) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Focus chat input | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(6) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Focus chat input | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(6) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Toggle plan mode while typing a message | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(7) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Toggle plan mode while typing a message | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(7) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Approve plan | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(8) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Approve plan | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(8) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Approve tool request | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(9) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Approve tool request | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(9) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Use alternate tool approval action | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(10) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Use alternate tool approval action | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(10) > |
| b | ours-only | settings-key-bindings | Change shortcut for Deny tool request | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(11) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Deny tool request | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(11) > |
| b | ours-only | settings-key-bindings | Change shortcut for Cancel agent | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(12) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Cancel agent | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(12) > |
| b | ours-only | settings-key-bindings | Change shortcut for Link issue | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(13) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Link issue | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(13) > |
| b | ours-only | settings-key-bindings | Change shortcut for Insert snippet | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(14) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Insert snippet | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(14) > |
| b | ours-only | settings-key-bindings | Change shortcut for Save goal | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(17) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Save goal | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(17) > |
| b | ours-only | settings-key-bindings | Change shortcut for Add attachment | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(18) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Add attachment | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(18) > |
| b | ours-only | settings-key-bindings | Change shortcut for Open model picker | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(19) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Open model picker | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(19) > |
| b | ours-only | settings-key-bindings | Change shortcut for Toggle Fast mode | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(20) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Toggle Fast mode | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(20) > |
| b | ours-only | settings-key-bindings | Change shortcut for Cycle effort level | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(21) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Cycle effort level | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(21) > |
| b | ours-only | settings-key-bindings | Change shortcut for Select loadout 1 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(22) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Select loadout 1 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(22) > |
| b | ours-only | settings-key-bindings | Change shortcut for Select loadout 2 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(23) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Select loadout 2 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(23) > |
| b | ours-only | settings-key-bindings | Change shortcut for Select loadout 3 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(24) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Select loadout 3 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(24) > |
| b | ours-only | settings-key-bindings | Change shortcut for Select loadout 4 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(25) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Select loadout 4 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(25) > |
| b | ours-only | settings-key-bindings | Change shortcut for Select loadout 5 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(26) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Select loadout 5 | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(26) > |
| b | ours-only | settings-key-bindings | Change shortcut for Next chat needing attention | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(27) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Next chat needing attention | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(27) > |
| b | ours-only | settings-key-bindings | Change shortcut for Search chat | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(28) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Search chat | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(28) > |
| b | ours-only | settings-key-bindings | Change shortcut for Find next match | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(29) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Find next match | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(29) > |
| b | ours-only | settings-key-bindings | Change shortcut for Find previous match | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(30) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Find previous match | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(30) > |
| b | ours-only | settings-key-bindings | Change shortcut for Scroll to current match | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(31) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Scroll to current match | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(31) > |
| b | ours-only | settings-key-bindings | Change shortcut for Copy concise transcript | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(32) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Copy concise transcript | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(32) > |
| b | ours-only | settings-key-bindings | Change shortcut for Fork chat to new tab | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(33) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Fork chat to new tab | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(33) > |
| b | ours-only | settings-key-bindings | Change shortcut for Toggle speech to text | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(34) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Toggle speech to text | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(34) > |
| b | ours-only | settings-key-bindings | Change shortcut for Previous question | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(35) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Previous question | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(35) > |
| b | ours-only | settings-key-bindings | Change shortcut for Next question | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(36) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Next question | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(36) > |
| b | ours-only | settings-key-bindings | Change shortcut for Focus other answer | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(37) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Focus other answer | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(37) > |
| b | ours-only | settings-key-bindings | Change shortcut for Pick an answer option by number | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(38) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Pick an answer option by number | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(38) > |
| b | ours-only | settings-key-bindings | Change shortcut for Submit answer | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(39) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Submit answer | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(39) > |
| b | ours-only | settings-key-bindings | Change shortcut for Steer with queued message | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(40) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Steer with queued message | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(40) > |
| b | ours-only | settings-key-bindings | Change shortcut for Edit queued message | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(41) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Edit queued message | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(41) > |
| b | ours-only | settings-key-bindings | Change shortcut for Delete queued message | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(42) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Delete queued message | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(42) > |
| b | ours-only | settings-key-bindings | Change shortcut for Save queued message edit | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(43) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Save queued message edit | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(43) > |
| b | ours-only | settings-key-bindings | Change shortcut for Save queued message and steer | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(44) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Save queued message and steer | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(44) > |
| b | ours-only | settings-key-bindings | Change shortcut for Cancel queued message edit | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(45) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Cancel queued message edit | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(5) > div:nth-of-type(45) > |
| b | ours-only | settings-key-bindings | Change shortcut for Open diff view | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(6) > div:nth-of-type(1) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Open diff view | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(6) > div:nth-of-type(1) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Go to previous file in diff | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(6) > div:nth-of-type(2) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Go to previous file in diff | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(6) > div:nth-of-type(2) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Go to next file in diff | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(6) > div:nth-of-type(3) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Go to next file in diff | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(6) > div:nth-of-type(3) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Go to previous comment in diff | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(6) > div:nth-of-type(4) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Go to previous comment in diff | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(6) > div:nth-of-type(4) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Go to next comment in diff | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(6) > div:nth-of-type(5) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Go to next comment in diff | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(6) > div:nth-of-type(5) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Toggle file as viewed | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(6) > div:nth-of-type(6) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Toggle file as viewed | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(6) > div:nth-of-type(6) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Save edited file | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(6) > div:nth-of-type(7) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Save edited file | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(6) > div:nth-of-type(7) >  |
| b | ours-only | settings-key-bindings | Change shortcut for New terminal tab (when terminal focused) | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(7) > div:nth-of-type(1) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for New terminal tab (when terminal focused) | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(7) > div:nth-of-type(1) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Close terminal tab (when terminal focused) | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(7) > div:nth-of-type(2) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Close terminal tab (when terminal focused) | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(7) > div:nth-of-type(2) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Open localhost URL | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(7) > div:nth-of-type(3) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Open localhost URL | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(7) > div:nth-of-type(3) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Find in terminal | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(7) > div:nth-of-type(4) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Find in terminal | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(7) > div:nth-of-type(4) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Insert terminal newline | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(7) > div:nth-of-type(5) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Insert terminal newline | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(7) > div:nth-of-type(5) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Clear terminal scrollback | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(7) > div:nth-of-type(6) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Clear terminal scrollback | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(7) > div:nth-of-type(6) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Delete terminal line | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(7) > div:nth-of-type(7) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Delete terminal line | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(7) > div:nth-of-type(7) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Move to terminal line start | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(7) > div:nth-of-type(8) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Move to terminal line start | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(7) > div:nth-of-type(8) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Move to terminal line end | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(7) > div:nth-of-type(9) >  |
| b | ours-only | settings-key-bindings | Clear shortcut for Move to terminal line end | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(7) > div:nth-of-type(9) >  |
| b | ours-only | settings-key-bindings | Change shortcut for Move back one terminal word | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(7) > div:nth-of-type(10) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Move back one terminal word | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(7) > div:nth-of-type(10) > |
| b | ours-only | settings-key-bindings | Change shortcut for Move forward one terminal word | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(7) > div:nth-of-type(11) > |
| b | ours-only | settings-key-bindings | Clear shortcut for Move forward one terminal word | button aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > section:nth-of-type(7) > div:nth-of-type(11) > |
| b | ours-only | settings-default-models, settings-models-style-menu, settings-models-effort-menu, settings-models-codex-thinking-menu, settings-models-personality-menu | First available model | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(1) > div > fieldset > button > span |
| b | ours-only | settings-default-models, settings-default-models, settings-default-models, settings-models-style-menu, settings-models-style-menu, settings-models-style-menu, s | Fast mode in new chats | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div > div > p |
| b | ours-only | settings-default-models, settings-models-style-menu, settings-models-effort-menu, settings-models-codex-thinking-menu, settings-models-personality-menu | Start new chats with fast mode on. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div > p |
| b | ours-only | settings-default-models, settings-models-style-menu, settings-models-effort-menu, settings-models-codex-thinking-menu, settings-models-personality-menu | Model used by chats that start an AI code review. Empty uses the default model. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(3) > div > div > p |
| b | ours-only | settings-default-models, settings-default-models, settings-default-models, settings-models-style-menu, settings-models-style-menu, settings-models-style-menu, s | Fast mode for reviews | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(4) > div > div > div > p |
| b | ours-only | settings-default-models, settings-models-style-menu, settings-models-effort-menu, settings-models-codex-thinking-menu, settings-models-personality-menu | Start new chats in plan mode so the agent proposes a plan first. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(5) > div > div > p |
| b | ours-only | settings-default-models, settings-models-style-menu, settings-models-effort-menu, settings-models-codex-thinking-menu, settings-models-personality-menu | How hard Codex thinks in new chats. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(6) > div > div > p |
| b | ours-only | settings-default-models, settings-models-style-menu, settings-models-effort-menu, settings-models-codex-thinking-menu, settings-models-personality-menu | Model default | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(6) > div > fieldset > button > span |
| b | ours-only | settings-default-models, settings-default-models, settings-default-models, settings-models-style-menu, settings-models-style-menu, settings-models-style-menu, s | Codex thinking level for reviews | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(7) > div > div > div > p |
| b | ours-only | settings-default-models, settings-models-style-menu, settings-models-effort-menu, settings-models-codex-thinking-menu, settings-models-personality-menu | How hard Codex thinks during AI code reviews. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(7) > div > div > p |
| b | ours-only | settings-default-models, settings-models-style-menu, settings-models-effort-menu, settings-models-codex-thinking-menu, settings-models-personality-menu | The tone Codex uses in new chats. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(8) > div > div > p |
| b | ours-only | settings-default-models, settings-models-style-menu, settings-models-effort-menu, settings-models-codex-thinking-menu, settings-models-personality-menu | How much effort Claude spends in new chats. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(10) > div > div > p |
| b | ours-only | settings-default-models, settings-default-models, settings-default-models, settings-models-style-menu, settings-models-style-menu, settings-models-style-menu, s | Claude effort level for reviews | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(11) > div > div > div > p |
| b | ours-only | settings-default-models, settings-models-style-menu, settings-models-effort-menu, settings-models-codex-thinking-menu, settings-models-personality-menu | How much effort Claude spends during AI code reviews. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(11) > div > div > p |
| b | ours-only | settings-default-models, settings-default-models, settings-default-models, settings-models-style-menu, settings-models-style-menu, settings-models-style-menu, s | Models shown in the picker | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(12) > div > div > div > p |
| b | ours-only | settings-default-models, settings-models-style-menu, settings-models-effort-menu, settings-models-codex-thinking-menu, settings-models-personality-menu | Limit which provider models appear in the model picker. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(12) > div > div > p |
| b | ours-only | settings-git | Preview: sam/<name> | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(1) > div > fieldset > p |
| b | ours-only | settings-git, settings-git, settings-git | Custom branch prefix | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div > div > p |
| b | ours-only | settings-git | The text used when the prefix type is custom, for example feature/ or alex-. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div > p |
| b | ours-only | settings-git | After the first message, replace the placeholder branch name with one that describes the task. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(3) > div > div > p |
| b | ours-only | settings-git | When the branch gets a real name, rename the workspace to match. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(4) > div > div > p |
| b | ours-only | settings-git | Where the open pull request button sends you. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(8) > div > div > p |
| b | ours-only | settings-git | Ask the agent to put a link to this workspace in the pull request description. The link only works on your own Mac. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(9) > div > div > p |
| b | ours-only | settings-environment | Variables for every repository, or only for one where they win over the shared value. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > div:nth-of-type(1) > div > p:nth-of-type(2) |
| b | ours-only | settings-environment | All repositories | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > div:nth-of-type(1) > button > span |
| b | ours-only | settings-environment | Names are stored in the app; values are stored in the macOS Keychain. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > div:nth-of-type(2) > div > p |
| b | ours-only | settings-environment | Add variable | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > div:nth-of-type(2) > form > div:nth-of-type(1) > button > span |
| b | ours-only | settings-environment, settings-environment | Suggested variables | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > div:nth-of-type(2) > form > div:nth-of-type(2) > p |
| b | ours-only | settings-environment | AWS access key ID for Bedrock, kept in the Keychain. | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > div:nth-of-type(2) > form > div:nth-of-type(2) > ul > li:nth-of-type( |
| b | ours-only | settings-environment | AWS secret access key for Bedrock, kept in the Keychain. | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > div:nth-of-type(2) > form > div:nth-of-type(2) > ul > li:nth-of-type( |
| b | ours-only | settings-environment | Access token for Codex, kept in the Keychain. | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > div:nth-of-type(2) > form > div:nth-of-type(2) > ul > li:nth-of-type( |
| b | ours-only | settings-environment | OpenAI API key, kept in the Keychain. | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > div:nth-of-type(2) > form > div:nth-of-type(2) > ul > li:nth-of-type( |
| b | ours-only | settings-environment | Dotenv files found in your home folder. A path is listed here and its names can be imported into the variables above. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > div:nth-of-type(3) > div:nth-of-type(1) > p |
| b | ours-only | settings-environment | No environment files yet. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div > div:nth-of-type(3) > div:nth-of-type(2) > p |
| b | ours-only | settings-experimental | Detect Graphite stacks for the active local workspace and show stack-aware UI in the git panel. Cloud workspaces are unaffected. When off, Conducted never runs  | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(1) > div > div > p:nth-of-type(1) |
| b | ours-only | settings-experimental | Install gt to enable. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(1) > div > div > p:nth-of-type(3) |
| b | ours-only | settings-experimental, settings-experimental, settings-experimental | Big terminal command list | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(5) > div > div > div > p |
| b | ours-only | settings-experimental | Extra commands offered when you open a big terminal, one per line. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(5) > div > div > p |
| b | ours-only | settings-advanced | Choose folder | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(1) > div > fieldset > div > button > span |
| b | ours-only | settings-advanced | Configure new Conducted workspaces so plain git push sets a branch upstream. Turning this off avoids writing Git worktree config, but PR info may be less reliab | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(5) > div > div > p |
| b | ours-only | settings-advanced | The Claude Code and Codex programs and the Cursor SDK, which the app downloads, verifies and keeps up to date. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(7) > div > p:nth-of-type(2) |
| b | ours-only | settings-advanced | No agent programs are managed. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(7) > p |
| b | ours-only | settings-advanced | Helper programs | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(8) > div > p:nth-of-type(1) |
| b | ours-only | settings-advanced | The GitHub CLI and watchexec, which the app downloads for GitHub and Spotlight. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(8) > div > p:nth-of-type(2) |
| b | ours-only | settings-advanced | GitHub CLI (gh) | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(8) > ul > li:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-ty |
| b | ours-only | settings-advanced | watchexec | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div > div:nth-of-type(8) > ul > li:nth-of-type(2) > div:nth-of-type(1) > p:nth-of-ty |
| b | ours-only | settings-general-sound-menu | Everyday behaviour for messages, notifications and the app window. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > header > p |
| b | ours-only | settings-appearance-code-theme-menu, settings-appearance-colors-menu, settings-appearance-markdown-menu | Theme, colours, zoom, fonts, and live previews. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > header > p |
| b | ours-only | settings-models-style-menu, settings-models-effort-menu, settings-models-codex-thinking-menu, settings-models-personality-menu | The model and options a new chat starts with. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > header > p |
| b | ours-only | settings-models-personality-menu | Pragmatic | span text: div:nth-of-type(2) > div > div > div:nth-of-type(2) > span:nth-of-type(1) |
| b | ours-only | settings-agents-bedrock | Provider sign-in and keys for Claude Code. | p text: div:nth-of-type(3) > p |
| b | ours-only | settings-agents-bedrock | Credentials | label text: div:nth-of-type(3) > div:nth-of-type(1) > div:nth-of-type(2) > div:nth-of-type(1) > label |
| b | ours-only | settings-agents-bedrock | Save Bedrock credentials | span text: div:nth-of-type(3) > div:nth-of-type(1) > div:nth-of-type(2) > div:nth-of-type(4) > button > span |
| b | ours-only | settings-agents-bedrock | Keys are saved in the macOS Keychain. | p text: div:nth-of-type(3) > div:nth-of-type(2) > p |
| b | ours-only | settings-agents-bedrock | Bedrock credentials | combobox aria-label: div:nth-of-type(3) > div:nth-of-type(1) > div:nth-of-type(2) > div:nth-of-type(1) > button |
| b | ours-only | settings-agents-bedrock | us-east-1 | textbox placeholder: div:nth-of-type(3) > div:nth-of-type(1) > div:nth-of-type(2) > div:nth-of-type(3) > div:nth-of-type(1) > input |
| b | ours-only | settings-agents-bedrock | For example, a Claude model id | textbox placeholder: div:nth-of-type(3) > div:nth-of-type(1) > div:nth-of-type(2) > div:nth-of-type(3) > div:nth-of-type(2) > input |
| b | ours-only | settings-repo-scripts, settings-repo-scripts | pnpm install | textbox text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(1) > textarea |
| b | ours-only | settings-repo-scripts, settings-repo-scripts | Start the default action after setup | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(4) > div > p:nth-of-type(1) |
| b | ours-only | settings-repo-scripts | Start the repository's default action once the setup script has finished. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(4) > div > p:nth-of-type(2) |
| b | ours-only | settings-repo-scripts | Variables in scripts | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(5) > p:nth-of-type(1) |
| b | ours-only | settings-repo-scripts | $CONDUCTED_WORKSPACE_NAME $CONDUCTED_WORKSPACE_PATH $CONDUCTED_WORKSPACE_ID $CONDUCTED_ROOT_PATH $CONDUCTED_DEFAULT_BRANCH $CONDUCTED_PORT | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(5) > p:nth-of-type(2) |
| b | ours-only | settings-repo-scripts | pnpm clean | textbox placeholder: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(2) > textarea |
| b | ours-only | settings-repo-actions, settings-repo-actions | Dev | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > ul > li:nth-of-type(1) > div:nth-of-type(1) > div > span:nth |
| b | ours-only | settings-repo-actions, settings-repo-actions | pnpm dev | code text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > ul > li:nth-of-type(1) > div:nth-of-type(1) > code |
| b | ours-only | settings-repo-actions, settings-repo-actions | Test | span text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > ul > li:nth-of-type(2) > div:nth-of-type(1) > div > span:nth |
| b | ours-only | settings-repo-prompts | General preferences | label text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(1) > div > label |
| b | ours-only | settings-repo-prompts | Sent when you start an AI code review. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(2) > p |
| b | ours-only | settings-repo-prompts | Sent when you ask the agent to create a pull request. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(3) > p |
| b | ours-only | settings-repo-prompts | Sent when you send failing checks to the agent. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(4) > p |
| b | ours-only | settings-repo-prompts | Resolve conflicts | label text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(5) > div > label |
| b | ours-only | settings-repo-prompts | Sent when you ask the agent to resolve merge conflicts. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(5) > p |
| b | ours-only | settings-repo-prompts | Rename branch | label text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(6) > div > label |
| b | ours-only | settings-repo-prompts | Sent when the agent names the branch. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(6) > p |
| b | ours-only | settings-repo-prompts | Uses only the built-in instructions. | textbox placeholder: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(1) > textarea |
| b | ours-only | settings-repo-misc | /Users/sam/code/atlas | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(2) > div:nth-of-type(1) > p:nth-of-type(3) |
| b | ours-only | settings-repo-misc | New workspaces branch from the repository's default branch. Choosing another base is not built yet (WS-01). | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(3) > p |
| b | ours-only | settings-repo-misc | Where to push, pull and create pull requests. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(4) > p |
| b | ours-only | settings-repo-misc | The terminal panel's Open URLs. Use $CONDUCTED_PORT for the workspace port. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(5) > p |
| b | ours-only | settings-repo-misc | Add a file or pattern | label text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(6) > div > div > label |
| b | ours-only | settings-repo-misc | No files are copied into new workspaces. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(6) > div > p:nth-of-type(1) |
| b | ours-only | settings-repo-misc | If the repository has a .worktreeinclude file, the paths in it are copied as well. Edit that file to add or remove them. | p text: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(6) > div > p:nth-of-type(2) |
| b | ours-only | settings-repo-misc | atlas icon | img aria-label: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(1) > div > span |
| b | ours-only | settings-repo-misc | origin | textbox placeholder: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(4) > input |
| b | ours-only | settings-repo-misc | http://localhost:$CONDUCTED_PORT | textbox placeholder: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(5) > input |
| b | ours-only | settings-repo-misc | .env* | textbox placeholder: [data-testid="settings-screen"] > main > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(6) > div > div > div > input |
| a | gap-missing (feature) | title:R11300919 | Terminal font | SET-02: Conductor's settings search copy (its registry, @11300535 to @11300934); its page copy differs by a full stop or case and ours matches that. Ours has on |
| a | gap-missing (feature) | description:R11300514 | Font used for code and diffs. | SET-02: Conductor's settings search copy (its registry, @11300535 to @11300934); its page copy differs by a full stop or case and ours matches that. Ours has on |
| a | gap-missing (feature) | description:R11300742 | Rendering style for markdown files. | SET-02: Conductor's settings search copy (its registry, @11300535 to @11300934); its page copy differs by a full stop or case and ours matches that. Ours has on |

### Start-up (3)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| b | ours-only | startup-loading | Opening the database | p text: div > div > div:nth-of-type(2) > p:nth-of-type(2) |
| b | ours-only | startup-blocked | This database (schema version 9) was created by a newer version of Conducted than the one running (which supports up to version 8). Update Conducted to continue | p text: div > div > div:nth-of-type(2) > section > p |
| b | ours-only | startup-failed | /Users/sam/Library/Application Support/Conducted/sidecar.log | p text: div > div > div:nth-of-type(2) > section > div > div > p:nth-of-type(2) |

### ui-map 4. Left sidebar (1)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| a | gap-missing (feature) | title:M3788154 | Open cloud workspace remotely in app | not in our UI |

### ui-map 6. Settings (2)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| a | gap-unshown (unshown) | tooltip:M2690256 | Approved | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M2685029 | Private | no catalogue state shows it |

### Unplaced (779)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| a | gap-unshown (unshown) | text:R206903 | Something went wrong! | APP-04: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R218908 | Not Found | APP-04: no catalogue state shows it |
| a | gap-missing (feature) | text:R1853248 | View workspace world map | not in our UI |
| a | gap-missing (feature) | text:R1855374 | BACK TO APP | NAV-13: not in our UI |
| a | gap-unshown (unshown) | text:R1855635 | Conductor Passport | NAV-13: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R1856290 | CITIES VISITED | NAV-13: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R1859869 | [ARCHIVED] | NAV-13: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R1859949 | [CLICK TO OPEN] | NAV-13: no catalogue state shows it |
| a | gap-missing (feature) | text:R1860885 | GRID::EQUALEARTH | NAV-13: not in our UI |
| a | gap-unshown (unshown) | text:R1861963 | [NOT VISITED] | NAV-13: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R1892943 | Clone GitHub repo | PRJ-02: no catalogue state shows it |
| a | gap-missing (feature) | text:R1893004 | Choose a recent repo or paste a clone URL. | PRJ-02: not in our UI |
| a | gap-unshown (unshown) | text:R1893165 | Repository URL | PRJ-02: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R1894370 | Location | no catalogue state shows it |
| a | gap-missing (feature) | text:R1895265 | Cloning... | not in our UI |
| a | gap-unshown (unshown) | text:R1897964 | Recent repos | APP-04: no catalogue state shows it |
| a | gap-missing (feature) | text:R1898879 | No repositories found | APP-04: not in our UI |
| a | gap-missing (feature) | text:R2035684 | Create a local folder, private GitHub repo, and first workspace. | not in our UI |
| a | gap-unshown (unshown) | text:R2036417 | Name must include letters or numbers. | no catalogue state shows it |
| a | gap-unshown (unshown) | text:R2256696 | Discard | no catalogue state shows it |
| a | gap-unshown (unshown) | text:R2256762 | Save | no catalogue state shows it |
| a | gap-unshown (unshown) | text:R2261476 | Resolve | GIT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R2262911 | Add all comments to chat | GIT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R2270584 | Deployments | WS-09: no catalogue state shows it |
| a | gap-missing (feature) | text:R2272875 | Queue checks | PR-04: not in our UI |
| a | gap-unshown (unshown) | text:R2273904 | Re-run failed checks | PR-04: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R2275695 | Add all to chat | PR-04: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R2277819 | Add to chat | RUN-05: no catalogue state shows it |
| a | gap-missing (feature) | text:R2501184 | No apps available | not in our UI |
| a | gap-missing (feature) | text:R2506945 | Open in... | WS-08: not in our UI |
| a | gap-unshown (unshown) | text:R2530910 |  /  | no catalogue state shows it |
| a | gap-unshown (unshown) | text:R2532074 | Attach to chat | REV-10: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R2614665 | Discard changes | REV-06: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R2628436 | (trunk) | PR-08: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R2628976 | gt restack | PR-08: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R2629550 | Checkout this branch | PR-08: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R2630397 | Conflicts | PR-08: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R2631426 | Viewed | REV-02: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R2640313 | Current | PR-08: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R2640500 |  ·  | PR-08: no catalogue state shows it |
| a | gap-missing (feature) | text:R2668400 | Could not load git status | not in our UI |
| a | gap-missing (feature) | text:R2669415 | Finish rebasing or merging to see changes | REV-01: not in our UI |
| a | gap-unshown (unshown) | text:R2671291 | No files match this filter | REV-01: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R2673271 | Some untracked files are not shown. | REV-01: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R2754302 | Loading branches... | REV-01: no catalogue state shows it |
| a | gap-missing (feature) | text:R2754470 | Couldn't load branches. | REV-01: not in our UI |
| a | gap-missing (feature) | text:R2754604 | No branch found. | REV-01: not in our UI |
| a | gap-missing (feature) | text:R2759094 | Options | REV-01: not in our UI |
| a | gap-missing (feature) | text:R2759246 | Current branch | REV-01: not in our UI |
| a | gap-missing (feature) | text:R2762831 | Uncommitted | not in our UI |
| a | gap-missing (feature) | text:R2763588 | Back to all changes | REV-01: not in our UI |
| a | gap-missing (feature) | text:R4026205 | Close search | not in our UI |
| a | gap-unshown (unshown) | text:R4633180 | No icons found | RUN-01: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R4971674 | ⌘X | no catalogue state shows it |
| a | gap-unshown (unshown) | text:R4971853 | ⌘C | no catalogue state shows it |
| a | gap-unshown (unshown) | text:R4972025 | ⌘V | no catalogue state shows it |
| a | gap-missing (feature) | text:R4987742 | Can run in | CLOUD-09: not in our UI |
| a | gap-unshown (unshown) | text:R5014678 | Stopping... | RUN-01: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R5015072 | Stop | RUN-01: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R5018396 | Running setup script... | WS-03: no catalogue state shows it |
| a | gap-missing (feature) | text:R5018754 | Couldn't load setup script settings | WS-03: not in our UI |
| a | gap-unshown (unshown) | text:R5019114 | Add setup script | WS-03: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R5019283 | Ask agent | WS-03: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R5019401 | Add manually | WS-03: no catalogue state shows it |
| a | gap-missing (feature) | text:R5019486 | Run commands when a workspace is created to install dependencies or set up the environment | WS-03: not in our UI |
| a | gap-unshown (unshown) | text:R5019758 | No setup script output | WS-03: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R5019845 | Setup script output will appear here after running setup. | WS-03: no catalogue state shows it |
| a | gap-missing (feature) | text:R5020313 | Couldn't load actions. | not in our UI |
| a | gap-missing (feature) | text:R5020935 | Run tests or a development server to test changes in this workspace | RUN-01: not in our UI |
| a | gap-unshown (unshown) | text:R5021705 | Add action manually | RUN-01: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R5022582 | Starting... | RUN-01: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R5022850 | Setting up... | NAV-03: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R5433730 | Preview URL | CLOUD-09: no catalogue state shows it |
| a | gap-missing (feature) | text:R5434210 | Copy preview URL | CLOUD-09: not in our UI |
| a | gap-unshown (unshown) | text:R5435078 | Off | CLOUD-09: no catalogue state shows it |
| a | gap-missing (feature) | text:R5436101 | Select a port to share via a URL. Workspace read permissions required. | not in our UI |
| a | gap-missing (feature) | text:R5444654 | Forward port | CLOUD-09: not in our UI |
| a | gap-missing (feature) | text:R5446468 | Add port | CLOUD-09: not in our UI |
| a | gap-missing (feature) | text:R5447177 | Ports detected | CLOUD-09: not in our UI |
| a | gap-missing (feature) | text:R5457681 | Ports unavailable | CLOUD-09: not in our UI |
| a | gap-unshown (unshown) | text:R5509774 | Read | no catalogue state shows it |
| a | gap-unshown (unshown) | text:R5509816 | Write | no catalogue state shows it |
| a | gap-unshown (unshown) | text:R5512389 | Keep editing | no catalogue state shows it |
| a | gap-unshown (unshown) | text:R5664987 | No open issues found | PR-09: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R5665380 | Connect Linear | PR-09: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R5666002 | No issues found | PR-09: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R5679832 | No logs available. | PR-04: no catalogue state shows it |
| a | gap-missing (feature) | text:R5686320 | Browse... | Checked by hand: the wording differs. Ours reads "Browse" (text) in create-project. |
| a | gap-missing (feature) | text:R5687206 | No workspaces found | not in our UI |
| a | gap-missing (feature) | text:R5693367 | Loading directories... | not in our UI |
| a | gap-missing (feature) | text:R5694226 | Select all | not in our UI |
| a | gap-missing (feature) | text:R5694380 | Deselect all | not in our UI |
| a | gap-missing (feature) | text:R8113678 | Loading preview... | REV-08: not in our UI |
| a | gap-unshown (unshown) | text:R8113966 | Preview not available | REV-08: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8133849 | Loading comment... | REV-03: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8134174 | Comment not found | REV-03: no catalogue state shows it |
| a | gap-missing (feature) | text:R8135916 | No comment body | CHAT-02: not in our UI |
| a | gap-unshown (unshown) | text:R8683825 | Disconnect | no catalogue state shows it |
| a | gap-missing (feature) | text:R8685730 | Stop waiting | not in our UI |
| a | gap-unshown (unshown) | text:R8717420 | Loading MCP servers | no catalogue state shows it |
| a | gap-missing (feature) | text:R8875135 | Context usage | not in our UI |
| a | gap-unshown (unshown) | text:R8876144 | Context usage is unavailable for Cursor. | CHAT-14: no catalogue state shows it |
| a | gap-missing (feature) | text:R8881215 | MCPs | not in our UI |
| a | gap-unshown (unshown) | text:R8907434 | Link workspaces | WS-07: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8908351 | Add snippet | COMP-09: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R8912157 | More composer actions | COMP-01: no catalogue state shows it |
| a | gap-missing (feature) | text:R8912549 | Speech to text | COMP-01: not in our UI |
| a | gap-unshown (unshown) | text:R8917278 | Disable auto-accept edits | COMP-03: no catalogue state shows it |
| a | gap-missing (feature) | text:R9037926 | Couldn’t load image | not in our UI |
| a | gap-missing (feature) | text:R9119284 | Couldn’t load options | not in our UI |
| a | gap-missing (feature) | text:R9120201 | Loading options… | not in our UI |
| a | gap-missing (feature) | text:R9121155 | Options update with your next message | not in our UI |
| a | gap-unshown (unshown) | text:R9226849 | Opens in new chat | COMP-02: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R9233520 | No models found | COMP-02: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R9241138 | Add models | COMP-02: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R9260827 | Send plan to a new chat for implementation | CHAT-12: no catalogue state shows it |
| a | gap-missing (feature) | text:R9268515 | Files from this directory are accessible to the agent in this workspace. | not in our UI |
| a | gap-unshown (unshown) | text:R9562178 | Compacting... | CHAT-06: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R9573319 | Reset chat? | CHAT-15: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R9573354 | Later messages will be deleted. | CHAT-15: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R9573684 | Also reset files | CHAT-15: no catalogue state shows it |
| a | gap-missing (feature) | text:R9586815 | Input | Checked by hand: the wording differs. Ours reads "Input:" (text) in chat-working. |
| a | gap-unshown (unshown) | text:R9587041 | Output | no catalogue state shows it |
| a | gap-missing (feature) | text:R9587290 | Cache read | not in our UI |
| a | gap-unshown (unshown) | text:R9587550 | Cache write | CHAT-16: no catalogue state shows it |
| a | gap-missing (feature) | text:R9652412 | Failed to load PDF | not in our UI |
| a | gap-missing (feature) | text:R9655838 | Failed to render page | not in our UI |
| a | gap-missing (feature) | text:R9659929 | Failed to load video | not in our UI |
| a | gap-unshown (unshown) | text:R9662211 | Empty CSV | REV-08: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R9730742 | Discard comment? | REV-03: no catalogue state shows it |
| a | gap-missing (feature) | text:R9957571 | No changes in this file | not in our UI |
| a | gap-unshown (unshown) | text:R9959555 | File changed on disk | REV-08: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R9959684 | Discard my edits | REV-08: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R9959802 | Keep mine | REV-08: no catalogue state shows it |
| a | gap-missing (feature) | text:R9976019 | No changes to this file. | REV-01: not in our UI |
| a | gap-missing (feature) | text:R9984446 | Enter a new title for this pull request | PR-07: not in our UI |
| a | gap-missing (feature) | text:R9988523 | Video attachment | not in our UI |
| a | gap-unshown (unshown) | text:R9992592 | No description | PR-07: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R10000509 | Resolved | no catalogue state shows it |
| a | gap-unshown (unshown) | text:R10000794 | Outdated | no catalogue state shows it |
| a | gap-missing (feature) | text:R10007781 | Couldn't load comments | not in our UI |
| a | gap-missing (feature) | text:R10014580 | Failed to load logs | not in our UI |
| a | gap-missing (feature) | text:R10030326 | Some people aren’t listed. Enter their full GitHub username. | not in our UI |
| a | gap-missing (feature) | text:R10031601 | Couldn’t load people. Enter a GitHub username. | not in our UI |
| a | gap-unshown (unshown) | text:R10057113 | Description | PR-07: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R10057491 | Activity | PR-07: no catalogue state shows it |
| a | gap-missing (feature) | text:R10060117 | Cloud terminal unavailable in read-only workspaces. | not in our UI |
| a | gap-missing (feature) | text:R10069947 | Waiting for background tasks | not in our UI |
| a | gap-missing (feature) | text:R10070194 | Cancelling | not in our UI |
| a | gap-missing (feature) | text:R10076883 | ⌘⌥C | not in our UI |
| a | gap-missing (feature) | text:R10221548 | Anyone | not in our UI |
| a | gap-unshown (unshown) | text:R10247990 | Unarchive workspace | WS-06: no catalogue state shows it |
| a | gap-missing (feature) | text:R10289703 | Toggle sidebar | not in our UI |
| a | gap-unshown (unshown) | text:R10324184 | Archiving... | NAV-03: no catalogue state shows it |
| a | gap-missing (feature) | text:R10324889 | Planning... | NAV-03: not in our UI |
| a | gap-unshown (unshown) | text:R10325216 | Cancelling... | NAV-03: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R10325382 | Waiting... | NAV-03: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R10325545 | Initializing... | NAV-03: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R10325730 | Initialization failed | NAV-03: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R10411671 | Pull requests | no catalogue state shows it |
| a | gap-unshown (unshown) | text:R10462484 | Pinned | NAV-04: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R10474958 | Drag a workspace here | NAV-04: no catalogue state shows it |
| a | gap-missing (feature) | text:R10493981 | My workspaces | not in our UI |
| a | gap-missing (feature) | text:R10502967 | ⌘, | not in our UI |
| a | gap-unshown (unshown) | text:R10553428 | Sign in | no catalogue state shows it |
| a | gap-missing (feature) | text:R10574584 | Capture information about your environment to help diagnose issues. | not in our UI |
| a | gap-missing (feature) | text:R10576215 | Copy the full diagnostics report to your clipboard | not in our UI |
| a | gap-missing (feature) | text:R10576554 | Redacted report hashes the values of all env variables, except a few non-sensitive ones like PATH | not in our UI |
| a | gap-missing (feature) | text:R10576999 | Create a new session with the redacted report attached. Env values are hashed except non-sensitive ones like PATH. | not in our UI |
| a | gap-missing (feature) | text:R10577409 | Create a new session with the full report attached. All env values are sent to your AI provider. | not in our UI |
| a | gap-missing (feature) | text:R10581067 | Something went wrong. | APP-03: not in our UI |
| a | gap-unshown (unshown) | text:R10581463 | Copy logs (may include personal data) | APP-03: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R10662685 | Dark | no catalogue state shows it |
| a | gap-unshown (unshown) | text:R10662728 | System | no catalogue state shows it |
| a | gap-unshown (unshown) | text:R10669114 | Custom... | no catalogue state shows it |
| a | gap-missing (feature) | text:R10669800 | Enter font name exactly as installed on your system | not in our UI |
| a | gap-missing (feature) | text:R10670104 | // Preview | not in our UI |
| a | gap-missing (feature) | text:R10670143 | const greeting = 'Hello, World!'; | not in our UI |
| a | gap-missing (feature) | text:R10670205 | function sum(a, b) { return a + b; } | not in our UI |
| a | gap-missing (feature) | text:R10674386 |  ~/project main ±3 ?2 | not in our UI |
| a | gap-missing (feature) | text:R10674436 | ❯ npm test ✓ | not in our UI |
| a | gap-missing (feature) | text:R10674477 | └── ▶ All tests passed! | not in our UI |
| a | gap-missing (feature) | text:R10734876 | setup guide | not in our UI |
| a | gap-missing (feature) | text:R10735245 | MCP server URL | not in our UI |
| a | gap-missing (feature) | text:R10735883 | Client ID | not in our UI |
| a | gap-missing (feature) | text:R10736417 | Client secret | not in our UI |
| a | gap-missing (feature) | text:R10737019 | Finish connecting in your browser. | not in our UI |
| a | gap-missing (feature) | text:R10738808 | Connect Datadog | not in our UI |
| a | gap-missing (feature) | text:R10738847 | Before connecting, allow Conductor’s OAuth redirect URL in Datadog. | not in our UI |
| a | gap-missing (feature) | text:R10739035 | Datadog site | not in our UI |
| a | gap-missing (feature) | text:R10739612 | Organization Settings → Preferences → MCP OAuth Redirect URLs | not in our UI |
| a | gap-missing (feature) | text:R10739707 | Add this URL: | not in our UI |
| a | gap-missing (feature) | text:R10764556 | No recommended MCPs match your search | not in our UI |
| a | gap-missing (feature) | text:R10767373 | Import from local | not in our UI |
| a | gap-missing (feature) | text:R10769991 | Select MCP servers | not in our UI |
| a | gap-missing (feature) | text:R10770341 | Scanning local MCP servers… | not in our UI |
| a | gap-missing (feature) | text:R10770489 | Couldn't read local MCP configs | not in our UI |
| a | gap-unshown (unshown) | text:R10771891 | No matching MCP servers. | SET-05: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R10778940 | Installed | no catalogue state shows it |
| a | gap-unshown (unshown) | text:R10820086 | Loading repositories... | no catalogue state shows it |
| a | gap-missing (feature) | text:R10821137 | Couldn't check your GitHub sign-in | not in our UI |
| a | gap-missing (feature) | text:R10821338 | Signed in to GitHub as | not in our UI |
| a | gap-unshown (unshown) | text:R10832356 | GitHub account | SET-02: no catalogue state shows it |
| a | gap-missing (feature) | text:R10854681 | Runs in the directory containing your repos | not in our UI |
| a | gap-missing (feature) | text:R10854974 | shared environment variables | not in our UI |
| a | gap-unshown (unshown) | text:R10876329 | Loading environment variables | no catalogue state shows it |
| a | gap-unshown (unshown) | text:R10886799 | Import | no catalogue state shows it |
| a | gap-unshown (unshown) | text:R11017379 | No custom actions yet. Add one to get started. | SET-07: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R11019107 | Hidden | no catalogue state shows it |
| a | gap-missing (feature) | text:R11022869 | Show action | not in our UI |
| a | gap-missing (feature) | text:R11023100 | Hide action | not in our UI |
| a | gap-missing (feature) | text:R11023365 | Reset to your repo's settings.toml | not in our UI |
| a | gap-missing (feature) | text:R11027519 | Create a .conductor/settings.toml file | PLAT-16: not in our UI |
| a | gap-missing (feature) | text:R11144267 | Pause and save | CLOUD-09: not in our UI |
| a | gap-missing (feature) | text:R11154299 | Manual overrides are ignored while Exclusive port forwarding is off. | not in our UI |
| a | gap-missing (feature) | text:R11155309 | Remote | not in our UI |
| a | gap-unshown (unshown) | text:R11155409 | Local | CLOUD-09: no catalogue state shows it |
| a | gap-missing (feature) | text:R11160803 | 32768–60999 | CLOUD-09: not in our UI |
| a | gap-missing (feature) | text:R11160879 | Forward those ports manually. | CLOUD-09: not in our UI |
| a | gap-unshown (unshown) | text:R11187774 | Done | no catalogue state shows it |
| a | gap-missing (feature) | text:R11231761 | Could not load models. | not in our UI |
| a | gap-missing (feature) | text:R11320596 | No matching sections | WS-01: not in our UI |
| a | gap-unshown (unshown) | text:R11324211 | Esc | no catalogue state shows it |
| a | gap-missing (feature) | text:R11339519 | Couldn't load this workspace's artifacts | REV-10: not in our UI |
| a | gap-missing (feature) | text:R11445293 | No branch name | not in our UI |
| a | gap-missing (feature) | text:R11448022 | Linear could not be loaded. Refresh Linear in settings. | not in our UI |
| a | gap-missing (feature) | text:R11535620 | No instructions | not in our UI |
| a | gap-missing (feature) | text:R11541757 | Artifact | not in our UI |
| a | gap-missing (feature) | text:R11542973 | Enter a new name for this chat | not in our UI |
| a | gap-missing (feature) | text:R11544294 | Pick an icon, emoji, favicon, or uploaded image for this repository | not in our UI |
| a | gap-unshown (unshown) | text:R11551086 | ~/ | no catalogue state shows it |
| a | gap-missing (feature) | text:R11609141 | Go to workspaces | not in our UI |
| a | gap-missing (feature) | text:R11610071 | Your computer build failed. | not in our UI |
| a | gap-unshown (unshown) | text:R11676567 | Reload | RUN-04: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R11677710 | Open in browser | RUN-04: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R11678490 | Starting preview… | RUN-04: no catalogue state shows it |
| a | gap-missing (feature) | text:R11679495 | No local servers running. Start your dev server and it'll show up here. | not in our UI |
| a | gap-missing (feature) | text:R11687853 | Workspace unavailable | CLOUD-03: not in our UI |
| a | gap-missing (feature) | text:R11716261 | No actions found in this source. | not in our UI |
| a | gap-missing (feature) | text:R11741989 | Type shortcut | not in our UI |
| a | gap-missing (feature) | text:R11744268 | Fixed shortcut | not in our UI |
| a | gap-missing (feature) | text:R11772171 | Loading... | not in our UI |
| a | gap-unshown (unshown) | text:R11975847 | Revert | CHAT-15: no catalogue state shows it |
| a | gap-missing (feature) | text:R12039927 | Press Enter to run the rollback command. Conductor will restart when done. | not in our UI |
| a | gap-unshown (unshown) | text:R12041464 | Wrong version of Conductor for this Mac | APP-08: no catalogue state shows it |
| a | gap-missing (feature) | text:R12044893 | Update required | not in our UI |
| a | gap-missing (feature) | text:R12044977 | This version of Conductor is no longer supported. Update to the latest version to continue. | not in our UI |
| a | gap-missing (feature) | text:R12046593 | Download the latest version manually | not in our UI |
| a | gap-missing (feature) | text:R12047732 | Conductor isn't available in your region | not in our UI |
| a | gap-unshown (unshown) | text:R12095445 | Will automatically restart when all agents are idle | APP-06: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R12095642 | See changes | APP-06: no catalogue state shows it |
| a | gap-unshown (unshown) | text:R12095810 | Restart when idle | APP-06: no catalogue state shows it |
| a | gap-missing (feature) | label:M204813 | Common | not in our UI |
| a | gap-missing (feature) | label:M204930 | Uncommon | not in our UI |
| a | gap-missing (feature) | label:M205025 | Rare | not in our UI |
| a | gap-missing (feature) | label:M205124 | Legendary | not in our UI |
| a | gap-missing (feature) | label:M389969 | Overwrite file | DATA-05: not in our UI |
| a | gap-missing (feature) | label:M780682 | Merge on GitHub | not in our UI |
| a | gap-missing (feature) | label:M952497 | Open account settings | not in our UI |
| a | gap-missing (feature) | label:M1092304 | View logs | not in our UI |
| a | gap-missing (feature) | label:M1420230 | Background Task | not in our UI |
| a | gap-unshown (unshown) | label:M3072009 | Spotlight | no catalogue state shows it |
| a | gap-missing (feature) | label:M3099042 | Learn more | not in our UI |
| a | gap-missing (feature) | label:M3754095 | Delete permanently | not in our UI |
| a | gap-missing (feature) | label:M3754296 | Delete anyway | not in our UI |
| a | gap-missing (feature) | label:R104487 | Yes for this session | CHAT-11: not in our UI |
| a | gap-unshown (unshown) | label:R104578 | Allow all edits during this session | CHAT-11: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R2035080 | Open in GitHub | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R2138036 | PR info unavailable | GIT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R2139395 | No internet connection | GIT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R2139834 | Checking mergeability… | GIT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R2269745 | Deployed | WS-09: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R2269882 | Failed | WS-09: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R2270007 | Deploying | WS-09: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R2270162 | Pending | WS-09: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R2270269 | Inactive | WS-09: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R2271674 | Cancelled | no catalogue state shows it |
| a | gap-missing (feature) | label:R2960293 | Big terminal | NAV-02: not in our UI |
| a | gap-missing (feature) | label:R2960400 | Internal | NAV-02: not in our UI |
| a | gap-missing (feature) | label:R2960724 | Members | NAV-02: not in our UI |
| a | gap-missing (feature) | label:R4994069 | Cloud | not in our UI |
| a | gap-unshown (unshown) | label:R4994132 | Local | no catalogue state shows it |
| a | gap-missing (feature) | label:R5008818 | Open terminal | not in our UI |
| a | gap-missing (feature) | label:R5438208 | Forward to localhost | CLOUD-09: not in our UI |
| a | gap-missing (feature) | label:R5438774 | Auto-forwarding | CLOUD-09: not in our UI |
| a | gap-unshown (unshown) | label:R5652630 | Match case | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R5652994 | Whole word | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R5653348 | Regular expression | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R9240756 | Add models | COMP-02: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R9343545 | Discard | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R9857501 | Replace | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R9857551 | Replace All | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R9857607 | Previous | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R9857669 | Next | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R9983794 | Edit title | PR-07: no catalogue state shows it |
| a | gap-missing (feature) | label:R9992853 | Edit description | PR-07: not in our UI |
| a | gap-unshown (unshown) | label:R10015966 | Waiting | PR-04: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R10026716 | Approved | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R10026849 | Changes requested | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R10026974 | Commented | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R10027091 | Dismissed | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R10027221 | Awaiting review | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R10044498 | Branch | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R10046733 | Merge | GIT-04: no catalogue state shows it |
| a | gap-missing (feature) | label:R10081916 | Cloud desktop | not in our UI |
| a | gap-unshown (unshown) | label:R10091233 | Browser | NAV-10: no catalogue state shows it |
| a | gap-unshown (unshown) | label:R10091398 | Local terminal | NAV-10: no catalogue state shows it |
| a | gap-missing (feature) | label:R10299290 | Other | Checked by hand: the wording differs. Ours reads "Other..." (text) in chat-question. |
| a | gap-unshown (unshown) | label:R10461875 | Pinned | NAV-04: no catalogue state shows it |
| a | gap-missing (feature) | label:R10480019 | My workspaces | not in our UI |
| a | gap-unshown (unshown) | label:R10488895 | Project | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R10488999 | Sort by | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R10489049 | Updated | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R10489205 | Group by | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R10489474 | Filter by project | no catalogue state shows it |
| a | gap-missing (feature) | label:R10570025 | Non-zsh default shell env | not in our UI |
| a | gap-unshown (unshown) | label:R10676706 | Claude | no catalogue state shows it |
| a | gap-missing (feature) | label:R10676910 | Amp | not in our UI |
| a | gap-missing (feature) | label:R10676977 | Copilot | not in our UI |
| a | gap-missing (feature) | label:R10677047 | Gemini | not in our UI |
| a | gap-missing (feature) | label:R10751739 | Claude Desktop | not in our UI |
| a | gap-missing (feature) | label:R10755170 | Claude Code plugins | not in our UI |
| a | gap-unshown (unshown) | label:R10787975 | Canceled | no catalogue state shows it |
| a | gap-unshown (unshown) | label:R10818359 | Connect GitHub | SET-02: no catalogue state shows it |
| a | gap-missing (feature) | label:R10853717 | Environment info | not in our UI |
| a | gap-unshown (unshown) | label:R11166546 | App | no catalogue state shows it |
| a | gap-missing (feature) | label:R11316952 | Routines | not in our UI |
| a | gap-unshown (unshown) | label:R11339122 | Loading artifacts | REV-10: no catalogue state shows it |
| a | gap-missing (feature) | label:R11440151 | Set up an agent | not in our UI |
| a | gap-missing (feature) | label:R11440532 | View computer | not in our UI |
| a | gap-missing (feature) | label:R11440860 | Add one | not in our UI |
| a | gap-missing (feature) | label:R11448282 | Set up Linear | not in our UI |
| a | gap-missing (feature) | label:R11539456 | Delete artifact | not in our UI |
| a | gap-missing (feature) | label:R11902518 | Label | not in our UI |
| a | gap-unshown (unshown) | label:R11977140 | Prompt | no catalogue state shows it |
| a | gap-missing (feature) | aria_label:R511358 | Notifications | not in our UI |
| a | gap-missing (feature) | aria_label:R1898003 | Loading recent repos | APP-04: not in our UI |
| a | gap-unshown (unshown) | aria_label:R1898585 | Search repositories | APP-04: no catalogue state shows it |
| a | gap-unshown (unshown) | aria_label:R2623047 | Filter changed files | REV-01: no catalogue state shows it |
| a | gap-missing (feature) | aria_label:R2623631 | Close filter | REV-01: not in our UI |
| a | gap-unshown (unshown) | aria_label:R2637434 | Stack PRs | PR-08: no catalogue state shows it |
| a | gap-missing (feature) | aria_label:R4632115 | Choose action icon | RUN-01: not in our UI |
| a | gap-unshown (unshown) | aria_label:R4987086 | Action name | RUN-01: no catalogue state shows it |
| a | gap-missing (feature) | aria_label:R5434122 | Copy preview URL | CLOUD-09: not in our UI |
| a | gap-missing (feature) | aria_label:R5434782 | Choose preview URL port | CLOUD-09: not in our UI |
| a | gap-missing (feature) | aria_label:R5444519 | Forward port | CLOUD-09: not in our UI |
| a | gap-missing (feature) | aria_label:R5445011 | Cancel forwarding port | CLOUD-09: not in our UI |
| a | gap-missing (feature) | aria_label:R5446340 | Add port | CLOUD-09: not in our UI |
| a | gap-missing (feature) | aria_label:R8082977 | Video player | not in our UI |
| a | gap-missing (feature) | aria_label:R8085928 | Playback speed | not in our UI |
| a | gap-missing (feature) | aria_label:R8087654 | Volume | not in our UI |
| a | gap-missing (feature) | aria_label:R8700214 | Setting actions | not in our UI |
| a | gap-unshown (unshown) | aria_label:R8717346 | Loading MCP servers | no catalogue state shows it |
| a | gap-missing (feature) | aria_label:R8874837 | Context usage | not in our UI |
| a | gap-missing (feature) | aria_label:R9222951 | Fast mode on | not in our UI |
| a | gap-unshown (unshown) | aria_label:R9226139 | Opens in new chat | COMP-02: no catalogue state shows it |
| a | gap-unshown (unshown) | aria_label:R9327423 | Queued attachments | CHAT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | aria_label:R9573518 | Also reset files | CHAT-15: no catalogue state shows it |
| a | gap-unshown (unshown) | aria_label:R9605986 | Scroll to bottom | CHAT-06: no catalogue state shows it |
| a | gap-unshown (unshown) | aria_label:R9964533 | Updating diff | REV-02: no catalogue state shows it |
| a | gap-unshown (unshown) | aria_label:R9970155 | Dismiss diff rendering warning | REV-02: no catalogue state shows it |
| a | gap-missing (feature) | aria_label:R9987343 | Loading attachment | not in our UI |
| a | gap-unshown (unshown) | aria_label:R10032976 | Request review | PR-06: no catalogue state shows it |
| a | gap-unshown (unshown) | aria_label:R10247681 | Unarchive workspace | WS-06: no catalogue state shows it |
| a | gap-unshown (unshown) | aria_label:R10276677 | Loading workspaces | NAV-03: no catalogue state shows it |
| a | gap-missing (feature) | aria_label:R10289853 | Toggle sidebar | not in our UI |
| a | gap-missing (feature) | aria_label:R10292173 | Resize sidebar | not in our UI |
| a | gap-missing (feature) | aria_label:R10295355 | Unavailable in this version | not in our UI |
| a | gap-missing (feature) | aria_label:R10329806 | Private workspace | not in our UI |
| a | gap-unshown (unshown) | aria_label:R10464425 | Pinned workspaces | no catalogue state shows it |
| a | gap-unshown (unshown) | aria_label:R10504137 | Creating workspace... | WS-01: no catalogue state shows it |
| a | gap-missing (feature) | aria_label:R10515645 | My workspaces | not in our UI |
| a | gap-missing (feature) | aria_label:R10770111 | Scanning local MCP servers | not in our UI |
| a | gap-unshown (unshown) | aria_label:R10822492 | Done | no catalogue state shows it |
| a | gap-unshown (unshown) | aria_label:R10876245 | Loading environment variables | no catalogue state shows it |
| a | gap-missing (feature) | aria_label:R11022769 | Show action | not in our UI |
| a | gap-missing (feature) | aria_label:R11023000 | Hide action | not in our UI |
| a | gap-missing (feature) | aria_label:R11023468 | Delete action | not in our UI |
| a | gap-missing (feature) | aria_label:R11147513 | First local port | CLOUD-17: not in our UI |
| a | gap-missing (feature) | aria_label:R11147939 | Last local port | not in our UI |
| a | gap-missing (feature) | aria_label:R11156373 | Remote port | CLOUD-09: not in our UI |
| a | gap-missing (feature) | aria_label:R11156789 | Local port | CLOUD-09: not in our UI |
| a | gap-missing (feature) | aria_label:R11157100 | Add override | CLOUD-09: not in our UI |
| a | gap-missing (feature) | aria_label:R11319788 | Back to commands | not in our UI |
| a | gap-unshown (unshown) | aria_label:R11328531 | Loading | no catalogue state shows it |
| a | gap-unshown (unshown) | aria_label:R11676490 | Reload | RUN-04: no catalogue state shows it |
| a | gap-unshown (unshown) | aria_label:R11676943 | Port and path | RUN-04: no catalogue state shows it |
| a | gap-unshown (unshown) | aria_label:R11677566 | Open in browser | RUN-04: no catalogue state shows it |
| a | gap-missing (feature) | aria_label:R11703477 | Minimize | not in our UI |
| a | gap-missing (feature) | aria_label:R11703813 | Maximize | not in our UI |
| a | gap-missing (feature) | aria_label:R11762034 | Search settings shortcut | not in our UI |
| a | gap-missing (feature) | aria_label:R11762597 | Clear settings search | not in our UI |
| a | gap-unshown (unshown) | aria_label:R11996180 | Status | no catalogue state shows it |
| a | gap-unshown (unshown) | aria_label:R12021308 | Pull requests | no catalogue state shows it |
| a | gap-missing (feature) | placeholder:R1898620 | Search repositories... | APP-04: not in our UI |
| a | gap-unshown (unshown) | placeholder:R2754036 | Select target branch... | REV-01: no catalogue state shows it |
| a | gap-unshown (unshown) | placeholder:R4632855 | Search icons | RUN-01: no catalogue state shows it |
| a | gap-unshown (unshown) | placeholder:R4987113 | Action name | RUN-01: no catalogue state shows it |
| a | gap-missing (feature) | placeholder:R5444083 | Remote port | CLOUD-09: not in our UI |
| a | gap-missing (feature) | placeholder:R5645838 | Search files... | not in our UI |
| a | gap-missing (feature) | placeholder:R5652247 | Search in files... | Checked by hand: the wording differs. Ours reads "Search in files" (text) in command-palette. |
| a | gap-unshown (unshown) | placeholder:R5664306 | Search issues... | PR-09: no catalogue state shows it |
| a | gap-missing (feature) | placeholder:R5685793 | Search workspaces... | Checked by hand: the wording differs. Ours reads "Search workspaces" (aria-label) in first-run-home. |
| a | gap-missing (feature) | placeholder:R5692826 | Search directories or type a nested path like apps/web... | not in our UI |
| a | gap-unshown (unshown) | placeholder:R9730040 | Add a comment for the AI | REV-03: no catalogue state shows it |
| a | gap-unshown (unshown) | placeholder:R9856436 | Replace | no catalogue state shows it |
| a | gap-unshown (unshown) | placeholder:R10669494 | Enter font name... | no catalogue state shows it |
| a | gap-unshown (unshown) | placeholder:R10672939 | Leave empty for default | no catalogue state shows it |
| a | gap-missing (feature) | placeholder:R10680280 | my-agent --flag | not in our UI |
| a | gap-missing (feature) | placeholder:R10770889 | Search MCP servers... | not in our UI |
| a | gap-missing (feature) | placeholder:R10779334 | Search installed MCPs | not in our UI |
| a | gap-missing (feature) | placeholder:R10780577 | Search recommended MCPs | not in our UI |
| a | gap-missing (feature) | placeholder:R11021601 | My action | not in our UI |
| a | gap-unshown (unshown) | placeholder:R11319420 | Search sections… | NAV-08: no catalogue state shows it |
| a | gap-unshown (unshown) | placeholder:R11951239 | Branch | no catalogue state shows it |
| a | gap-missing (feature) | title:M948377 | GitHub sign-in expired | not in our UI |
| a | gap-missing (feature) | title:M952355 | GitHub token rejected | not in our UI |
| a | gap-missing (feature) | title:M1183209 | You don't have access to this workspace | NAV-10: not in our UI |
| a | gap-unshown (unshown) | title:M1183322 | Workspace not found | NAV-10: no catalogue state shows it |
| a | gap-missing (feature) | title:M1183476 | You can't open this workspace | NAV-10: not in our UI |
| a | gap-missing (feature) | title:M3096088 | Couldn't load your shell environment | not in our UI |
| a | gap-missing (feature) | title:M3096230 | Couldn't find your login shell | not in our UI |
| a | gap-missing (feature) | title:M3847163 | Try to match | not in our UI |
| a | gap-missing (feature) | title:M3847315 | Always use port range | not in our UI |
| a | gap-missing (feature) | title:R1717947 | Select project directory | not in our UI |
| a | gap-missing (feature) | title:R1892068 | Choose where to clone the repository | PRJ-02: not in our UI |
| a | gap-unshown (unshown) | title:R2031302 | Choose where to create the project | no catalogue state shows it |
| a | gap-unshown (unshown) | title:R2093263 | Loading chats | CHAT-01: no catalogue state shows it |
| a | gap-unshown (unshown) | title:R2093709 | No open chats | CHAT-01: no catalogue state shows it |
| a | gap-unshown (unshown) | title:R2137781 | PR info unavailable | GIT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | title:R2138221 | GitHub access required | GIT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | title:R2139138 | No internet connection | GIT-04: no catalogue state shows it |
| a | gap-missing (feature) | title:R2141079 | Loading status... | GIT-04: not in our UI |
| a | gap-unshown (unshown) | title:R2142068 | Blocked from merging | GIT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | title:R2145200 | Merge conflicts | GIT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | title:R2145377 | PR changes requested | GIT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | title:R2148149 | Unable to merge | GIT-04: no catalogue state shows it |
| a | gap-missing (feature) | title:R2623659 | Close filter | REV-01: not in our UI |
| a | gap-unshown (unshown) | title:R2649785 | Conflicts | no catalogue state shows it |
| a | gap-missing (feature) | title:R2649847 | Clean | not in our UI |
| a | gap-unshown (unshown) | title:R2667864 | Select adjacent PRs to see their changes | no catalogue state shows it |
| a | gap-missing (feature) | title:R3621572 | setup draw | not in our UI |
| a | gap-missing (feature) | title:R5685048 | Select directory to link | not in our UI |
| a | gap-unshown (unshown) | title:R9949267 | Failed to open editor | REV-02: no catalogue state shows it |
| a | gap-missing (feature) | title:R9975554 | Couldn't load file changes | REV-01: not in our UI |
| a | gap-unshown (unshown) | title:R9976123 | No files match this filter | REV-01: no catalogue state shows it |
| a | gap-missing (feature) | title:R9999611 | Open comment on GitHub | not in our UI |
| a | gap-missing (feature) | title:R10001462 | Open comment | not in our UI |
| a | gap-missing (feature) | title:R10009303 | Open commit on GitHub | not in our UI |
| a | gap-unshown (unshown) | title:R10045277 | Closed | GIT-04: no catalogue state shows it |
| a | gap-missing (feature) | title:R10045807 | Blocked | GIT-04: not in our UI |
| a | gap-unshown (unshown) | title:R10046191 | Checking mergeability... | GIT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | title:R10062089 | Workspace archived | WS-06: no catalogue state shows it |
| a | gap-missing (feature) | title:R10065307 | This chat tab failed to render | NAV-10: not in our UI |
| a | gap-unshown (unshown) | title:R10199869 | Error loading workspace | NAV-10: no catalogue state shows it |
| a | gap-unshown (unshown) | title:R10303877 | Activity | PR-07: no catalogue state shows it |
| a | gap-missing (feature) | title:R10678486 | Big terminal | not in our UI |
| a | gap-missing (feature) | title:R11159986 | Exclusive port forwarding | CLOUD-09: not in our UI |
| a | gap-missing (feature) | title:R11160334 | Forwarding strategies | CLOUD-09: not in our UI |
| a | gap-missing (feature) | title:R11161279 | Local port range | CLOUD-09: not in our UI |
| a | gap-missing (feature) | title:R11161641 | Manual overrides | CLOUD-09: not in our UI |
| a | gap-unshown (unshown) | title:R11557358 | Connect GitHub | SET-02: no catalogue state shows it |
| a | gap-missing (feature) | title:R11608905 | You're all set | not in our UI |
| a | gap-missing (feature) | title:R11687823 | Workspace unavailable | CLOUD-03: not in our UI |
| a | gap-missing (feature) | title:R12038786 | Database rollback | not in our UI |
| a | gap-unshown (unshown) | tooltip:M1432993 | This message could not be displayed. | CHAT-06: no catalogue state shows it |
| a | gap-unshown (unshown) | tooltip:R1717507 | Copy error | no catalogue state shows it |
| a | gap-missing (feature) | tooltip:R8414164 | inline* | not in our UI |
| a | gap-missing (feature) | tooltip:R8922004 | block+ | not in our UI |
| a | gap-missing (feature) | tooltip:R8925669 | text* | not in our UI |
| a | gap-missing (feature) | tooltip:R8966854 | paragraph block* | not in our UI |
| a | gap-unshown (unshown) | tooltip:R10033594 | Request review | PR-06: no catalogue state shows it |
| a | gap-missing (feature) | description:M948441 | Reconnect GitHub in Settings to keep pushing changes. | not in our UI |
| a | gap-missing (feature) | description:M952385 | Your personal access token may be expired or revoked. Update it in Settings. | not in our UI |
| a | gap-missing (feature) | description:M3096133 | Agents will run without it. | not in our UI |
| a | gap-missing (feature) | description:M3096269 | Agents will run without your shell env. | not in our UI |
| a | gap-missing (feature) | description:M3140028 | Failed to start authentication | not in our UI |
| a | gap-missing (feature) | description:M3847184 | Use the same local port as the remote port when it's free. Otherwise pick from the local port range. | not in our UI |
| a | gap-missing (feature) | description:M3847345 | Pick every local port from the local port range. | not in our UI |
| a | gap-missing (feature) | description:R1717331 | Please try again. | APP-02: not in our UI |
| a | gap-missing (feature) | description:R2129942 | Check your connection and try again. | not in our UI |
| a | gap-unshown (unshown) | description:R2668060 | Its commits aren't in this workspace | no catalogue state shows it |
| a | gap-missing (feature) | description:R5493845 | This workspace failed to start. | not in our UI |
| a | gap-missing (feature) | description:R8679569 | Authorization failed. Try connecting the MCP server again. | not in our UI |
| a | gap-missing (feature) | description:R8684406 | Try connecting the MCP server again. | not in our UI |
| a | gap-missing (feature) | description:R9949297 | An error occurred while opening the editor. | not in our UI |
| a | gap-unshown (unshown) | description:R10062116 | Unarchive this workspace to view files, terminals, and browser previews. | WS-06: no catalogue state shows it |
| a | gap-missing (feature) | description:R10065346 | Switch tabs or try rendering this chat again. | NAV-10: not in our UI |
| a | gap-missing (feature) | description:R10678507 | Configure big terminal mode behavior (⌘⇧T). | not in our UI |
| a | gap-missing (feature) | description:R11160020 | Turning on port forwarding in one workspace turns it off everywhere else | CLOUD-09: not in our UI |
| a | gap-missing (feature) | description:R11160364 | How new forwards choose their local port. Existing forwards keep their ports. | CLOUD-09: not in our UI |
| a | gap-missing (feature) | description:R11161304 | Used for forwards that don't match their remote port number. | CLOUD-09: not in our UI |
| a | gap-missing (feature) | description:R11539515 | This permanently deletes the artifact and all its versions. | not in our UI |
| a | gap-missing (feature) | description:R11709706 | Configure action-specific behavior and instructions for this repository. | not in our UI |
| a | gap-missing (feature) | description:R11737185 | Couldn't load repository settings. Try again. | not in our UI |
| a | gap-missing (feature) | description:R12095963 | The update will download automatically in the background. | APP-06: not in our UI |
| a | gap-missing (feature) | description:R12096092 | You're running the latest version of Conductor. | APP-06: not in our UI |
| a | gap-unshown (unshown) | toast:M389857 | Can't save setting because your settings file is invalid | DATA-05: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:M390047 | Failed to save setting | DATA-05: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:M394092 | Failed to load settings | DATA-05: no catalogue state shows it |
| a | gap-missing (feature) | toast:M409156 | Setting is controlled by a feature flag | not in our UI |
| a | gap-unshown (unshown) | toast:M462115 | Shared repository settings are read-only in Conductor. Edit the settings file directly. | DATA-05: no catalogue state shows it |
| a | gap-missing (feature) | toast:M2099774 | Failed to add comment to chat | not in our UI |
| a | gap-missing (feature) | toast:M2100103 | Failed to save comment | not in our UI |
| a | gap-missing (feature) | toast:M3139338 | Signed out successfully | not in our UI |
| a | gap-missing (feature) | toast:M3139996 | Authentication failed | not in our UI |
| a | gap-missing (feature) | toast:M3243420 | Microphone access denied. | PLAT-12: not in our UI |
| a | gap-missing (feature) | toast:M3244635 | Failed to initialize speech-to-text. | PLAT-12: not in our UI |
| a | gap-missing (feature) | toast:M3581318 | Couldn't save template | not in our UI |
| a | gap-missing (feature) | toast:M3581736 | Couldn't delete template | not in our UI |
| a | gap-missing (feature) | toast:M3582162 | Couldn't delete artifact | not in our UI |
| a | gap-missing (feature) | toast:M3582639 | Couldn't add template | not in our UI |
| a | gap-missing (feature) | toast:M3636992 | Couldn't reopen chat. Try again. | not in our UI |
| a | gap-unshown (unshown) | toast:M3735892 | Failed to attach setup context | WS-03: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:M3743541 | Setup script failed. Check the setup tab for logs. | WS-03: no catalogue state shows it |
| a | gap-missing (feature) | toast:M3750302 | Couldn’t check for open pull requests. Close them on GitHub if needed. | not in our UI |
| a | gap-missing (feature) | toast:M3756589 | Restarted workspace | CLOUD-15: not in our UI |
| a | gap-missing (feature) | toast:M3825227 | No terminal emulator found | not in our UI |
| a | gap-missing (feature) | toast:R140842 | Couldn't save your default personality. Try again. | not in our UI |
| a | gap-missing (feature) | toast:R227819 | Failed to attach file | PLAT-20: not in our UI |
| a | gap-missing (feature) | toast:R236876 | Some saved models require a newer version of Conductor. | not in our UI |
| a | gap-missing (feature) | toast:R252371 | Couldn't save loadouts. Try again. | not in our UI |
| a | gap-unshown (unshown) | toast:R1714656 | Failed to create workspace | WS-01: no catalogue state shows it |
| a | gap-missing (feature) | toast:R1717306 | Failed to copy | CHAT-29: not in our UI |
| a | gap-unshown (unshown) | toast:R2035043 | Project created. | no catalogue state shows it |
| a | gap-missing (feature) | toast:R2489534 | File is outside the synced workspace | CLOUD-11: not in our UI |
| a | gap-missing (feature) | toast:R2489876 | Remote open is only supported for VS Code, Cursor, and Zed | CLOUD-12: not in our UI |
| a | gap-missing (feature) | toast:R2504857 | No workspace path available | WS-08: not in our UI |
| a | gap-missing (feature) | toast:R2504925 | Workspace is still loading, try again | WS-08: not in our UI |
| a | gap-unshown (unshown) | toast:R2505067 | This app can't open this path | WS-08: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R2505156 | Failed to prepare file to open | WS-08: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R2506351 | No default app configured | WS-08: no catalogue state shows it |
| a | gap-missing (feature) | toast:R2520921 | No active chat selected. | not in our UI |
| a | gap-unshown (unshown) | toast:R3020329 | Folders can’t be uploaded | COMP-07: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R4998666 | Workspace is not ready for local terminals. | RUN-06: no catalogue state shows it |
| a | gap-missing (feature) | toast:R5000520 | No active chat to send setup request to | not in our UI |
| a | gap-missing (feature) | toast:R5007891 | Unable to start: workspace or repository not found | not in our UI |
| a | gap-missing (feature) | toast:R5432175 | Preview URL copied to clipboard | not in our UI |
| a | gap-missing (feature) | toast:R5443582 | Enter a valid port (1-65535) | CLOUD-10: not in our UI |
| a | gap-missing (feature) | toast:R5443642 | Port 22 is reserved for SSH and cannot be forwarded here | CLOUD-10: not in our UI |
| a | gap-missing (feature) | toast:R5453992 | Forwarding ports | CLOUD-10: not in our UI |
| a | gap-missing (feature) | toast:R5493916 | Copied link | not in our UI |
| a | gap-missing (feature) | toast:R5493957 | Failed to copy link | not in our UI |
| a | gap-missing (feature) | toast:R8679526 | Couldn't connect this MCP server | not in our UI |
| a | gap-missing (feature) | toast:R8680643 | Try connecting the MCP server again. | not in our UI |
| a | gap-missing (feature) | toast:R8684256 | Couldn't stop waiting | not in our UI |
| a | gap-missing (feature) | toast:R8684358 | Couldn't open your browser to connect | not in our UI |
| a | gap-missing (feature) | toast:R8684476 | Connection timed out | not in our UI |
| a | gap-missing (feature) | toast:R8701195 | Failed to reset setting | not in our UI |
| a | gap-missing (feature) | toast:R8889053 | FYI: When you switch effort mid-chat with Claude, your next response will be slower and use more tokens. | not in our UI |
| a | gap-missing (feature) | toast:R8889231 | FYI: When you switch models mid-chat, your next response will be slower and use more tokens. | not in our UI |
| a | gap-missing (feature) | toast:R8920359 | Speech recording failed. | PLAT-12: not in our UI |
| a | gap-unshown (unshown) | toast:R9948837 | Failed to open editor | WS-08: no catalogue state shows it |
| a | gap-missing (feature) | toast:R9953202 | File changed on disk. Keep or discard your edits to save. | REV-08: not in our UI |
| a | gap-missing (feature) | toast:R10074815 | Failed to close other chats. Try again. | not in our UI |
| a | gap-missing (feature) | toast:R10074989 | No chat content to copy | not in our UI |
| a | gap-missing (feature) | toast:R10075328 | Copied session info | not in our UI |
| a | gap-missing (feature) | toast:R10075377 | Failed to copy session info | not in our UI |
| a | gap-missing (feature) | toast:R10085340 | Terminal settings are still loading. | RUN-06: not in our UI |
| a | gap-missing (feature) | toast:R10085400 | Failed to load terminal settings. | RUN-06: not in our UI |
| a | gap-missing (feature) | toast:R10105621 | Couldn't open preview: local workspace mirror is unavailable. | CLOUD-11: not in our UI |
| a | gap-missing (feature) | toast:R10110444 | Failed to close chat. Try again. | not in our UI |
| a | gap-missing (feature) | toast:R10111109 | Workspace is not ready yet. | not in our UI |
| a | gap-unshown (unshown) | toast:R10477591 | Couldn't delete section | NAV-04: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R10522795 | Couldn't reorder section | NAV-04: no catalogue state shows it |
| a | gap-missing (feature) | toast:R10572663 | Failed to copy report to clipboard | not in our UI |
| a | gap-missing (feature) | toast:R10572819 | Console logs copied to clipboard | not in our UI |
| a | gap-missing (feature) | toast:R10573129 | No workspace available. Create a workspace first. | not in our UI |
| a | gap-missing (feature) | toast:R10581997 | Failed to copy logs | APP-03: not in our UI |
| a | gap-unshown (unshown) | toast:R10582102 | App logs copied | APP-03: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R10588207 | Couldn't finish setup. Please try again. | APP-02: no catalogue state shows it |
| a | gap-unshown (unshown) | toast:R10871822 | Couldn't update your environment variables | SET-04: no catalogue state shows it |
| a | gap-missing (feature) | toast:R11015771 | Action names can't be empty | not in our UI |
| a | gap-missing (feature) | toast:R11146597 | Couldn't update the local port range | CLOUD-17: not in our UI |
| a | gap-missing (feature) | toast:R11150870 | Couldn't update the forwarding strategy | CLOUD-17: not in our UI |
| a | gap-missing (feature) | toast:R11153716 | Couldn't update manual overrides | not in our UI |
| a | gap-missing (feature) | toast:R11203171 | Failed to reset callout dismissals | not in our UI |
| a | gap-missing (feature) | toast:R11203233 | Callout dismissals reset | not in our UI |
| a | gap-missing (feature) | toast:R11326426 | Copied the prompt | not in our UI |
| a | gap-missing (feature) | toast:R11326469 | Couldn't copy the prompt | not in our UI |
| a | gap-missing (feature) | toast:R11608299 | Couldn't create the admin workspace: Your computer has no repositories. Add a repository and try again. | not in our UI |
| a | gap-missing (feature) | toast:R11608457 | Couldn't create the admin workspace: Your computer isn't ready yet. Try again. | not in our UI |
| a | gap-missing (feature) | toast:R11699632 | Failed to attach terminal selection | RUN-06: not in our UI |
| a | gap-missing (feature) | toast:R11739982 | Failed to save keyboard shortcut | not in our UI |
| a | gap-missing (feature) | toast:R12096061 | You're up to date! | APP-06: not in our UI |
| a | gap-unshown (unshown) | literal:M18119 | Download | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M18192 | Video | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M271945 | Promise | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M433895 | Geist Mono | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M586780 | Content-Type | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M643972 | Rebase and merge | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M667863 | Merging | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M795341 | Syncing | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M958089 | PRAGMA journal_mode = WAL | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M1077722 | Couldn't configure Git push upstream settings. PR info may be less reliable until this branch has an upstream. | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M1086777 | Initial commit | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M1373821 | SKILL.md | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M1419600 | Bash | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M1520540 | Right | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M2044531 | PR instructions.md | GIT-17: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M2044552 | Review request.md | GIT-17: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M2044572 | Fix errors instructions.md | GIT-17: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M2044601 | Branch continued.md | GIT-17: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M2298484 | Image | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M2325013 | Action | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M2515610 | Plugin | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M2516003 | Log | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M2656909 | No priority | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M3099729 | Plan ready. Click to review and approve the plan. | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M3100221 | Agent has a question. Click to answer it. | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M3236681 | Agent finished. Click to view session. | CHAT-19: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M3236722 | Agent failed. Click to view session. | CHAT-19: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M3736277 | Couldn't fetch remote updates. Creating the workspace from the latest local revision. | WS-03: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:M3833560 | SSH to the remote is blocked; HTTPS retry also failed | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R495687 | Visual Studio Code | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R496045 | Zed | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R496563 | VSCodium | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R496750 | Devin Desktop | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R496935 | Sublime Text | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R497089 | PyCharm | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R497465 | IntelliJ IDEA | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R498265 | Android Studio | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R498455 | Xcode | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R498591 | Rider | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R498754 | RubyMine | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R498926 | WebStorm | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R499098 | PhpStorm | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R499293 | Ghostty | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R499400 | Alacritty | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R499635 | WezTerm | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R499764 | Warp | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R499858 | Hyper | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R500118 | GitHub Desktop | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R500245 | Sourcetree | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R500355 | Fork | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R500461 | Kaleidoscope | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R500605 | GoLand | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R500771 | DataGrip | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R500939 | Trae | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R501124 | Antigravity | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R710800 | Go | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R715089 | Markdown | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R853678 | Regex | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R1361690 | Forward | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2141251 | Remote branch was rebased | GIT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2141279 | Incompatible with remote | GIT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2149903 | Stack needs a rebase | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2236069 | Resolve branch incompatibility with remote | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2259789 | PR is in draft | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2271909 | Skipped | PR-04: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2273883 | Re-run | PR-04: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2517578 | Attach in chat | REV-06: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2517763 | Open in | NAV-08: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2518339 | Copy relative path | REV-06: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2644422 | No changes in the selected PRs | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R2763995 | Show flat list | REV-01: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R3081756 | Cut | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R3083063 | Push | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R3122139 | File | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R3122276 | Hint | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R3122529 | Left | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R3123193 | Section | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R3167503 | Result | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R3352836 | Channel | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R3392824 | Annotate | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R3408782 | Confirm | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R3418027 | Directory | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R3420339 | Down | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R3424646 | Expand | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R3444964 | Install | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R3458066 | Messages | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R3465496 | On | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R3465826 | Optional | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R3468980 | Paste | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R3470217 | Pick | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R3471013 | Plus | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R3494596 | Tasks | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R3501304 | Up | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R3896824 | Send | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R4950293 | Shell | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R4986695 | Edit action | RUN-01: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R4988948 | Saving... | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R4997852 | Configure actions | RUN-01: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R5023567 | Start spotlight | RUN-02: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R5646000 | No files found | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R5655678 | Invalid regular expression | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R5655738 | No matches | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R5664567 | Searching issues... | PR-09: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R5664589 | Loading your issues... | PR-09: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R5664683 | Search results | PR-09: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R5664700 | Recent issues | PR-09: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R5673483 | Loading MCP servers… | SET-05: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R5673831 | No MCP servers configured. | SET-05: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R7864999 | Comment | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R8034448 | Diagram | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R8684721 | Disconnected | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R8718221 | Couldn't load MCP servers | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R8877958 | Needs auth | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R8878057 | Disabled | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R8909467 | Stop recording | COMP-08: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R8909486 | Transcribing | COMP-08: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R8911246 | Transcribing... | COMP-08: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R8914823 | Save edit | CHAT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R8914848 | Queue message | COMP-01: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9234615 | Not supported | COMP-02: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9235510 | Not supported for this model | COMP-02: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9260202 | Copy plan to clipboard | CHAT-12: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9324600 | Expand queue | CHAT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9325309 | Resume | CHAT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9328642 | Save and steer | CHAT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9559666 | Command | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9588439 | Fork to new tab | CHAT-16: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9588564 | Fork to new workspace | CHAT-21: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9588756 | Reset chat | CHAT-15: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R9984405 | Edit PR title | PR-07: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R10013192 | Copy details | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R10089377 | New chat, same files | NAV-10: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R10223000 | Cost | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R10227903 | Unstarted | WS-11: no catalogue state shows it |
| a | gap-missing (feature) | literal:R10228149 | Working | Checked by hand: the wording differs. Ours reads "Working..." (aria-label) in sidebar. |
| a | gap-unshown (unshown) | literal:R10228299 | In merge queue | GIT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R10228429 | Merge conflict | GIT-04: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R10228554 | Pull request open | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R10470389 | Sections | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R10476438 | Edit section | NAV-04: no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R10477343 | Delete section | NAV-04: no catalogue state shows it |
| a | gap-missing (feature) | literal:R10495167 | Add project… | PRJ-01: Checked by hand: the wording differs. Ours reads "Add project" (text) in command-palette. |
| a | gap-unshown (unshown) | literal:R10574968 | Run again | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R10576510 | Copy redacted report | no catalogue state shows it |
| a | gap-missing (feature) | literal:R10902737 | Try again. | Checked by hand: the wording differs. Ours reads "Try again" (text) in settings-agents-error. |
| a | gap-missing (feature) | literal:R11342763 | Added | Checked by hand: the wording differs. Ours reads "added" (text) in chat-finished. |
| a | gap-unshown (unshown) | literal:R11346070 | Search projects... | no catalogue state shows it |
| a | gap-unshown (unshown) | literal:R11346111 | Search actions... | no catalogue state shows it |
| a | gap-missing (feature) | literal:R11346152 | Search settings... | Checked by hand: the wording differs. Ours reads "Search settings" (aria-label) in settings-general. |
| a | gap-unshown (unshown) | literal:R11708982 | Ports | no catalogue state shows it |
| a | gap-missing (feature) | route:M1114939 | /workspaces | not in our UI |
| a | gap-missing (feature) | route:R1714453 | /repository/$repositoryId/workspace/$localWorkspaceId | WS-01: not in our UI |
| a | gap-missing (feature) | route:R2960849 | /settings/repos | NAV-02: not in our UI |
| a | gap-missing (feature) | route:R2960925 | /settings/repos/$repoId/scripts | NAV-02: not in our UI |
| a | gap-missing (feature) | route:R2961215 | /settings/repos/$repoId/actions | NAV-02: not in our UI |
| a | gap-missing (feature) | route:R5008856 | /settings/repos/$repoId/misc | not in our UI |
| a | gap-missing (feature) | route:R9253487 | /settings/user/models | not in our UI |
| a | gap-unshown (unshown) | route:R10407696 | /dashboard | no catalogue state shows it |
| a | gap-missing (feature) | route:R10411413 | /pull-requests | not in our UI |
| a | gap-missing (feature) | route:R11312381 | /settings/user/internal | not in our UI |
| a | gap-missing (feature) | route:R11704796 | /login | not in our UI |
| a | gap-missing (feature) | route:R11732135 | /settings/user/experimental | not in our UI |
| a | gap-missing (feature) | route:R11779761 | /settings/user | not in our UI |
| a | gap-unshown (unshown) | route:R11783496 | /settings | no catalogue state shows it |
| a | gap-missing (feature) | route:R11783578 | /user | not in our UI |
| a | gap-missing (feature) | route:R11783949 | /providers | not in our UI |
| a | gap-missing (feature) | route:R11784032 | /environment | not in our UI |
| a | gap-missing (feature) | route:R11784112 | /connections | not in our UI |
| a | gap-missing (feature) | route:R11784178 | /ports | not in our UI |
| a | gap-missing (feature) | route:R11784222 | /settings/user/connections | not in our UI |
| a | gap-missing (feature) | route:R11784338 | /remote-control | not in our UI |
| a | gap-missing (feature) | route:R11784428 | /key-bindings | not in our UI |
| a | gap-missing (feature) | route:R11784537 | /terminal | not in our UI |
| a | gap-missing (feature) | route:R11784600 | /internal | not in our UI |
| a | gap-missing (feature) | route:R11785462 | /repos | NAV-02: not in our UI |
| a | gap-missing (feature) | route:R11785714 | /repos/$repoId | NAV-02: not in our UI |
| a | gap-missing (feature) | route:R11785937 | /git | not in our UI |
| a | gap-missing (feature) | route:R11785995 | /scripts | not in our UI |
| a | gap-missing (feature) | route:R11786057 | /actions | not in our UI |
| a | gap-missing (feature) | route:R11786119 | /misc | not in our UI |
| a | gap-missing (feature) | route:R11786352 | /github | not in our UI |
| a | gap-missing (feature) | route:R11786604 | /mcp | COMP-06: not in our UI |
| a | gap-missing (feature) | route:R11786662 | /mcp-servers | not in our UI |
| a | gap-missing (feature) | route:R11786789 | /prompts | COMP-06: not in our UI |
| a | gap-missing (feature) | route:R11786851 | /repositories/$owner/$repo | COMP-06: not in our UI |
| a | gap-missing (feature) | route:R12032539 | /dev/simulated-route-error | not in our UI |
| a | gap-missing (feature) | test_id:R9050252 | composer-input | not in our UI |
| a | gap-missing (feature) | test_id:R9473251 | virtuoso-list | not in our UI |
| a | gap-missing (feature) | test_id:R10242215 | workspace-status-matrix-merged-pattern | not in our UI |
| a | gap-missing (feature) | test_id:R10242406 | workspace-status-matrix-error-pattern | not in our UI |
| a | gap-missing (feature) | test_id:R10242632 | workspace-status-matrix-overlay | not in our UI |
| a | gap-missing (feature) | test_id:R10242893 | workspace-status-matrix-automation-arrow | not in our UI |
| a | gap-missing (feature) | test_id:R11550278 | onboarding-setup-scene | not in our UI |
| a | gap-missing (feature) | test_id:R12001662 | routine-prompt-composer | not in our UI |

### Workspace chat (255)

| Check | Code | Where | Text | Detail |
| --- | --- | --- | --- | --- |
| b | ours-only | chat-finished, chat-tool-calls, workspace-actions-menu, chat-tab-menu | 3 tool calls, 2 messages | span text: [data-testid="virtuoso-item-list"] > div > div > button > span > span:nth-of-type(1) |
| b | ours-only | chat-finished, chat-tool-calls, chat-markdown, chat-working, chat-approval, chat-question, chat-plan-review, workspace-actions-menu, chat-tab-menu | ⌘L to focus | div text: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(6) > div > |
| b | ours-only | chat-finished, chat-tool-calls, workspace-actions-menu, chat-tab-menu | 5files changed | span text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div:nth-of-type(1) > span:nth-of-type(1) |
| b | ours-only | chat-finished, chat-finished, chat-tool-calls, chat-tool-calls, workspace-actions-menu, workspace-actions-menu, chat-tab-menu, chat-tab-menu | added | span text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div:nth-of-type(2) > div > div:nth-of-type(1) > div > s |
| b | ours-only | chat-finished, chat-finished, chat-tool-calls, chat-tool-calls, workspace-actions-menu, workspace-actions-menu, chat-tab-menu, chat-tab-menu | modified | span text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div:nth-of-type(2) > div > div:nth-of-type(2) > div > s |
| b | ours-only | chat-finished, chat-tool-calls, chat-markdown, chat-working, chat-approval, chat-question, chat-plan-review, workspace-actions-menu, chat-tab-menu | Dev | span text: [data-testid="scripts-panel"] > div > div > div > div:nth-of-type(2) > div:nth-of-type(2) > div > div:nth-of-type(1) > button:nth-of-type(1) > span |
| b | ours-only | chat-finished, chat-tool-calls, chat-markdown, chat-working, chat-approval, chat-question, chat-plan-review, workspace-actions-menu, chat-tab-menu | Sidebar | aside aria-label: [data-testid="sidebar"] > div > aside |
| b | ours-only | chat-finished, chat-tool-calls, chat-markdown, chat-working, chat-approval, chat-question, chat-plan-review, workspace-actions-menu, chat-tab-menu | Main | nav aria-label: [data-testid="sidebar"] > div > aside > div:nth-of-type(2) > div > nav |
| b | ours-only | chat-finished, chat-finished, chat-tool-calls, chat-tool-calls, chat-markdown, chat-markdown, chat-working, chat-working, chat-approval, chat-approval, chat-que | Create workspace in atlas | link aria-label: [data-testid="sidebar"] > div > aside > div:nth-of-type(2) > div > div:nth-of-type(1) > div > section:nth-of-type(1) > div > div:nth-of-type(1) |
| b | ours-only | chat-finished, chat-finished, chat-tool-calls, chat-tool-calls, chat-markdown, chat-markdown, chat-working, chat-working, chat-approval, chat-approval, chat-que | Create workspace in relay | link aria-label: [data-testid="sidebar"] > div > aside > div:nth-of-type(2) > div > div:nth-of-type(1) > div > section:nth-of-type(2) > div > div:nth-of-type(1) |
| b | ours-only | chat-finished, chat-tool-calls, chat-working, chat-approval, workspace-actions-menu, chat-tab-menu | atlas icon | img aria-label: [data-testid="main-content"] > div > div > div:nth-of-type(1) > div > div > div:nth-of-type(1) > span:nth-of-type(1) |
| b | ours-only | chat-finished, workspace-actions-menu, chat-tab-menu | Expand 3 tool calls, 2 messages | button aria-label: [data-testid="virtuoso-item-list"] > div > div > button |
| b | ours-only | chat-finished, chat-tool-calls, chat-markdown, chat-approval, chat-question, chat-plan-review, workspace-actions-menu, chat-tab-menu | Turn details | button aria-label: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(3) > button |
| b | ours-only | chat-finished, chat-tool-calls, workspace-actions-menu, chat-tab-menu | Files changed in this turn | section aria-label: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(3) > section |
| b | ours-only | chat-finished, chat-tool-calls, workspace-actions-menu, chat-tab-menu | Modified: src/auth/sign-in.ts | button title: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(3) > section > button:nth-of-type(1) |
| b | ours-only | chat-finished, chat-tool-calls, workspace-actions-menu, chat-tab-menu | Added: src/auth/safe-next.ts | button title: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(3) > section > button:nth-of-type(2) |
| b | ours-only | chat-finished, chat-tool-calls, workspace-actions-menu, chat-tab-menu | Added: src/auth/safe-next.test.ts | button title: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(3) > section > button:nth-of-type(3) |
| b | ours-only | chat-finished, chat-tool-calls, chat-markdown, chat-working, chat-approval, chat-question, chat-plan-review, workspace-actions-menu, chat-tab-menu | composer | textbox aria-label: [data-testid="composer-editor"] > div > div |
| b | ours-only | chat-finished, chat-tool-calls, chat-markdown, chat-working, chat-approval, chat-question, chat-plan-review, workspace-actions-menu, chat-tab-menu | Model picker | button aria-label: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(6 |
| b | ours-only | chat-finished, chat-tool-calls, chat-markdown, chat-working, chat-approval, chat-question, chat-plan-review, workspace-actions-menu, chat-tab-menu | Claude Code: change agent | button title: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(6) > d |
| b | ours-only | chat-finished, chat-tool-calls, chat-markdown, chat-working, chat-approval, chat-question, chat-plan-review, workspace-actions-menu, chat-tab-menu | Changes and scripts | aside aria-label: [data-testid="right-panel"] > div > aside |
| b | ours-only | chat-finished, chat-tool-calls, chat-markdown, chat-working, chat-approval, chat-question, chat-plan-review, workspace-actions-menu, chat-tab-menu | Review options | button aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > button:nth-of-type(2) |
| b | ours-only | chat-finished, chat-tool-calls, chat-markdown, chat-working, chat-approval, chat-question, chat-plan-review, workspace-actions-menu, chat-tab-menu | Search changed files | button aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(1) > button:nth-of-type(1) |
| b | ours-only | chat-finished, chat-tool-calls, chat-markdown, chat-working, chat-approval, chat-question, chat-plan-review, workspace-actions-menu, chat-tab-menu | Diff scope | button aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(1) > button:nth-of-type(3) |
| b | ours-only | chat-finished, chat-tool-calls, workspace-actions-menu, chat-tab-menu | Changed files | grid aria-label: [data-testid="git-panel"] > div > div > div > div:nth-of-type(3) > div > div:nth-of-type(2) > div:nth-of-type(2) |
| b | ours-only | chat-finished, chat-tool-calls, chat-markdown, chat-working, chat-approval, chat-question, chat-plan-review, workspace-actions-menu, chat-tab-menu | Collapse panel | button aria-label: [data-testid="scripts-panel"] > div > div > div > div:nth-of-type(1) > button:nth-of-type(1) |
| b | ours-only | chat-finished, chat-tool-calls, chat-markdown, chat-working, chat-approval, chat-question, chat-plan-review, workspace-actions-menu, chat-tab-menu | No preview URL yet | button title: [data-testid="scripts-panel"] > div > div > div > div:nth-of-type(2) > div:nth-of-type(2) > div > div:nth-of-type(1) > div > button:nth-of-type(1) |
| b | ours-only | chat-tool-calls | Read 7 lines | span text: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(3) > button > span:nth-of-type(2) > span:nth-of-type(1) |
| b | ours-only | chat-tool-calls | Collapse 3 tool calls, 2 messages | button aria-label: [data-testid="virtuoso-item-list"] > div > div > button |
| b | ours-only | chat-markdown | // Before: url.parse is gone in Node 24. const next new URL request url searchParams .get "next" export const safe next ?.startsWith next | pre text: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(2) > div:nth-of-type(1) > div:nth-of-type(1) > pre |
| b | ours-only | chat-markdown | ts | span text: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(2) > div:nth-of-type(1) > div:nth-of-type(2) > span |
| b | ours-only | chat-markdown | Check | th text: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(2) > div:nth-of-type(2) > table > thead > tr > th:nth-of-type(1) |
| b | ours-only | chat-markdown | Before | th text: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(2) > div:nth-of-type(2) > table > thead > tr > th:nth-of-type(2) |
| b | ours-only | chat-markdown | After | th text: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(2) > div:nth-of-type(2) > table > thead > tr > th:nth-of-type(3) |
| b | ours-only | chat-markdown | Unit tests | td text: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(2) > div:nth-of-type(2) > table > tbody > tr:nth-of-type(1) > td:nth-of-type(1) |
| b | ours-only | chat-markdown | 1 failed | td text: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(2) > div:nth-of-type(2) > table > tbody > tr:nth-of-type(1) > td:nth-of-type(2) |
| b | ours-only | chat-markdown | all pass | td text: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(2) > div:nth-of-type(2) > table > tbody > tr:nth-of-type(1) > td:nth-of-type(3) |
| b | ours-only | chat-markdown | Build | td text: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(2) > div:nth-of-type(2) > table > tbody > tr:nth-of-type(2) > td:nth-of-type(1) |
| b | ours-only | chat-markdown | nodejs.org | link text: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(2) > blockquote:nth-of-type(2) > p > a |
| b | ours-only | chat-markdown, chat-markdown, chat-approval, chat-approval, chat-question, chat-question, chat-plan-review, chat-plan-review | No changes | button text: [data-testid="git-panel"] > div > div > div > div:nth-of-type(1) > div > button |
| b | ours-only | chat-markdown, chat-question, chat-plan-review | relay icon | img aria-label: [data-testid="main-content"] > div > div > div:nth-of-type(1) > div > div > div:nth-of-type(1) > span:nth-of-type(1) |
| b | ours-only | chat-working | grep for 'redis in src | span text: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(3) > button > span:nth-of-type(2) > span:nth-of-type(1) |
| b | ours-only | chat-working | 2 matches | span text: [data-testid="virtuoso-item-list"] > div > div > div:nth-of-type(3) > button > span:nth-of-type(2) > span:nth-of-type(2) |
| b | ours-only | chat-working | 1 queued | span text: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(5) > sect |
| b | ours-only | chat-working, chat-approval, chat-question, chat-plan-review | The agent is working | status aria-label: [data-testid="virtuoso-scroller"] > div > div:nth-of-type(3) > div > div > span:nth-of-type(1) |
| b | ours-only | chat-approval | The agent suggests these rules: | span text: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(2) > fiel |
| b | ours-only | chat-approval | Message to the agent (optional) | label text: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(2) > fie |
| b | ours-only | chat-approval | Add the switch component is running | status aria-label: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(2 |
| b | ours-only | chat-approval | Message to the agent | textbox aria-label: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type( |
| b | ours-only | chat-approval | Why are you denying this? | textbox placeholder: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type |
| b | ours-only | chat-question | Agent question | fieldset aria-label: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type |
| b | ours-only | chat-plan-review | Reject plan | span text: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(2) > fiel |
| b | ours-only | chat-plan-review | Hand off | span text: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(2) > fiel |
| b | ours-only | chat-plan-review | Plan review | fieldset aria-label: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type |
| b | ours-only | chat-plan-review | Plan feedback | textbox aria-label: [data-testid="main-content"] > div > div > div:nth-of-type(2) > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type( |
| b | ours-only | workspace-actions-menu | Link pull request | span text: div:nth-of-type(2) > div > div:nth-of-type(8) > span |


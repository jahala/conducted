# Audit s2-1-ui-1 (batch n8-s1-ui-1) on slice2/step-1

Scope: APP-02, APP-14, CHAT-09, CHAT-11, CHAT-27, COMP-03, NAV-04, NAV-05. Read only. CI-catchable failures (types, lint, failing tests) skipped. Tests were read, not run.

Cross-cutting (LATER): all eight backlog rows in `docs/plans/backlog.md` still read `stub` (lines 147, 148, 174, 176, 192, 203, 302, 314) and the GitHub checklists are unticked. `pnpm stubs` will flag that, so the row flip must land with the fixes below.
Outcome: fixed already, 904a23d4 the eight rows read `done` in `docs/plans/backlog.md:147,148,174,176,192,203,302,314`.

## APP-02 First-run onboarding

- MUST `apps/desktop/src/app/router.tsx:125-132`, `app/navigation-history.ts:144`: `chooseRestoreTarget` returns `{ kind: "onboarding" }` but `RestoreLastLocation` acts only on `kind === "workspace"`. Nothing in the app navigates to `/first-run-onboarding` (grep finds only the route definition), so checklist item "First launch routes to onboarding when no project exists" is not done and the whole screen is unreachable. Fix: navigate to the onboarding route when the target is `onboarding` and the guide is not finished, with a test through the real router that a first run with no projects lands there.
- MUST `features/onboarding/AgentStep.tsx:136-193` duplicates the sign-in state machine in `features/settings/pages/AgentsPage.tsx:104-195` (start, finish, cancel, newest-start guard, Codex/Cursor auto-finish). `AgentStep.tsx:159` (`agent === "claude"`) also copies `needsPastedCode` (`AgentsPage.tsx:62`). Fix: extract one hook (for example `useAgentLogin`) in `core/` or `features/settings/agents/` and use it from both.
- MUST `core/registries/settings.ts:1576` (`onboarding_step`) and `:1589` (`first_time_onboarding_step`) are both tagged APP-02. Only the first is read or written anywhere. Checklist rule "One onboarding step key for one flow" is not kept. Fix: remove the unused key (new migration/registry step if it was ever stored) or document why two exist.
- LATER `AgentStep.tsx:7-8`, `:272`: the D021 items "Onboarding agents step installs and updates the agent programs" and "pick agents" have no code or test. The header says so honestly. I did not check whether `docs/plans/items/ui.tsv` or PLAT-28 carries the onboarding hook-up; if not, add it there (D041).
Outcome: fixed already, 3e3d6498 both pieces now have items rows (`ui.tsv:991,1049`).
- LATER `OnboardingScreen.tsx:204-218` and `:229-231`: `finish()` navigates to `/`, and the effect that reacts to the stored step also navigates once the setting store updates. Two navigations for one exit.
Outcome: fixed already, 89d68b85 the `leaving.current` guard makes the store effect skip the second navigation (`OnboardingScreen.tsx:234-238`).
- LATER `OnboardingScreen.tsx:13-14` header claims "the window title area stays draggable". The file has no drag region; it comes from `FullPage`. Say so in the header or drop the claim.
Outcome: fixed already, 89d68b85 the header now says the drag area comes from `FullPage` (`OnboardingScreen.tsx:19`).
- LATER `AgentStep.tsx`: a sign-in left running when the user leaves the step or the screen is never cancelled on unmount (no `cancelLogin` cleanup).
Outcome: open, item APP-02 - neither `AgentStep.tsx` nor `use-agent-login.ts` cancels the running login in an effect cleanup (`AgentStep.tsx:84-95` only cleans up the refresh).
- LATER Tests: no test for Down arrow wrapping from the last step to the first, for Codex/Cursor auto-finish, for cancelling a sign-in, or for a failed `openUrl` or `copyText`.
Outcome: open, item APP-02 - the ArrowDown and cancel tests now exist, but none covers Codex/Cursor auto-finish or a failed `openUrl`/`copyText` (`AgentStep.test.tsx:32-158`).

## APP-14 Missing design tokens

- MUST `ui/theme-variants.ts:48-90`: `themeAttributes` and `applyThemeAttributes` have no caller outside `app-14.test.tsx` (grep). Nothing writes `data-theme`, `data-contrast` or `data-color-vision` to `<html>`, so the low-contrast, colour-vision and forced light/dark token sets can never be switched on. No plan item tracks the wiring (grep of `docs/plans` finds none). Fix: call it from the composition root or the appearance setting subscriber, add the wiring as a checklist item on the owning settings feature, and test that changing the setting changes `document.documentElement`.
- MUST `styles.css:275-278`: `:root[data-vibrancy="on"]` is never set by any code, and `theme-variants.ts` has no vibrancy output. The "translucent sidebar surface" is dead CSS. Fix: have `themeAttributes` emit `data-vibrancy` from the vibrancy setting (`core/registries/settings.ts:1312`), or put the wiring on an item.
- MUST `docs/design.md:70` still says "Still open (APP-14): ... Colour-vision variants, a search-highlight colour and the translucent sidebar surface are not built yet". It is now false. The table at `:60-69` also omits the AA changes this batch made to the terminal colours (green `#12853c`, yellow `#a28700`, bright variants, white, and the dark black raised to `#736b64`) and the colour-vision palettes. D023 requires each adjusted pair to be listed there, and the CSS comment that said so was deleted in `styles.css:12-20`.
- MUST `ui/app-14.test.tsx:157-181` copies `parse`, `over`, `luminance`, `ratio` from `ui/tokens.test.ts:36-60`, and the text/mark pair matrix (`app-14.test.tsx:206-262`) repeats `tokens.test.ts`. Two contrast guards will drift. Fix: one shared helper module in `ui/` (or fold app-14 into tokens.test.ts).
- MUST `app-14.test.tsx` terminal check ("meets 3:1 on both terminal backgrounds"): the checklist item says "with AA checks". ANSI colours draw text, and AA text is 4.5:1. The 3:1 threshold is a silent downgrade with no decision entry. Fix: test at 4.5:1 and adjust the values, or record the 3:1 choice in `docs/design.md`.
- LATER `app-14.test.tsx:366-376`: the vibrancy test checks the CSS text only. The contrast matrix never switches `data-vibrancy`, so sidebar text on the translucent surface is unchecked (and the colour behind the window is unknown).
Outcome: open, item APP-14 - the contrast matrix still never sets `data-vibrancy`; the vibrancy checks are the CSS-text and document-attribute tests (`ui/app-14.test.tsx:295-302,140-164`).
- LATER Checklist "Link style in Markdown and PR text": `--color-link` already existed; this batch changed nothing for links beyond the shared contrast pair. The underline/hover style lives only in `features/chat/AssistantText.tsx:225,259`. PR text has no link style yet. No test for the style.
Outcome: open, item APP-14 - links render through `ExternalLink` with no underline/hover style in `AssistantText.tsx`, and no test covers a link style (`AssistantText.tsx:267,411`).
- LATER `styles.css:106-107`: `search-highlight` tokens carry the same values as `highlight`. The test (`app-14.test.tsx:378-384`) asserts class names only, so it does not prove the colour.
Outcome: open, item APP-14 - the search-highlight pair still equals the highlight pair (`styles.css:113-117,283-286`) and the test checks class names only (`app-14.test.tsx:308-313`).

## CHAT-09 Thinking and todo blocks

- MUST `features/chat/tools/cards/TodoCard.tsx:17-48` re-implements the Claude TodoWrite normalisation in `packages/sidecar/src/runners/claude/todo.ts:26-47` (label from `content`, status mapping, skip empty labels). It also accepts statuses nothing emits (`running`, `in-progress`) and turns any unknown status into `pending` (`:25-28`), which is an invented default. Fix: let the card read the neutral `todo` item the sidecar already builds, or share one mapper in `packages/protocol`.
- LATER `TodoBlock.tsx:26` titles the block "Todo". The checklist item "Todo card: 'No todos', 'Todo started', 'Todo completed'" is met only by `TodoCard`; the block shows "N of M done". Decide one wording for both.
Outcome: open, item CHAT-09 - `TodoBlock` still titles the block "Todo" and shows "N of M done" (`TodoBlock.tsx:26-31`).
- LATER `TodoCard.tsx:62-65` falls back to the generic card when the input has no list. The header discloses it. Entries without a label are dropped silently (`:44`).
Outcome: open, item CHAT-09 - the generic-card fallback and the silent drop of an unlabelled entry remain (`TodoCard.tsx:35-44,62-65`).
- LATER Tests missing for header claims: very long thinking text scrolls (`ThinkingBlock.tsx:34`), `TodoList` keeping row identity when the list is reordered (`TodoList.tsx:9`), `TodoCard` unknown status and unlabelled entries.
Outcome: open, item CHAT-09 - no test covers very long thinking text, row identity on reorder, or an unknown/unlabelled todo entry.

## CHAT-11 Tool approval card

- MUST `features/chat/interactions/ToolApprovalCard.tsx:184-209`: the card prints the raw input as JSON. Checklist items "An approval card shows the tool card or the decision reason" and region "Approval card shows the tool card" are not met; the header's Behaviour line says it shows the tool card. The tool card registry (`features/chat/tools/registry.ts`) is not used. The test (`ToolApprovalCard.test.tsx:128`) asserts JSON text only.
- MUST `ToolApprovalCard.tsx:110-112` (`focusOnMount` calls `node.focus()`) moves focus off the composer when an approval arrives. A user typing a message who presses Enter then triggers `send("allow")` (`:159-162`). That approves a tool by accident. Fix: do not take focus; show a visible hint and bind the shortcuts only after the user focuses the card, or require the card to be focused by a click or Tab.
- MUST `ToolApprovalCard.tsx:40-45` copies `EDIT_TOOLS` from `packages/sidecar/src/runners/claude/permissions.ts` (different casing), and `approvalTitle` (`:48-70`) guesses the tool kind with `includes("fetch")`, `includes("command")` on raw names. Canonical names exist in `packages/protocol/src/tools.ts`. An MCP tool such as `git_fetch_x` is titled "fetch this page". Fix: classify through the canonical tool name once, shared with the sidecar.
- MUST `PermissionGrantCard.tsx:3` header claims access "(file system, network or command)". The protocol schema (`packages/protocol/src/interactions.ts:72-82`) has paths and a `network` flag only, and the card has no command handling. Cut the claim or build it.
- MUST `PermissionGrantCard.tsx:123-128`: checklist item "'Network access' card with Deny and Approve" is a note inside the permission card here, not a card. I found no decision entry for the difference (grep of `docs/decisions.md`), so D020 says put it back or record it.
- MUST duplicated logic inside the batch: the expiry timer effect (`PermissionGrantCard.tsx:58-67` and `McpFormCard.tsx:150-159`), the `TIMEOUT_MINUTES` constant and "timed out" text (`:42,:138` and `:53,:318`), and the send/pending/failed/chosen state machine (`ToolApprovalCard.tsx:124-144`, `PermissionGrantCard.tsx:76-99`, `McpFormCard.tsx:175-195`). Timeout also exists a third time in `core/services/sessions.ts:884-901` (`interactionClosed`). Fix: one `useInteractionAnswer` hook plus one `useExpiry` hook. Both timer effects use `Date.now()` directly instead of an injected clock.
- LATER `ToolApprovalCard.tsx:243-247`, `PermissionGrantCard.tsx:130-134`, `McpFormCard.tsx:310-314`: a failed answer shows the invented text "Could not send the answer. Try again." and drops `result.error`. Pass the real message on.
Outcome: fixed already, 89d68b85 all three cards now show the real failure (`answerState.failed`) instead of the invented sentence (`ToolApprovalCard.tsx:175`, `PermissionGrantCard.tsx:138`, `McpFormCard.tsx:291`).
- LATER `ToolApprovalCard.tsx:114-116`: "Yes always" is offered for every agent, but only Claude persists it (`runners/claude/permissions.ts:178`). Codex maps it to accept-for-session (`runners/codex/approvals.ts:15,35-38`) and ACP to a plain allow (`runners/acp/permission.ts:36-39`). The label promises more than those runners do.
Outcome: open, item CHAT-11 - the alternate button still chooses `always_allow` for every non-edit tool, whatever the agent (`ToolApprovalCard.tsx:69-70`).
- LATER `core/services/sessions.ts:1137-1143` and `protocol/src/live-state.ts:27-29`: live state carries `since` but no `expiresAt`. After a reload a pending Codex card has `expiresAt: null`, so only the sidecar's `interactionClosed` can mark it timed out.
Outcome: open, item CHAT-11 - live state still carries only `since`, not `expiresAt` (`packages/protocol/src/live-state.ts:28`).
- LATER `sessions.ts:884-889`: `interactionClosed` with reason `delivery_failed` returns silently; the user is not told the answer did not arrive.
Outcome: open, item CHAT-11 - a `delivery_failed` reason still returns without marking the card or telling the user (`core/services/sessions.ts:1179-1181`).
- LATER `McpFormCard.tsx:93-96,:114`: JSON Schema `integer` is accepted as any finite number (1.5 passes). Enum options that are not strings are filtered out without a notice (`:74`).
Outcome: open, item CHAT-11 - `integer` still maps to the number field and only checks `Number.isFinite`, and non-string enum options are dropped silently (`McpFormCard.tsx:74,93,114`).
- LATER Tests: none for the separate Network access card (it does not exist), for the focus behaviour, or for the expiry timer firing while the card is open (the existing timed-out tests pass the `timedOut` prop).
Outcome: open, item CHAT-11 - there is still no Network access card and no focus or live-expiry test (`ToolApprovalCard.test.tsx`, `PermissionGrantCard.test.tsx`).

## CHAT-27 Visible auto-retry with Retry now

- MUST `features/chat/TurnItem.tsx` `retryNow` (new code, `if (message === null) return;`): the "Retry now" button does nothing and says nothing when the turn has no user message. Show an error or hide the button for such turns.
- LATER `TurnItem.tsx` `retryNow` calls `sessions.cancel` then `sessions.send`. `cancel` pauses the follow-up queue (`core/services/sessions.ts:809`, `pauseOnCancel`). I found nothing in `send` that releases it, so queued follow-ups may stay paused after Retry now, and the history gets an "Interrupted" turn plus a copy of the user message. Needs a test of the queue state after Retry now.
Outcome: open, item CHAT-27 - `retryNow` still cancels and sends without resuming the paused queue (`TurnItem.tsx:124-142`; `pauseOnCancel` at `sessions.ts:1086`).
- LATER `sessions.ts` `retryInNewChat`: if `create` succeeds and `send` fails, the empty new chat stays and the caller sees only the send error. Close the new chat on failure or say so.
Outcome: fixed already, 075e4b4e `retryInNewChat` now goes through `#createAndSend`, which deletes the new chat when the send fails (`sessions.ts:554-575,2088`).
- LATER `ChatBanner.tsx:86-92`: navigation uses `as never` on the `search` function, and it is the third copy of "open a session tab" (`app/router.tsx:238`, `features/workspace/ChatHistoryButton.tsx:53`, `features/workspace/useNewTab.tsx:74`). Use one helper.
Outcome: open, item CHAT-27 - the `as never` navigation is still there (`ChatBanner.tsx:87-92`).
- LATER `ChatBanner.tsx` `ChatRetryBanner` uses the destructive tone while the agent is still retrying; the header says error colour is for real errors only.
Outcome: open, item CHAT-27 - `ChatRetryBanner` still renders `Alert tone="destructive"` while retrying (`ChatBanner.tsx:103-105`).
- LATER Tests: none for Retry now on a turn without a user message, for the queue after Retry now, or for a failed `send` after a successful `create`.
Outcome: open, item CHAT-27 - the three cases still have no test (`TurnItem.*.test.tsx`, `sessions.chat-27.test.ts`).

## COMP-03 Plan mode and approval toggles

- MUST `features/composer/ModeChips.tsx:48-51`: the Auto-accept state is local `useState` with an invented default of `false`. Switch to another chat or tab, or reload, and the chip shows "off" while the sidecar may still auto-accept edits, so the user believes edits need approval when they do not. Fix: read the real state from the session/live state (the sidecar owns it) and render that.
- MUST Checklist items with no code or test in this batch (`git show --stat ab538c8` touches only `ModeChips`): "'+' menu: 'Plan mode' / 'Exit plan mode'" (`composer/PlusMenu.tsx` is still `notImplemented("COMP-07")`), "Account Claude Code tool approvals / Default to plan mode in new chats / /plan / Auto permission mode setting", "Change a chat's permission mode in its config" (`protocol/src/session-config.ts` has `planMode` only), "Claude starts in bypass mode and switches live". Either build them or move each to the feature that owns it, in `docs/plans/items/`.
- MUST The step-4 item "needs the UI to RPC to sidecar end-to-end test" is not met: `ModeChips.test.tsx:127-131` spies on `services.sessions.setAutoApproveEdits` and never reaches the sidecar RPC.
- LATER `ModeChips.tsx:54-62`: `{ ...config, planMode: !config.planMode }` uses the config captured at render. Two quick clicks send the same value, and a whole-config write can overwrite a model change made at the same time. Use a patch or `createLatestWins`.
Outcome: fixed already, 89d68b85 the toggle reads the latest config from the store before writing (`ModeChips.tsx:58-62`).
- LATER `ModeChips.tsx:36-38`: both chips are hidden for non-Claude agents. Header discloses it; D020 wants a decision entry if Conductor shows them.
Outcome: open, item COMP-03 - the chips are still hidden for every non-Claude agent, with a code comment but no decision entry (`ModeChips.tsx:36-38`).

## NAV-04 Pinned, sections, drag and drop, manual order

- MUST Not mounted: `PinnedSection`, `SectionList`, `SectionDialog` and `useWorkspaceDrag` have no caller outside their tests. The live sidebar (`features/sidebar/GroupedWorkspaces.tsx:174-175`) still passes `sections: []` with the comment "NAV-04 supplies the user's sections", and `:283-285` still renders "Grouping by section is not available yet". None of the 30 checklist items can be reached by a user. Fix: mount them in `GroupedWorkspaces`/`WorkspaceList`, delete the stale comment and message, and add a test through `Sidebar`.
- MUST `PinnedSection.tsx:64-68`: the drop looks the dragged id up in its own `workspaces` prop, which holds the workspaces that are already pinned. A workspace from the main list is `undefined` there, so the drop is cancelled and nothing is pinned. `PinnedSection.nav-04.test.tsx:54-68` passes the same workspace as the pinned list and so hides the bug. Fix: look the workspace up in the full list (pass it in) and test with an unpinned workspace.
- MUST `SectionList.tsx:342-353` with `use-workspace-drag.ts:136-152`: dropping a workspace that comes from another list onto a row inside a section stops propagation, then `dropOn("row:...")` returns when manual order is off or the dragged id is not in this section's `order`. The drop is lost without a message. Fix: a row drop from outside the list should place the workspace in this section at the row's index.
- MUST `SectionList.tsx:269-274`: a section header drop always calls `onDropSection(true)` (after the target), so a section can never be moved to the first position.
- MUST `SectionList.tsx:223` and `:374`: `SectionGroup` keeps its own `renaming` state and renders a second `SectionDialog` that nothing opens (rename goes through the parent's dialog at `:164`). Dead code, one extra dialog per section.
- MUST `features/workspace/WorkspaceActionsMenu.tsx:186-195` renders a second "New section" dialog (`RenameDialog`, name only, emoji always `null`) next to `SectionDialog`. Same job in two places. Use `SectionDialog`.
- MUST `SectionList.tsx:291-293`: "Create in section" links to `/create` with `search={{ section: section.id }}`, but the create route has no search validation and `app/CreateWorkspacePage.tsx:58` starts `sectionId` at `""`. The section is never preselected.
- MUST Main-list manual order is not wired: the `reorder` callback of `useWorkspaceDrag` (`use-workspace-drag.ts:46,:144-148`) has no caller. `SectionGroup` passes only `place` (`SectionList.tsx:224-231`), so "Reorder workspaces by drag when 'Arrange workspaces manually' is on" works inside sections only, not in the main list or Pinned. The hook header (`:3-4`) promises it.
- MUST `core/services/sections.ts:9` header says "positions stay dense after a move or delete". `#remove` (`:116-127`) and the `sectionId === null` branch of `#place` (`:147-157`) leave gaps in the stored positions. Only `reorder` and the target of a move are written densely. Fix: re-number after delete and when a member leaves a section, or cut the claim.
- MUST Missing checklist item: "'New section...' (sidebar background menu and workspace menu)". The sidebar background menu does not exist; only the section row menu and the workspace menu have it.
- LATER `SectionList.tsx:11-12` and `settings/pages/GeneralPage.tsx:17` call the setting "Arrange workspaces by hand"; the checklist (and Conductor) say "Arrange workspaces manually".
Outcome: fixed already, 89d68b85 `SectionList.tsx:13` now says "workspaces manually".
- LATER The draggable row wrapper is copied in `PinnedSection.tsx:107-117` and `SectionList.tsx:332-353` (and the grouped list). Extract one `DraggableWorkspaceRow`.
Outcome: open, item NAV-04 - the three `draggable` wrappers are still written out separately (`PinnedSection.tsx:134`, `SectionList.tsx:295,355`).
- LATER `SectionList.tsx:222`: `open` starts from `section.collapsed` and is never re-synced; a failed `setCollapsed` leaves the UI and the store disagreeing. Pinned's collapsed state (`PinnedSection.tsx:39`) is not saved at all.
Outcome: open, item NAV-04 - `SectionGroup` still derives `open` from `section.collapsed` once (`SectionList.tsx:236`), and Pinned keeps its open state in local `useState` (`PinnedSection.tsx:56`).
- LATER `SectionDialog.tsx:99-104`: the emoji field takes any text of any length.
Outcome: open, item NAV-04 - the emoji input still has no length limit (`SectionDialog.tsx:97-104`).
- LATER `core/services/sections.ts:145`: `before` is read before the awaited write, and `start()` is not in the write queue, so a concurrent reload can be overwritten by the older snapshot. `SectionRepository.moveWorkspace` (`core/db/sections.ts`) is now used only by `core/services/workspace.ts:1272`; check that both paths agree.
Outcome: open, item NAV-04 - `#place` still captures `before` and uses it after `await`s (`core/services/sections.ts:143-170`).
- LATER `SectionList.tsx:309`: the actions button is the literal character `⋯`; use an icon.
Outcome: open, item NAV-04 - the button is still the literal `⋯` (`SectionList.tsx:330`).

## NAV-05 Home grid of all workspaces

- MUST Checklist shortcut "Cmd+Shift+H go to Home" does nothing: command `nav.home` (`core/registries/commands.ts:364`) has no handler. `app/router.tsx:64-68` registers only `nav.back` and `nav.forward`; `SidebarNav.tsx:49` only reads the shortcut for a label. No test.
- MUST Duplicated logic: `isArchived` is the same function in `features/home/home-query.ts:58` and `features/home/WorkspaceCard.tsx:50`; `toneClass` in `WorkspaceCard.tsx:42` is a copy of the one in `features/sidebar/WorkspaceRow.tsx:40`. Put the predicate on the workspace model (or `workspace-status.ts`) and the tone map next to `StatusTone` in `workspace/status-text.ts`.
- LATER `home-query.ts:13` "Test first" says "page 2 of 60 results has 10 items", but `queryHome` returns all items up to `pageCount * 50` (cumulative), and the screen relies on that. Fix the header.
Outcome: fixed already, 89d68b85 the header now says the paging is cumulative and the test asks for all 60 (`home-query.ts:11-17`).
- LATER `HomeScreen.tsx:113-116`: workspaces whose repository is not in the list are dropped silently (the header discloses it). The user gets no hint that rows are hidden.
Outcome: open, item NAV-05 - the row is still dropped with `return null` when its repository is missing (`HomeScreen.tsx:71-72`).
- LATER `HomeFilters.tsx:84,:106-111`: filter state is an array (`projects: RepoId[]`) but the control is a single select.
Outcome: fixed already, 4180388b the project filter is now a checkbox menu and toggles ids in the array (`HomeFilters.tsx:120-176`).
- LATER `HomeFilters.tsx:64-73`: the effect that copies `filters.search` into the box can reset the box to the older text if a keystroke lands right after the debounce fires.
Outcome: open, item NAV-05 - the effect still writes `filters.search` over the local box text on every outside change (`HomeFilters.tsx:101-103`).
- LATER `HomeEmptyState.tsx:27-49`: shows one button; the checklist names both "Create a workspace" and "Clear filters". The header calls it a design choice; add a decision entry per D020.
Outcome: open, item NAV-05 - the no-workspace state still shows only "Create a workspace" (`HomeEmptyState.tsx:41-49`), with no decision entry.
- LATER The Display menu offers two fields (`home-query.ts:31`); line changes wait for GIT-04. `WorkspaceCard.tsx` imports `relativeTime` from `features/sidebar/WorkspaceRow.tsx`, and `HomeScreen.tsx:28` imports `useNow` from the sidebar. Move both to a shared place.
Outcome: open, item NAV-05 - `relativeTime` and `useNow` are still imported from the sidebar (`WorkspaceCard.tsx:38`, `HomeScreen.tsx:28`).
- LATER Tests: search by display name and by PR title is untested (`home-query.test.ts` covers branch, accents, repository name).
Outcome: fixed already, 89d68b85 the test file now covers a display-name and a PR-title search (`home-query.test.ts:83,96`).

Summary: APP-02 3 MUST / 5 LATER; APP-14 5 MUST / 3 LATER; CHAT-09 1 MUST / 3 LATER; CHAT-11 6 MUST / 6 LATER; CHAT-27 1 MUST / 5 LATER; COMP-03 3 MUST / 2 LATER; NAV-04 10 MUST / 8 LATER; NAV-05 2 MUST / 7 LATER (plus 1 cross-cutting LATER).

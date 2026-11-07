# Audit: step 6, batch n6-s1-ui

Branch `overnight/step-6` against `main`. Features: CHAT-06, CHAT-10, NAV-02, NAV-03.
Method: read the committed files with `git show overnight/step-6:<path>`, the four issues, `decisions.md` (D020, D022), `ui-map.md` 3.3 and 4. No test run. Nothing was checked in a running app, so the layout findings are from reading the code.

## CHAT-06 Message list

- MUST `apps/desktop/src/features/chat/UserMessage.tsx:29` and `TurnItem.tsx:110`: "Message not sent" with Retry and Discard never shows. `UserMessage` takes an optional `failed` prop, but `TurnItem` renders `<UserMessage turn sessionId />` without it. `ChatView` (`core/model.ts:322`) has no `failedSends` field, although the issue requires adding it and `sessions.ts:124` already keeps `failedSends` in the store. The UserMessage test passes `failed` by hand, so it passes without the feature. Fix: add `failedSends` to `ChatView`, return it from `chatView()`, pass it down from `TurnItem`, and add a test through `MessageList`.
- MUST `features/chat/MessageList.tsx:94-123`: the Scroll to bottom button is likely misplaced. The wrapper is `relative h-full` and `Virtuoso` takes `h-full`. The button is a `sticky bottom-3` sibling after it, with no scroll container, so it sits below the list instead of floating over it. Fix: position it `absolute bottom-3 inset-x-0` over the list (or portal it as the header says). No test mounts the list with the button, so this is not caught.
- MUST `MessageList.tsx:92` and `EmptyChat.tsx:23`: `EmptyChat` has an `archived` prop and a test, but `MessageList` never passes it. `workspaceId` is ignored (`_workspaceId`). In an archived workspace the starters still show. The header says "archived workspace (read-only, composer bar says so)". Fix: read the workspace state and pass `archived`, or remove the claim and the prop.
- MUST `MessageList.tsx:84-89`: the header says "error with retry", but no `onRetry` is passed to `LoadableView`, so the error card has no "Try again" button. Fix: pass a retry, or change the header.
- MUST `ChatBanner.tsx:1-15` header names "image too large" and four sign-in banners. The code has one auth title (`item.code === AGENT_ERROR_CODES.authRequired` gives "Authentication required"). There is no wording for 'ChatGPT login expired', 'Codex authentication required' or 'Cursor API key required', and no image-too-large case. Fix: map the agent error codes to the four titles, or cut the claims and leave the items open.
- MUST `ChatBanner.tsx:33,44`: `/compact/i.test(text)` on any `info` notice shows "Compacting...". A text such as "Compacted 40 messages" would read as in-progress. This is a guessed default. Fix: use a protocol notice kind for compacting, or an exact match.
- MUST `AssistantText.tsx:240-251`: links with a non-http scheme keep their `href` and the click handler returns early, so `file:` and relative links navigate the app window. The header says links never open inside the window. Fix: always `preventDefault`, and open only http, https and mailto through the opener.
- MUST `AssistantText.tsx:327,340,350,353`: React keys come from cell and item text (`${key}-${item}`, `${key}-r-${row.join("|")}-${cell}`). Two equal list items, or two equal cells in a row (common: "-", "yes"), give duplicate keys. Fix: key by index.
- LATER `AssistantText.tsx:316-329`: nested lists flatten, because leading spaces are stripped by the list regex. Callouts have no per-kind icon or tone. Mermaid and video are acknowledged in the header as CHAT-24, so they are fine.
Outcome: open, item CHAT-06. Nested lists still flatten because UNORDERED and ORDERED begin with `^\s*` and drop the indentation (AssistantText.tsx:54-55, 205-227); callouts now carry a per-kind colour (CALLOUT_CLASS, :69-78) but still no per-kind icon.
- LATER `CodeBlock.tsx:67`: `setTokens(null)` on every text change shows plain text again for each streaming update. The header says "re-highlight without flicker". Fix: keep the last tokens until the new ones arrive. `import("shiki")` also pulls in every language chunk; load the language lazily.
Outcome: open, item CHAT-06. The highlight is now kept until the new load resolves, but the code still imports the whole "shiki" bundle (CodeBlock.tsx:252) rather than a language-specific entry.
- LATER `CodeBlock.tsx:85`: a highlight failure is swallowed (`catch`) and plain text shows. This is declared in the header, but nothing is logged.
Outcome: open, item CHAT-06. The catch is still silent (CodeBlock.tsx:269-272); plain text shows and nothing is logged.
- LATER `UserMessage.tsx:50`: an image thumbnail uses `src={path}`, a raw file path. A webview will not load that without the asset URL, so every thumbnail falls back to the file icon. Use the platform preview URL.
Outcome: fixed already, 833f6059. The thumbnail now uses platform.fs.assetUrl(path) (UserMessage.tsx:74).
- LATER `UserMessage.tsx:122-127`: a PR mention opens `tab: "pr"` without the PR number, although `pr` is now a search field. The `as never` casts hide the type check.
Outcome: open, item CHAT-06. The PR link now carries the number (workspace-links.ts:62-63, tested at UserMessage.test.tsx:202), but the `as never` casts remain (workspace-links.ts:34, 43, 55, 64).
- LATER `TurnFooter.tsx:107-117`: Fork to new tab is disabled with no reason when there is no checkpoint (the header promises a reason). The details hover card is a `Tooltip` with `\n` text, which collapses on one line unless the tooltip uses `whitespace-pre`.
Outcome: open, item CHAT-06. The disabled fork and reset items now carry a title reason (TurnFooter.tsx:224-242), but Tooltip has no whitespace-pre, so the details text with newlines still collapses (ui/Tooltip.tsx:34-46).
- LATER `ScrollToBottomButton`/`MessageList.tsx:116`: the "New" marker is tied to `liveState.status === "working"`, not to content that arrived while the user was away.
Outcome: open, item CHAT-06. hasNew is still `!atBottom && data.liveState.status === "working"` (MessageList.tsx:188).
- LATER `MessageList.tsx:53-59`: the history header and footer are empty spacers. No older-history loading exists. Say so in the header.
Outcome: open, item CHAT-06. The history header is still an empty spacer (MessageList.tsx:68) and the header does not say older-history loading is unbuilt.
- LATER `TurnItem.tsx:32-47`: block keys come from the first 40 characters of text. The key changes (and the block remounts) if the opening text changes while streaming.
Outcome: fixed already, fefdb6d5. keyedBlocks gives a tool block its call id and every other block its position (TurnItem.tsx:56-59).
- LATER Tests: `MessageList.test.tsx` mocks `UserMessage`, `ChatBlockView`, `TurnFooter` and `ChatBanner` and counts mock renders. This is valid for memo, but nothing covers atBottom to button, loading, error or archived. No test for an "Interrupted by user" banner from a real `ChatBanner`.
Outcome: open, item CHAT-06. MessageList.test.tsx now covers a very long chat and an archived workspace (:176, :217), but not the scroll-to-bottom button, loading, error, or an Interrupted banner.
- Not duplicated: `stripLeadingFiller` has one home.

## CHAT-10 Question card

- MUST `packages/sidecar/src/tools/format.ts:15-29` (answer text to the agent): it returns "The user answered:\n1. <answer>" and `(no answer)`. The issue rule is "Answers return as 'question / answer / (Skipped)'". The question text is missing and the skipped word differs. `QuestionCard.tsx` header and `AskUserQuestionCard.tsx:42` both repeat the wrong contract. Fix: format each entry as the question, the answer and "(Skipped)", and update the parser and tests together.
- MUST `QuestionCard.tsx:98-111` with `core/services/sessions.ts:766-781`: if the sidecar replies `{accepted:false, superseded:false}` (an unknown id, `interactions.ts:119`), `answer()` returns ok and nothing settles. `busy.current` stays true and `pending` stays true, so the Submit button spins forever and cannot retry. Fix: treat "not accepted and not superseded" as an error and show "Could not send answers. Try again."; add a test.
- MUST `AskUserQuestionCard.tsx:69-100`: a secret answer is shown in plain text in the history card. The card does not read `secret` from the input and does not mask. The same card also leaves the secret in the stored tool result. Fix: mask answers for questions flagged `secret` and say so in the header.
- MUST Item "Open questions survive a restart" has no code and no test. `openInteractions` is an in-memory store (`sessions.ts:125,229`). The only survival is the sidecar re-sending after a reconnect (`manager.ts:onAppAttached`), which is not a restart of the app. Row is `done`. Fix: persist it, or leave the item open and say so in the backlog.
- MUST Item "Check whether a chat has a pending consent interaction" (services-map 1.4) has no function and no test. `git grep` finds no `pendingConsent`-style API. Fix: add it (the sidebar needs it for status) or reopen the item.
- LATER `QuestionCard.tsx:182-186,139-148`: pages move only by ArrowLeft and ArrowRight. There are no visible Previous and Next controls, so mouse users cannot reach page two. Conductor lists keys; a visible control is safer.
Outcome: open, item CHAT-10. Paging is still keyboard-only (QuestionCard.tsx goToPage at :61-65 and the key handler); there are no Previous and Next buttons.
- LATER `QuestionCard.tsx:114-123`: a failed Cancel agent clears `pending` and shows nothing. Show an error.
Outcome: fixed already, fefdb6d5. cancelAgent now sets failed("cancel") and the card renders a message for it (QuestionCard.tsx:122-133, :290-292).
- LATER `QuestionCard.tsx:47-50,215`: the card focuses its first control on mount. `ChatPane.tsx` header says "the composer is the only part that keeps focus", so one of them is wrong.
Outcome: open, item CHAT-10. focusOnMount still focuses the first option (QuestionCard.tsx:56-58, :232), while ChatPane.tsx:15 still says the composer is the only part that keeps focus.
- LATER `QuestionCard.tsx:216`: `key={option.label}` breaks on duplicate labels.
Outcome: fixed already, 284730c1. Options are keyed with withKeys (QuestionCard.tsx:226-231), so duplicate labels no longer collide.
- LATER `handlers.chat-10.test.ts`: the test mocks `interactions.request` and checks the pass-through. It exercises no logic; `sessions.chat-10.test.ts` covers the real path.
Outcome: wrong. sessions.chat-10.test.ts covers the real path; the handler test is a valid pass-through test of the RPC edge.
- LATER `sessions.ts:1122`: `expiresAt: null, timedOut: false` are fixed. Codex timeouts are out of scope for this issue, so this is only a note.
Outcome: wrong. The opened interaction now carries request.expiresAt ?? null (sessions.ts:1221); a Codex timeout is another feature, not a defect here.
- Checked and fine: single, multi, Other (key 0), number keys, Enter, previews, secret masking on entry, withdraw on turn end, superseded answers.

## NAV-02 Routes and per-workspace URL state

- MUST `apps/desktop/src/app/navigation-history.ts:64`: `chooseRestoreTarget` is never called outside its test. The "/" route renders `NoWorkspaceSelected` (`router.tsx:115-119`), so "'/' restores the last route and last workspace and skips archived ones" does not happen. Nothing reads or saves the last location either; the header says "belongs to the app entry", but no such code exists. Fix: call it from the "/" route (a `beforeLoad` redirect or a component), save the location when the route settles, and add a router test.
- MUST Go back and forward shortcuts: `commands.ts:346-355` registers `nav.back` and `nav.forward` (Cmd+[ and Cmd+]), but `git grep` finds no `useCommandHandler("nav.back"...)`. Only the buttons in `ShellControls.tsx` work. Fix: register both handlers with `router.history.back()` and `forward()`, with a test.
- MUST Store items "The app knows which workspace is on screen and polls git and GitHub only for it", "Session and workspace visibility stores", and "View history persists: closed tabs, recent workspaces and the git panel choice": no code or test found in the diff (`git grep` for visibility, recent workspaces and closed tabs finds nothing). Fix: build them or reopen the items. The row is `done`.
- MUST `router.tsx:131,168,176` production code bends to test fixtures: `hasSessions = services.sessions !== undefined`, `actions.workspaces?.setActiveSession?.(...)`, and casts through `unknown` (`:82`). The comment says "so a fixture without one keeps its workspace route". This is a silent fallback; a missing service should fail. Fix: always provide the services in the fixture and read them directly.
- MUST Duplicated rule, different meaning: "can this workspace be opened" appears as `archived || archiving` in `navigation-history.ts:28`, twice in `router.tsx:146` (and once more as `workspace.state === "archived" || ...` at `:154`), while `sidebar-view.ts:112` uses `archived || archivedAt !== null` and lists `archiving` workspaces. The sidebar can show a row whose route redirects Home. Fix: one predicate in `core/` used by all four places.
- LATER `router.tsx:136-149`: a deleted workspace is detected only if the list is non-empty or the id was seen. With a bookmarked id and zero workspaces the dead screen stays.
Outcome: open, item NAV-02. The guard still leaves a missing workspace alone when the store is empty and the id was never seen (router.tsx:250-258).
- LATER `router.tsx:151-161`: "restore the last active search for that workspace" restores only the chat tab (`activeSessionId`). File, terminal and git panel state are not restored.
Outcome: open, item NAV-02. The restore effect still applies only the chat tab (router.tsx:266-277).
- LATER `router.tsx:85-91`: the chat repair checks only that the chat exists, not that it is closed.
Outcome: open, item NAV-02. SessionRouteRepair checks only that the session exists and belongs to the workspace (router.tsx:200-206); a closed chat is not sent Home.
- LATER `router.tsx:123`: `repositoryId` is not checked against `workspace.repoId`.
Outcome: open, item NAV-02. The workspace route still passes `repositoryId as RepoId` to WorkspaceScreen without comparing it to workspace.repoId (router.tsx:296-300).
- Checked and fine: the diff scope round trip is tested (`workspace-search.test.ts:53-59`), and the route repair tests in `router.nav-02.test.tsx` use a real router. `render-with-router.tsx` is support code and needs no test.

## NAV-03 Sidebar

- MUST `GroupedWorkspaces.tsx:91-100`: the "+" on a project header is labelled "Create workspace in <repo>" but links to plain `/create`. The route has no search param, so the repo is dropped. Fix: pass the repo (a search param on `/create`) and add a test that asserts it.
- MUST `GroupedWorkspaces.tsx:17,168-176`: the header says Cmd+1..9 and previous/next "move through the visible order". `ordered` includes workspaces in collapsed groups (`open` is local state in `GroupSection`), so Cmd+3 can jump to a row nobody sees and the hint badge is on a hidden row. Fix: lift the collapsed state and drop collapsed groups from `ordered`, or fix the header.
- MUST Status subtitle "Planning..." (checklist) is missing: `status-text.ts` has no planning label, and `WorkspaceStatus` (`model.ts:522`) has no such value. Row is `done`. Fix: add the label to the status function and text, or reopen.
- MUST Items "Line counts (+/-) on the row, always coloured with 'Colored sidebar diffs'", "Row badges 'Draft' and 'Archive workspace'", "Optional status matrix animation", and the "R read / P pin" hover keys are not built (`WorkspaceRow.tsx` header and `WorkspaceStatusIcon.tsx` header say so). They are surfaced in headers, but the backlog row is `done` and the issue's "Done when" says every item works. Fix: set the row to something other than `done`, or move the items to their owners (GIT-04, NAV-04, WS-09) in `backlog.md`.
- LATER `ViewOptionsMenu.tsx:7`: the issue says "Sort by is absent" when manual order is on; the code and its test keep Sort by visible (documented, because NAV-04 is not built). `GroupedWorkspaces.tsx:153` hard-codes `manualOrder: false` and `sections: []`. Update the issue text or accept this and say so.
Outcome: fixed already, 89d68b85. ViewOptionsMenu now hides Sort by when manualOrder is true (ViewOptionsMenu.tsx:123), and GroupedWorkspaces reads the manual_workspace_order setting instead of hard-coding false (GroupedWorkspaces.tsx:258-277).
- LATER `status-text.ts`: labels use "…" while the research and issue use "...". D020 asks for the same text. `Unstarted` is not in the research.
Outcome: fixed already, fefdb6d5. status-text.ts now records the ellipsis as Our design choice (lines 8-9) and includes an Unstarted label (:42).
- LATER `WorkspaceRow.tsx:90`: `Date.now()` is read during render and never re-ticks, so "5m" goes stale. Pass `now` in from a ticking hook.
Outcome: fixed already, fefdb6d5. WorkspaceRow takes `now` as a prop and relativeTime(at, now) formats it (WorkspaceRow.tsx:68, 107-109).
- LATER `WorkspaceRow.tsx:91-93`: the hook is called with `"workspace.switch1"` when there is no index, only to discard the answer. Split the hint into its own component.
Outcome: open, item NAV-03. The row still calls useLiveShortcut with "workspace.switch1" when shortcutIndex is null and discards it (WorkspaceRow.tsx:146-147).
- LATER `WorkspaceList.tsx:38,50`: Try again calls `window.location.reload()`, which reloads the whole app. Retry the hooks instead.
Outcome: fixed already, fefdb6d5. The list restarts the failed service in place; the header says it does not reload the window (WorkspaceList.tsx:8-10, 41).
- LATER `sidebar-view.ts:66-70`: an unknown stored value silently falls back to "project". Registry validation should make that unreachable; log or fail.
Outcome: open, item NAV-03. readGroupBySetting still falls back to "project" silently for any unknown value (sidebar-view.ts:66-70); only a header comment explains the fallback.
- LATER `GroupedWorkspaces.tsx:49-61`, `settings.ts:1456`: `sidebar_repo_filter` is a comma-joined string, but its registry description says "the project". Fix the description.
Outcome: open, item NAV-03. The registry description still says "The project the sidebar is filtered to. Empty shows all." (registries/settings.ts:1571-1572), while the value is a comma-joined list.
- LATER Tests: `GroupedWorkspaces.nav-03.test.tsx` mocks `WorkspaceRow` and `ViewOptionsMenu`. `status-text.test.ts` covers three of the labels; the other subtitles in the checklist have no test. No test covers the project filter search from 5 repos in `ViewOptionsMenu`, the Dashboard setting reaching the real registry key, or the Settings footer link target.
Outcome: open, item NAV-03. ViewOptionsMenu.nav-03.test.tsx:133 now covers the project filter search from five projects, but status-text.test.ts still checks only three labels, and the Dashboard setting key and Settings footer link target remain untested.
- Checked and fine: grouping and sort logic (pure, 300-workspace test), settings keys exist, pinned shown once, archived and hidden repos excluded, name fallback, unread dot, live shortcut hints.

Summary: CHAT-06 8 MUST + 10 LATER, CHAT-10 5 MUST + 5 LATER, NAV-02 5 MUST + 4 LATER, NAV-03 4 MUST + 9 LATER.

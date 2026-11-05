# Test quality review: desktop UI (features, ui, app, main)

Snapshot: commit `808d632` of `slice2/step-1` (slice 1 merged, slice 2 step 1 landed, CI not run on slice 2). Nothing was run. Every verdict comes from reading each test file next to the source it tests.

How this report was made. Eight reviewers (Sonnet) each took a part of the area and read every test file and its source in full. I read all eight reports, spot-checked the sharpest claims against the code (listed under "What I verified myself" below), and merged them. Finding ids are local to a part, so cite them as "app C2", "ui M4", "chat M1", "cards M3", "sidebar C1", "workspace M5", "scripts C1", "git C3". Paths are relative to `apps/desktop/src` unless they start with `docs/`, `packages/` or `core/`.

## 1. Summary

- Files read: 167 test files (166 under `features/`, `ui/`, `app/`, plus `main.app-01.test.tsx`), and the source of each.
- Verdicts: **REAL 64, WEAK 100, THEATER 3.**
- Parts: app shell 18 files (8 / 10 / 0), `ui/` 14 (5 / 8 / 1), chat top level 21 (12 / 8 / 1), chat cards and composer 21 (8 / 13 / 0), sidebar 18 (5 / 13 / 0), workspace 22 (8 / 14 / 0), scripts panel, settings, terminal, diff 33 (9 / 23 / 1), git panel, Home, onboarding and the rest 20 (9 / 11 / 0).
- The three THEATER files: `ui/layout-sizes.test.ts`, `features/chat/ChatPane.test.tsx`, `features/scripts-panel/ScriptsPanel.run-01.test.tsx`. About fifteen more single tests inside WEAK files are theater and are named in the part findings.

The three worst problems:

1. **Code is built and tested but nothing calls it, and the tests stay green.** This is the slice-1 "dispatcher never mounted" bug again, and no check catches it. Orphans found by reading (no non-test importer): `app/SurfaceLayer.tsx` (NAV-15), `features/sidebar/PinnedSection.tsx`, `SectionList.tsx`, `SectionDialog.tsx`, `use-workspace-drag.ts` (NAV-04), `features/chat/TurnChanges.tsx` (REV-09), `features/composer/ArchivedComposerBar.tsx`, `features/pr/PrEmptyState`, `features/file-viewer/FileTabState`, the `failed` path of `UserMessage` (no live caller passes it), the Viewed checkbox and Target branch scope in the Git panel. The worst case is a live bug under a green test: `PinnedSection.nav-04.test.tsx:54` drops a workspace that is already in the list it was given, so it passes while a drag from the main list can never pin (`PinnedSection.tsx:64-69`).
2. **Screens are tested against stand-ins, so the seams between parts have no test.** 41 of 167 files replace `core/hooks.ts` or `core/context.tsx` with `vi.mock`. Another 10 hand-cast a `Container`, usually with a false comment that `createTestContainer` "cannot run under jsdom" (it can: `test/container.jsdom.test.tsx`, and 25 files already use it). Seams with no integration test: the chat screen with real turn building (`useChat`, `chatView`), the interaction dock to the sidecar answer, the centre tab strip with real sessions, the Git panel header with the real `computeGitHeader`, settings pages writing and reloading through the real service, the sidebar list over real data, onboarding agent detection (where the slice-1 "every agent not installed" bug lived). Keyboard shortcuts are mostly driven by calling the handler registry (`registry.run`, `runCommandHandlers`: 11 files), not by pressing keys into the mounted dispatcher. Only `nav.back` in `router.nav-02.test.tsx`, `command-dispatcher.hooks.test.tsx`, `ModeChips` and the composer tests do it for real.
3. **Some tests prove the opposite of what their title says.** `main.app-01.test.tsx:63` treats a "Startup..." log line as proof of success, but only failure paths write it. The shell reads `left_panel_visible` into `useState` before settings are loaded (`main.tsx:212-224`, `AppShell.tsx:51-53`), and every shell test sets settings before mount, so the saved sidebar is probably never applied on a real launch. Two tests in `features/home/home-query.test.ts` and one in `features/git-panel/git-panel.tabs.test.tsx:74` disagree with the source and read as red on the next CI run. Nine files assert `Not built yet: <ID>` placeholders, which breaks "never test a placeholder" and rots as each feature lands.

Judgement. The pure logic and the small controls are well tested: the command dispatcher lookup, layout persistence, navigation history, tab layout, forms, dialogs, the cards that talk to the sidecar (exact payloads), the composer editor. The weak spot is everything between parts. Line coverage hides it: `ui/` is at 98.1% and `ChatPane.tsx` at 100% lines, and `ChatPane.test.tsx` is theater. I would not let a feature row flip to `done` on this suite's say-so until each user-visible seam has one integration test over `createTestContainer`.

### What I verified myself

- `app/SurfaceLayer.tsx` is imported by nothing but its own test. `features/sidebar/PinnedSection.tsx` has no importer outside its test, and its drop handler looks the dropped id up only in the `workspaces` prop (`:64-69`), as reported.
- `main.app-01.test.tsx:63` asserts `message.startsWith("Startup")`; `AppShell.tsx:51-53` copies `left_panel_visible` into `useState` once.
- `TerminalSurface.tsx:287` lists `focusOnMount` in the effect dependencies and its cleanup calls `terminal.dispose()`; `TerminalTabBody.tsx:61` passes `focusOnMount={visible}`. A tab switch therefore rebuilds xterm.
- `home-query.test.ts:83-94` (workspace `repoId: "api"` against repos `app` and `api-service`) and `:110-117` (`pageCount: 2` expecting 10 items while `home-query.ts:113` slices `HOME_PAGE_SIZE * pageCount`) match the reported mismatch. `git-panel.tabs.test.tsx:74` expects `Not built yet: GIT-04` and `core/status/git-header.ts` has no `notImplemented`.
- Not re-verified by me: every other claim. They come from the reviewers' reading with file and line references; treat the source-bug claims as "reported by reading, not run".

## 2. Coverage

Source: [coverage-2026-11-05.md](coverage-2026-11-05.md) and `files.tsv`, measured on main (slice 1 only, 220 files, 2853 tests). Slice-2 files read 0% because they were stubs on main, so judge them by reading.

Desktop overall: 86.94% lines, 75.21% branches, 76.73% functions.

| Folder                                                                     | Files |    Lines | Branches | Functions |
| -------------------------------------------------------------------------- | ----: | -------: | -------: | --------: |
| ui                                                                         |    41 |    98.1% |    88.4% |     97.2% |
| features/composer                                                          |    21 |    93.1% |    77.7% |     85.8% |
| app                                                                        |    22 |    92.3% |    85.2% |     86.8% |
| features/sidebar                                                           |    18 |    91.4% |    80.4% |     82.7% |
| features/terminal                                                          |     5 |    90.6% |    74.6% |     83.5% |
| features/chat                                                              |    73 |    89.3% |    71.2% |     80.9% |
| features/workspace                                                         |    25 |    87.9% |    74.6% |     90.6% |
| features/diff                                                              |    13 |    82.9% |    92.2% |     61.5% |
| features/scripts-panel                                                     |    17 |    80.9% |    81.6% |     60.9% |
| features/git-panel                                                         |    30 |    80.7% |    69.8% |     67.4% |
| features/settings                                                          |    38 |    65.4% |    76.7% |     43.8% |
| features/pr                                                                |    11 |    57.1% |     100% |     18.2% |
| features/home                                                              |     5 |    57.1% |     100% |     40.0% |
| features/dashboard                                                         |     4 |    57.1% |      n/a |     40.0% |
| features/file-viewer                                                       |    19 |    34.5% |    68.8% |     10.5% |
| features/onboarding                                                        |     3 |    33.3% |      n/a |     33.3% |
| features/palette, open-in, updates, diagnostics, browser-preview, passport |    28 | 0 to 25% |      n/a |  0 to 25% |

Least covered files that matter (lines / branches / uncovered lines): `main.tsx` 39.1 / 23.5 / 42; `features/git-panel/GitPanel.tsx` 70.5 / 50.0 / 26; `features/git-panel/changes/ChangesTab.tsx` 72.0 / 78.3 / 14; `features/workspace/tab-layout.ts` 74.3 / 68.2 / 36; `features/chat/AssistantText.tsx` 82.5 / 62.8 / 29; `features/terminal/TerminalSurface.tsx` 83.0 / 51.7 / 23; `features/settings/pages/AgentsPage.tsx` 83.9 / 65.3 / 15; `features/scripts-panel/setup/SetupTab.tsx` 84.6 / 73.9 / 14.

What the numbers cannot see. Line coverage rewards the theater: `ChatPane.tsx` is at 100% lines and 100% branches because the test renders it, and the test asserts only the wrapper divs the component itself draws. `ui/` at 98% sits beside tests that pin Tailwind strings and `layout-sizes.test.ts` that copies constants. Branch coverage is the better hint: `TerminalSurface` 51.7%, `GitPanel` 50%, `AssistantText` 62.8%, `AgentsPage` 65.3% match the untested paths the reviewers named. Slice-2 files (RUN-01, SET-07, NAV-04, NAV-11, CHAT-09, CHAT-27, REV-09, APP-14) have no measurement at all.

## Over and under (shape of the suite for the whole plan)

Over-pinned, breaks on a harmless refactor and proves nothing in jsdom (no layout, no stylesheet): Tailwind class assertions in `ui/app-05-look`, `ui/app-12`, `ui/app-13`, `ui/resizable`, `ui/app-05-toast`, `ui/components`, `ui/app-04`, `ui/TitleBarInset`, `app/ShellControls`, `chat/ScrollToBottomButton`, `workspace/WorkspaceStatusIcon` (`.bg-accent`); DOM-order picks (`resetButtons[1]` in `RepoPromptsPage.test`); `[data-terminal-view]` selectors; the `svg[data-step]` attribute in `OnboardingScreen.test`; the literal `Not built yet: <ID>` text in nine files. Duplicates: `ui/components.test.tsx` repeats app-04, app-05 and app-13; `workspace.test.tsx` repeats four WorkspaceGate, Layout and StatusIcon tests; `composer.test.tsx` repeats `composer/app-04.test.tsx` exactly; `ScriptsPanel.run-01` repeats `RunTab.run-01`; contrast pair lists in `tokens.test.ts` and `app-14.test.tsx` have already drifted; `sidebar.test.tsx` repeats UnreadDot and EmptyState tests.

Under-tested for the plan ahead: a real-browser tier (dialog widths, split-pane and sidebar sizing, scroll-follow in the message list, WebKit IME `keyCode 229`, real drag and drop, xterm key handling, focus rings, reduced motion) is named in CLAUDE.md as planned and does not exist, so every layout claim in the unit tests is unverified. Real-size tests are missing almost everywhere: no component renders 300 sidebar rows, 20,000 chat events, 1,000 Home rows, 5,000 files in the Changes tab through the filter, 100,000 lines of terminal scrollback, or 500 closed chats in the history popover.

## Tests that pin behaviour that differs from Conductor (D020 and D022)

Each needs either a fix or an entry in `docs/decisions.md` that lists the difference.

- `features/chat/MessageList.test.tsx:204-208` pins "Fix a known bug"; research `ui-map.md:165` says "Fix a TODO" (chat M8).
- `features/sidebar/ViewOptionsMenu.nav-03.test.tsx:46-57` asserts "Sort by" stays visible with manual order on; Conductor hides it (sidebar C6).
- `features/chat/TurnFooter.test.tsx:109-118` and `UserMessage.test.tsx:175-203` expect Reset and Revert to run at once; Conductor shows a "Reset chat?" dialog. The real `revertTo` throws `notImplemented("CHAT-15")` (chat M9).
- The turn hover card has no Fast mode line and the test sets `fastMode: true` without asserting it (chat M16).
- `features/sidebar/AddProjectButton.test.tsx:115` asserts there is no "Recents" group; the PRJ-01 checklist lists one (sidebar C10).
- `ArchivedNotice` wording and the `Working…` ellipsis in `status-text.ts` differ from the research text, pinned by `WorkspaceGate.nav-10.test.tsx:34` and `status-text.test.ts:8-17` (workspace L1).
- `HomeEmptyState.test.tsx:19` pins "Nothing is archived" for any active filter with the archived toggle on (git LATER).
- ANSI colours are held to 3:1 contrast, not the 4.5:1 text rule of D022 (`ui/app-14.test.tsx:250-251`), with no decision entry (ui M8).

## Source bugs found while reading (reported, not run)

These came out of reading the sources. Each has a failing test to write first.

- `features/sidebar/PinnedSection.tsx:64-69`: a workspace from the main list cannot be dropped into Pinned. Also `SectionList.tsx:273` (a section can never move to first place), `:347-353` (a drop on a row inside a section does nothing), `:222,374` (dead `renaming` state), `WorkspaceRow.tsx:111-116` (hover key R only works while the row has focus), `GroupedWorkspaces.tsx:61` (`manualOrder` hard-coded false).
- `features/terminal/TerminalSurface.tsx:287` with `TerminalTabBody.tsx:61`: switching terminal tabs disposes and rebuilds xterm, and `core/services/terminals.ts:399,411` hands over an always-empty `history`, so the screen is lost. Find and link columns use string indexes, wrong after wide characters (`TerminalFindBar.tsx:84,126`).
- `main.tsx:212-224` with `AppShell.tsx:51-53`: settings read before they load.
- `features/chat/AssistantText.tsx:214,271-272`: snake_case names are italicised. `TurnItem.tsx:72` with `ChatBanner.tsx:184`: "Try again" can never show for a failed turn. `TurnItem.tsx:127` never passes `failed` to `UserMessage`.
- `features/home/WorkspaceCard.tsx:70-77`: if `unarchive` throws (the real one is `notImplemented("WS-06")`), the busy flag stays set and the button spins forever. `features/git-panel/GitHeader.tsx:381` swallows a rejected header action, and the PR-05 and PR-06 placeholders throw synchronously, so those buttons spin and stop with no message. `GitPanel.tsx:204-213`: the shortcut path has no double-press guard on a metered agent call.
- `features/scripts-panel/run/RunTab.tsx:70,145`: `isSpotlight` and `canAskAgent` are fixed values, so Spotlight and "Ask agent" are unreachable. `ScriptsPanel.tsx:141-145` mounts `PortsTab`, which throws `notImplemented("RUN-03")`. `RepoMiscPage.tsx:259-260,281` fixes `matches={null}` and `runningAgentCount={0}`.
- `features/chat/interactions/ToolApprovalCard.tsx:158` and `QuestionCard.tsx:136-137`: Enter on a focused "No" button may send `allow` if the `onButton` guard is removed; no test presses a key on a button. `PlanReviewBar` throws `notImplemented("CHAT-12")`, so a real `plan_approval` shows a placeholder and the agent waits.
- `app/command-dispatcher.ts:448` and `ui/Toast.tsx:31`: module-level mutable state, against architecture.md.

---

## 3. Findings

Each part below lists MUST then LATER. A finding gives the file and line, what is wrong, the mutation the suite misses, the fix, and the features checked. Where a finding says "bug is live", the feature is already broken and the suite is green.

### 3.1 App shell, routing, startup (`app/`, `main.app-01`)

#### MUST

**C1. The shell reads settings before they are loaded, and no test can see it.** `main.tsx:212-224` renders the router, then calls `runStartup` without waiting. `AppShell.tsx:51-53` copies `left_panel_visible` and `left_panel_width` into `useState` once. Before `settings.start()` the store is `{}` (`settings.ts:572`, `:819-820`) and `get` returns registry defaults (`settings.ts:906-912`). So on a real launch the saved sidebar state is probably never applied. Every shell test sets the values before mount (`shell-test-support.ts:120-123`, used by AppShell.test.tsx:59-63). Mutation missed: nothing waits for load. Fix: a test that renders the shell first, then runs `services.settings.start()` over a database holding `left_panel_visible=false` and a width of 300, and asserts the collapsed state and the width; then make the shell wait for loaded settings. Features checked: NAV-01 ("width remembered"), APP-01 (settings first).

**C2. `main.app-01.test.tsx:63` asserts a failure log as proof of success.** The only writers of a message starting with "Startup" are `main.tsx:198`, `main.tsx:204` and `startup.ts:101`, all failure or blocked paths. A good start writes none. So test 1 is green only if the start failed. It never checks `(await app.started).ok`, and `root.firstChild !== null` (line 59) holds even without the router. Mutations missed: making `container.start` fail; removing `<AppRoutes>` from `root.render`; removing `rootErrorHandlers` from `createRoot` (main.tsx:211). Fix: run over a migrated database and a counter id source, assert `(await app.started).ok === true`, assert that the "Run agents side by side" heading appears, and assert that a thrown render error reaches the log. Also `installHandlers` is always false here, so the default `true` is never exercised. Features: APP-01.

**C3. The shell fixture hides crashes; the boundary swallows them.** `shell-test-support.ts` builds a container over a database that refuses every query (:44-51), fills stores by hand (:100-118) and mocks `settings.set`, `terminals.loadWorkspace` and `workspaces.setActiveSession` (:119-139). Its header (:7-8) says `createTestContainer` cannot run under jsdom; that is no longer true (`test/container.jsdom.test.tsx` proves it, `test/sqlite.ts:21-27` finds the migrations from `cwd`). Every screen sits inside `NotBuiltYet`, so a real crash shows as text and the test goes on. CI log s7-r1 shows it: in `router.nav-02.test.tsx` the sidebar list `GroupedWorkspaces` crashed 9 times (`reading 'store'`), `SplitPanes` 7 times, `OpenInMenu` 7 times, `TypeError ... 'split'` 18 times, while the tests passed. The same log shows 77 stderr blocks across the shell tests (nav-02 20, router 14, AppShell 5). Mutation missed: any breakage inside a boundary that is not the thing asserted. Fix: build these tests on `createTestContainer` plus `seedRepo` and `seedWorkspace`, delete `shell-test-support.ts`, and add one helper used by every route test that fails when "This part failed to load." shows, or when `NotBuiltYet` logs a non-`NotImplemented` error. Features: NAV-01, NAV-02, NAV-03.

**C4. Route tests pin placeholders and one of them is already wrong.**

- `router.test.tsx:113-119` and `router.nav-02.test.tsx:112-113` expect `Not built yet: NAV-05` on `/all-workspaces`. `HomeScreen.tsx` has no `notImplemented`, and renders `<h1>Home</h1>` (:208), so this assertion fails on the next CI run.
- `router.test.tsx:135-136, 151`, `AppShell.test.tsx:92, 124` and `router.test.tsx:159-160` wait on "Git panel", "Scripts", "Settings", "Diagnostics" text. That text is only produced by `NotBuiltYet` (WorkspaceScreen.tsx:55, 60). The CI log shows `GitPanel` throwing GIT-04 and `ScriptsPanel` throwing RUN-01 in these tests. Engineering rule: "never test a placeholder". These break when GIT-04 or RUN-01 land, and say nothing about routing today.
- Mutation missed: pointing `/dashboard` at the Home component stays green only while both are placeholders; once built, the tests must be rewritten.
  Fix: assert on what the route adapter owns (`router.state.location.pathname`, and a stable landmark the adapter renders, e.g. a `data-route` attribute on the wrapper in router.tsx), plus the real screen's own heading for built screens. Features: NAV-02, NAV-05, NAV-06, NAV-10.

**C5. Only `nav.back` is proven through the mounted root dispatcher.** `router.nav-02.test.tsx:257-264` is a good test: real router, real `RootLayout`, real key event. Every other handler (`workspace.switch1..9`, `workspace.next/previous`, `tab.*`, `chat.*`, `review.*`) is registered through `useCommandHandler` and tested with `runCommandHandlers(...)` on the module-level default registry (`features/sidebar/GroupedWorkspaces.nav-03.test.tsx:248, 280, 314`) or under a local `CommandDispatcher`. Production uses the registry created in `RootLayout` (router.tsx:140-148), so a break in how the real dispatcher hands handlers to screens would pass all of them. Also `Cmd+]` (forward) is never pressed (nav-02 :243-255 use `registry.run`). Fix: with `createAppRouter` and `createTestContainer`, seed three workspaces, press the switch keys and `Cmd+]`, assert the location. Features: NAV-14, NAV-02, NAV-03.

**C6. Send-key tests cannot fail on the mode mapping.** `command-dispatcher.hooks.test.tsx:250-298` check that Enter, and Cmd+Enter, are left to the composer. `resolveSendKey` (send-key.ts) returns a non-null intent for both keys in both modes (Enter: submit or newline; Cmd+Enter: submit_opposite or submit), so `composerOwnsKey` is true either way. Mutation missed: `const sendKeyMode = "enter"` at command-dispatcher.ts:561. Fix: press Alt+Enter with `message_send_key = "cmd-enter"` (owned by composer) and with `"enter"` (not owned, dispatcher takes it), and assert the menu receives `CmdOrCtrl+Enter` for `chat.submit` after the setting changes (`shortcutCalls`). Features: NAV-14, COMP-01.

**C7. `startup.app-01.test.ts` leaves the database gate's error branches untested.** `fakePlatform` always returns `ok(warning)` (:26). Missing: `dbVersionWarning` throwing (startup.ts:51-62) and returning an Err (:63-71), both of which must report `failed`, phase `database`, with the log path. Mutation missed: delete both blocks. Also the container is a hand-made object (:37-39) so `runStartup` is never run against a real `container.start`. Fix: two tests that override `memory.platform.app.dbVersionWarning`, and one ready-state test on `createTestContainer`. Features: APP-01.

**C8. NAV-15 is built and tested, but nothing uses it.** `grep` for `SurfaceLayer` and `SurfaceAnchor` finds only `SurfaceLayer.tsx` and its test. Checklist item "Terminals and browser previews stay alive when the user switches tabs" has no failing test: unmounting the terminal in the tab strip would not fail anything. Items "surface layout registry" and "dialog manager" (stores) have no code and no test. Fix: mount the layer in the workspace screen (NAV-10 owner) and add an integration test that switches tabs in the real `WorkspaceScreen` and asserts the terminal node is the same DOM node. Features: NAV-15, NAV-10, RUN-06.

**C9. `CreateWorkspacePage.test.tsx` runs over a hand-built container and skips the states the page must handle.**

- Lines 63 (`new RepoService({} as RepoServiceDeps)`), 70-81 (hand-made settings) and 95-107 (`as unknown as Container`) break the engineering rule "screens are tested over the real container". The `lastFailedCreate` shape and `create` result are the test's own inventions.
- Untested "Must handle" items: no project (source :87-97), loading (:71-77), error (:79-85), a failed retry (:163-167), a failed recover (:177-181), a chosen section (:142), plan mode (:57, 130), a typed model (:127), the "Failed to create workspace" toast (:150), the "Creating workspace…" toast (:124).
- Mutations missed: `planMode: false` constant; `sectionId: null` constant; `toolApprovals` constant.
- Leak: `vi.spyOn(toast, "warning")` is restored by a manual `mockRestore()` at the end of the test (:177, :266), so a failing assertion leaves the spy in place.
  Fix: `createTestContainer` + `seedRepo`, `seedSection`, and a real `workspaces.create` against the memory platform's shell; add the missing states. Features: WS-01.

**C10. `git-16.test.tsx` has a racy negative and an unchecked title.** Test 2 (:60-83) waits until the shell call for `xcodebuild` is recorded, then immediately asserts the toast is absent. The toast is raised after the probe's `await` resumes, so the assertion can run first. Mutation missed: show the toast when the exit code is 0. Test 1's title promises "for 15 seconds" and offers the fix, but never reads the duration (`xcodeLicenseToastOptions` carries it, xcode-license.ts:90-102). The fix-failed branch (xcode-license-notice.ts:38-41) is untested. `test.close()` runs without `container.stop()`. Fix: wait on something that happens after the decision (a completion log line, or flush with `await act(async () => {})` after the call and then assert), assert the toast `duration`, and add a test where `runXcodeLicenseFix` fails and a toast error shows. Features: GIT-16.

**C11. `ShellControls` buttons have no navigation test.** `ShellControls.test.tsx` never clicks "Go back" or "Go forward"; the only checks are existence (also in router.test.tsx:88-89) and `disabled`. Fix: render in a real router with two history entries, click Go back, assert the location, click Go forward, assert it returns. Features: NAV-01, NAV-02 (checklist "Go back and Go forward buttons").

**C12. The sidebar toggle test passes without a toggle.** `AppShell.test.tsx:105-120` click "Hide sidebar" and check the saved value. `toggleSidebar` saves `{ inPixels: 0 }` right after `panel.collapse()` (AppShell.tsx:93-94) whatever the panel did. Deleting `panel.collapse()` stays green. The "Show sidebar" label after the click is only asserted in a harness that owns the state (ShellControls.test.tsx:9-25). Fix: after the click in the full shell assert that the button now reads "Show sidebar" (it is driven by `onResize`), and put the real resize and the drag path (`onLayoutChanged`, AppShell.tsx:128) in the end-to-end layer if jsdom cannot lay out. Features: NAV-01.

**C13. A theater test and dead exports in `query-options`.** `query-options.test.ts:50-58` builds two `QueryClient`s from the defaults and checks they do not share data; that is true of any `QueryClient`. It never touches `createQueryClient` (providers.tsx:41), where a persister would be added. Also `sharedQueryOptions` and `immutableQueryOptions` have no importer outside `query-options.ts`, so the tested retry rule runs on no query. Fix: drop the theater test, assert on `createQueryClient(...).getDefaultOptions()` and that the cache has no persister; delete unused exports or add the first query that uses them. Features: DATA-01 (checklist "query cache is not persisted", "30 s stale time").

**C14. `command-dispatcher.test.ts:330-343` is a tautology.** `keyBindings()` is built from `effectiveShortcuts` (command-dispatcher.ts:295-303); the test compares it to `effectiveShortcuts`. It covers three commands, not every shortcut as its title says. Checklist item "one registry feeds menus, palette and shortcut dialog" is not proven by it. Fix: for every command in `COMMANDS`, assert that pressing each default shortcut resolves back to that command id (round trip), and that no two commands in one scope share a shortcut. Features: NAV-14.

#### LATER

- L1. Three copies of "/ shows the centre empty state": router.test.tsx:78-83, router.nav-02.test.tsx:103-107, AppShell.test.tsx:48-57. Keep one.
- L2. `router.test.tsx` and `AppShell.test.tsx` do not clear `localStorage` in `beforeEach` the way nav-02 does (nav-02:23-26); `RouteLocationPersistence` writes the saved location in router.test.tsx:130-140. Order-dependent if a "/" test is added after the workspace tests.
- L3. `startup.app-01.test.ts:199-239`: `dispose()` is not in a `finally`, so a failing assertion leaves `console.error` patched and the window listeners installed. The console.error test also prints "save failed" to stderr (CI log line 4925), which breaks "output must be pristine".
- L4. Constant ids: `main.app-01.test.tsx:46, 73` and `command-dispatcher.hooks.test.tsx:36` use `uuid: () => "id"`. Engineering rule: ids are never constant.
- L5. `ShellControls.test.tsx:34` and `FullPage.test.tsx` assert a Tailwind class (`pl-(--traffic-lights-clearance)`); a rename breaks the test with the behaviour intact. Assert computed position or the CSS variable instead.
- L6. `router.nav-02.test.tsx:117-121` (repo settings route) passes with a wrong `page` prop because the screen is a placeholder. Assert once SET-02 lands.
- L7. `test/container.ts` fidelity: real migrated database and real `createContainer` (good), counter ids (good), but a frozen clock (`FIXED_NOW`, :27), seed helpers using their own `FIXED_CLOCK` and `crypto.randomUUID` instead of the container's inputs (:90-98), every seeded workspace on port 55000 (:127; the real allocator hands out different ports), `close()` that does not call `container.stop()`, and place names `test-place` (:36-43) instead of the real list.
- L8. `command-dispatcher.test.ts:167-226` assert only on `vi.fn` deps. Acceptable (dependency injection, they check calls with real ids), but a script will flag them.
- L9. Header says tests "pin" `Cmd+A` for shift and alt variants; `AppShell.test.tsx:138-163` covers only the Cmd case and the input case. Add Ctrl, Shift+Cmd+A, contenteditable.
- L10. Real size: no test of the shell with 300 workspaces or `chooseRestoreTarget` with thousands (cheap), no late-answer test for `RestoreLastLocation` when the stores load after mount.
- L11. `AppShell` "centre error clears on route change" (resetKey, AppShell.tsx:153) and "sidebar fails separately" have no test.

### 3.2 UI primitives (`ui/`)

#### MUST

**M1. layout-sizes.test.ts:4-18 is theater (NAV-01).**
The three tests assert `sidebarSize.default === "256px"` and the like. The expected values are copied from the source file beside it. Nothing checks that the shell uses them. `scriptsPanelCollapsedSize` (layout-sizes.ts:27, used by features/workspace/WorkspaceLayout.tsx:106) has no assertion at all.
Mutation missed: `AppShell.tsx:134-135` uses a different `minSize` or `maxSize`; `centreMinSize` dropped at `AppShell.tsx:151`.
Fix: delete the file. Put the behaviour in a shell test: with the real `AppShell` and `createTestContainer`, read the sidebar panel's min and max from the rendered separator (`aria-valuemin`, `aria-valuemax`) using the offsetHeight/offsetWidth spy from resizable.test.tsx:96. Without that, accept the constants as unverified and say so in the file header.
Checked: NAV-01 items "Left sidebar: resizable, collapsible, min and max" and "Centre panel with a minimum width".

**M2. The `--shell-left-inset` seam has no test (NAV-01, "Title bar row with traffic-light clearance").**
`TitleBarInset.test.tsx:14-15` only checks that the class string contains `w-[var(--shell-left-inset,0px)]`. The variable is set in `app/AppShell.tsx:114-116` (`sidebarOpen ? "0px" : "var(--shell-controls-width)"`). A search of `AppShell.test.tsx` finds no "inset". Two consumers use the spacer (features/home/HomeScreen.tsx:207, features/workspace/WorkspaceLayout.tsx:71) and no test reads the variable.
Mutation missed: swap the ternary at AppShell.tsx:115. Closed sidebar then hides the header behind the traffic lights; every test stays green.
Fix: in `AppShell.test.tsx`, hide the sidebar through the real toggle button and assert `getComputedStyle(root).getPropertyValue("--shell-left-inset")` (or the inline `style`) is `var(--shell-controls-width)`, and `0px` when open. Keep the TitleBarInset test for `aria-hidden` only.

**M3. Restoring a saved layout is not tested (resizable.test.tsx:73-88; NAV-01 "Right-panel layout is saved per workspace").**
The test makes `load` a `vi.fn` returning `{left:30,right:70}` and asserts it was called with the group id and panel ids. It never checks the layout reached the panels.
Mutation missed: resizable.tsx:94 `defaultLayout={savedLayout ?? defaultLayout}` becomes `defaultLayout={defaultLayout}`. Every workspace then reopens with default sizes.
Fix: reuse the `offsetHeight` spy from `:96`, render with a store returning `{left:30,right:70}`, and assert the separator's `aria-valuenow` (or the panel's flex-grow) is 30. Also add a case with a saved id that is not in the group (the `knownPanels` filter at resizable.tsx:78) and a case with `persist={false}` (resizable.tsx:73, :80, :86). AppShell relies on `persist={false}` (app/AppShell.tsx:128) and no test in `resizable.test.tsx` covers it.

**M4. The page-scroll close test cannot see the `capture` flag (Menu.tsx:180; APP-05 "close on scroll").**
Both close tests dispatch `scroll` on `document` itself (app-05.test.tsx:155, app-05-menu.test.tsx:92). A listener on `document` hears that whether or not `capture` is `true`. Real scrollers (the sidebar list) fire `scroll` on an element, and element scrolls do not bubble.
Mutation missed: `document.addEventListener("scroll", onScroll, true)` becomes `(..., false)`. The menu would stay open when the sidebar scrolls. Green.
Fix: render a scrollable `<div>` beside the trigger and `fireEvent.scroll(thatDiv)`. Do this for Menu and ContextMenu.

**M5. Digit selection edges are unchecked (Menu.tsx:198, :201; APP-05 "Digits 1 to 9 pick a menu item").**
No test has a disabled item, a modifier key, or a digit beyond the item count. The selector skips disabled items (`:not([data-disabled])`) and the handler ignores Cmd, Ctrl and Alt. ui-map.md lists Ctrl+1..9 as other shortcuts (docs/research/conductor/ui-map.md:584), so the guard matters.
Mutations missed: remove `:not([data-disabled])` (a disabled item gets clicked); remove the `metaKey || ctrlKey || altKey` line (Cmd+1 picks a menu item while a menu is open).
Fix: three small tests on Menu and one on ContextMenu: disabled first item makes digit 1 pick the second; `fireEvent.keyDown(item, {key:"1", metaKey:true})` picks nothing; digit 9 with two items picks nothing.

**M6. Button sizes and IconButton behaviour are unchecked (Button.tsx:49-54, IconButton.tsx:23-28, :52-57; APP-05 "Button variants and sizes", "Dialog, tooltip, popover").**
No test passes `size` to Button or IconButton (search for `size=` finds only Dialog, Checkbox, Toggle). The variant tests compare the rendered class to `buttonVariantClass[variant]` from the same source (app-05.test.tsx:51), so they restate the source. `IconButton` tests (components.test.tsx:66-78) check the name and `aria-pressed` only.
Mutations missed: swap `md` and `lg` in `buttonSizeClass`; delete the `<Tooltip>` wrapper at IconButton.tsx:54; remove `if (rest.disabled) return button;`; drop `shortcut` from the tooltip.
Fix: assert each size renders a different size class and the four heights differ; for IconButton hover or focus the button and assert the tooltip text and the `Kbd` shortcut; render disabled and assert focus shows no tooltip. The real pixel size needs a browser test (section E).

**M7. "Shows a spinner" never checks a spinner (components.test.tsx:50-63; Button.tsx:97-101).**
The title says loading "shows a spinner". The body asserts `disabled`, `aria-busy`, no `status` role and no click. The spinner sits in an `aria-hidden` wrapper, so `queryByRole("status")` is null whether the spinner exists or not. `app-05-toast.test.tsx:124-129` repeats the same check.
Mutation missed: delete the `{loading ? ... : null}` block. A loading button then shows only an invisible label (`opacity-0`).
Fix: assert `button.querySelector('[data-kind="working"]')` is not null when loading and null otherwise.

**M8. APP-14 tests pass for reasons weaker than their titles (app-14.test.tsx).**

- `:312-315` "keeps warning distinguishable under every colour-vision variant" only asserts `visionColors[...].has("warning")` is false. Nothing measures distance between warning and the new danger (`#b7430a` orange, styles.css protan block) or success (blue). Amber against `#b7430a` is the pair most likely to merge for protanopia.
- `:250-251`, `:353-359` check the sixteen ANSI colours at 3:1 and call them marks. A terminal prints text. D022 says text meets WCAG AA (4.5:1). docs/design.md:70 admits several light ANSI colours fall under 4.5:1; the 3:1 bar is what lets them pass. This is a written choice, but it is the weaker bar and is not recorded as an exception in `docs/decisions.md`.
- `:366-375` "translucent sidebar surface" asserts literal hexes and a regex match on `styles.css`. With `data-vibrancy="on"` the surface becomes `#fafaf999` or `#211e1c99`; text on it is never measured, although the file already has the `translucentBases` blend (`:196-208`).
  Mutations missed: set `--color-warning` in the protan block to a colour close to `#b7430a`; set `--color-sidebar-translucent` alpha to `0x10`; make `--color-term-white` 3.0:1 against canvas. All green.
  Fix: compute warning-vs-danger and warning-vs-success contrast or a simulated colour difference per palette; write the ANSI exceptions as an explicit named allow list at 4.5:1 for the rest; add vibrancy-on pairs to `textPairs`.
  Checked: APP-14 items "Colour-vision variants", "Translucent sidebar surface", "Sixteen terminal colours".

**M9. The hard-coded colour guard misses 11 feature folders and cannot fail on a sample (tokens.test.ts:194-206, :217-235).**
`roots` lists nine feature folders. The folders on disk but not listed: `browser-preview`, `diagnostics`, `diff`, `file-viewer`, `git-panel`, `open-in`, `pr`, `scripts-panel`, `settings`, `terminal`, `updates`. engineering.md says "A guard proves it can fail"; this one has no sample it must flag.
Mutation missed: add `className="bg-red-500"` in `features/git-panel/...`; or break the `palette` regex so it never matches. Both green (`:222` only checks more than 50 files were found).
Fix: walk all of `src` except tests, `assets/` and `styles.css`; add one in-test string containing `bg-red-500` and `#fff` that the same function must flag. Add `rgb(`, `hsl(` and `oklch(` to the patterns.

**M10. No test mounts the real Dialog or Menu under the real command dispatcher.**
`app/command-dispatcher.ts:355-360` decides scope from `[role='menu']`, `[role='menuitem']` and `[role='dialog']`. Its only dialog test builds a bare element with `setAttribute("role","dialog")` (app/command-dispatcher.test.ts:277). `ui/Dialog.tsx:70-75` handles Cmd+Enter itself, and the registry also binds Cmd+Enter (core/registries/commands.ts:214, :502). I did not run it, so I cannot say both fire. The point is that nothing tests it.
Mutation missed: Radix changes the role it renders, or the dispatcher also runs `chat.submit` on Cmd+Enter inside a Radix dialog. Green.
Fix: one integration test in `app/` that mounts `CommandDispatcher`, a real `Dialog` with `onConfirm`, a focused textarea inside it, sends `keyDown` Cmd+Enter, and asserts `onConfirm` ran once and the underlying chat command did not. A second one for a real `Menu`: with a menu open, digit and arrow keys do not reach global handlers.
Checked: APP-05 "Cmd+Enter confirms a dialog", NAV-14.

#### LATER

**L1. Duplicate tests, no single home.**

- Contrast: `tokens.test.ts:84-121, :129-140` and `app-14.test.tsx:210-248, :333-364` hold the same pair lists. They have already drifted: app-14 has the search-highlight pair and the terminal colours, tokens.test does not. Keep the one in app-14; keep the other token tests (type scale, weights, fonts, colour scan) under a `TOKENS` id.
- EmptyState: `app-04.test.tsx:10-26` and `components.test.tsx:94-112`.
- Spinner status: `components.test.tsx:80-85`, `app-05.test.tsx:279-283`, `app-05-look.test.tsx:11-45`.
- Toast: `app-05.test.tsx:241-273` and `app-05-toast.test.tsx:43-111`.
- Menu digit, Menu open, Dialog Escape, Button loading: `components.test.tsx` repeats app-05 and app-13 cases.
- Icons: `namedIcons` is built twice (`app-05.test.tsx:287`, `app-05-look.test.tsx:47`).
  Fix: delete `components.test.tsx` after moving Badge, Tabs, Tooltip, PanelHeader, SectionHeader, Kbd and cn tests into id-named files.

**L2. Tests pin Tailwind strings that break on harmless refactors and prove nothing about rendering.**
jsdom has no layout and no stylesheet, so `className` checks cannot show a real size or colour. Pinned: app-05-look.test.tsx:93-106 (seven `max-w-*`, `rounded-md`, `p-6`, `gap-4`); resizable.test.tsx:41-71 (about ten arbitrary-value classes, including `before:-left-[3.5px]`); app-12.test.tsx:157-160, :172-176, :192-197, :207-219, :247-260; app-13.test.tsx:52-53, :61, :214-215, :224, :229, :306, :332; app-05-toast.test.tsx:51-53; components.test.tsx:41-42, :140; app-14.test.tsx:380-384; app-04.test.tsx:51; TitleBarInset.test.tsx:14-15.
Fix: keep a handful where the class is the contract (state classes such as `bg-active` on pressed). For sizes, hit areas and colours use the planned browser or screenshot tier (section E). Delete the rest.

**L3. Vacuous or weak assertions.**

- states.test.tsx:45 `expect(log).toHaveBeenCalled()` on a spied `console.error`. React logs a caught render error itself, so deleting NotBuiltYet.tsx:51 stays green. Assert a call whose first argument is the thrown error and whose second is a component stack. Add the opposite for NotImplemented. ErrorBoundary's `console.error` (ErrorBoundary.tsx:38) is never asserted either.
- app-12.test.tsx:186-189 `not.toContain("w-full")` is vacuous: `Input` has no `w-full` in any branch.
- app-13.test.tsx:170-171 asserts the close callback ran twice, not that the second call was `false`.
- app-05.test.tsx:291-295 checks one key per icon family (`review`, `pullRequest`, `terminal`). `statusIcons` has five keys (icons.tsx:135-141); nothing ties them to the real status union.
- states.test.tsx:166 asserts `new NotImplemented("X").featureId` inside an ErrorBoundary test. That belongs in `packages/shared`.
- app-14.test.tsx:87-106 uses a Map as the root. The real `document.documentElement` is available in jsdom and costs nothing.

**L4. CopyButton timer cases named in the header are untested (CopyButton.tsx:49-56, :58-73; APP-13).**
The header lists "a second copy inside the window restarts the timer" and "unmounting while the timer runs". Mutation missed: delete `clearTimer()` at `:59` or the cleanup effect at `:56`. Also, if the first of two copies resolves after the second, `timer.current` is overwritten at `:72` without clearing the second timer. Rule "only the newest async result changes state" applies.
The two tests that wait use real time (`copiedMs={200}` at app-13.test.tsx:98 and `waitFor`, `:103`). Use fake timers.

**L5. TruncatedText header cases are untested (TruncatedText.tsx:9-10, :20-21, :52-54).**
Not tested: limit 0 or 1, an emoji or non-Latin text split by code point, no copy button without `onCopy`. The third test (app-13.test.tsx:350-360) computes its expected text with `truncateMiddle`, the function under test. Add literal expected strings.

**L6. Switch and Checkbox keyboard handlers look redundant and rest on jsdom behaviour (Switch.tsx:35-39, Checkbox.tsx:41-45).**
A native button already toggles on Space and Enter, and Radix handles the click. jsdom does not turn `keydown` into a click, so the handlers exist in a form only the tests can see. Deleting them probably changes nothing in WebKit, but the tests would fail. I have not verified WebKit. Checkbox Space has no test at all (listed under "Must handle", Checkbox.tsx:7). A real-key test (user-event or a Playwright run) would settle both.

**L7. Real-time waits.**
Hover card opens after `openDelay={200}` (Popover.tsx:41) and the test waits with `findByText` (app-05.test.tsx:183); the toast auto-close test uses `duration: 30` and `timeout: 2000` (app-05-toast.test.tsx:116-119); CopyButton above. Under load these are slow, not wrong, but the brief says fake time. Only focus-open is tested for the hover card; pointer hover (the main use) is not.

**L8. Shared module state.**
`ui/Toast.tsx:31-50` holds a module-level zustand store (`open`, `owned`, `next`), against architecture.md "no module-level mutable state". `app-05.test.tsx:26-29` resets only `toast.dismiss()`, not `setCurrentWorkspace(null)` (app-05-toast.test.tsx:16-20 does). The test at `:259-273` leaves `open = "w2"`. No test breaks today because later tests use plain `toast`; reordering would. `states.test.tsx:15` also keeps a mutable `flaky` object at module scope; every test that uses it sets it first, so it is safe today.

**L9. Dialog behaviours named in the header are untested (Dialog.tsx:8-10).**
Only Escape and Cmd+Enter are tested. Not tested: overlay click closes, focus is trapped, focus returns to the trigger (Popover has such a test, app-05.test.tsx:161-174). AlertDialog "controlled and uncontrolled" is claimed (AlertDialog.tsx:10); every test passes `open` and a `vi.fn`, so real closing is never observed.

**L10. Missing edges.**
Badge: three of four tones untested (components.test.tsx:137-142). Slider at min or max (ArrowRight at max). Select with empty options. `SectionHeader count={0}`. Menu with 300 items for digit keys. NotBuiltYet `overlay` without `onDismiss` and the `inline` variant with a non-NotImplemented error (NotBuiltYet.tsx:60-86). HighlightedText on a long text with thousands of matches (settings search at real size).

**L11. Test hygiene one-liners.**
`import "../test/dom-polyfills.ts"` appears in seven files, but `test/setup.ts` already loads it (setup.ts header says "no test has to import it by hand"). `components.test.tsx` and `tokens.test.ts` have no feature id in titles; engineering.md asks for one.

### 3.3 Chat top level (`features/chat/*.test`)

#### MUST

**M1. ChatPane has no real test (THEATER).** `features/chat/ChatPane.test.tsx:6-13, 20-35`. Six children are mocked and only wrapper `data-region` divs are asserted. The real behaviour is in the effect at `ChatPane.tsx:36-42`: it sets the viewed chat, clears the workspace's unread chats and toasts on failure, and clears the viewed chat on unmount. It also resets each part with `resetKey={sessionId}` on a chat switch. Mutations missed: delete lines 37-41; remove `resetKey`; remove `<MessageList/>`. Fix: render `ChatPane` over `createTestContainer` with a seeded workspace and two sessions, one unread, one waiting for permission. Assert the unread count drops and the waiting chat keeps it, that unmount calls `setViewing(null)` (observable through the notification suppression that `core/services/notifications.nav-11.test.ts` already tests), that a failing `markAllRead` toasts, and that switching `sessionId` resets the parts. Features: CHAT-06, NAV-11. The service tests (`core/services/sessions.nav-11.test.ts:108,127-130`) call `markAllRead` and `setViewing` directly, so nothing proves the screen calls them.

**M2. The chat screen is never tested over the real container with real turn building.** `useChat` (`core/hooks/chats.ts:68`) and `sessions.chatView` are named in no test file (grep for `useChat`, `chatView`: only `hooks/chats.ts`, `services/sessions.ts`, `api.ts`, mocks). Every chat component test mocks `core/hooks.ts` or hand-builds `ChatTurn` objects. The slice-1 bugs lived at exactly this seam. Mutation missed: `chatView` returns turns with fresh object identities on every call (the tail-only re-render in `MessageList.test.tsx:182-199` passes only because the test reuses the same turn objects); `useChat` drops `liveState.retry`; the turn builder emits a block kind the list cannot show. Fix: one integration test file that seeds a session, feeds real `SessionEvent`s through the container's ingest, renders `ChatPane` unmocked, and asserts user message, assistant text, tool card, footer, error banner, retry line, then appends one streaming event and asserts only the tail item re-rendered. Features: CHAT-06, CHAT-07, CHAT-27, CHAT-09.

**M3. "Message not sent" with Retry and Discard is unreachable, and the test passes without the wiring.** `features/chat/TurnItem.tsx:127` renders `<UserMessage turn sessionId />` with no `failed`, `onRetry` or `onDiscard`. `failedSends` lives in the session store (`core/services/sessions.ts:138`) but not in `ChatView` (`core/model.ts:322-337`). `retryFailedSend` and `discardFailedSend` (`core/api.ts:421-423`) have no UI caller. `UserMessage.test.tsx:96-113` passes the prop and the text "Message not sent" itself, then clicks the buttons. Mutation missed: remove the whole failed-send path from the live app; the test stays green. This is a CHAT-06 checklist rule (moved from CHAT-02) on a `done` row. Fix: add `failedSends` to `ChatView`, render per message in `TurnItem`, and test over the real container that a failed send shows the card and Retry calls `retryFailedSend`. Features: CHAT-06, CHAT-02.

**M4. The failed-turn retry test uses a banner that drifts from the real one.** `TurnItem.test.tsx:20-32` mocks `ChatBanner` to show a retry button whenever `onRetry` is given. The real banner shows "Try again" only when `item.retryable && onRetry` (`ChatBanner.tsx:184`), and `TurnItem.outcomeBlock` builds the error block with `retryable: false` (`TurnItem.tsx:72`). So for `turn.outcome === "error"` the real UI offers no "Try again", and the tests at `TurnItem.test.tsx:148-165` cover a path the live screen cannot reach. Mutation missed: none needed, the path is already dead. Fix: render the real `ChatBanner` in these tests. Decide which is right per Conductor (ui-map 3.3 lists Retry in new chat for the error card); then either set `retryable` from the turn or delete `retryMessage`. Features: CHAT-06, CHAT-27.

**M5. TurnItem tests never assert the user message or the footer of a finished turn.** `TurnItem.test.tsx:14-19` mocks both but no `expect` reads `user:` or `footer:` positively (only `queryByText(/^footer:/)` null at 183). Mutations missed: delete `TurnItem.tsx:127` or `:157`. Fix: assert both appear for a finished turn and only the spinner and no footer for a running one. Features: CHAT-06.

**M6. Scroll behaviour of the list is untested.** `MessageList.tsx:103,114,116-117,121-130`: `key={sessionId}` reset on chat switch, `initialTopMostItemIndex`, `followOutput`, `atBottomStateChange` driving the Scroll to bottom button, `scrollToIndex` on click. jsdom has no layout, so `VirtuosoMockContext` (`MessageList.test.tsx:146-150`) never fires an at-bottom change. Mutations missed: delete `atBottomStateChange={setAtBottom}`; scroll to index 0; flip `followOutput`; drop the `key`. All green. The component test for the button (`ScrollToBottomButton.test.tsx`) cannot see the wiring. Fix: a browser-level test (see E) plus a jsdom test that captures the `Virtuoso` props through a typed stand-in and calls `atBottomStateChange(false)` to assert the button appears and its click calls `scrollToIndex({ index: last, behavior: "smooth" })`. Features: CHAT-06.

**M7. Starter pick may drop the user's draft, and no test can see it.** `MessageList.tsx:81-88` appends to an existing draft; `MessageList.test.tsx:24` fixes `useDraft` to empty, so only the empty branch runs (201-209). Mutation missed: `text = prompt` always (data loss). Fix: seed a draft through the real container and assert it is kept with a blank line before the prompt. Features: CHAT-06.

**M8. Wrong visible text pinned (D020).** `features/chat/EmptyChat.tsx:16` shows "Fix a known bug"; `docs/research/conductor/ui-map.md:165` says "Fix a TODO". `MessageList.test.tsx:204-208` asserts the wrong label. No decision lists this difference. Fix: change the label and the test, or add a decision entry. Features: CHAT-06.

**M9. Reset and Revert run at once, tests pin that, and the real action throws (D020).** `TurnFooter.test.tsx:109-118` and `UserMessage.test.tsx:175-203` click and expect `revertTo` at once. Conductor shows "Reset chat?" with "Later messages will be deleted." and "Also reset files" (ui-map.md Reset dialog row); `ResetChatDialog.tsx` is a CHAT-15 placeholder. The real `revertTo` is `notImplemented("CHAT-15")` (`core/services/checkpoint.ts:208-210`) and throws, and `UserMessage.tsx:179-186` renders Revert on every message. Mutation missed: none, but the live click throws. Fix: when CHAT-15 lands the tests change; until then these tests give false cover. Features: CHAT-06, CHAT-15.

**M10. Hand-built container with a false claim.** `ExternalLink.test.tsx:21-22`: "`createTestContainer` needs a node environment" and `{ actions: { app: { openUrl } } } as unknown as Container`. `test/container.jsdom.test.tsx` and `features/chat/interactions/ToolApprovalCard.test.tsx` use `createTestContainer` under jsdom. Fix: use it and override `container.actions.app.openUrl`, as `ToolApprovalCard.test.tsx` does. Features: CHAT-06.

**M11. Ten of 21 files replace `core/hooks.ts` with `vi.mock` and a hand-made `useActions`.** `AssistantText`, `CodeBlock`, `ChatBanner` (2), `MessageList` (2), `TurnFooter`, `TurnItem` (2), `UserMessage` tests. The fake action tables are untyped factories, so a changed `Actions` signature (for example `sessions.send` arguments) breaks nothing in these tests. engineering.md "Screens are tested over the real container" is not followed. The two files that use the real container (`NextUnreadButton.nav-11`, `ChatPane`) prove it works in jsdom. Fix: `createTestContainer`, then assign typed overrides on `container.actions`. Features: CHAT-06, CHAT-27, CHAT-09.

**M12. TurnChanges is orphaned and TurnFooter duplicates its count.** `TurnChanges` is imported by no file outside its own test (grep over `apps`). `TurnFooter.tsx:94-98` renders its own "N files changed" span with no Open diff. REV-09 checklist item "File-change summary with 'Open diff' under a turn" is not on screen; `TurnChanges.test.tsx` passes without it. `docs/plans/items/system.tsv:2956` (APP-16) names it only in a list. Row REV-09 is `stub`, so not a done-row violation yet. Fix: render `TurnChanges` in `TurnFooter` or `TurnItem` with a real `onOpenDiff`, and test it at the turn level. Features: REV-09, CHAT-06.

**M13. NextUnreadButton handlers and key hint are untested.** `NextUnreadButton.tsx:82-85` registers `chat.nextNeedingAttention` (Cmd+Alt+L) and `nav.nextUnread`; `:96-100` shows the live shortcut. No test in the repo runs either id against this component (`grep` finds only registry entries and a `CommandHint` test). Mutation missed: delete lines 82-85. Fix: with the real container, run the command through `runCommandHandlers` and assert `navigate` is called with the same arguments as the click; return false when nothing is unread; rebind the shortcut and assert the title and `Kbd`. Features: NAV-11.

**M14. Ctrl+O goes through the handler registry directly, not a key event.** `MessageList.test.tsx:219-243` calls `runCommandHandlers("chat.expandAllToolCalls")` on the module-level default registry. No test mounts the real `CommandDispatcher` above `MessageList` and presses the key, or checks a rebind. Slice 1's worst bug was a dispatcher nobody mounted. Mutation missed: register under a different command id in the real app shell, or register in a registry the dispatcher does not read. Fix: render under the real dispatcher provider, `userEvent.keyboard("{Control>}o")`, assert `expand_tool_calls` flips in the real settings store, then rebind and repeat. Features: CHAT-06 (rule moved from CHAT-08).

**M15. Retry actions have no failure or double-click tests.** `ChatBanner.tsx:75-100` (toast, navigate, single flight) and `TurnItem.tsx:92-103` (cancel failure, single flight, toast "Couldn't retry now"). Mutations: see the WEAK rows. Fix: add a cancel-fails test (send must not be called), a double click test (one `cancel`), a retry-in-new-chat failure test (toast, no navigation), and a success test reading the router location (`sessionId` becomes the new chat). Features: CHAT-27.

**M16. Turn hover card omits Fast mode (D020).** Research lists "Fast mode state" in the hover card (ui-map.md Turn footer row). `TurnFooter.tsx:58-65` has no fast-mode line, and `TurnFooter.test.tsx:55-63` sets `fastMode: true` and never asserts it. Fix: add the line and assert it. Features: CHAT-06.

**M17. Markdown renderer italicises snake_case, with no test (source bug).** `AssistantText.tsx:214` (`(_[^_]+_)`) and `:271-272`. By reading, `my_var_name` renders as "my", italic "var", "name". Agent replies often carry names like `expand_tool_calls` outside backticks. Not run. Failing test first: render `expand_tool_calls` and assert one text node with that exact string. Features: CHAT-06.

#### LATER

- L1. `ScrollToBottomButton.test.tsx:26-32` pins `absolute`, `inset-x-0`, `bottom-3`. A harmless restyle breaks it, and a layout bug it was written for is still invisible without layout. Move to the browser test.
- L2. `console.error` spies restored after assertions, not in `finally` or `afterEach`: `TurnItem.test.tsx:96-112`, `ChatBlockView.test.tsx:78-88, 91-106`. A failing assertion leaves the spy on for later tests in the file.
- L3. `TurnItem.test.tsx:95-113` makes the mocked `ChatBlockView` throw. The real `ChatBlockView` wraps every block in its own boundary (`ChatBlockView.tsx:80`), so that throw never reaches the turn boundary in the live app. Throw from a mocked `UserMessage` or `TurnFooter` instead.
- L4. `CodeBlock.tsx:86` guards a stale highlight with `cancelled`. engineering.md asks for a test with two answers in the wrong order. Also theme switching.
- L5. `UserMessage.tsx:171` keys attachments by path; two equal paths collide. `:133-167` Show more, `:43-67` thumbnail fallback and `:118-119` PR number guard are untested.
- L6. `TurnFooter`: Copy final message disabled when no text, two text blocks joined with a blank line, Fork to new workspace disabled, `forkFrom` result ignored (`TurnFooter.tsx:110-113`, the new session is never opened).
- L7. `MessageList.chat-27.test.tsx:47` builds partial turns with `as unknown as ChatTurn` and `session: { id } as never` (51). Use the full builder from `MessageList.test.tsx` or a shared fixture.
- L8. `ChatBanner`: notice kinds `session_started`, `model_changed`, "Copy message" on a notice, `Open agent settings` link target.
- L9. `TodoList`: identity when the agent reorders or repeats a label (`withKeys` in `tools/ToolCardFrame.tsx`). Already in the prior audit as a gap.
- L10. `AssistantText.test.tsx:63-67` checks only the `data-markdown-style` attribute, not that Tufte changes the layout.
- L11. Real size: `MessageList.test.tsx` uses 2000 hand-made turns. engineering.md asks for 20,000 events. `core/services/turn-builder.test.ts:434-455` builds 5,000 turns from 20,000 events but asserts only counts and "same", with no time bound, and nothing renders those turns.
- L12. Redundant `import "../../test/dom-polyfills.ts"` in `MessageList*.test.tsx`, `NextUnreadButton.nav-11.test.tsx`, `ScrollToBottomButton.test.tsx`: `test/setup.ts` already loads it.
- L13. `ChatBlockView.test.tsx:12-18` simulates a thinking view that throws `notImplemented("CHAT-09")`. `ThinkingBlock` is built now, so only the generic boundary part still matters. `APP-16` in `docs/plans/items/system.tsv:2956` still says thinking shows "Not built yet".

### 3.4 Interaction cards, tool cards, composer

#### MUST

**M1. No integration test from the store to the open card to the sidecar answer (user-visible seam).**

- Where: `InteractionDock.test.tsx:16-21` mocks `useChat`. Nothing calls `chatView` (core/services/sessions.ts:1375) or `useChat` (core/hooks/chats.ts:68) with an open interaction. Every card test replaces `sessions.answer` with a `vi.fn` (ToolApprovalCard.test.tsx:55, PermissionGrantCard.test.tsx:48, McpFormCard.test.tsx:77) or mocks the hooks module (QuestionCard.test.tsx:16). `ChatPane.test.tsx:10` also mocks the dock.
- Mutations that stay green: `chatView` drops `expiresAt` or `timedOut` (sessions.ts:1397-1404); `useChat` returns loading too long; `key={interactionId}` removed. The last one means a second approval inherits the first card's "Allowed" state and ignores Enter (ToolApprovalCard.tsx:125 checks `chosen !== null`).
- Fix: one dock test over `createTestContainer` (real SessionsService, the memory platform's sidecar or a fake sidecar client). Cases: `requestInteraction(question)` shows the card; Enter sends `answerInteraction` with that interaction id and the exact answer; accepted removes the card; refused keeps it and shows the retry line; a second `requestInteraction` replaces an answered approval card with a fresh one; `interactionClosed(timed_out)` shows the timed-out text on the permission and MCP cards (this is the real path for the `timedOut` prop).
- Features: CHAT-10, CHAT-11.

**M2. Enter on a focused approval button can send the wrong decision, untested.**

- Where: ToolApprovalCard.tsx:150 and :158 (`onButton` guard). Same shape in QuestionCard.tsx:136-137. No test fires a key on a button (ToolApprovalCard.test.tsx keys all target the fieldset or the message input).
- Mutation: delete `if (onButton) return;`. Tabbing to "No" and pressing Enter then preventDefaults the click and sends `allow`. This is an inverted answer to a permission prompt.
- Fix: focus "No", fire Enter on that button, assert `answer` was not called with `allow` (and with user-event, that exactly one `deny` goes out). Same for QuestionCard's "Cancel agent": Enter must not submit.
- Features: CHAT-11, CHAT-10.

**M3. IME composition: the WebKit-only branch and two cards have no test.**

- Where: ComposerEditor.tsx:101 checks `isComposing || keyCode === 229`. composer-editor.test.tsx:81 sets both flags together, so removing `|| native.keyCode === 229` stays green. QuestionCard.tsx:135 and ToolApprovalCard.tsx:147 check only `isComposing` and have no IME test at all. Known WebKit behaviour (not verified in this app): the Enter that confirms a composition arrives with `isComposing: false` and `keyCode: 229`. The earlier audit left this as unverified (step-3-s1-ui, LATER).
- Fix: composer-editor test with `{ key: "Enter", isComposing: false, keyCode: 229 }` expecting no submit. Add the same test for Question and Approval cards. Move the composition check into one shared helper so the three places cannot differ.
- Features: COMP-01, CHAT-10, CHAT-11.

**M4. Composer shell: the success path of a send is untested, and the Cmd+Enter setting is never selected.**

- Where: composer-shell.test.tsx:212 only asserts that `send` was called. Nothing asserts the editor is empty, the draft is cleared, attachments reset or focus returns after success (Composer.tsx:168-173; header promises "focus returns to the editor after sending"). `sendKey` exists in the harness (composer-shell.test.tsx:72, :108) and no test passes it, so `sendKey === "cmd-enter" ? "mod_enter" : "enter"` (Composer.tsx:107) is never exercised. Attachments are never non-empty in a send (`[]` at :218, :330, :360, :386).
- Mutations that stay green: delete `setContent("")`, `setAttachments([])`, `focus()`; change `"cmd-enter"` to `false`; pass `[]` instead of `attachments` at Composer.tsx:161.
- Also: no test for a second send while the first is in flight (Composer.tsx:154 has no busy guard of its own; it relies on `disabled`).
- Fix: after a successful Enter-send, wait on `editor().textContent === ""`, `files` has no draft, `document.activeElement` is the editor. Add a case with `sendKey: "cmd-enter"`: Enter inserts a line and does not send; Cmd+Enter calls `send(..., "auto")`. Add a draft with an attachment and assert it is passed. Hold `send` open and press Enter twice; expect one call.
- Features: COMP-01.

**M5. Model picker: three checklist items have no test, and the fixture hides them.**

- Where: ModelPicker.test.tsx:89 and :310 set `lastUserMessageAt: null` for every session, so the started-chat branch (ModelPicker.tsx:134-153: `actions.sessions.create`, the "Opens in new chat" toast, the "next reply may be slower" toast) never runs. `create` is built at :169 and never asserted. The installs fixture marks every agent installed (:117-137), so `disabled={!available}` (ModelPicker.tsx:351) is never false-to-true. The fixture has no ACP rows, so OpenCode and Pi are disabled in the "lists the ACP agents" test (:404) and the test still passes.
- Not tested either: `visible_provider_models` (the setting is always `""`, :162; `modelsForPicker` ModelPicker.tsx:81-94 is exported and has no direct test), loading and error rows (:373-378), choosing an ACP agent (`acpAgent` assignment at :130), loadouts 3 to 5, clicking an effort level, "Not supported" row for a model that lacks the current effort (:410-412).
- Fix: add a started session case (`lastUserMessageAt: 1`) asserting `create` was called with the new agent and the "Opens in new chat" text; a case with Codex not installed asserting its button is disabled; table tests for `modelsForPicker` and `effortForModel`; one test that picks OpenCode and checks `acpAgent: "opencode"`.
- Features: COMP-02.

**M6. Hand-built `Container` casts where `createTestContainer` works, with a false reason in the comments.**

- Where: chat-08-cards.test.tsx:42-47, send-button.test.tsx:13-31, FavoriteModels.test.tsx:77-102, ModelPicker.test.tsx:77-200, composer-shell.test.tsx:79-159, use-draft-sync.test.tsx:108-139. The comments in the first two say `createTestContainer` "needs a node environment". It does not: `test/container.jsdom.test.tsx` proves it under jsdom, and ToolApprovalCard, PermissionGrantCard, McpFormCard and ModeChips tests in this scope use it. Rule: docs/engineering.md "Screens are tested over the real container".
- Drift found:
  - FavoriteModels.test.tsx:52 hands out `fav-${length + 1}`, so an id repeats after a delete then an add. The engineering rule names this exact fake.
  - ModelPicker's `agentCatalog`, `favoriteModels` and `commands` are partial objects behind `as unknown as Container` (:193). Renaming a service method the component calls leaves the tests green.
  - `fakeFs` is written twice (composer-shell.test.tsx:27-69, use-draft-sync.test.tsx:17-56) and checked against neither the memory platform's file system nor `platform/contract.ts`.
- Fix: use `createTestContainer` and `seedWorkspace`; use `container.services.favoriteModels` over the real repository; use the memory platform's fs; spy on the single service method that crosses a process boundary, not whole services.
- Features: CHAT-08, COMP-01, COMP-02.

**M7. FavoriteModels: picking a favourite is not tested.**

- Where: FavoriteModels.test.tsx has four tests (sixth refused, unavailable muted, reorder, remove last). `onPick` is only asserted `not.toHaveBeenCalled` (:142). Success of "Add models" (the "Favourite saved" toast, FavoriteModels.tsx:59-61), the move-down control, and the Edit button hiding at zero are also unasserted.
- Mutation: delete `onPick(favorite.config)` (FavoriteModels.tsx:130) or pass `{}`. Green.
- Also: the availability check and message exist twice, in FavoriteModels.tsx:123-129 and ModelPicker.tsx:261-272 (`pickFavorite`). The picker passes its own `applyConfig` as `onPick` (:339), so the loadout keys and the list clicks use different code.
- Fix: click an available favourite, expect `onPick` with its config. Add a ModelPicker-level test that a list click and Cmd+Ctrl+N end in the same `updateConfig` call.
- Features: COMP-02.

**M8. Answer text is a contract kept in two copies.**

- Where: sidecar `packages/sidecar/src/tools/format.ts:17-35` writes `The user answered:\n1. <q>\n   <a>`; the desktop parser `AskUserQuestionCard.tsx:35-55` reads it. Each side tests its own literal (`packages/sidecar/src/tools/format.test.ts:9-21`, AskUserQuestionCard.test.tsx:45). The strings match today (I compared them).
- Mutation: change the indent or the `(Skipped)` word on one side. The other side's tests stay green and the history card shows every answer as skipped.
- Fix: one shared fixture of (questions, answers, text) triples in `packages/protocol`, used by both tests.
- Features: CHAT-10.

**M9. Secret-answer path is only reachable from hand-made input on the Claude route.**

- Where: AskUserQuestionCard.tsx:66 reads `secret` from the tool call input. The sidecar's Claude tool (`packages/sidecar/src/tools/ask-user-question.ts:29-41` schema, `:59-64` mapping) has no `secret` field. Codex sets it in the interaction (`runners/codex/approvals.ts:169, :182`); the only place I found `ask_user_question` mapped to a history tool call is `runners/claude/tool-names.ts:37`. So QuestionCard's secret box can appear for Codex, but I found no real producer for the history card's mask. Tests feed `secret: true` by hand (AskUserQuestionCard.test.tsx:69, QuestionCard.test.tsx:166).
- Why MUST: checklist item "Question secret input (masked answer)" passes on invented input; the answer text is also stored unmasked in the result (the mask is display only).
- Fix: decide the route. Add a test that takes a Codex secret question from the runner, through the interaction, to the card and the history item, and fails if no history item carries the flag.
- Features: CHAT-10.

**M10. Orphan component with two test files; an APP-04 checklist item is tested on dead code.**

- Where: `ArchivedComposerBar` has no importer (only app-04.test.tsx, composer.test.tsx, and a comment at Composer.tsx:19). The screen a user sees for an archived workspace is `features/workspace/WorkspaceGate.tsx` and `ArchivedNotice.tsx`, tested in `WorkspaceGate.nav-10.test.tsx`. composer.test.tsx:8-14 duplicates app-04.test.tsx:8-14.
- Mutation: delete the bar or change its text. The app does not change; only these two files react.
- Fix: delete the bar and both tests, and point the APP-04 item at the NAV-10 gate; or mount the bar and test the mount. Merge the duplicate either way.
- Features: APP-04, COMP-01 (checklist rule "The bar has no importer ..." is still open).

**M11. ToolCard and registry tests cannot see a wrong setting key or a swapped card.**

- Where: ToolCard.test.tsx:13-15 mocks `useSetting` with a function that ignores its argument. registry.test.tsx:12-23 cannot fail on a wrong mapping.
- Mutations that stay green: `useSetting("expand_tool_calls")` becomes another key (Garry mode then never works); `TOOL_CARDS.read` and `TOOL_CARDS.write` swapped. Every card is tested by direct import (chat-08-cards.test.tsx), never through the registry, except `bash` and `unknown`.
- Fix: render `ToolCard` once per implemented tool kind (20 of 34 have real cards) and assert that card's title. For Garry mode, use a real settings service set to `expand_tool_calls: true` and assert collapsed when false.
- Features: CHAT-08.

**M12. Draft sync: stale load is untested, and the stand-in editor hides TipTap behaviour.**

- Where: use-draft-sync.ts:103-108 (`cancelled`), no test lets chat A's load resolve after the switch to chat B. Test 3 (use-draft-sync.test.tsx:199) gates only the second chat's load. The engineering rule says to test latest-wins with answers in the wrong order.
- Also: the editor is a hand-made object (use-draft-sync.test.tsx:58-106). Its `setContent` ignores the `{ emitUpdate: false }` option the hook depends on (use-draft-sync.ts:117), and `contentToText` (:68-80) is a hand-written inverse of `draftToContent`. Real TipTap is used in composer-shell.test.tsx:308, but that test would not notice an `emitUpdate: true` mistake because it saves the same text.
- Mutations that stay green: delete `if (cancelled) return;`; change `emitUpdate: false` to true; delete the cleanup save (use-draft-sync.ts:95-98; test 1 already saved through the update event at :168-171).
- Fix: gate chat A's `loadDraft`, switch to B, release A, assert B's text and B's file. Run the hook against a real `Editor` (as composer-editor.test.tsx does) and assert no `update` event fires on restore. Make the cleanup save testable by changing text without an update event (programmatic `setContent` with `emitUpdate: false`, then unmount).
- Features: COMP-01.

**M13. InteractionHost test mocks a built card and hides an unbuilt one.**

- Where: InteractionHost.test.tsx:13-18, comment at :3-5 says the approval card is "still a placeholder". ToolApprovalCard.tsx is built and tested. PlanReviewBar.tsx:29-31 throws `notImplemented("CHAT-12")`, so a real `plan_approval` renders "Agent request: Not built yet: CHAT-12" in ChatPane and the agent waits for an answer nobody can give.
- Mutation: swap the `permission_grant` and `mcp_form` cases, or drop `expiresAt`/`timedOut` (InteractionHost.tsx:60-77). Green.
- Fix: remove the approval-card mock; add one test per kind with the real cards; keep the plan sentinel only until CHAT-12 lands and add a test that fails when it does.
- Features: CHAT-10, CHAT-11, CHAT-12.

#### LATER

- **L1. QuestionCard gaps** (QuestionCard.test.tsx): trim of Other and secret (QuestionCard.tsx:92, :96); single-select clears Other and the reverse (:76, :83); key `1-9` out of range and while typing (:142, :159); page clamp and the "n of m" label (:58, :189); header and option descriptions (:180-186, :248); focus and hover preview (:228-229); double Enter while pending (:102). Features: CHAT-10.
- **L2. ToolApprovalCard gaps**: message sent only with `deny` (:133); trimmed message; "Denied" and other outcome lines (only "Allowed" is asserted, :200); Cmd+Enter while typing; busy guard on the key path (:125); absence of the suggested-rules button and Subagent badge. Features: CHAT-11.
- **L3. McpFormCard gaps**: choose an enum value (the Select is only found, McpFormCard.test.tsx:109); required enum and boolean; `timedOut` prop. PermissionGrantCard: `timedOut` prop and the future-expiry timer (PermissionGrantCard.tsx:58-67); both cards read `Date.now()` directly (:60, McpFormCard.tsx:152), which breaks "time is an input". Features: CHAT-11.
- **L4. send-key matrix**: Alt+Enter in Enter mode, Cmd+Shift+Enter, Ctrl+Enter in Cmd+Enter mode, Alt+Shift (send-key.ts:31-39 all return null). Make it table-driven. Add a parity test with the dispatcher's `composerOwnsKey` (command-dispatcher.ts:253). The `"cmd-enter"` to `"mod_enter"` mapping exists twice (Composer.tsx:107, command-dispatcher.ts:561); the open COMP-01 item `sendWithFromSetting` covers it. Features: COMP-01.
- **L5. composer-editor**: assert Enter does not add a line break when it submits (ComposerEditor.tsx:106-107; the test at :46 checks only `onSubmit`); `disabled` stops submit (:92); placeholder disappears after typing (:113); changing `sessionId` rebuilds the editor. Features: COMP-01.
- **L6. ModeChips**: show the chip state after a real `updateConfig` (the spy hides the store round trip); Shift+Tab on a Codex chat returns false (ModeChips.tsx:55); tooltip text "Exit plan mode". The checklist asks for a UI-to-sidecar end-to-end test of the auto-accept chip; none exists. Features: COMP-03.
- **L7. chat-08-cards**: empty states ("No matches", "No files found", "Empty folder", "No results", "No new output"); caps (50 list entries, MAX_PATHS, 8 search results, 20 excerpt lines, Write MAX_LINES) and real size (a 5,000-match Grep, a 1 MB Bash output, a 10,000-path Glob); MultiEdit content order; Read excerpt text; Edit "Edit" link; WebFetch body; Bash background and truncated notes and ANSI stripping; Mcp Raw toggle. Features: CHAT-08.
- **L8. ModelPicker test hygiene**: `setTimeout(0)` as the wait at ModelPicker.test.tsx:399; the `toBeDefined` on the test's own store at :401 (delete it); "lists the ACP agents" should assert they are enabled.
- **L9. Fixed timers**: `settle()` is `setTimeout(0)` and is used at composer-shell.test.tsx:312, :342, :361, :374 and use-draft-sync.test.tsx:150, :175, :191, :205, :244, :287. They are microtask yields, low flake risk, but the rule says wait for the event: wait for the file to appear in `files`.
- **L10. Shared mutable table**: tests assign into the exported `TOOL_CARDS` (ToolCard.test.tsx:81, :91; chat-08-cards.test.tsx:183-186). They restore it, but a crash between assign and restore leaks. Prefer passing the card table to `ToolCard` as a prop, or a test-only `withCards()` helper.
- **L11. Copy mismatch**: the approval, permission and MCP cards say "Could not send the answer. Try again." The service error and the CHAT-10 checklist say "Could not send answers. Try again." (sessions.ts:914). COMP-01 item says "Couldn't send message"; Composer.tsx:165 says "Couldn't send the message" and composer-shell.test.tsx:332 pins it.
- **L12. Backlog rows**: CHAT-09, CHAT-11, COMP-03 are `stub` while their code and tests exist; CHAT-12 is a placeholder with an interaction path that throws. Per D041 the rows flip before the step's CI. When they flip, the gaps in section D below must close first.

### 3.5 Sidebar

#### MUST

**C1. A workspace cannot be dragged into Pinned, and the test hides it.** Features: NAV-04.

- Source: `PinnedSection.tsx:64-69` looks the dropped id up in `workspaces`, the list of already pinned workspaces, and calls `drag.cancel()` when it is missing. A workspace from the main list is never in that list. An empty Pinned (the "Drag a workspace here" hint) can never accept a drop either.
- Test: `PinnedSection.nav-04.test.tsx:54-69` renders `workspaces={[workspace]}` and drops that same workspace. It passes while the feature is broken.
- Mutation missed: none needed, the feature is already broken and the file is green.
- Fix: render Pinned with `workspaces=[]` (and then with one other pinned workspace), drop an id that is not in the prop, and assert `setPinned(id, true)` runs. Fix the source to look the id up in all workspaces, or take a `resolve(id)` prop. Prefer the real `setPinned` over the spy, and assert `pinnedAt` on the real workspace store.

**C2. The NAV-04 UI is not mounted anywhere, so its tests prove parts, not the feature.** Features: NAV-04, NAV-03.

- `PinnedSection`, `SectionList`, `SectionDialog` and `use-workspace-drag` have no importer outside their own tests. `GroupedWorkspaces.tsx:174-178` passes `sections: []` and `manualOrder: new Map()`; `readView` hard-codes `manualOrder: false` (:61). `GroupedWorkspaces` also draws its own "Pinned" group (region name "Pinned", `sidebar-view.ts:170-178`), a second implementation next to `PinnedSection` ("Pinned workspaces").
- The backlog row NAV-04 is `stub`, yet the placeholders are gone. `pnpm stubs` will fail ("stub row has none"). CI has not run on this step.
- Missing test: render the sidebar over `createTestContainer` with a pinned workspace and a section, check both appear, drag a row from the main list into the section and into Pinned with real events, and check the real stores change.
- Fix: wire the components into `GroupedWorkspaces`, then delete the duplicate Pinned group, or mark the work not done.

**C3. No test renders the sidebar list over the real container.** Features: NAV-03, APP-04, PRJ-01, NAV-11.

- Six files mock `core/hooks.ts` whole: AddProjectButton.test, Sidebar.nav-03, sidebar.test, SidebarNav.nav-03, GroupedWorkspaces.nav-03, WorkspaceRow.nav-03. Two of them also mock `core/context.tsx` (Sidebar.nav-03, sidebar.test). The hand-written `useSetting` returns the same value for every key (SidebarNav :10, Sidebar.nav-03 :15, GroupedWorkspaces :25-29).
- `GroupedWorkspaces` is tested with `WorkspaceRow` and `ViewOptionsMenu` mocked (:34-62). The props that cross those seams (`repo`, `selected`, `view`, `repos`) are not asserted. The app-level `AppShell.test.tsx` renders only the empty state.
- Mutation missed: pass `view={undefined-like}` to the menu, or `repo` of the wrong project to the row: nothing fails.
- Fix: one integration test per sidebar state over `createTestContainer`: seed repos and workspaces with `seedRepo`/`seedWorkspace`, mount `Sidebar` in the real router, then check rows, the `href` of a row, the selected row (`aria-current`), pick "Status" in the real menu and see regrouping and the saved setting.

**C4. 300 workspaces are never rendered.** Features: NAV-03.

- engineering.md names "a sidebar with 300 workspaces". The only 300 case is `sidebar-view.nav-03.test.ts:174-184`: the pure function, one repo, one status, distinct timestamps, no pinned, no filter. No component renders 300 rows, with each row calling `useWorkspaceStatus`, `useSessions` and `useLiveShortcut`.
- Fix: seed 300 workspaces across 8 repos, 5 statuses, 20 pinned, 30 with unread chats; assert group sizes, that all 300 rows (or the virtualised window) render, that Cmd+1..9 numbers only visible rows, and a render-time budget with a generous bound.

**C5. The hover key R is tested the way a keyboard cannot deliver it.** Features: NAV-11, NAV-03.

- Source: `WorkspaceRow.tsx:111-116` listens for `keydown` on the link. Key events go to the focused element, so pressing R over a hovered but unfocused row does nothing. It only works on a row the user just clicked.
- Test: `WorkspaceRow.nav-11.test.tsx:84-85` fires `mouseEnter` and `keyDown` on the same link. No negative cases: R without hover, Cmd+R (reload) must not toggle (:112 guards).
- Fix: listen on the document while a row is hovered (and ignore typing targets), then test with `userEvent.hover(row)` and `userEvent.keyboard("r")` with focus on another element, plus the two negative cases.

**C6. NAV-03 is `done` but several checklist items have no code and no test, and one test pins a Conductor mismatch.** Features: NAV-03, NAV-04, D020.

- Items with no code and no test: right-click on a row opens the actions menu; Draft badge and Archive workspace badge (WorkspaceRow.tsx header says left out; `ui.tsv:116` still says "covered"); line counts; status matrix animation. They are moved to GIT-04, WS-09 and NAV-03 in `system.tsv:2864-2867,2878`, but the NAV-03 issue #111 still lists them as its own items.
- "Sort by hidden when manual order is on" (`ui-map.md` 4, issue #111): `ViewOptionsMenu.nav-03.test.tsx:46-57` asserts the opposite (Sort stays visible). The header calls it a temporary design choice until NAV-04. NAV-04 has landed and the menu was not changed. D020 says visible differences are listed in a decision; none is.
- Fix: flip the test to the Conductor behaviour when NAV-04 is wired; correct `ui.tsv` for the badges.

**C7. `sidebar-view.ts` branches with no test.** Features: NAV-03, NAV-04.

- The sections block (`sidebar-view.ts:180-193`) is unreachable from the tests because the helper types `sections` as `never[]` (`sidebar-view.nav-03.test.ts:70`). "Each workspace once" (pinned and in a section), "sections in saved order", the id tie-break (:123), the dedupe of repeated ids in manual order (:143-147), "canceled" and "in review" groups, and the `archiving`/`archivedAt` rule from `canOpenWorkspace` (workspace-open.ts) are untested.
- Fix: widen the helper type, add a section test with a pinned workspace also listed in a section, equal timestamps, a manual order that repeats an id and names a gone id, and all five statuses in order.

**C8. `GroupedWorkspaces` behaviour with no failing test.** Features: NAV-03.

- Selected row: `GroupedWorkspaces.tsx:135` (no route with a workspace id is ever rendered in the test).
- Previous/next relative to the open workspace and wrapping at the ends (:234-244): every test runs with `selectedId === null`, so only "none open" is checked (test :286-318).
- Sort setting `created` (:60), project filter write (:266-268), sort write (:263-265), the "Couldn't save the sidebar view" toast (:271), "Clear filter" (:297-300), a filter naming a removed repo (:165).
- Fix: add these with the real `ViewOptionsMenu` and a real settings service (see C3).

**C9. `SectionList` tests assert unchanged state that could not change, and two behaviours are broken in source.** Features: NAV-04.

- `SectionList.nav-04.test.tsx:118` and `:255`: the action is mocked to fail, then the test checks the store did not change. It could not have changed. The header promise "a failed call restores the previous order" is not tested.
- `SectionList.tsx:273`: a section header drop always uses `after = true`, so a section can never be moved to the first place.
- `SectionList.tsx:347-353` with `use-workspace-drag.ts:136-140`: dropping a workspace from another list onto a row inside a section does nothing (the row stops propagation, and a `row:` target needs manual order and a row of the same list). Only the header and empty space accept it.
- `SectionList.tsx:222,374`: each section mounts a second `SectionDialog` driven by `renaming`, which is never set to true.
- Untested: saving the collapsed state (:233-238), emoji, the count when collapsed, `New section...` (button :154-162 and the menu item), the Cancel path of the delete dialog.
- Fix: use the real `sections` service (no spy on `place`), force the service to fail and assert the rendered order; add the four behaviours above.

**C10. `AddProjectButton`: weak double-click test, footer mount untested, a checklist item pinned absent.** Features: PRJ-01.

- Test :89-101 would pass without the single-flight guard (see B). Use a menu click twice (`onSelect` path, :77), where the button is not disabled, to prove the guard.
- No test that `Sidebar` mounts the button in the footer (Sidebar.tsx:50-52). PRJ-01 item: "Sidebar footer 'Add project...' button and menu".
- Test :115-121 asserts there is no "Recents" group. The PRJ-01 checklist (#93) lists "'Recents' group ... (scaffold: missing)" (`ui.tsv:711`). Either the item is dropped by a decision, or the test asserts the wrong thing.
- Real-seam gap: the button is only tested against hand-made `useActions`; the real `actions.app.pickFolder` and `actions.projects.addLocal` are tested in `core/actions.test.ts` but never together with the button.

**C11. `SidebarNav` live shortcut hint is not proven.** Features: NAV-03.

- The mock returns the default shortcuts, so a hard-coded string passes (`SidebarNav.nav-03.test.tsx:9-19`, :49-54). `WorkspaceRow.nav-03` does it right (rebound "⌃2", asserts "⌘2" absent, :144-158).
- Fix: use a non-default binding and assert the default is absent; or use the real `useLiveShortcut` over a container with an override.
- Also no test for the active row (`activeProps`) or for the Create row at `/create`.

**C12. A hand-built partial container.** `use-workspaces.nav-03.test.tsx:48` casts `{ services: { workspace: { store } } } as unknown as Container`. Rule: "Screens are tested over the real container." Use `createTestContainer` and `seedWorkspace`, assert re-render when the store changes after mount, and the id tie-break. Features: NAV-03.

**C13. Next unread.** Features: NAV-11.

- `next-unread.test.ts:106-119` has the input already in time order, so removing the unread sort (next-unread.ts:101) is not caught. Add input in reverse order.
- Not tested: a waiting workspace whose chats are all closed (`waitingChat` returns null), a workspace with `archiving` state (next-unread.ts:83 checks `state === "archived"` only, while the sidebar uses `canOpenWorkspace`), dedupe of a chat that is both waiting and unread.
- No test anywhere in the repo runs the commands `chat.nextNeedingAttention` (Cmd+Alt+L) or `nav.nextUnread` (NextUnreadButton.tsx:84-85); `NextUnreadButton.nav-11.test.tsx` has three tests and none calls `runCommandHandlers`.

#### LATER

- L1. Duplicate tests: `sidebar.test.tsx:114-130` repeats `app-04.test.tsx` and `UnreadDot.nav-11.test.tsx`; `sidebar.test.tsx:96-104` overlaps `app-04.test.tsx:20-25`. Delete the copies, keep the named-feature files.
- L2. `sidebar.test.tsx` has no `@feature` header and builds data with `as unknown as Repo/Workspace` (:40-41); `next-unread.test.ts:12-30` and `WorkspaceRow.nav-03.test.tsx:120` use partial casts. Use the typed `repo()`/`workspace()` builders other files define (they are copied into 5 files; move to `test/`).
- L3. `WorkspaceList.tsx:56-71`: the workspaces-side loading, error and retry (`workspace.start`) have no test. Swapping `workspace.start` and `repo.start` at :61 passes.
- L4. `relativeTime` months and years untested (WorkspaceRow.tsx:60-62); boundary seconds 59/60 untested.
- L5. `use-workspace-drag`: add a drop on the dragged row (hook :139), thrown errors through `fireAndForget` (:87-91), the CSS text and `data-workspace-drag` attribute (:175-177), cleanup on unmount.
- L6. `PinnedSection.nav-04.test.tsx:118` and `use-workspace-drag.nav-04.test.ts:112` use `await Promise.resolve()` before a negative assertion. Prefer a deterministic signal.
- L7. `SectionDialog`: Enter on an empty name (`submit` line 52 is the only guard on that path), a name with spaces only, Escape, a second submit while busy.
- L8. `PinnedSection` hides when empty and nothing is dragged (test :71-79). `ui-map.md` 7.2 lists "Pinned: Drag a workspace here" as an empty state, which suggests Conductor shows an empty Pinned. Verify against the research before keeping the test.
- L9. Cmd+1..9 and Cmd+Alt+Arrow are tested through `runCommandHandlers` (GroupedWorkspaces test :248,:280,:298,:314), not through a key press and the dispatcher. `command-dispatcher.*.test` do not mention `workspace.switch`. Add one test that presses the key in the mounted shell.
- L10. `use-now`: a changed `read` source restarts the timer (header "Must handle"); no test.
- L11. `Sidebar.nav-03.test.tsx` renders `NotBuiltYet` footers whose children are stubs (`UpdateNotice`, `ResourceUsageTable`); the footer checks only pass because errors are swallowed by the boundary. Fine today, a risk when APP-06/APP-07 land.
- L12. The `/create?repo=` and `/create?section=` links are asserted by `href` only (GroupedWorkspaces test :195, SectionList test :188). The create page ignores them (G).

### 3.6 Workspace and tab strip

#### MUST

**M1. Previous/next tab shortcut: direction can flip unseen.**

- TabStrip.nav-10.test.tsx:307-323. Two tabs, so a wrap in either direction lands on the same tab. The `search` prop never changes between the two calls.
- Mutation missed: `useCommandHandler("tab.previous", ... go(-1))` changed to `go(1)` (TabStrip.tsx:303). Both assertions expect "two" and stay green.
- Fix: three tabs, active in the middle. Assert previous gives the left tab and next the right tab, then wrap at both ends (re-render with the new `search` between steps).
- Features checked: NAV-10 "Previous and next tab (Ctrl+Shift+Tab, Cmd+Shift+[, Cmd+Alt+ArrowLeft and mirrors)".

**M2. Closing the last tab never asserts the outcome.**

- TabStrip.nav-10.test.tsx:334-346 closes the only tab, then waits only until `onSearchChange` was called (:343). Production sends the "nothing open" patch (TabStrip.tsx:226, 179-186). tab-layout.nav-10.test.ts never closes the sole tab of the main group either (group-main must stay with `activeRef` null).
- Mutation missed: `showNeighbour` calling `select(tabs[0])`, or sending `{}`, for the last tab.
- Fix: assert the exact patch (`tab`, `sessionId`, `terminalId`, `path`, `commentId`, `browserUrl` all undefined). Better, mount strip and TabContent together over the real search state and assert "No tab is open" appears. Add a tab-layout case: close the only tab, expect `tabs: []` and `activeRef: null`.
- Features checked: NAV-10 "Cmd+W close tab", "Empty tab group with 'New chat', 'Browser', 'Local terminal'", "Closing the active middle tab selects the tab to its right".

**M3. Shortcuts are called through the registry, never through a key press.**

- TabStrip.nav-10.test.tsx:303, :318, :321, :329, :344 and SplitPanes.nav-10.test.tsx:258, :268 call `registry.run(id)`. The binding table (core/registries/commands.ts:391-431 and :841) is never joined to the mounted handlers. The slice-1 bug "the command dispatcher was never mounted" is exactly this seam.
- Also missing: Cmd+T refused at the tab limit (TabStrip.tsx:298), Cmd+W with no tab open returns false (:311), Cmd+D with the setting off (SplitPanes.tsx:183), and "Cmd+Shift+T selects the reopened tab" (TabStrip.tsx:288; the test at :344 only checks `sessions.reopen` was called).
- Mutations missed: delete `if (atTabLimit) return false`; delete `select(tab)` in `reopen`; delete `!splitEnabled ||`.
- Fix: one integration test that mounts the real dispatcher (`useCommandDispatcher`, as app/command-dispatcher.hooks.test.tsx does with `KeyboardEvent`) with TabStrip and SplitPanes, then fires the default key events for each of the 8 bindings above and asserts the URL patch, the `close` call, and so on.
- Features checked: NAV-10 (four shortcut items), CHAT-01 "Cmd+T new chat tab".

**M4. SplitPanes: URL move, strip exclusion and drag hand-off are unverified.**

- SplitPanes.nav-10.test.tsx:109 creates `onSearchChange: vi.fn()` inside `renderPanes` and never exposes it. SplitPanes.tsx:149-155 (`moveAwayFromActive`) is therefore untested, though the header promises "Splitting the active tab moves the URL to its neighbour".
- TabStrip is mocked as `<p>strip</p>` (:65-68), so `excludeRefs={hiddenRefs}` (SplitPanes.tsx:217) is unchecked. The test at :228 is titled "closes the split pane without closing its tab" but only checks the pane vanishes.
- The drag type string `"application/x-conducted-tab"` exists in three places: TabStrip.tsx:373, SplitPanes.tsx:53-55 and the test (:131). No test drags from a real TabItem and drops on the real SplitPanes. Changing the string in TabStrip stays green everywhere.
- TabItem is mocked (:85-87), so the split pane's own `dragStart` (SplitPanes.tsx:203-209) and its drag image are never fired.
- Mutations missed: delete `moveAwayFromActive(tab.ref)`; drop `excludeRefs`; rename the MIME in TabStrip only.
- Fix: unmock TabStrip and TabItem (they are cheap). Fire `dragStart` on the real tab, reuse the captured `dataTransfer` in the drop, assert the main strip no longer lists the tab, the pane shows it, and `onSearchChange` got the neighbour. Export the MIME constant once.
- Features checked: NAV-10 "Drag tabs between groups or to an edge, with a drag ghost", "Cmd+D splits the tab", "Split panes with the 'Split tabs' setting".

**M5. TabContent test passes on the placeholder's label.**

- TabContent.nav-10.test.tsx:41-46 expects text "Pull request". `PrTab` is `notImplemented("PR-07")` (features/pr/PrTab.tsx) and `NotBuiltYet` prints the `area` prop it was given (ui/not-built-yet.tsx:62-73). The text comes from TabContent.tsx:106 itself. This breaks "never test a placeholder" (engineering.md, Tests).
- Mutations missed: render `BrowserTab` in the `pr` case (another placeholder, the same label stays); in `file`, pass `path={tab.url}`; in `terminal`, pass the wrong id. `TerminalView` also still lacks `onNewTerminal` (TabContent.tsx:89), which the RUN-06 audit already named.
- Fix: for each of the six kinds, mock the child (a legitimate seam, they belong to other features) with a stub that prints the props it received, and assert them. Keep the empty-group, error-card and remount tests as they are; they are real.
- Features checked: NAV-10 "File tab", "PR tab", "Browser tab", "Error card 'This chat tab failed to render'".

**M6. WorkspaceHeader asserts a button the test supplied.**

- WorkspaceHeader.nav-10.test.tsx:60-62 stubs `WorkspaceActionsMenu` as a button named "Workspace actions"; :100 asserts that button. The real child in the header (WorkspaceHeader.tsx:153-157) is never checked, and the header-to-menu seam (the menu opens from the header button) has no test.
- Mutation missed: delete the `<Button aria-label="Workspace actions">` child.
- Also unchecked: `disabled={archived}` on Rename workspace (:148), the branch Rename item being disabled for an archived or empty-branch workspace (:108, :112), the placeholder-branch muted style.
- Fix: do not stub the menu. The real one needs `useSessions`, `useLiveShortcut` and the sections store, all of which a seeded `createTestContainer` provides. Click the header button and assert the menu opens. Add an archived case: the pencil is disabled.
- Features checked: NAV-10 "'Workspace actions' menu button", "Workspace name with 'Rename workspace'".

**M7. WorkspaceLayout toggle test asserts its own state.**

- WorkspaceLayout.nav-10.test.tsx:42-50 reads `data-right-panel-open`, set from `useState` in WorkspaceLayout.tsx:46 and :55. `setup.ts` and `dom-polyfills.ts` make `ResizeObserver` a no-op, so the panel never really resizes in jsdom.
- Mutation missed: delete `panel.collapse()` and `panel.expand()` (WorkspaceLayout.tsx:51-54). The test stays green and the panel never hides.
- Also untested: the 65/35 default, the 30% minimum, the git-over-scripts vertical group sizes, the collapsed scripts size, per-workspace group ids.
- Fix: the real collapse needs layout, which jsdom lacks. Cover it with a browser-level test (see E). In jsdom, at least spy on the panel's imperative handle and assert `collapse` then `expand` were called, and drop the claim that the test proves "hides".
- Features checked: NAV-10 "Right panel (about 35 percent, collapsible)", "'Toggle right sidebar' button", "Right panel is a vertical group".

**M8. Pin/Unpin: the Unpin click is untested.**

- WorkspaceActionsMenu.nav-10.test.tsx:120-127 only checks the label "Unpin" for a pinned workspace. Only the pin click is made (:110-118).
- Mutation missed: `actions.workspaces.setPinned(workspaceId, !pinned)` changed to `true` (WorkspaceActionsMenu.tsx:111).
- Fix: click Unpin and assert `setPinned(workspaceId, false)`. Also assert the current kanban status is checked in the Set status submenu (`MenuRadioGroup value`, :120) and that "No sections yet" shows with an empty section list (:133).
- Features checked: NAV-10 "Workspace actions: Pin or Unpin", "Set status".

**M9. workspace.test.tsx supplies the text it asserts, and duplicates four files.**

- workspace.test.tsx:37-42 feeds `appError("not_found", "Workspace not found")` and asserts "Workspace not found". The component only echoes `error.message`; the real not-found card is keyed on code `workspace_unknown` (WorkspaceGate.tsx:44), which this test never uses. The test would pass if the not-found card were deleted.
- Duplicates: Gate archived/ready/unarchive (:44-57 vs WorkspaceGate.nav-10.test.tsx:31-74), Layout slots (:73-89 vs WorkspaceLayout.nav-10.test.tsx:34-40), status icon (:91-101 vs WorkspaceStatusIcon.nav-03.test.tsx:8-27). No `@feature` header and no feature id anywhere in the file.
- Fix: move the two unique tests (Gate loading :31, ArchivedNotice busy :61) into WorkspaceGate.nav-10.test.tsx and an ArchivedNotice test file with a WS-06 header; then remove the rest, since they are covered elsewhere. Nothing is dropped.
- Features checked: NAV-10 "Workspace load states", WS-06 archived notice.

**M10. WorkspaceGate not-found depends on a hand-typed error code.** (Seam is covered; only the pointer is a finding.)

- WorkspaceGate.nav-10.test.tsx:45-48 builds `appError("workspace_unknown", ...)` by hand; the hook produces it at core/hooks/workspaces.ts:104. If the hook changed its code, this test stays green.
- The real join is covered outside this folder: app/router.test.tsx:140-146 opens a missing workspace over a real container and finds "Workspace not found". Verified by reading, so no new test is needed; export the code as a constant so the compiler joins them.
- Features checked: NAV-10 "Workspace load states".

**M11. No test asserts a failure toast, except one menu.**

- `toast` is asserted only in WorkspaceActionsMenu.nav-10.test.tsx:279-312. Untested user-visible failures, with the line that raises each:
  - useNewTab.tsx:70-73 (chat), :85-88 (terminal), :94-98 (browser without port)
  - TabStrip.tsx:234-236, :241-243 (close), :278-279, :283-286 (reopen), :326-327 (retry)
  - ChatHistoryButton.tsx:62-65
  - TabContextMenu.tsx:58, :68
  - WorkspaceGate.tsx:38
  - WorkspaceHeader.tsx:56
- Mutation missed: delete any one `toastError` line, or return `true` after a failed create.
- engineering.md: "If a write the user relies on fails, the user sees it." The step-7 audit already listed "close-failure toast" as untested; it still is.
- Fix: spy `toast.error` as the ActionsMenu test does. For each failing Result assert title and description, that no tab opened (`onSearchChange` not called) and that the button is usable again (`finally` branches).
- Features checked: NAV-10 (menus, empty group, tab strip), CHAT-01 (history, tab menu).

**M12. Screen tests do not use the real container, and their fakes are partial.**

- 12 test files mock `core/hooks.ts` and 8 also mock `core/context.tsx`. No file uses `createTestContainer`, `seedWorkspace` or `ServicesProvider` (engineering.md: "Screens are tested over the real container"; D049).
- Stand-ins that can drift: stores with `subscribe: () => () => {}` (TabStrip.nav-10.test.tsx:24-29, :30-36, SplitPanes.nav-10.test.tsx:18-30, WorkspaceActionsMenu.nav-10.test.tsx:21-26), so a live-state change never re-renders; sessions cast `as Session` with `config: {}` (TabStrip :56-63); terminals as `{ id, kind, title }` through `as unknown as Loadable<unknown[]>` (:39-40); `useSetting: () => false` for string settings (useNewTab.nav-10.test.tsx:24).
- Seams only an integration test covers, none of which exists in this folder: new chat from the empty group creates a real session and the tab appears; closing a chat removes it from `useSessions`; reopen from history brings it back; a chat's status icon follows a real live-state change; terminals created in the centre show up as tabs with "Terminal N"; the tab limit counts real rows.
- The nearest real test is app/router.test.tsx:132-139 ("shows the workspace screen with its regions"): it proves the strip and PR tab render, nothing more.
- Fix: one file `WorkspaceCentre.nav-10.test.tsx` using `createTestContainer` + `seedWorkspace` + `ServicesProvider`, mounting SplitPanes (so strip and content are real). Cover the six seams above.
- Features checked: NAV-10, CHAT-01.

**M13. Checklist items marked done in backlog.md:153 (NAV-10) with no test and, in places, no code.** See D for the full list. Highest impact: "PR and git buttons move into the header when the right panel is closed" (WorkspaceHeader.tsx:177-188 has only the toggle), "Persist closed tabs and a recent-workspace list" (`lastClosed` is a `useRef`, TabStrip.tsx:201), "Composer minimises when a content tab is open", "Drag a terminal from the right panel into the centre", and "Right-click on a row opens the Workspace actions menu". Also `docs/plans/items/ui.tsv` carries `covered` for rows with no code.

**M14. TabStrip does not prove the real history button is mounted.**

- TabStrip.nav-10.test.tsx:97-99 replaces ChatHistoryButton with `<p>chat history</p>` and never asserts that text. Deleting TabStrip.tsx:409 stays green. The same goes for the real NewTabMenu (:91-95), whose stub only echoes the `atTabLimit` prop.
- Fix: the integration test in M12 should click "View chat history" and "New tab" inside the strip.
- Features checked: NAV-10 "'View chat history' button and chat tab menu mounting", "'+' new tab menu".

**M15. "Terminal N" numbering has no test; the test supplies the title.**

- TabStrip.nav-10.test.tsx:199 and :353-354 give terminals `title: "Terminal 1"`. The fallback `terminal.title || \`Terminal ${index + 1}\`` (TabStrip.tsx:148) is never taken.
- Mutation missed: `index + 1` changed to `index`; `||` changed to `&&`.
- Fix: terminals with an empty `title`; assert "Terminal 1" and "Terminal 2" and "Close Terminal 2".
- Features checked: NAV-10 "Terminal tabs 'Terminal N' with 'Close terminal N'".

**M16. PR and browser tab titles have no test.**

- `specialTab` builds "PR #N" and the host label (TabStrip.tsx:100-107, :56-62). The only special tabs rendered in tests are `file` (:357) and `comment` (:278). The router test finds a tab named "PR" without a number (app/router.test.tsx:139).
- Mutation missed: `PR #${prNumber}` changed to `PR`; `hostOf` returning the full URL.
- Fix: unit-test `specialTab` (it is exported): PR with number and null, browser URL with host and with a bad URL, comment by user/github/agent author and a missing comment.
- Features checked: NAV-10 "PR tab 'PR #N'", "Browser tab labelled with the URL host", "Comment tab 'Comment by <author>'".

#### LATER

- **L1. Text parity with Conductor (D020).** ArchivedNotice says "This workspace is archived / Unarchive it to view files, terminals and browser previews." (ArchivedNotice.tsx:21-22; asserted at WorkspaceGate.nav-10.test.tsx:34). Conductor's verified text is "Workspace archived. Unarchive this workspace to view files, terminals, and browser previews." (ui-map.md 3.2). The issue's own "Test first" uses the shorter text, so the test and the spec agree with each other but not with the research. Decide and record in decisions.md. Same question for the ellipsis character in status-text.ts (words print "Working…" where research has "Working..."); the choice lives only in a file header, and D020 requires visible differences to be listed. The tests pin the deviation (status-text.test.ts:8-17, WorkspaceStatusIcon.nav-03.test.tsx:10).
- **L2. "Try again" on the workspace load error.** Conductor shows "Error loading workspace" with "Try again" (ui-map.md 7.4). WorkspaceGate passes no `onRetry` (WorkspaceGate.tsx:55-59) and no test asks for it.
- **L3. Test pins a placeholder state.** TabContextMenu.test.tsx:81-91 asserts the transcript items are disabled "until CHAT-17 builds them". CHAT-17 (#140) lists those items as its own work, so that builder must edit or delete this test. Replace it with a note in the CHAT-17 checklist, not a test.
- **L4. Try/catch around Result actions is pinned.** WorkspaceActionsMenu.nav-10.test.tsx:298-312 tests that a thrown error becomes a toast. engineering.md says failure lives in the return type. The audit already called the catch a LATER cast. Remove the catch once NAV-11 builds mark read/unread; delete that test with it.
- **L5. Blanket `console.error` silencer.** TabStrip.nav-10.test.tsx:154 replaces `console.error` with a no-op for every test in the file, to check one React key warning. It also hides act warnings and real render errors. Check the one warning directly instead.
- **L6. Leaking inline resets.** TabContent.nav-10.test.tsx:68 and :77 set and reset `state.throwChat` inside the test body. If the assertion at :76 fails, the next test mounts a throwing pane. Reset in `afterEach`.
- **L7. Late reopen answer.** ChatHistoryButton.tsx:56-67 awaits `sessions.reopen` and then `show`. Two quick picks can resolve out of order and the older pick wins the URL. No latest-wins test. Same for double close: `close(tab)` (TabStrip.tsx:249-253) has no guard, so a double middle-click calls `sessions.close` twice.
- **L8. Real-size history list.** ChatHistoryButton header says a very long list scrolls and can be searched; the tests use at most two chats. Add 500 closed chats: search narrows the list and rendering stays within a bound.
- **L9. Sort order.** `newestFirst` in ChatHistoryButton.tsx:33-37 (uses `lastUserMessageAt ?? createdAt`) is untested.
- **L10. active-tab.test.ts:81-92 title "round-trips a tab into the search that opens it"** only shows that `searchPatchFor` drops scope, mode and line (see G1). Rename it, or fix the source and assert the round trip.
- **L11. active-tab coverage.** No test for `resolveActiveTab` with session, comment, browser (with and without URL); for line ignored on non-file tabs (header "Must handle"); for `activeTabFromDescriptor` on session without id, comment, browser, pr.
- **L12. workspace-search.** Add parsing of `fileMode`, `fileView`, `commentId`, `browserUrl`, numeric `sessionId` and `terminalId`. The file has no `@feature` header and no feature id (NAV-02).
- **L13. WorkspaceStatusIcon.** Assert the `data-kind` for `setting_up` ("setting-up"), `working` ("typing"), `waiting` ("waiting"), `cancelling` ("working"), and the success dot. Replace `.bg-accent` (class name pin) with a role or `data-` hook.
- **L14. status-text.test.ts:32-41** repeat two rows of the table. Delete the two extra tests; the table covers them.
- **L15. Redundant import.** 16 test files import `../../test/dom-polyfills.ts` by hand, but `test/setup.ts` already loads it (engineering.md: "Do not stub them per test").
- **L16. Tab-limit constant.** The limit of 5 is marked INFERRED in ui-map.md (line 916). TabStrip.nav-10.test.tsx:213-240 pins 5 and 10. Fine until verified; record it as an assumption in the test header.
- **L17. Duplicate-looking tests.** ChatHistoryButton.test.tsx:131 and :145 differ only by one closed chat. Merge into `it.each`.
- **L18. tab-layout gaps.** Nested split insertion for same and for crossing direction; `sizes` after a split or group removal; `neighbourAfterClose` with an unknown ref (tab-layout.ts:95); move to an index past the end (clamp, :204); the "moves a tab into another group" test (:108-121) checks only "one holder", not which group, index or active tab.
- **L19. Test titles promise more than the body.** SplitPanes.nav-10.test.tsx:228 ("without closing its tab"); TabStrip.nav-10.test.tsx:348 ("renders ... together" counts four tabs but checks no titles).

### 3.7 Scripts panel, settings, terminal, diff

#### MUST

**C1. Switching terminal tabs recreates xterm and loses the screen (source bug, no test).**
Files: TerminalTabBody.tsx:61 passes `focusOnMount={visible}`. TerminalSurface.tsx:287 lists `focusOnMount` in the effect dependencies, and the cleanup calls `terminal.dispose()` (283). So every tab switch disposes the hidden and the shown terminal and builds new ones. The new xterm replays `connection.history`, and that is always an empty array: core/services/terminals.ts:399 creates it and line 411 hands it on, and nothing ever writes to it. The scrollback is gone after a switch (read, not run).
Test gap: every Surface test passes `focusOnMount={false}` (TerminalSurface.test.tsx:131, 159, 185, 196, 221, 251, 282, 315, 349), and TerminalTabBody.test.tsx:39-53 replaces TerminalView. Nothing toggles the prop.
Mutation it misses: none needed, the bug is live.
Fix: Surface test that renders with `focusOnMount` false, rerenders true, and expects `open` once and `dispose` zero times. A ScriptsPanel test over the real container that writes output, switches to another terminal tab and back, and finds the output still in the buffer. Features: RUN-06, RUN-01.

**C2. The xterm stand-in is a hand-written fake with no contract check, and its timing differs from the real library.**
File: TerminalSurface.test.tsx:14-66. The names match xterm's typings (input, attachCustomKeyEventHandler, registerLinkProvider, select, scrollToLine, write, disableStdin all exist in `@xterm/xterm/typings/xterm.d.ts`). The behaviour does not: `write` runs its callback at once (line 25) while the real one calls back after parsing; `options` is a plain object; every `new Terminal` returns the same shared instance (56-60); `history` is always empty (71), so history before live output (TerminalSurface.tsx:189-201, "no duplicated lines") is untested. `onExit` exists on the fake only. Nothing else in the repo uses the real xterm.
Mutation it misses: delete `pending.push(chunk)` and write live chunks at once; write `new Uint8Array()` instead of `connection.history`.
Fix: a test that holds the history write callback, emits a live chunk, asserts the write order is history then chunk and that `ack` fires per chunk after its own callback; type the fake as `Pick<Terminal, ...>`; run the same tests against `@xterm/headless`, or inject the Terminal factory (dependency as a parameter) so the real one can be used. Features: RUN-06.

**C3. An ended process turning input off has no test at any level.**
Code: TerminalSurface.tsx:172, 183, 292; TerminalView.tsx:371. Tests: the Surface tests never pass `ended={true}`; the View test only writes `data-ended` into its fake (TerminalView.test.tsx:63) and never asserts it.
Mutation it misses: delete `if (endedRef.current) return;` or `disableStdin = ended`, or pass `ended={false}`. Typing after exit would hit a dead PTY with no test failing.
Fix: Surface test: `ended` true, call the data handler, expect `connection.write` not called and `options.disableStdin` true; rerender `ended` false, expect writes again. View test: after `source.exit(7)` expect `data-ended="true"`; after restart expect "false". Features: RUN-06.

**C4. TerminalView find stepping and focus return are unchecked.**
Code: TerminalView.tsx:286-299 (search), 320-323 (`closeFind` focuses the terminal), 394-395 (Next and Previous pass `matchRef.current`). Test: the mocked surface returns `find: vi.fn(() => null)` (TerminalView.test.tsx:30), so `matchRef` is never set. The Escape-focus assertion does not exist (`surface.focus` is never asserted). The icon buttons "Next match", "Previous match" and "Close find" (TerminalFindBar.tsx:219-231) are never clicked in any file.
Mutation it misses: `onNext={() => search("next", null)}` (Next sticks on the first hit); remove the `focus()` call; swap the two arrows.
Fix: fake `find` returns a match; press Enter in the find input; expect the second call has `from` equal to the first match and direction "next"; Shift+Enter "previous"; Escape closes the bar and calls `focus`; click each icon button. Features: RUN-06.

**C5. Find and link columns are wrong after wide characters (source bug; the test fake cannot show it).**
Code: TerminalFindBar.tsx:84 builds each line with `translateToString(false)` and line 126 returns `match.index` as the column. xterm's `translateToString` skips the empty cell after a wide character (xterm src `BufferLine.ts:534-544`, and it offers an `outColumns` argument for this). The result feeds `terminal.select(match.column, ...)` (TerminalSurface.tsx:139) and the link ranges (210-215). After a CJK or emoji character the highlight and the clickable link are shifted.
Test gap: `bufferWith` (TerminalFindBar.test.tsx:19-27) returns plain strings.
Mutation it misses: not applicable (live bug).
Fix: use the `outColumns` argument; add a test with a real buffer line such as "日本語 foo" expecting the cell column, and the same for `findTerminalLinks` through the link provider. Features: RUN-06.

**C6. Settings pages never prove that a change persists and reloads.**
Files: RepoActionsPage.test.tsx (spies at 51, 83, 101, 123, 148), RepoMiscPage.test.tsx (68, 100, 117, 133, 151, 164), RepoPromptsPage.test.tsx:46-48, RepoScriptsPage.test.tsx:46-48 all use `vi.spyOn(container.actions.projects, ...).mockResolvedValue(ok())`. Each page test then asserts on the arguments of its own spy. The one assertion that reads a file back, "leaves the shared file alone" (RepoActionsPage.test.tsx:116-118), is trivially true because the write is mocked. Only hide-for-this-user (line 47) runs the real service. The service itself is covered by core/services/repo.config.test.ts:443, so the gap is the seam page to service to file to reload.
Mutation it misses: the page calls `save` with a stale `value.data`; `save` drops the returned `Result`; the page writes the wrong layer.
Fix: per page, one test with no spy: edit, blur, read the personal settings file through `container.platform.fs`, mount a fresh page on a fresh container over the same fs and assert the value shows. Features: SET-07.

**C7. Failed writes on three settings pages are untested.**
Code: RepoActionsPage.tsx:68-75 (toast and dialog stays open), 95-98 (rollback of the hidden list), RepoMiscPage.tsx:74-81, 104-106, 283-289 (remove failure returns false), RepoPromptsPage.tsx:122-127 (error under the field). Only RepoScriptsPage.test.tsx:110 covers a failed save. engineering.md: "If a write the user relies on fails, the user sees it." RepoPromptsPage header promises "a failed save (text kept and the failure shown)".
Mutation it misses: delete the `if (!saved.ok)` branch in any of them.
Fix: make the platform fs refuse the write (real service, no spy); assert the alert or toast, the kept text, the open dialog, and that the list shows the old form. Features: SET-07.

**C8. `resetRunAction` has no real test anywhere.**
Code: core/services/repo.ts:965-977. The page test mocks it (RepoActionsPage.test.tsx:148-154) and no core test names it (searched the whole src tree: the only test hit is that line). The body rewrites the config without the action and then clears the hidden id. I could not confirm from reading that `updateConfig` turns "merged config minus the action" into "drop the local override" rather than an explicit removal.
Mutation it misses: filter the wrong id; skip `setRunActionHidden(..., false)`; return before saving.
Fix: core test with a shared and a local `dev`: after reset the local file has no `dev`, the merged action is the shared one, and the hidden id is gone; then the page test over the real service. Features: SET-07.

**C9. AgentsPage: the sign-in flows that carry risk are untested, and the whole data layer is hand-built.**
Test: AgentsPage.test.tsx:34-42 mocks `hooks.ts` and `Toast.tsx`; the "store" is the variable `state.installs` that the refresh mock rewrites (142-150, 189-197). Engineering rule: screens use `createTestContainer`.
Untested code: closing the dialog mid-flow must call `cancelLogin` (AgentsPage.tsx:175-185); a failed `login` start shows the error and Retry (107-117); a `finishLogin` error or non-`signed_in` outcome (144-162); Cursor auto-finish (134-136); copy failure (93-100); a second Sign in click while the first is starting; loading and error views.
Mutation it misses: delete the `cancelLogin` call in `closeLogin`; drop `setBusyKey`; drop `finishLogin(started.value.loginId)` for Cursor.
Fix: agent-catalog service over a fake sidecar client in a real container; one test per flow above, including an out-of-order refresh (the SET-03 test-first item). Features: SET-03.

**C10. SetupTab runs on mocks and skips its state and race cases.**
Test: SetupTab.test.tsx:13-57 (hooks, context, router, Toast, TerminalView mocked; `{ id: "s1" } as Session` at 71; `toast` and `toast.error` share one mock at 48-51, so a swap between them passes).
Untested: busy and double click (SetupTab.tsx:158-169), archived (150-156, 235), `Add manually` target and `Ask agent` send of `ADD_SETUP_PROMPT` (247-248; `state.navigate` is never asserted), loading and error returns (128-143), `log_missing` view with Retry (254-266), `not_run` text (252), "N files in this workspace" (224-228), a stale `readSetupLog` answer after the workspace changes (107-126, the `active` flag; engineering.md asks for an overlapping-calls test).
Mutation it misses: delete `setBusy(true)`; drop `if (!active) return`; point `navigate` at another page.
Fix: container-based tests with a fake PTY: failed run, Run again pressed twice, Stop, archived, expired log; one overlapping-read test. Features: WS-03.

**C11. ScriptsPanel is effectively untested.**
Test: ScriptsPanel.run-01.test.tsx:67-98 (see table). Code with no test: tab resolution (ScriptsPanel.tsx:65-74), new terminal and its error toast (87-96), close, neighbour and error toast (98-111), terminal limit, collapse (134), Ports tab, setup shown while the workspace initializes.
Note: collapse and tab switching hide bodies with the Tailwind class `hidden` (134-142). jsdom ignores it, so tests cannot see which tab is shown. Use the `hidden` attribute, or assert `aria-hidden`/`data-active`, so tests (and screen readers) can tell.
Fix: panel tests over the real container: initializing gives Setup; actions present gives Run; New terminal creates and selects a tab; closing the middle tab selects its neighbour and keeps the others mounted; limit shows the reason; collapse keeps a terminal mounted. Features: RUN-01, RUN-06.

**C12. RunTab: the run lifecycle is never driven through the real service.**
Test: RunTab.run-01.test.tsx:97-101 seeds the store with `setState` (phases and byWorkspace), so the label test passes whatever the real service emits. Line 114 mocks `start`. Missing: Run to Starting to Stop to exit to "Run again"; stop that is not confirmed returns the button to Run (header); a failed start toast (RunTab.tsx:111); waiting for setup text (173); choosing another action; archived, loading and error views (121-141); a second Cmd+R pressed while running stops.
Mutation it misses: `history.includes(selected.id)` forced false (72); `phaseFor` ignoring `storedPhase`.
Fix: RunTab over real `runScripts` with a fake PTY, one test per phase change, plus the double-click case. Features: RUN-01.

**C13. Settings pieces tested in isolation are not wired in the page, and the page tests do not notice.**

- FilesToCopyField preview, "Detecting files to copy..." and `.worktreeinclude` (SET-07 item) are tested at the component (FilesToCopyField.test.tsx:51, 64, 82), but RepoMiscPage passes `matches={null}` and `source="settings"` always (RepoMiscPage.tsx:259-260). The user never sees them.
- RemoveRepoDialog "running agents" is tested with a number the test supplies (RemoveRepoDialog.test.tsx:65), but RepoMiscPage hard-codes `runningAgentCount={0}` (line 281).
- RepoMiscPage.test.tsx:66-78 seeds one repo, so removing the `repoId` filter on the count (RepoMiscPage.tsx:110-113) still passes.
  Fix: page tests that seed a second repo with workspaces and a `.worktreeinclude` file, and assert the count and source line on the page. Features: SET-07.

**C14. Done rows with checklist items that have no failing test.**

- RUN-06 (done): "Terminal text selected by the user can be sent to the chat" and the UI that opens `terminals.openForRepo` have no UI. `openForRepo` is called only from core/api.ts and core/actions.ts; the terminal view only copies text (TerminalView.tsx:271-275). "Divider on restart" is a service item. "Cmd+K, Cmd+Backspace, Cmd+Left/Right, Alt+Left/Right" have no test (TerminalSurface.tsx:89-104, 236-238, 247-251). The cold-restore replay has no test and the history is empty (C1).
- SET-03 (done): the "Update" button next to the ACP warning is not passed by the page (AgentsPage.tsx:276-283); AgentCard.test.tsx:73 passes `onUpdate` itself, so it would pass without the page wiring. Items moved to PLAT-28, SET-09, SET-12 per `docs/plans/items/system.tsv` lines 2803-2815 are fine.
- WS-03 (done): "Setup logs cannot be loaded or expired" view with Retry, cancelled and stopping titles, and "files copied" line have no test (see D).
- REV-02 (done): Hide whitespace checkbox and Unified button have no test (see D).

#### LATER

**L1. AddActionDialog edge cases.** Edit mode self-clash exemption (AddActionDialog.tsx:87), thrown error text (109-111), reset on close (120-125), icon and default switch, Enter key. Features: SET-07, RUN-01.
**L2. Handler wiring in presentational lists.** ActionList (onDelete, onSetDefault, Show), RunToolbar select, RunEmptyState Ask agent, ScriptsPanelTabs New terminal click and status dots. Assert each handler with its own spy. Features: SET-07, RUN-01.
**L3. AgentLoginDialog.** Cancel, empty code blocked, finishing blocks a second submit, Enter confirms, instructions-only flow.
**L4. FilesToCopyField.** Absolute path and `~/` refusals, duplicate, Enter key, Remove (only RepoMiscPage.test.tsx:156 clicks Remove).
**L5. DiffToolbar and DiffView.** Unified click, whitespace checkbox, disabled checkboxes inside the popover, deleted file, dismissal returning when the text changes, focus comment scroll, light and dark theme reaching the renderer (`themeType`). The third renderer test should render `DiffView` with the whitespace preference rather than call `parseDiffFromFile`.
**L6. TerminalSurface details.** Fit debounce and fit-on-visible (TerminalSurface.tsx:255-273, `FIT_DELAY_MS`), resize success path, link Cmd-click only (217-220), cleanup of every listener (the fake `dispose: vi.fn()` is created per call and cannot be asserted, lines 29, 33), Cmd+C without a selection falls through.
**L7. Fake leakage inside TerminalSurface and TerminalView tests.** `xterm.terminal.options` is mutated and never reset (TerminalSurface.test.tsx:200-202); `toastSpy.mockRestore()` runs at the end of the test body (TerminalSurface.test.tsx:328, 360; TerminalView.test.tsx:109, 124, 139), so a failed assertion leaves the spy for the next test. Use `afterEach(vi.restoreAllMocks)`.
**L8. Duplicate and redundant test code.** `fakeConnection` is written twice with different shapes (TerminalSurface.test.tsx:68, TerminalView.test.tsx:78); ~20 files import `test/dom-polyfills.ts` by hand though `test/setup.ts:14` already loads it for every file; the `agentDisplayName` it.each (AgentCard.test.tsx:86-95) tests a core function and belongs in `agent-catalog.test.ts`; ScriptsPanel.run-01 duplicates RunTab.run-01.
**L9. Incidental pins.** `resetButtons[1]` (RepoPromptsPage.test.tsx:102-105) depends on DOM order; `not.toContain("Setup tab")` (SetupTab.test.tsx:270); `[data-terminal-view]` selector (TerminalView.test.tsx:234, 260, 286). Prefer roles and labels.
**L10. Source points.** DiffView.tsx:89 hashes both full file texts on every render (not memoised); for a multi-megabyte file it runs on each prop change. `convertEol: true` (TerminalSurface.tsx:157) was a prior LATER finding and is still there.
**L11. Late-answer tests are absent** for AgentsPage (finish arriving after the dialog closed), TerminalView restart (two restarts), RunTab (two starts). The code guards these partly (login id compare in AgentsPage.tsx:140-170); nothing proves it except the Codex case.

### 3.8 Git panel, Home, onboarding, app-04 state files, kanban

#### MUST

**M1. `features/home/home-query.test.ts:83-94` and `:110-117` read as failing.** Features: NAV-05.

- `:83-94`: the workspace has `repoId: "api"` but the repo list holds `repo("app")` and `repo("api-service")`, whose id is `"api-service"`. `queryHome` looks the repo up by id (`home-query.ts:99,107`), finds none, and the other fields are "one", "jahala/one". Result is empty, test expects `["one"]`.
- `:110-117`: `pageCount: 2` over 60 workspaces. `home-query.ts:113-114` slices `0..100`, so 60 items come back; the test expects 10. The screen relies on the cumulative result (`HomeScreen.test.tsx:98-100`), so the unit test is the odd one out. The prior audit (`s2-1-ui-1.md:91`) noted the header wording but not that the test body asserts the old contract.
- Mutation missed: none, the tests are red today. Fix: give the workspace `repoId: "api-service"` and a displayName without "api"; assert page 2 returns all 60 with `total` 60 and `hasMore` false.

**M2. `features/git-panel/git-panel.tabs.test.tsx:74` expects "Not built yet: GIT-04".** Features: REV-01, GIT-04.

- `core/status/git-header.ts` has no `notImplemented` and is implemented (and `git-header.test.ts` exists). With the real function and `uncommittedFiles: 1`, the header renders "Uncommitted changes", so line 74 fails. The comment at `:36` ("real, unbuilt one") is stale (prior audit s2 core-1, LATER).
- This file also tests the `NotBuiltYet` placeholder boundary for FilesTab and ChecksTab (`:67-92`), which `docs/engineering.md` forbids ("never test a placeholder"). They will go stale again when REV-06 and PR-04 land.
- Fix: replace line 74 with an assertion that the real header shows "Uncommitted changes" while the Checks tab is selected. Move the unbuilt-tab cases into a test of `NotBuiltYet` itself, which exists in `ui`.

**M3. No test runs the Git panel over the real header logic.** Features: REV-01, GIT-04, GIT-05, PR-02.

- `rev-01-panel.test.tsx:39-66`, `git-panel.git-05.test.tsx:37-45` and `git-panel.pr-02.test.tsx:45-53` replace `computeGitHeader`. `rev-01-panel.test.tsx:106-110` then asserts the title and button the mock returns. That is theater (prior audit step-4 MUST, still open). `GitPanel.tsx:254-261` builds the inputs (`agentWorking`, `forge`, `automergeSettingOn`, `treatOptionalChecksAsBlocking`, `stack`). Change `forge: ... === "not_github" ? "local" : "github"` or hard-code `agentWorking: false` and no test fails.
- Fix: one integration test over `createTestContainer` with the git cache seeded and `computeGitHeader` real. A table of four to five states (uncommitted, no PR with changes, behind, PR draft, agent working) asserting the title and the button label, and the first state also driving `agentWorking` through a seeded session.

**M4. Ten of twelve header actions have no test.** Features: REV-01 (header), GIT-04.

- `GitPanel.tsx:153-200`: `pull`, `push`, `resolve`, `ready_for_review`, `fix_errors`, `approve`, `merge`, `merge_stack`, `toggle_automerge`, `retry` are untested. Also the failed-result toast (`:159`), the error header with Retry (`:238-249`), and the loading skeleton (`:237`).
- Mutations missed: swap the `pull` and `push` cases; invert `pr === null ? true : !pr.autoMergeEnabled` (`:190`); make `retry` do nothing.
- Fix: parameterise over the action ids with a spy per action and assert id to call and argument; add error and loading cases.

**M5. Shortcut path bypasses the double-press guard on metered agent calls.** Features: GIT-05, PR-02.

- `GitPanel.tsx:204-213` runs `runAction` directly. The single-flight sits in `GitHeader.tsx:376-382` and only protects the button. `GitService.commitAndPush` (`core/services/git.ts:987-999`) has no guard of its own. Two quick Cmd+Shift+Y presses send two commit instructions to the agent.
- Neither GIT-05 nor PR-02 panel test presses twice. Mutation: remove nothing; the guard simply does not exist on that path.
- Fix: test presses the shortcut twice while the first call is pending and expects one service call; implement the guard once in `runAction`.

**M6. A rejected or throwing header action is swallowed silently.** Features: REV-01, GIT-04.

- `GitHeader.tsx:381` `.then(settle, settle)` drops the error. The real PR-05 and PR-06 service methods (`core/services/github.ts:1466-1475,1535-1547`) are non-async functions returning `notImplemented(...)`, which throws synchronously, so `GitPanel.runAction` throws before `run(...)` is reached. In the live app, "Fix errors", "Ready for review", "Approve" and auto-merge spin and stop with no message.
- The test `rev-01.test.tsx:58-74` locks in the swallow ("button usable again") without asserting that the user is told anything. Panel tests mock `useActions`, so they never see the throw.
- Fix: an integration test with the real container clicking each unbuilt action and asserting a visible message. The header should hand the error on (value or toast).

**M7. Home "Unarchive" is tested over a spy; the real action is a placeholder that leaves the button stuck.** Features: NAV-05.

- `WorkspaceCard.test.tsx:91-105` spies `actions.workspaces.unarchive`. The real service method is `notImplemented("WS-06")` (`core/services/workspace.ts:1224-1229`). `WorkspaceCard.tsx:70-77` calls `setBusy(true)` and then the action; a synchronous throw skips the `.finally(setBusy(false))`, so the button spins forever.
- Even with a working service, `:72-75` ignores `needsBranchName: true` ("Nothing changed yet", `core/api.ts:183-186`) and `uncommittedChangesLost`; the test only returns `false/false`.
- Fix: a test over the real container expecting a visible result, plus `needsBranchName: true` and `uncommittedChangesLost: true` cases.

**M8. AgentStep never exercises the detection join.** Features: APP-02. This is the seam where slice 1's "every agent shows not installed" lived.

- `AgentStep.test.tsx:15-18,56-58,156-158` stub `agentCatalog.refresh`; `:18` injects installs with `setInstalls`. The unit `agent-catalog.test.ts:28-69` tests `refresh` with a fake sidecar, and the UI mapping is tested here, but nothing joins container sidecar client, `getAgentInstalls` result shape and the screen. No test anywhere calls `getAgentInstalls` against the real sidecar handler (`packages/sidecar/src/rpc/handlers.ts`).
- Mutation missed: the container passes a sidecar client whose `getAgentInstalls` returns `{agents: []}`.
- Fix: a contract test where the sidecar handler's output (real detection over a fake binary on PATH) is validated against the protocol schema and then served to the UI through a loopback `SidecarClient`; the AgentStep test uses that, un-stubbed.

**M9. `ChangesTab` seams untested.** Features: REV-01.

- `ChangesTab.tsx:126-128` (filter matches nothing, Clear filter) has no test through the tab: delete the branch or return `no_changes` and nothing fails. `app-04.test.tsx:8` tests `ChangesEmpty` alone.
- Discard path `:102-106` and `:138` never clicked through the tab. `rev-01-hooked.test.tsx:175-185` only checks the menu item shows. Mutation: pass `path` as `workspaceId`, drop `toastError`: not caught.
- Not covered through the tab: flat/folder toggle (`onViewChange` is `vi.fn()` and never clicked, `rev-01-components.test.tsx:271`), loading rows (`:47`), git error (`:118-120`), back bar (`:158-163`).

**M10. REV-01 is `done` with checklist items that have no failing test or no code.** Details in D. Headline: the Viewed checkbox is not wired (`ChangesTab.tsx:131-139` passes no `onToggleViewed`), the target-branch scope runs on `useBranches = notImplemented("WS-02")` (`core/hooks/git.ts:104`) and its only test asserts the placeholder (`rev-01-hooked.test.tsx:206`), and "N files changed" has only an absence test (`:219`).

#### LATER

- **Duplicates.** `rev-01-panel.test.tsx:112-116` repeats `git-panel.git-05.test.tsx:89-97`. `rev-01-hooked.test.tsx:187` repeats `app-04.test.tsx:15`. Four files each build their own GitPanel mock set; consolidate on git-05's approach (real container plus `importOriginal`).
- **Two guards hide each other.** "Pressed twice" tests (`rev-01.test.tsx:34`, `rev-01-panel.test.tsx:130`) pass if either the single-flight or the disabled button is removed. Add a case where the button is not disabled (clicked inside the same act).
- **GitPanel review.** No test that Review is disabled when `changedCount` is 0 (`GitPanel.tsx:282`), none for the "Couldn't start the review" toast, none for Escape or Cmd+Enter in `ReviewPromptDialog`. `openFile` (`GitPanel.tsx:143-151`) and `files.open` are mocked and never asserted. No test that the panel's handlers are removed on unmount.
- **Keybinding mapping.** The Cmd+Shift+D test (`rev-01-hooked.test.tsx:165`) calls `runCommandHandlers("review.openDiff")` without `commandForKeyPress`, so a changed default binding is not caught (the Cmd+Alt+U test does check it). No test sends a real key event through a mounted `useCommandDispatcher` to the panel.
- **rev-01-tree `:32`**: make the conflicted file sort after the clean one alphabetically.
- **rev-01-components**: `ChangedFolderRow` test echoes props (`:103-116`); `CommitScopeList` checks messages only, not short hash, author, date (`:210-217`); `ChangedFileRow` does not assert +/- lines, Conflict badge or binary tag.
- **HomeFilters**: add tests for the two untested effects; assert the project filter in a `HomeScreen` rerender.
- **HomeScreen**: only 60 workspaces (`:91`). Add 300 to 1,000, pinned group above 50, search after "Show more" (page resets, `HomeScreen.tsx:184-187`), the sort and project controls driven at screen level, Display toggle hiding a field, retry for the workspace store (`:224`; only the repo retry is tested).
- **WorkspaceCard**: branch, status subtitle, last-active text (the test passes `now = lastActivityAt`, so the text is "now" and unasserted), toasts on Finder and copy failure.
- **home-query**: `:178` has no tie; PR title search missing (audit LATER); sorting of pinned group.
- **HomeEmptyState source**: `HomeEmptyState.tsx:30` says "Nothing is archived" whenever filters are active and archived is on, even when the user typed a search that matches nothing among real archived rows. The test `:19` pins this.
- **AgentStep**: header "Must handle" items beyond detection are untested, plus `rowState` "Installed" and "Not signed in" labels, "Version unknown", and absence of the "No agent programs" text when one is installed (`:48` has no negative check; flipping `!anyInstalled` at `AgentStep.tsx:235` for the present case is not caught).
- **OnboardingScreen**: Continue on the last step calls `finish` (`:220-226`, untested); Enter with a focused button or input must not advance (`isControl`, `isEditable`, `:54-64`); double Exit click and retry after failure (`leaving.current`, `:205,210`); the illustration test reads an `svg[data-step]` attribute (`:77,82`), which pins an incidental detail.
- **ProjectStep**: `:61` `await waitFor(() => expect(addLocal).not.toHaveBeenCalled())` passes on the first look; wait for the busy state to clear first. No double-click test for the `flight` guard (`ProjectStep.tsx:11,27`); `pickFolder` failure branch (`:32-35`) untested; the "not a repository" error is canned (`:71-73`), so the title promises more than the body.
- **file-viewer/app-04**: add `missing` and `binary` kinds; assert each state shows at most one button.
- **kanban.test**: remove the tautology at `:18`; assert all five labels; the grouping function waits for NAV-06.
- **Style**: `expect(screen.getBy...).toBeTruthy()` is redundant because `getBy` already throws. Assert on a property of the element (text, state, attribute) instead.

---

## 4. Per-file verdicts

All 167 files. Paths are relative to `apps/desktop/src`. WEAK and THEATER rows name the mutation that stays green.

| Path                                                         | Verdict | Reason                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/AppShell.test.tsx`                                      | WEAK    | Cmd+A, toast host and failed-save tests are real. Deleting `panel.collapse()` (AppShell.tsx:93) leaves the "hide sidebar" tests green, because the save at :94 is unconditional. The fixture sets settings before mount, so the launch-order bug in C1 cannot show. Waits on the text "Git panel" (line 92, 124), which only the NotBuiltYet placeholder emits.                                                                 |
| `app/CreateWorkspacePage.test.tsx`                           | WEAK    | Hand-built `as unknown as Container` (line 95-107). Hard-coding `planMode: false`, dropping `sectionId` mapping (CreateWorkspacePage.tsx:142) or `toolApprovals` stays green. The empty, loading and error states (source :71-97) have no test.                                                                                                                                                                                 |
| `app/FullPage.test.tsx`                                      | REAL    | Swapping the order of drag strip and children, or removing `data-tauri-drag-region`, fails it.                                                                                                                                                                                                                                                                                                                                  |
| `app/ShellControls.test.tsx`                                 | WEAK    | Swapping the back and forward `onClick` handlers (ShellControls.tsx:39, 44) stays green; nothing clicks them. Line 34 pins a Tailwind class. Title at :37 says "back and forward" but asserts forward is enabled.                                                                                                                                                                                                               |
| `app/SurfaceLayer.nav-15.test.tsx`                           | REAL    | Mount-through-hide, one-slot rule, focus, blur-on-hide and anchor resize all fail on a matching mutation. But no non-test file imports `SurfaceLayer` (see C8), so the user-visible feature does not exist.                                                                                                                                                                                                                     |
| `app/app-04.test.tsx`                                        | REAL    | Route-state screens are asserted on real output. `vi.mock` of `AddProjectButton` (line 8-10) is minor: that button has its own test and the real one renders in router tests.                                                                                                                                                                                                                                                   |
| `app/command-dispatcher.test.ts`                             | REAL    | Pure lookup, scope, priority, send-key swap and accelerator tests each fail on a flipped condition. One tautological test (:330-343).                                                                                                                                                                                                                                                                                           |
| `app/command-dispatcher.hooks.test.tsx`                      | WEAK    | Real container, real listeners, real `KeyboardEvent`s. But the two composer tests (:250-298) pass if the send-key mapping at command-dispatcher.ts:561 is replaced by a constant. The overlay-to-scope wiring (:595) and key rebinding are untested. `commands.run` is mocked in 8 tests.                                                                                                                                       |
| `app/git-16.test.tsx`                                        | WEAK    | Real container and real notice. Setting the toast duration to 1 ms stays green (title says "for 15 seconds"). The fix-failed branch (xcode-license-notice.ts:38-41) has no test. The negative test (:74-79) can pass before the probe finishes.                                                                                                                                                                                 |
| `app/layout-persistence.test.ts`                             | REAL    | Clamp, round trip, bad JSON, unknown panels, failed write, no write on unchanged values: each mutation fails a test.                                                                                                                                                                                                                                                                                                            |
| `app/navigation-history.test.ts`                             | REAL    | Fallback order, tie-break, skip of initializing or failed, codec edge cases: each mutation fails a test.                                                                                                                                                                                                                                                                                                                        |
| `app/overlay-store.test.ts`                                  | REAL    | Tiny, but "show replaces" and "close clears" fail on the obvious mutations.                                                                                                                                                                                                                                                                                                                                                     |
| `app/providers.app-01.test.tsx`                              | REAL    | Client identity, defaults, query and mutation logging, redaction at depth, root handlers. Duplicates one assertion in query-options.test.ts.                                                                                                                                                                                                                                                                                    |
| `app/query-options.test.ts`                                  | WEAK    | Retry and 4xx rules are real. The "cache in memory" test (:50-58) cannot fail (see C13). Adding a persister in `createQueryClient` stays green.                                                                                                                                                                                                                                                                                 |
| `app/router.nav-02.test.tsx`                                 | WEAK    | Restore, repair, chat-tab restore and Cmd+[ through the mounted root dispatcher are real and good. But `Not built yet: NAV-05` (line 113) fails now that Home is built. The repo-settings test (:117-121) passes with a wrong `page` prop. `setActiveSession` is mocked, so no persistence is checked.                                                                                                                          |
| `app/router.test.tsx`                                        | WEAK    | Duplicates nav-02 and AppShell.test cases. Four tests pin placeholder text (`Not built yet: ...`, "Git panel", "Scripts"). Swapping the dashboard and home components stays green only while placeholders exist. No header, no localStorage reset.                                                                                                                                                                              |
| `app/startup.app-01.test.ts`                                 | WEAK    | Deleting both `dbVersionWarning` failure branches (startup.ts:51-71) leaves every test green. Fake container and platform are `as unknown as`. Container start order is covered in core, not here.                                                                                                                                                                                                                              |
| `main.app-01.test.tsx`                                       | WEAK    | Test 1 passes only if startup failed or was blocked (see C2). Deleting the router from `root.render` stays green. Constant-id fake and hand-made database. Test 2 (query errors reach the Platform log) is real.                                                                                                                                                                                                                |
| `ui/layout-sizes.test.ts`                                    | THEATER | Copies three constants from `layout-sizes.ts` into `toBe` literals. Mutation missed: `AppShell` passes `minSize="100px"` or drops `maxSize` (app/AppShell.tsx:134-135), green.                                                                                                                                                                                                                                                  |
| `ui/TitleBarInset.test.tsx`                                  | WEAK    | One test, checks the Tailwind class string. Missed: `AppShell` never sets `--shell-left-inset` (app/AppShell.tsx:114-116), green. No test anywhere reads that variable.                                                                                                                                                                                                                                                         |
| `ui/app-04.test.tsx`                                         | WEAK    | EmptyState content is real. Tone is a `data-tone` echo of the prop (`:36`, `:42`); Skeleton asserts a class the test passed in (`:51`). Missed: heading colour `failed ? "text-danger" : "text-fg"` (EmptyState.tsx:52) removed, green. Duplicates `components.test.tsx:94-112`.                                                                                                                                                |
| `ui/app-05.test.tsx`                                         | WEAK    | Menus, digits, submenu, popover focus return, Cmd+Enter, toasts are real. Missed: Button sizes swapped (Button.tsx:49-54); `capture` flag dropped on the scroll listener (Menu.tsx:180); variant tests compare `className` to the source's own map (`:42-52`).                                                                                                                                                                  |
| `ui/app-05-menu.test.tsx`                                    | REAL    | Own-content scroll, nested digit, context-menu key, indicators, shortcut and icon parts, shared classes. Deleting Menu.tsx:176-177 or the ContextMenu key handler (ContextMenu.tsx:73-85) fails a test. Gaps are in section C.                                                                                                                                                                                                  |
| `ui/app-05-toast.test.tsx`                                   | REAL    | Mounts the real `AppProviders` and counts hosts; workspace claim, dismiss on leave, release on auto-close, `Result` to toast. Removing `<Toaster />` (app/providers.tsx:92) or the `release` calls (Toast.tsx:101, :105) fails. Uses real 30 ms timer (`:116`).                                                                                                                                                                 |
| `ui/app-05-look.test.tsx`                                    | WEAK    | Spinner shapes and Cmd+Enter in a textarea are real. Half the file pins Tailwind strings (dialog `rounded-md`, `p-6`, `gap-4`, `max-w-*`) that jsdom cannot lay out. The "sit still under reduced motion" comment (`:41-43`) is never asserted.                                                                                                                                                                                 |
| `ui/app-12.test.tsx`                                         | REAL    | Real key events into Radix for Slider, Switch, Select, real label click for Checkbox, real `aria-describedby` link for Input errors. Disabled guards are caught (Switch.tsx:38). Gaps in section C (Checkbox Space, class pins).                                                                                                                                                                                                |
| `ui/app-13.test.tsx`                                         | REAL    | CopyButton failure by throw and by failed `Result`, AlertDialog confirm/cancel/Escape, `splitHighlight` with `İ`, regex symbols, Collapsible unmount. Gaps (timer restart, truncate edges) in section C.                                                                                                                                                                                                                        |
| `ui/app-14.test.tsx`                                         | WEAK    | `themeAttributes` tests and the contrast matrix are real. Missed: the "warning stays distinguishable" test only checks that no override exists (`:312-315`); ANSI colours are checked at 3:1, below the 4.5:1 text rule (`:250-251`, `:353-359`); vibrancy is a regex plus literal hexes (`:366-375`).                                                                                                                          |
| `ui/components.test.tsx`                                     | WEAK    | Smoke level. "shows a spinner" never checks a spinner (`:50-63`); IconButton tooltip, shortcut and disabled branches unchecked (`:66-78`); Badge checks one tone of four. Duplicates app-04, app-05 and app-13. No feature ids in titles.                                                                                                                                                                                       |
| `ui/resizable.test.tsx`                                      | WEAK    | Save path is real (`:90-117`). Restore only asserts `load` was called (`:73-88`). Missed: `defaultLayout={savedLayout ?? defaultLayout}` becomes `defaultLayout={defaultLayout}` (resizable.tsx:94), green. Three tests pin class strings.                                                                                                                                                                                      |
| `ui/states.test.tsx`                                         | REAL    | Placeholder id, generic message, retry, `resetKey`, NotImplemented rethrow, all LoadableView states. One vacuous assertion (`:45`), see C.                                                                                                                                                                                                                                                                                      |
| `ui/tokens.test.ts`                                          | WEAK    | Font files, weights, type scale and contrast are real. Hard-coded colour scan skips 11 feature folders and has no known-bad sample. Contrast block duplicates app-14. No feature id.                                                                                                                                                                                                                                            |
| `features/chat/AssistantText.test.tsx`                       | WEAK    | Parser cases are real, but the header claims raw HTML is not rendered, a failed image shows its alt text, and a streaming open list must not flash. None is tested. Mutation missed: replace the `<img onError>` fallback (AssistantText.tsx:237) or break ordered lists; all tests stay green. Also no test for `_` or `*` inline marks, and the code italicises snake_case (see G).                                           |
| `features/chat/ChatBanner.chat-27.test.tsx`                  | WEAK    | "Retry in new chat" test (58-67) only checks the service was called. Mutations missed: delete the `navigate(...)` call (ChatBanner.tsx:86-92), delete the `toastError` (83), remove the single-flight guard (80). The two retry-banner text tests are real.                                                                                                                                                                     |
| `features/chat/ChatBanner.test.tsx`                          | REAL    | Flipping `item.retryable && onRetry` (ChatBanner.tsx:184), the empty-message fallback, the compacting regex and the copy menu all fail a test. Notice kinds `session_started` and `model_changed` are untested (LATER).                                                                                                                                                                                                         |
| `features/chat/ChatBlockView.test.tsx`                       | WEAK    | Every child is mocked, so it checks only the switch. No test for `todo` or `error` blocks, and none for `onRetry` and `retryInNewChat` reaching the banner (ChatBlockView.tsx:54, header says they must). Mutation missed: `<ChatBanner block={block} />` without `onRetry`, or `case "todo"` returning null.                                                                                                                   |
| `features/chat/ChatPane.test.tsx`                            | THEATER | All six children are mocked and the only assertions are that `div[data-region=...]` wrappers exist (28-30), and those wrappers are ChatPane's own markup. Mutations missed: delete every child element from the JSX and keep the divs; delete the whole `useEffect` (ChatPane.tsx:36-42) that calls `setViewing` and `markAllRead`. All green.                                                                                  |
| `features/chat/CodeBlock.test.tsx`                           | REAL    | Copy of full text while cut (70-79), "Show all", colours kept while code grows (38-68) all fail on the obvious mutations. shiki is stood in at the module edge with a stated reason. Out-of-order highlight answers are untested (LATER).                                                                                                                                                                                       |
| `features/chat/EmptyChat.test.tsx`                           | REAL    | Starter click, archived hides starters, invitation text. Mutation `archived ? ... : null` flipped fails.                                                                                                                                                                                                                                                                                                                        |
| `features/chat/ExternalLink.test.tsx`                        | REAL    | `preventDefault` on click and aux click, scheme allowlist, toast on failure. All fail on the obvious mutations. Problem is the hand-built `as unknown as Container` at line 22 with a false comment (finding M10).                                                                                                                                                                                                              |
| `features/chat/MessageList.chat-27.test.tsx`                 | REAL    | Passing `retry` to every turn, or to the first, fails because `turn:t1` is matched exactly (83-84). TurnItem is mocked, but the other half of the seam is in TurnItem.chat-27. Uses `as unknown as ChatTurn` partials (LATER).                                                                                                                                                                                                  |
| `features/chat/MessageList.test.tsx`                         | WEAK    | Virtualisation window and tail-only re-render are real tests. Mutations missed: delete `atBottomStateChange={setAtBottom}` (MessageList.tsx:117), change the `scrollToIndex` target (125), remove `key={sessionId}` (103), drop the draft-append branch (82-83; the fixture `useDraft` at line 24 is always empty), remove `LoadingTurns`. Wrong starter label pinned at 204-208. `core/hooks.ts` and four children are mocked. |
| `features/chat/NextUnreadButton.nav-11.test.tsx`             | WEAK    | Button tests use the real container and are real. Mutation missed: delete both `useCommandHandler` lines (NextUnreadButton.tsx:82-85, the Cmd+Alt+L path) or the `Kbd` hint (96-100). Nothing fails.                                                                                                                                                                                                                            |
| `features/chat/ScrollToBottomButton.test.tsx`                | REAL    | Hidden, click, "New" marker all fail on flips. Test 4 (26-32) pins three Tailwind class names (LATER).                                                                                                                                                                                                                                                                                                                          |
| `features/chat/ThinkingBlock.test.tsx`                       | REAL    | Default `open=false`, toggle, summary label, empty text.                                                                                                                                                                                                                                                                                                                                                                        |
| `features/chat/TodoBlock.test.tsx`                           | REAL    | "1 of 3 done" count and empty state. Off-by-one in the filter fails.                                                                                                                                                                                                                                                                                                                                                            |
| `features/chat/TodoList.test.tsx`                            | REAL    | Status words and `data-status` per row, empty state. Row identity on reorder is untested (LATER).                                                                                                                                                                                                                                                                                                                               |
| `features/chat/TurnChanges.test.tsx`                         | REAL    | First five, "and 7 more" expand, rename old path, binary, scope handed to Open diff, disabled without caller. The component has no importer outside tests (see M12).                                                                                                                                                                                                                                                            |
| `features/chat/TurnFooter.test.tsx`                          | REAL    | Token details, copy final and summary, Reset disabled without checkpoint, Fork reason, three toast paths. Pins direct Reset without a confirm dialog (M9).                                                                                                                                                                                                                                                                      |
| `features/chat/TurnItem.chat-27.test.tsx`                    | WEAK    | Happy path of Retry now (cancel then send with attachments) is real. Mutations missed: drop `if (!stopped.ok) return stopped` (TurnItem.tsx:98), remove `retryFlight.run` (96) so a double click sends twice, swap send before cancel, drop the "Couldn't retry now" toast. Banner is mocked.                                                                                                                                   |
| `features/chat/TurnItem.test.tsx`                            | WEAK    | Mutations missed: delete `<UserMessage .../>` (TurnItem.tsx:127), delete `<TurnFooter/>` (157), delete the spinner (153). No test asserts `user:` or a footer on a finished turn. The retry test (148-165) uses a mock banner that always offers a button, which the real banner does not (M4).                                                                                                                                 |
| `features/chat/UserMessage.test.tsx`                         | WEAK    | Chips, router state, copy, reset toasts are real. Mutations missed: remove the `LONG_MESSAGE` collapse and "Show more" (UserMessage.tsx:133-167), remove the `<img onError>` fallback (43-67), accept PR number 0 (118-119). "Message not sent" test (96-113) feeds the prop and the text itself; no live caller passes `failed` (M3).                                                                                          |
| `features/chat/report-failure.test.ts`                       | REAL    | Removing `if (!result.ok)` or the title fails. Toast is mocked at the edge, which is the effect.                                                                                                                                                                                                                                                                                                                                |
| `features/chat/interactions/InteractionDock.test.tsx`        | WEAK    | Mocks `core/hooks.ts` (`useChat`, line 16), so the store to `chatView` to `useChat` path never runs. Missed: remove `key={interactionId}` (InteractionDock.tsx:21), or drop `expiresAt`/`timedOut` (:24-25). Stays green.                                                                                                                                                                                                       |
| `features/chat/interactions/InteractionHost.test.tsx`        | WEAK    | Mocks the approval card and plan bar with test-written sentinels (lines 13-18). Only 2 of 5 kinds tested. Missed: swap the `permission_grant` and `mcp_form` cases, or drop the `expiresAt`/`timedOut` props (InteractionHost.tsx:60-77). The mock reason (approval card unbuilt) is stale; the real plan bar throws `notImplemented("CHAT-12")`.                                                                               |
| `features/chat/interactions/McpFormCard.test.tsx`            | REAL    | Real container, answer function replaced at the boundary. Required, number, boolean, invalid, unknown schema, Decline/Cancel mapping, timeout, retry all asserted with exact payloads. Gap: enum is never chosen (LATER).                                                                                                                                                                                                       |
| `features/chat/interactions/PermissionGrantCard.test.tsx`    | REAL    | Approve turn, Approve session, Deny, double click, retry, past expiry all asserted with exact payloads. Gap: `timedOut` prop and future-expiry timer (see M1, L7).                                                                                                                                                                                                                                                              |
| `features/chat/interactions/QuestionCard.test.tsx`           | WEAK    | Whole `core/hooks.ts` mocked; answers asserted with exact payloads, good. Missed: delete the IME check (QuestionCard.tsx:135), delete the `busy` guard (:102), delete `.trim()` (:92, :96), stop clearing Other when an option is picked (:76). All stay green.                                                                                                                                                                 |
| `features/chat/interactions/ToolApprovalCard.test.tsx`       | WEAK    | Strong on Enter, Backspace, Cmd+Enter, deny message, retry. Missed: delete `if (onButton) return;` (ToolApprovalCard.tsx:158). Enter on a focused "No" button would send `allow`. Also missed: IME check (:147), `busy` guard on the key path (:125).                                                                                                                                                                           |
| `features/chat/tools/ToolCard.test.tsx`                      | WEAK    | `useSetting: () => state.expand` ignores the key (line 14). Missed: change `"expand_tool_calls"` (ToolCard.tsx:38) to any other string. Boundary cases (throw, placeholder) are real and good.                                                                                                                                                                                                                                  |
| `features/chat/tools/registry.test.tsx`                      | WEAK    | Registry half is tautological (`typeof ... === "function"`, line 13; uniqueness, line 20). Missed: swap `read` and `write` in `TOOL_CARDS` (registry.ts:53-54). The ToolCardFrame and toolStatus tests in the same file (lines 39-98) are REAL.                                                                                                                                                                                 |
| `features/chat/tools/cards/AskUserQuestionCard.test.tsx`     | REAL    | Parses answers, `(Skipped)`, waiting, withdrawn, masked secret. Mutation on `parseQuestionAnswers` or the mask is caught. Caveats in M8, M9.                                                                                                                                                                                                                                                                                    |
| `features/chat/tools/cards/TodoCard.test.tsx`                | REAL    | Rows through the real TodoList, started, completed, empty, generic fallback. Gaps are LATER (unknown status, unlabeled entry, summary text).                                                                                                                                                                                                                                                                                    |
| `features/chat/tools/cards/chat-08-cards.test.tsx`           | WEAK    | One happy-path test per card, 18 cards. No empty, cap or error state except Edit and Bash. Hand-built `Container` (line 44). Missed: reverse the MultiEdit edits (test checks only "Edit 1..3" labels, line 347); drop the Read excerpt; remove any list cap.                                                                                                                                                                   |
| `features/composer/FavoriteModels.test.tsx`                  | WEAK    | Never asserts `onPick` for an available favourite. Missed: delete `onPick(favorite.config)` (FavoriteModels.tsx:130). Hand-built container and fake repo (lines 37-97).                                                                                                                                                                                                                                                         |
| `features/composer/ModeChips.test.tsx`                       | REAL    | Real container, real chat via `sessions.create`, real dispatcher for Shift+Tab. Only the two service writes are spied. Plan on/off, auto-accept on/off with rollback on failure, hidden for Codex all assert.                                                                                                                                                                                                                   |
| `features/composer/ModelPicker.test.tsx`                     | WEAK    | Everything hand-built (lines 77-200). Missed: delete the started-chat branch (ModelPicker.tsx:134-153), delete `disabled={!available}` (:351), change `modelsForPicker` (:81-94). All green.                                                                                                                                                                                                                                    |
| `features/composer/app-04.test.tsx`                          | WEAK    | Tests `ArchivedComposerBar`, which nothing renders. Mutation: remove the bar from the app, nothing changes and the test only fails because the file is gone.                                                                                                                                                                                                                                                                    |
| `features/composer/composer-editor.test.tsx`                 | REAL    | Real TipTap in jsdom, real key events through the real wrapper. Enter, Shift+Enter, Cmd+Enter, both modes, IME. One hole (M3).                                                                                                                                                                                                                                                                                                  |
| `features/composer/composer-shell.test.tsx`                  | WEAK    | Real Composer, TipTap, ComposerService and dispatcher, which is good. Missed: delete `editor.commands.setContent("")`, `setAttachments([])` or `focus()` after a send (Composer.tsx:168-173); flip `"cmd-enter"` to `false` (:107).                                                                                                                                                                                             |
| `features/composer/composer.test.tsx`                        | WEAK    | Exact duplicate of app-04.test.tsx:8-14, no feature id, no header. Adds no coverage.                                                                                                                                                                                                                                                                                                                                            |
| `features/composer/send-button.test.tsx`                     | REAL    | Labels, disabled, Stop only while working, send-mode shortcut, live rebind of the Stop shortcut. Hand-built container is a finding (M6) but the assertions bite.                                                                                                                                                                                                                                                                |
| `features/composer/send-key.test.ts`                         | REAL    | Pure function, every primary cell asserted. Null cells are LATER.                                                                                                                                                                                                                                                                                                                                                               |
| `features/composer/use-draft-sync.test.tsx`                  | WEAK    | Fake editor instead of TipTap (lines 58-106), six `setTimeout(0)` waits, no stale-load test. Missed: delete `if (cancelled) return;` (use-draft-sync.ts:108); delete the cleanup save (:95-98). Both stay green.                                                                                                                                                                                                                |
| `features/sidebar/AddProjectButton.test.tsx`                 | WEAK    | Remove the `createSingleFlight` guard (AddProjectButton.tsx:36): "ignores a second click" (test :89) still passes, because the busy `Button` is already `disabled` after the first click. No test for the progress state. Test :115 pins the absence of the PRJ-01 "Recents" item.                                                                                                                                              |
| `features/sidebar/GroupedWorkspaces.nav-03.test.tsx`         | WEAK    | Change `selected={selectedId === workspaceId}` (GroupedWorkspaces.tsx:135) to `false`: no test fails (row and menu are mocked, no route has a workspace id). Make `readView` ignore "created" (:60): no test fails. Delete the "Clear filter" button (:297-300): no test fails.                                                                                                                                                 |
| `features/sidebar/PinnedSection.nav-04.test.tsx`             | WEAK    | Tests :71-123 are real. The headline drop test (:54-69) passes only because the dropped workspace is already in the `workspaces` prop. The real drag from the main list cannot pin (C1).                                                                                                                                                                                                                                        |
| `features/sidebar/SectionDialog.nav-04.test.tsx`             | REAL    | Create, rename with emoji, Enter, disabled button and error under the field are driven by real events over `createTestContainer`. Gaps are LATER (Enter on an empty name, Escape, double submit).                                                                                                                                                                                                                               |
| `features/sidebar/SectionList.nav-04.test.tsx`               | WEAK    | Real DOM drag events, but "keeps the saved order" (:118) and "keeps the section" (:255) assert a store that the mocked action never touches, so they are always true. Change `onDropSection(true)` to `false` (SectionList.tsx:273): caught. Break `changeOpen` saving the collapsed state (:233-238): not caught.                                                                                                              |
| `features/sidebar/Sidebar.nav-03.test.tsx`                   | WEAK    | Delete the footer `AddProjectButton` block (Sidebar.tsx:50-52): no test fails (the mocked button is never asserted). Hooks and context are mocked wholesale, and only the empty state is rendered.                                                                                                                                                                                                                              |
| `features/sidebar/SidebarNav.nav-03.test.tsx`                | WEAK    | Hard-code "⌘N", "⌘K", "⌘⇧H" in the rows instead of `useLiveShortcut`: passes, because the mock returns the default shortcuts. Delete `activeProps` (SidebarNav.tsx:58,68,77): passes, no test renders a non-root path.                                                                                                                                                                                                          |
| `features/sidebar/UnreadDot.nav-11.test.tsx`                 | REAL    | Both branches, exact role and name. Return `null` always or never: each fails a test.                                                                                                                                                                                                                                                                                                                                           |
| `features/sidebar/ViewOptionsMenu.nav-03.test.tsx`           | WEAK    | Flip the unchecked branch of `toggleRepo` (ViewOptionsMenu.tsx:50-55): no test unchecks a project. Replace `value={view.groupBy}` with a constant (:73): no test checks the marked choice. Test :46 asserts "Sort by" stays visible with manual order on, which is the opposite of Conductor (D020, C6).                                                                                                                        |
| `features/sidebar/WorkspaceRow.nav-03.test.tsx`              | WEAK    | Change `> 0` to `>= 0` or `.some` to `.every` (WorkspaceRow.tsx:84): passes, there is no "all read, no dot" case. Delete the status icon (:123): passes. Link `href` is never asserted. `core/hooks.ts` is mocked whole.                                                                                                                                                                                                        |
| `features/sidebar/WorkspaceRow.nav-11.test.tsx`              | WEAK    | Good: real container, real sessions service, real events. But it fires `keyDown` on the link itself (:85), which a real hover would not do (C5). Remove the `hovered` check or the modifier check (WorkspaceRow.tsx:112): passes.                                                                                                                                                                                               |
| `features/sidebar/app-04.test.tsx`                           | REAL    | Swap the two `kind` branches or drop the link/action: fails. The "Add a project" button text comes from the test's mock, but its presence still proves the `action` prop is wired.                                                                                                                                                                                                                                              |
| `features/sidebar/next-unread.test.ts`                       | WEAK    | Remove the sort on the unread group (next-unread.ts:101): "walks through" (:106-119) passes, because input order already equals time order. The archived check uses `state === "archived"` only (:83): `archiving` and `archivedAt` are untested.                                                                                                                                                                               |
| `features/sidebar/sidebar-view.nav-03.test.ts`               | WEAK    | Delete the whole sections block (sidebar-view.ts:180-193): passes, the helper types `sections` as `never[]` (test :70). Remove the id tie-break (:123): passes, all timestamps differ. Swap "in_review" and "in_progress" in `SIDEBAR_STATUS_ORDER`: passes, the test only uses 3 of 5 statuses.                                                                                                                                |
| `features/sidebar/sidebar.test.tsx`                          | WEAK    | Pass wrong props from `WorkspaceList` to `GroupedWorkspaces` (WorkspaceList.tsx:68): passes (it is mocked to `<p>grouped list</p>`). Break the workspace-side retry (:61): passes. Also duplicates UnreadDot and SidebarEmptyState tests. Retry and loading/error tests for projects are real.                                                                                                                                  |
| `features/sidebar/use-now.nav-03.test.tsx`                   | REAL    | Fake timers, interval advance and timer count after unmount. A changed interval or missing `clearInterval` fails. A changed `read` source restarting the timer is untested (LATER).                                                                                                                                                                                                                                             |
| `features/sidebar/use-workspace-drag.nav-04.test.ts`         | REAL    | Real hook, real `act`, real Escape key event, a late-answer test with two deferred promises. Reorder, pin, place, outside-drop and latest-wins each fail on the obvious mutation. Gaps are LATER (drop on the dragged row, style removed on unmount).                                                                                                                                                                           |
| `features/sidebar/use-workspaces.nav-03.test.tsx`            | WEAK    | Uses `{ services: { workspace: { store } } } as unknown as Container` (:48), against engineering.md. Remove the id tie-break (core/hooks/workspaces.ts) or stop subscribing to later store changes: passes. The hook lives in `core/hooks/`; the test sits in the sidebar folder.                                                                                                                                               |
| `features/workspace/ChatHistoryButton.test.tsx`              | WEAK    | Mocks `core/hooks.ts` and `core/context.tsx`. Deleting the `toastError` on a failed reopen (ChatHistoryButton.tsx:62-65) or the `newestFirst` sort (:33-37) stays green. No error state test, no test with many chats.                                                                                                                                                                                                          |
| `features/workspace/EmptyTabGroup.nav-10.test.tsx`           | REAL    | Uses the real `useNewTab`; the three buttons, the big-terminal preset and the port gate each fail if broken. Failure toast is untested here (counted once in M11).                                                                                                                                                                                                                                                              |
| `features/workspace/NewTabMenu.nav-10.test.tsx`              | WEAK    | The plain "New chat" item is never clicked, so changing `startChat(false)` to `startChat(true)` (NewTabMenu.tsx:52) stays green. Browser is only tested as disabled; at the limit only "Local terminal" is checked.                                                                                                                                                                                                             |
| `features/workspace/RenameDialog.nav-10.test.tsx`            | REAL    | Real Dialog, real Enter/Escape/Cmd+Enter events. Removing the single-flight, the select-on-open or the open-time reset each fails a test (:104, :88, :123, :139).                                                                                                                                                                                                                                                               |
| `features/workspace/SplitPanes.nav-10.test.tsx`              | WEAK    | TabStrip, TabContent and TabItem are mocked; `onSearchChange` is a throwaway `vi.fn()` (:109). Deleting `moveAwayFromActive(...)` (SplitPanes.tsx:165, :178) or `excludeRefs={hiddenRefs}` (:217) stays green.                                                                                                                                                                                                                  |
| `features/workspace/TabContent.nav-10.test.tsx`              | WEAK    | The PR test (:41-46) is satisfied by the "Pull request" label that NotBuiltYet prints for the PR-07 placeholder. Five of six tab kinds are never routed in any test; passing the wrong prop (`tab.path`, `tab.url`) stays green.                                                                                                                                                                                                |
| `features/workspace/TabContextMenu.test.tsx`                 | REAL    | Real ContextMenu opened with a contextMenu event; mark read/unread, rename, deep link, close and close others each fail if swapped or removed. Failure toasts untested (LATER).                                                                                                                                                                                                                                                 |
| `features/workspace/TabItem.nav-10.test.tsx`                 | REAL    | Middle click (real `auxclick`), close button name, selected state, unread dot, Enter/Space, key on the close button. Tab icons by type are untested (low value).                                                                                                                                                                                                                                                                |
| `features/workspace/TabStrip.nav-10.test.tsx`                | WEAK    | `go(-1)` changed to `go(1)` (TabStrip.tsx:303) stays green (:307-323). Last-tab close checks only that `onSearchChange` was called (:343). Shortcuts run through `registry.run`, never a key event.                                                                                                                                                                                                                             |
| `features/workspace/WorkspaceActionsMenu.nav-10.test.tsx`    | WEAK    | Pin is clicked, Unpin only has its label checked (:120-127), so `setPinned(workspaceId, !pinned)` changed to `true` (WorkspaceActionsMenu.tsx:111) stays green. Shortcut hints are mocked to null. Everything else is good, with real menu events and a real toast spy.                                                                                                                                                         |
| `features/workspace/WorkspaceGate.nav-10.test.tsx`           | REAL    | Archived, ready, not-found by error code, other error, unarchive. The not-found text comes from the component, not the test. Router test covers the real join (see M10). Loading state is only in workspace.test.tsx.                                                                                                                                                                                                           |
| `features/workspace/WorkspaceHeader.nav-10.test.tsx`         | WEAK    | `WorkspaceActionsMenu` is replaced by a stub that prints its own "Workspace actions" button (:60-62), then the test asserts that button (:100). Deleting the header's real button (WorkspaceHeader.tsx:154) stays green. `disabled={archived}` on the pencil (:148) is unchecked.                                                                                                                                               |
| `features/workspace/WorkspaceLayout.nav-10.test.tsx`         | WEAK    | The toggle test reads `data-right-panel-open`, which the component sets from its own state (WorkspaceLayout.tsx:55). Deleting `panel.collapse()` and `panel.expand()` (:51-54) stays green.                                                                                                                                                                                                                                     |
| `features/workspace/WorkspaceScreen.nav-10.test.tsx`         | WEAK    | All five children are mocked, WorkspaceGate as a pass-through. Dropping the `<WorkspaceGate>` wrapper (WorkspaceScreen.tsx:49), or passing the wrong `workspaceId` or `search`, stays green. Removing a whole region does fail.                                                                                                                                                                                                 |
| `features/workspace/WorkspaceStatusIcon.nav-03.test.tsx`     | WEAK    | `spinnerKind` (WorkspaceStatusIcon.tsx:20-25) changed to always return "working" stays green; the `data-kind` is never read. The success dot (:54-55) is untested. `.bg-accent` pins a class name.                                                                                                                                                                                                                              |
| `features/workspace/active-tab.test.ts`                      | WEAK    | No test resolves a session, comment or browser search to an ActiveTab; `case "browser"` returning `none` stays green. Test titled "round-trips" (:81) pins that `searchPatchFor` drops the file scope, mode and line.                                                                                                                                                                                                           |
| `features/workspace/status-text.test.ts`                     | REAL    | The table covers all 21 labels with words and tones. Lines :32-41 duplicate table rows (harmless).                                                                                                                                                                                                                                                                                                                              |
| `features/workspace/tab-layout.nav-10.test.ts`               | WEAK    | Nested splits (`insertBeside`, tab-layout.ts:254-282) are untested. Closing a non-active tab keeps the active one (tab-layout.ts:193): changing it to always pick a neighbour stays green. The sole tab of the main group never closes in a test.                                                                                                                                                                               |
| `features/workspace/useNewTab.nav-10.test.tsx`               | WEAK    | The single-flight test is real. The failure toasts and the "no tab opened" rule (useNewTab.tsx:70-73, :85-88) are asserted nowhere; `useSetting` returns `false` for every key.                                                                                                                                                                                                                                                 |
| `features/workspace/workspace-name.test.ts`                  | REAL    | All four fall-throughs and the blank-name rule. Deleting `.trim()` or reordering the chain fails.                                                                                                                                                                                                                                                                                                                               |
| `features/workspace/workspace-search.test.ts`                | REAL    | Unknown tab dropped, numeric path, line, PR number, scope codec round-trip for all five kinds and six bad strings. Gaps in `fileMode`, `fileView`, `commentId`, `browserUrl` parsing are minor (LATER). No feature id anywhere in the file.                                                                                                                                                                                     |
| `features/workspace/workspace.test.tsx`                      | WEAK    | Legacy file with no feature id. It repeats four WorkspaceGate tests, the layout slots and the status icon, and its not-found test asserts text the test supplied (:37-42). Two tests are unique and good: Gate loading (:31) and ArchivedNotice busy (:61).                                                                                                                                                                     |
| `features/scripts-panel/ScriptsPanel.run-01.test.tsx`        | THEATER | One test. It duplicates RunTab.run-01.test.tsx:82-110 (same store seeding, same Stop assertion). Mutation: `ScriptsPanel` reduced to `<RunTab/>`, or `fallback` forced to the Setup tab, or the `hidden` class removed. The test stays green because jsdom has no CSS, so a "hidden" Run tab is still found. Active tab, new/close terminal, limit, collapse, Ports are untested (ScriptsPanel.tsx:65-111, 134-158).            |
| `features/scripts-panel/ScriptsPanelTabs.run-01.test.tsx`    | WEAK    | Limit, select, middle click, Ports, collapse callbacks are checked. Mutation missed: remove `onClick={onNewTerminal}` (line 110); change `StatusDot` tone mapping (lines 97-99). Status dots are a header "Must handle" with no test.                                                                                                                                                                                           |
| `features/scripts-panel/run/ActionIconPicker.test.tsx`       | WEAK    | Search, empty text and pressed mark are real. Mutation missed: delete the `?? iconsByName.get(DEFAULT_ICON)` fallback or the `console.error` in `ActionIcon` (ActionIconPicker.tsx:62-66). Header says an unknown stored icon is handled.                                                                                                                                                                                       |
| `features/scripts-panel/run/AddActionDialog.test.tsx`        | WEAK    | Clash, trimmed save, failed save, disabled Save are real. Mutation missed: drop `&& !(draft.id !== null && existing === draft.id)` (AddActionDialog.tsx:87) so editing an action clashes with itself. Also missed: delete `finally { setSaving(false) }`, the thrown-error branch (109-111), reset on close (120-125), a second click while saving.                                                                             |
| `features/scripts-panel/run/RunEmptyState.run-01.test.tsx`   | WEAK    | Add action, manual, configure and disabled agent are real. Mutation missed: `onClick={onAskAgent}` swapped for `onConfigure` (RunEmptyState.tsx:32). The enabled Ask agent button is never clicked.                                                                                                                                                                                                                             |
| `features/scripts-panel/run/RunTab.run-01.test.tsx`          | WEAK    | Run label, Stop label (via a hand-set store), Cmd+R start through the real dispatcher, empty state. Mutations missed: `hasRunBefore` forced false (RunTab.tsx:72, no "again" test), `toastError` on a failed start (111), `isSpotlight` (70), archived/loading/error returns (121-141), "Waiting for setup" text (173), stop on second Cmd+R.                                                                                   |
| `features/scripts-panel/run/RunToolbar.run-01.test.tsx`      | WEAK    | Open button, disabled reason, select shown for many, button click. Mutation missed: `onValueChange={onSelectAction}` removed (RunToolbar.tsx:43). Choosing another action is untested here and in RunTab.                                                                                                                                                                                                                       |
| `features/scripts-panel/run/run-button-label.run-01.test.ts` | REAL    | Every phase and the empty label are asserted with exact objects. A flipped `disabled` or `click` fails.                                                                                                                                                                                                                                                                                                                         |
| `features/scripts-panel/setup/SetupEmptyState.test.tsx`      | REAL    | Both buttons with separate spies, disabled agent, hidden when a script exists. Swapped handlers fail.                                                                                                                                                                                                                                                                                                                           |
| `features/scripts-panel/setup/SetupStatusBar.test.tsx`       | WEAK    | Stop, Run again, exit code, interrupted text, busy on Run again. Mutations missed: drop the `!canAskAgent` term of the disabled condition (SetupStatusBar.tsx:75), drop `disabled={busy}` on Stop (67), `onAskAgentToFix` swapped with `onRunAgain` (the fix button is only checked for presence, line 45).                                                                                                                     |
| `features/scripts-panel/setup/SetupTab.test.tsx`             | WEAK    | 14 real checks of prompts and toasts, but hooks, context, router, Toast and TerminalView are all `vi.mock`ed (lines 26-57) and the data comes from test-held variables. Mutations missed: delete `setBusy(true)` (SetupTab.tsx:162); remove the `archived` guard (150); change the `navigate` target (248, the mock is never asserted); drop the `active` flag in the log effect (107-126).                                     |
| `features/scripts-panel/setup/setup-state.test.ts`           | REAL    | Table, actions and the expired-log rule are asserted. Small gap: a running script with `hasScript: false` (setup-state.ts:83-88) is untested.                                                                                                                                                                                                                                                                                   |
| `features/scripts-panel/terminals/TerminalTabBody.test.tsx`  | WEAK    | `nextTerminalAfterClose` is well tested. The wrapper test only checks that `visible` is passed through. Mutations missed: `onClose` not passed (TerminalTabBody.tsx:63), `focusOnMount={visible}` (61, which is a live bug, see C1), `aria-hidden`. The header's "closing selects the neighbour" is never exercised through ScriptsPanel.                                                                                       |
| `features/settings/agents/AgentCard.test.tsx`                | REAL    | Matrix of installed, signed in, missing, ACP name, API key, warning, long path, state words. Gaps are small (sign-in busy, unknown status, Copy).                                                                                                                                                                                                                                                                               |
| `features/settings/agents/AgentLoginDialog.test.tsx`         | WEAK    | Copy, open browser, auto-close on signed in, token command, paste code, Retry. Mutations missed: delete `if (finishing) return` (AgentLoginDialog.tsx:76, double click), delete `code.trim() === ""` guard (77), Cancel button (152), Enter key via `onConfirm` (88).                                                                                                                                                           |
| `features/settings/pages/AgentsPage.test.tsx`                | WEAK    | Good regressions (no cancel after finish, Codex toast, retry cancels first). Hooks and Toast are `vi.mock`ed and the store refresh is faked by editing `state.installs` (lines 142-150, 189-197). Mutations missed: delete `cancelLogin` in `closeLogin` (AgentsPage.tsx:180), failed `login` start (107-117), non-`signed_in` outcome (152-162), Cursor auto-finish (134-136), loading/error view.                             |
| `features/settings/repo/ActionList.test.tsx`                 | WEAK    | Visibility rules are real. Mutation missed: `onDelete`/`onSetDefault`/`onReset` swapped or unwired (ActionList.tsx:76-93). Delete and Make default are never clicked in any test.                                                                                                                                                                                                                                               |
| `features/settings/repo/FilesToCopyField.test.tsx`           | WEAK    | `../secret`, add, detecting, 50 limit, worktreeinclude. Mutation missed: delete the absolute-path and `~/` refusals (FilesToCopyField.tsx:24), Enter key add (77-81), duplicate (49-52).                                                                                                                                                                                                                                        |
| `features/settings/repo/RemoveRepoDialog.test.tsx`           | WEAK    | Count, plural, failed removal, running agents. Mutation missed: delete `if (busy) return` (RemoveRepoDialog.tsx:40), the `catch` (47-48), Cancel and Escape.                                                                                                                                                                                                                                                                    |
| `features/settings/repo/RepoActionsPage.test.tsx`            | WEAK    | Real container, real hide-for-this-user path, personal-layer edit. Writes are `mockResolvedValue`d (lines 51, 83, 101, 123, 148), so nothing persists and "leaves the shared file alone" (116-118) is trivially true. Mutations missed: `setDefault` not demoting others (RepoActionsPage.tsx:168-180), `remove` (160-166), Spotlight switch (191-194), save failure (70-74), hidden-read failure (59-66).                      |
| `features/settings/repo/RepoMiscPage.test.tsx`               | WEAK    | Real container, args checked. All writes mocked (68, 100, 117, 133, 151, 164). Store seeded by `setState` (52-55), not by loading. Mutation missed: remove the `repoId` filter on the workspace count (RepoMiscPage.tsx:110-113); only one repo is seeded. No failure test.                                                                                                                                                     |
| `features/settings/repo/RepoPromptsPage.test.tsx`            | WEAK    | null-not-empty, keep other fields, reset, long warning. Mutation missed: delete the error branch (RepoPromptsPage.tsx:123-127). Header says a failed save keeps the text and shows the failure; no test.                                                                                                                                                                                                                        |
| `features/settings/repo/RepoScriptsPage.test.tsx`            | WEAK    | Best of the pages: has a failed-save test (110-125). Mutation missed: `setRunMode` unwired (RepoScriptsPage.tsx:101-112, 193), "Try again" (127-130, 223). Write is mocked.                                                                                                                                                                                                                                                     |
| `features/terminal/TerminalEndedBanner.test.tsx`             | REAL    | Code, zero, unknown, limit, no limit text, restart. Disabled state and handlers asserted.                                                                                                                                                                                                                                                                                                                                       |
| `features/terminal/TerminalFindBar.test.tsx`                 | WEAK    | The pure search is thoroughly tested (wrap, previous, case, regex, errors). Mutations missed: swap the Next/Previous/Close icon buttons (TerminalFindBar.tsx:219-231; never clicked); wide characters (see C5). The fake buffer (lines 19-27) cannot show a wide cell.                                                                                                                                                          |
| `features/terminal/TerminalSurface.test.tsx`                 | WEAK    | xterm and the fit addon are fully faked (lines 14-66). Mutations missed: delete the `pending.push` branch (TerminalSurface.tsx:198-201); write constant text instead of `data` (184); `if (endedRef.current) return` (183); `disableStdin = ended` (172, 292); fit debounce (255-273); link `activate` Cmd-click (217-220); `output()` unsubscribe (279). See C2, C3.                                                           |
| `features/terminal/TerminalView.test.tsx`                    | WEAK    | Ended banner, restart, link confirm, copy, Cmd+F/W/T, settings to appearance, buffering are real. TerminalSurface is `vi.mock`ed (43-74) and `find` always returns null (30). Mutations missed: `search("next", null)` instead of `matchRef.current` (TerminalView.tsx:394); delete `surfaceRef.current?.focus()` (322); `ended={false}` passed to the surface (371). See C3, C4.                                               |
| `features/terminal/terminal-theme.test.ts`                   | REAL    | Token mapping, missing tokens named, fallback list, size, bytes to lines.                                                                                                                                                                                                                                                                                                                                                       |
| `features/diff/DiffToolbar.test.tsx`                         | WEAK    | Split, entire file, wrap lines, unique ids, narrow width. Mutations missed: Hide whitespace checkbox wired to the wrong key (DiffToolbar.tsx:87); Unified button (45); disabled checkboxes (the binary test at 62-67 only sees the four visible buttons, the popover is closed).                                                                                                                                                |
| `features/diff/DiffView.renderer.test.tsx`                   | REAL    | Uses the real renderer: split, wrap and no-ligatures reach the drawn shadow DOM. Note: the third test calls `parseDiffFromFile` directly, so it proves the library honours `ignoreWhitespace`, not that `DiffView` passes it on.                                                                                                                                                                                                |
| `features/diff/DiffView.test.tsx`                            | WEAK    | Warnings, force render, dismissal, error card and Retry, patch, added file. Paired with the real-renderer file, so the stand-in is acceptable. Mutations missed: deleted file branch (DiffView.tsx:146-153), `resetKey` made constant so a dismissed warning never returns (89-91, 117), `focusCommentId` scroll (96-100), `updating` with empty texts (131-132).                                                               |
| `features/diff/DiffWarnings.test.tsx`                        | REAL    | Each kind, its action and dismiss are asserted; "updating" has no buttons.                                                                                                                                                                                                                                                                                                                                                      |
| `features/diff/diff-options.test.ts`                         | REAL    | Layout, wrap, entire file, whitespace, theme fallback, ligatures. Small gap: `themeType` is never asserted (diff-options.ts:41).                                                                                                                                                                                                                                                                                                |
| `features/git-panel/git-panel.git-05.test.tsx`               | REAL    | Real container, real `useActions`; fails if the `commit_and_push` case in `GitPanel.tsx:164` is swapped or the `git.commitAndPush` handler (`:210`) is removed. Misses: double shortcut press, error toast.                                                                                                                                                                                                                     |
| `features/git-panel/git-panel.pr-02.test.tsx`                | WEAK    | Mocks all of `core/hooks.ts` and `core/context.tsx` with a hand-built `useServices` (`:29-44`); `actions.pullRequests.create` to `services.github.create` is never joined. Header is a constant mock. Mutation missed: `actions.ts:128` pointing at another service method.                                                                                                                                                     |
| `features/git-panel/git-panel.tabs.test.tsx`                 | WEAK    | `:74` expects "Not built yet: GIT-04" but `core/status/git-header.ts` is now built, so it reads as failing. Tests placeholders (`NotBuiltYet`). Workspace-switch test (`:96-116`) never opens the prompt, so removing the `currentWorkspace.current === workspaceId` guard (`GitPanel.tsx:230`) is not caught.                                                                                                                  |
| `features/git-panel/rev-01-panel.test.tsx`                   | WEAK    | Header mocked (`:39-66`); test `:106` asserts text the mock returns (theater). Good: single review (`:130`), add_comments dropped (`:123`), Cmd+Alt+U (`:146`). Mutation missed: wrong `agentWorking` or `forge` input to `computeGitHeader`.                                                                                                                                                                                   |
| `features/git-panel/rev-01.test.tsx`                         | REAL    | Real `GitHeader`, `GitPanelTabs`, `ReviewButton`, dialog. Double click, failed action reset, rebind hint (via real registry), 99+ cap all fail if broken. Gaps are in LATER.                                                                                                                                                                                                                                                    |
| `features/git-panel/changes/app-04.test.tsx`                 | REAL    | Four of five `ChangesEmpty` reasons with text and the Clear filter click. The fifth (`no_git_status`) is covered in rev-01-hooked.                                                                                                                                                                                                                                                                                              |
| `features/git-panel/changes/rev-01-components.test.tsx`      | REAL    | 5,000-file window, 50-key scroll, discard confirm, branch picker error, filter Escape: each fails if broken. Small gaps in LATER.                                                                                                                                                                                                                                                                                               |
| `features/git-panel/changes/rev-01-hooked.test.tsx`          | WEAK    | Hooks fully mocked by hand. `discardFile` and `setViewed` are configured (`:18-19,33`) but never asserted. `ChangesTab.tsx:126-128` (no files match) has no test. DiffScope placeholder test (`:194-208`).                                                                                                                                                                                                                      |
| `features/git-panel/changes/rev-01-tree.test.ts`             | WEAK    | Pure and good, except `:32` "conflicted first": `a.ts` is both conflicted and alphabetically first, so deleting `changed-file-tree.ts:59` is not caught.                                                                                                                                                                                                                                                                        |
| `features/home/HomeEmptyState.test.tsx`                      | REAL    | All four prop combinations; swapping the archived and no-match titles fails.                                                                                                                                                                                                                                                                                                                                                    |
| `features/home/HomeFilters.test.tsx`                         | WEAK    | Debounce, Escape, toggle, sort, display covered. Header "Must handle" items untested: dropping a removed repo (`HomeFilters.tsx:76-82`) and replacing the box on outside change (`:64-66`). Delete either effect and nothing fails.                                                                                                                                                                                             |
| `features/home/HomeScreen.test.tsx`                          | REAL    | Real container, store, router. Loading, error and Retry, 50 then 60, pinned group, archived filter, no match and Clear. Gaps in LATER (size 60 only, sort/project/Display not driven at screen level).                                                                                                                                                                                                                          |
| `features/home/WorkspaceCard.test.tsx`                       | WEAK    | Link, archived, unarchive args, Finder and copy, repository field covered. Not asserted: branch, status line, last-active time (`:134-142`), error toasts, busy state. Unarchive spied, hiding a placeholder (see C).                                                                                                                                                                                                           |
| `features/home/home-query.test.ts`                           | WEAK    | `:83-94` and `:110-117` read as failing (see C). "Stable tie-break" (`:178`) has no ties. PR title search untested.                                                                                                                                                                                                                                                                                                             |
| `features/onboarding/AgentStep.test.tsx`                     | WEAK    | `refresh` spied, installs injected with `setInstalls`. Real detection pipeline not exercised. Sign-in finish, cancel, Codex/Cursor auto-finish, open browser, copy, paste-code all untested. Good: Ready vs Not installed (`:32`), newest start wins (`:98`).                                                                                                                                                                   |
| `features/onboarding/OnboardingScreen.test.tsx`              | REAL    | Real settings write is read back (`:101`), error toast, stays put, skips when finished, Enter and ArrowDown wrap through real window key events. Gaps in LATER.                                                                                                                                                                                                                                                                 |
| `features/onboarding/ProjectStep.test.tsx`                   | REAL    | Dialog answer drives `addLocal` argument, cancel, error stays, skip. Gaps in LATER (vacuous negative `waitFor` at `:61`).                                                                                                                                                                                                                                                                                                       |
| `features/pr/app-04.test.tsx`                                | REAL    | Covers all six `PrEmptyKind` branches with heading or action. Component has no live importer.                                                                                                                                                                                                                                                                                                                                   |
| `features/file-viewer/app-04.test.tsx`                       | WEAK    | Only 4 of 6 kinds. Delete the `binary` or `missing` branch in `FileTabState.tsx:69-86` and nothing fails. Loading check is `aria-hidden` count > 0 (`:19`).                                                                                                                                                                                                                                                                     |
| `features/dashboard/kanban.test.ts`                          | WEAK    | Constants only. `groupByKanbanStatus` is `notImplemented("NAV-06")` (`kanban.ts:27`). `:18` compares a set built from the keys with the keys (always equal). 2 of 5 labels checked.                                                                                                                                                                                                                                             |

---

## 5. Checklist map gaps

"No test" means no test fails without the item. "Passes without" means a test exists and stays green when the item is removed. Rows marked `done` in `docs/plans/backlog.md` with gaps: NAV-01, NAV-02, NAV-03, NAV-10, NAV-14, APP-01, APP-04, APP-05, CHAT-01, CHAT-06, PRJ-01, REV-01, PR-02, SET-03, WS-03, REV-02, RUN-06. Rows still `stub` whose code and tests exist (flip them only after the gaps close): NAV-04, NAV-11, NAV-15, CHAT-09, CHAT-11, CHAT-27, COMP-03, GIT-04, GIT-16, NAV-05, REV-09, RUN-01, SET-07, APP-14.

### 5.1 App shell, routing, startup (`app/`, `main.app-01`)

Mapping for items with a test. "none" means no test fails without the item.

NAV-01 (#109, backlog `done`)

- Toggle left sidebar button: AppShell.test.tsx:113 (saves state) and ShellControls.test.tsx:15 (label). Panel collapse itself: test would pass without it (C12).
- Title bar clearance and drag region: ShellControls.test.tsx:27 (class pinned), FullPage.test.tsx:8.
- Header areas of every screen are drag regions: none in scope.
- Left sidebar resizable, collapsible, width remembered, min and max: clamp in layout-persistence.test.ts:123; launch restore: none (C1); drag resize: none; min and max passed to the panel: none.
- Centre panel minimum width: none.
- Sidebar width written to saved layout: layout-persistence.test.ts:98; the drag path (`onLayoutChanged` → `persistSidebar`): none.
- Right-panel layout saved per workspace and under a group id with the workspace id: storage functions tested (layout-persistence.test.ts:24); the workspace layout that calls them is out of scope.
- Cmd+A: AppShell.test.tsx:138 (real).
- Toast host knows the open workspace: AppShell.test.tsx:90, :122 (real).
- Settings left_panel_visible, left_panel_width: AppShell.test.tsx:59 (initial visible only), layout-persistence.test.ts.

NAV-02 (#110, `done`)

- Go back and Go forward buttons: none that click (C11).
- "/" restores the last route and skips archived: router.nav-02.test.tsx:126, :140.
- URL state: tab, chat id: nav-02 :208, :158; terminal id: none; pr: :233; file, line, comment, browser url: nav-02 :158 covers path and gitTab only (parsing lives in workspace-search tests, out of scope).
- With no search set, restore the last active search: nav-02 :208 (reads `activeSessionId` from the fixture).
- Route repair, deleted or archived workspace or chat: nav-02 :176, :187, :196. The first-frame empty-list rule (`sawWorkspace`, router.tsx:213-224): only the "missing" case in router.test.tsx:142 guards it; a workspace that disappears while open: none.
- Cmd+[ and Cmd+]: nav-02 :257 (Cmd+[ only).
- Active chat tab stored and restored after restart: write is a spy (nav-02 :230, mocked at shell-test-support.ts:138); round trip through the database: none.
- Route tree and repo settings routes: router.test.tsx:154-176; repo settings: test would pass without the `page` mapping (L6).
- Session and workspace visibility stores, view history persistence (moved items): none in scope.
- "Phase 4 mounts the router with redirects": main.app-01.test.tsx would pass without the router (C2).

NAV-14 (#122, `done`)

- Subscribe to menu and deep-link events and run the command: hooks.test.tsx:164, :312, :330 (with `commands.run` mocked).
- Mounted at the app root: nav-02 :257 (real). Sidebar switch keys reaching their handlers: none (C5).
- Key listener by scope (chat input, terminal, diff, dialog): pure in command-dispatcher.test.ts:270-316; through real key events only global and textarea cases (hooks.test.tsx:211, :250); overlay open → palette scope (command-dispatcher.ts:595): none.
- Priorities: command-dispatcher.test.ts:126, hooks.test.tsx:400. Hints follow rebinds: hooks.test.tsx:375. Accelerators update on rebind: hooks.test.tsx:144. Send-key swap in menus: pure only (command-dispatcher.test.ts:256); in the hook: none (C6).
- One registry feeds menus, palette and shortcut dialog: test would pass without it (C14).

APP-01 (#228, `done`)

- Query client defaults and mutation redaction: providers.app-01.test.tsx:52, :80, :100.
- React root error handlers write to the log: handlers tested pure (providers :112); wiring in `startApp` (main.tsx:211): none.
- console.error forwarded, unhandled rejection, drag-drop: startup.app-01.test.ts:199-239; that `startApp` installs them by default: none.
- Database newer than app blocks: startup.app-01.test.ts:46. Gate errors: none (C7).
- Services start in order and once: covered in core (`core/container.app-01.test.ts:178-259`), not in scope.
- "Render CommandDispatcher ... with onDeepLink calling openWorkspaceLink" (item moved from NAV-14): the dispatcher is mounted in `RootLayout` (router.tsx:142), not main.tsx, and gets no `onDeepLink`; no test. A `conducted://workspace` deep link event reaches `commandForDeepLink` and logs "No command handles the deep link" (command-dispatcher.ts:634-637).
- "Registry created in createContainer, not module-level" (moved from NAV-14): `defaultRegistry` is still module-level (command-dispatcher.ts:448); no guard.
- "Pass createPlaceNames() instead of the list in main.tsx": main.tsx:33-70 still has its own list; the test container uses a third one. Real names untested.
- "Clicking a notification opens the right workspace": `openWorkspaceLink` (main.tsx:128-152) has no test; container tests cover only that the opener is called.
- Toast events reach the toaster: providers.app-01.test.tsx:32 (calls `toast.success` directly, not a service toast).

APP-04 (#231, `done`) in scope

- Landing page, Not Found, route error screen, Try again: app-04.test.tsx; Not Found through the router: router.test.tsx:178. The root `errorComponent` (router.tsx:180-187) with a throwing route outside any boundary: none.

GIT-16 (#192, open; backlog row `stub` while the code and test exist)

- Detect and explain, toast text, "Run for me" runs the command in a terminal: git-16.test.tsx:15 (real). "For 15 seconds": none. Fix fails: none. Probe cannot run: git-16.test.tsx:85. Accepted licence: :60, racy (C10).

NAV-15 (#123, open, `stub`): see C8. All four items lack an integration test; the component rules (stay mounted, placed over the anchor, hidden without unmount, dispose on close) are tested in isolation.

WS-01 page items (#98)

- Failed state with Retry setup and Recover prompt: CreateWorkspacePage.test.tsx:180. "Toast 'Creating workspace…' and the failure toast": none. Repo picker with states: loading, error and empty: none; picking a second repo: none. Section picker: none. Model picker and plan mode: model default tested (:205), plan mode and typed model: none. Create button: :146. Cmd+N and Tab between fields: none. Entry points: none.

DATA-01 (#84) query items

- Shared preset retries only on non-4xx, 30 s stale time: query-options.test.ts:30-48 (real). "Query cache is not persisted": test would pass without it (C13). Default gcTime: query-options.test.ts:23.

Backlog `done` rows with unchecked items: NAV-01 (centre minimum width, collapse, launch restore), NAV-02 (Go back and forward buttons, persisted active chat, repo settings page prop), NAV-14 (scope wiring, one registry), APP-01 (root error handlers wiring, deep link wiring, notification click, place names, module-level registry), APP-04 (root error component).

### 5.2 UI primitives (`ui/`)

Items not named here have a test that would fail without them (listed in the map after the gaps).

| Feature | Item                                                                  | Gap                                                                                                                                                                                                                                                                    |
| ------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| APP-05  | Button variants and sizes                                             | Sizes: no test (M6). Variants: tests compare to the source map, so changing a class in `buttonVariantClass` is green (app-05.test.tsx:51).                                                                                                                             |
| APP-05  | Menus ... close on scroll                                             | Test passes with `capture` removed (M4).                                                                                                                                                                                                                               |
| APP-05  | Digits 1 to 9 pick a menu item                                        | Disabled skip and modifier guard: test would pass without them (M5).                                                                                                                                                                                                   |
| APP-05  | Dialog, tooltip, popover, hover card, context menu                    | Tooltip shortcut and IconButton tooltip: no test (M6). Hover card pointer open: no test. Dialog overlay click and focus trap: no test (L9).                                                                                                                            |
| APP-05  | Icon set: more icons for status, git, tool cards                      | Test would pass with one icon per family (app-05.test.tsx:291-295).                                                                                                                                                                                                    |
| APP-05  | Show an error toast from a service                                    | Only the helper is tested (app-05-toast.test.tsx:57-67). No service in scope calls it; feature tests elsewhere (features/settings/pages/AgentsPage.test.tsx, features/sidebar/AddProjectButton.test.tsx) mention `toastError`; I did not verify they assert the toast. |
| APP-05  | Surface, text, border, focus and danger tokens, single accent         | Contrast is real. "Single accent" has no test.                                                                                                                                                                                                                         |
| APP-05  | Loading indicator kinds                                               | Shapes are tested. Visible spinner inside a loading Button is not (M7).                                                                                                                                                                                                |
| APP-04  | Empty state has a tone and an optional icon                           | Tone is a `data-tone` echo; colour classes (EmptyState.tsx:48, :52) not tested.                                                                                                                                                                                        |
| APP-04  | Shared empty-state layout                                             | `aria-label` landmark (EmptyState.tsx:40) not tested; tests find the heading, which exists without it.                                                                                                                                                                 |
| APP-04  | Skeleton blocks and status role with aria labels                      | Skeleton `aria-hidden` real; wrapper status real (states.test.tsx:188-200). Reduced-motion pulse not tested.                                                                                                                                                           |
| APP-04  | Route error, not-found, sidebar empties, archived bar, repos, landing | Outside this scope (app/ and features/).                                                                                                                                                                                                                               |
| APP-12  | Checkbox                                                              | Label click and indeterminate are tested. Space key: no test.                                                                                                                                                                                                          |
| APP-12  | Input, Textarea, Label sized to their input with visible focus        | Label naming, error link real. Width and focus edge are class echoes (app-12.test.tsx:172-190). Visible focus ring is CSS; no test.                                                                                                                                    |
| APP-13  | One copy button with a short "Copied" state                           | Main flow and both failures real. Restart and unmount: no test (L4).                                                                                                                                                                                                   |
| APP-13  | Truncated text with middle truncation and copy                        | Main flow real. Edges: no test (L5).                                                                                                                                                                                                                                   |
| APP-14  | Link style in Markdown and PR text                                    | Only the `link` colour pair is measured (app-14.test.tsx:227). No test that Markdown or PR text uses it.                                                                                                                                                               |
| APP-14  | Sixteen terminal colours with AA checks                               | Checked at 3:1, not 4.5:1 (M8).                                                                                                                                                                                                                                        |
| APP-14  | Colour-vision variants                                                | Literal hex pins plus contrast. Distinguishability: test would pass without it (M8).                                                                                                                                                                                   |
| APP-14  | Translucent sidebar surface                                           | Literal hexes and a regex only (M8).                                                                                                                                                                                                                                   |
| APP-14  | Contrast guard checks every theme combination                         | The matrix covers all nine combinations. The only self-check is the ratio formula (`:328-331`); no failing sample proves the matrix can fail.                                                                                                                          |
| NAV-01  | Left sidebar min and max; centre minimum width                        | Constants only (M1).                                                                                                                                                                                                                                                   |
| NAV-01  | Right-panel layout saved per workspace                                | Save is real (resizable.test.tsx:90-117); restore not applied-checked (M3).                                                                                                                                                                                            |
| NAV-01  | Title bar row with traffic-light clearance                            | M2.                                                                                                                                                                                                                                                                    |
| NAV-01  | Other items (Cmd+A, ShellControls, persistence store)                 | Live in app/; outside this scope.                                                                                                                                                                                                                                      |

Items that do have a failing test (for the record):

- APP-05 Dropdown checkbox and radio: app-05.test.tsx:56-95.
- APP-05 One toast area, workspace-scoped toast, success/error/warning: app-05-toast.test.tsx:28-40, :69-121, :43-55.
- APP-05 Cmd+Enter: app-05.test.tsx:211-223, app-05-look.test.tsx:109-138.
- APP-05 Fonts: tokens.test.ts:178-189.
- APP-04 LoadableView: states.test.tsx:170-220.
- APP-12 Slider, Switch, Select, Input label: app-12.test.tsx:12-127, :222-277, :163-206.
- APP-13 Toggle, ToggleGroup, AlertDialog, Card, Separator, Collapsible, Table, Alert, HighlightedText: app-13.test.tsx:30-93, :139-308, :310-407.
- APP-14 theme attributes, low-contrast values, search-highlight AA: app-14.test.tsx:30-107, :294-310, :226.

Backlog rows marked `done` whose checklist lacks a failing test: APP-05 (sizes, digit edges, close-on-scroll capture, icon families), APP-04 (tone effect), NAV-01 (sizes, inset seam, restore). APP-12 and APP-13 are `done` and every checklist item has a test. APP-14 is `stub` in `docs/plans/backlog.md` while its code and tests exist; D041 flips the row before the step's CI.

### 5.3 Chat top level (`features/chat/*.test`)

Items with a real failing test are left out. "partial" means the named piece is tested and the rest is not.

| Feature | Item                                                                                               | Result                                                                                                                                                                                                                                               |
| ------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CHAT-06 | Sticky 'Scroll to bottom' button                                                                   | partial. `ScrollToBottomButton.test.tsx:9-24` fails without the component. The wiring in `MessageList` has no test (M6).                                                                                                                             |
| CHAT-06 | Chat tab content: message list and composer                                                        | test would pass without it (`ChatPane.test.tsx`, M1)                                                                                                                                                                                                 |
| CHAT-06 | Message list: virtualised, history header and footer                                               | partial. Window size tested (`MessageList.test.tsx:170-180`); `HistoryHeader` and `ListFooter` (MessageList.tsx:55-61) have no test. Loading skeleton and error card of the list also none.                                                          |
| CHAT-06 | Add failedSends to ChatView, render 'Message not sent' with Retry and Discard (moved from CHAT-02) | test would pass without it (M3)                                                                                                                                                                                                                      |
| CHAT-06 | Register `chat.expandAllToolCalls` once at the list, honour rebinds (moved from CHAT-08)           | partial. `MessageList.test.tsx:219-243` fails if the handler is removed; no key event, no rebind (M14).                                                                                                                                              |
| CHAT-06 | Empty chat starters                                                                                | test pins a wrong label (M8)                                                                                                                                                                                                                         |
| CHAT-06 | Markdown 'Tufte' style also applies to assistant text                                              | test would pass without the style classes (attribute only, L10)                                                                                                                                                                                      |
| CHAT-06 | Strip a leading "absolutely right" phrase                                                          | partial. One phrase tested (`AssistantText.test.tsx:35-45`); "You are", "again", comma variants (AssistantText.tsx:42-43) none.                                                                                                                      |
| CHAT-06 | Callouts Note, Tip, Important, Warning, Caution                                                    | partial. Only Warning (`AssistantText.test.tsx:57-61`).                                                                                                                                                                                              |
| CHAT-06 | Images in assistant text                                                                           | partial. Local and remote tested (75-92); `data:image` allowed and `onError` fallback none.                                                                                                                                                          |
| CHAT-06 | Turn footer: Copy final message, Copy summary                                                      | covered (`TurnFooter.test.tsx:79-92`); empty-message disable none (L6)                                                                                                                                                                               |
| CHAT-06 | 'Sent via' / 'Sent from another session'                                                           | covered (`UserMessage.test.tsx:115-130`)                                                                                                                                                                                                             |
| CHAT-06 | Only the tail turn re-renders                                                                      | covered in the test's own terms (`MessageList.test.tsx:182-199`), but not through the real service (M2)                                                                                                                                              |
| NAV-11  | Cmd+Alt+L next chat needing attention                                                              | no test (M13)                                                                                                                                                                                                                                        |
| NAV-11  | Opening a workspace clears the unread dot, except chats waiting for the user                       | no test at the chat screen (M1); service test exists                                                                                                                                                                                                 |
| NAV-11  | 'Next unread' button in the chat                                                                   | covered (`NextUnreadButton.nav-11.test.tsx:72-120`)                                                                                                                                                                                                  |
| NAV-11  | Replace default shortcut text with live hints (moved from NAV-14)                                  | no test for this button's hint (M13)                                                                                                                                                                                                                 |
| CHAT-27 | 'Something went wrong, retrying n/m' with 'Retry now' and 'Retry in new chat'                      | partial. Attempt text and Retry now cancel-then-send are covered (`ChatBanner.chat-27.test.tsx:38-56`, `TurnItem.chat-27.test.tsx:98-113`, `MessageList.chat-27.test.tsx:76-85`). Retry in new chat result, failure and double click: no test (M15). |
| CHAT-09 | Collapsible 'Thinking' card                                                                        | covered (`ThinkingBlock.test.tsx:8-18`)                                                                                                                                                                                                              |
| CHAT-09 | 'No todos'                                                                                         | covered (`TodoList.test.tsx:31-35`, `TodoBlock.test.tsx:29-32`)                                                                                                                                                                                      |
| CHAT-09 | Todo card 'Todo started' / 'Todo completed'                                                        | outside this scope (`tools/cards/TodoCard.test.tsx:50-61`)                                                                                                                                                                                           |
| REV-09  | File-change summary with 'Open diff' under a turn                                                  | test would pass without it (M12)                                                                                                                                                                                                                     |
| REV-09  | Diff scope: per turn                                                                               | partial. `TurnChanges.test.tsx:93-100` hands the scope; no caller turns it into the Changes tab                                                                                                                                                      |

Done rows in `docs/plans/backlog.md` in this scope: CHAT-06 only. Its checklist items without a failing test are the failedSends rule, the Scroll to bottom wiring, chat tab content, and list loading and error. CHAT-09, CHAT-27, NAV-11 and REV-09 are `stub` here; when D041 marks them done, the gaps above are the ones to close first.

### 5.4 Interaction cards, tool cards, composer

Gaps first, then what is covered. "Passes without it" means the named test stays green when the item is removed.

#### Gaps

| Feature | Item                                                                                                  | Status                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| CHAT-10 | Question secret input (masked answer)                                                                 | passes without a real producer: tests feed `secret: true` by hand (M9)                   |
| CHAT-10 | Answers return as question / answer / (Skipped)                                                       | each half tested alone; no cross test (M8)                                               |
| CHAT-10 | One page per question with a header, options with descriptions                                        | no test for header, descriptions, page label                                             |
| CHAT-10 | Previous and next with arrow keys, Enter submits                                                      | tested with `fireEvent` on the fieldset; Enter on a button and IME have no test (M2, M3) |
| CHAT-10 | Local questions and approvals wait without a timeout                                                  | no test                                                                                  |
| CHAT-10 | Pending interactions per chat kept so the card shows                                                  | dock test mocks `useChat`; no test through the real store (M1)                           |
| CHAT-10 | Open questions survive a restart                                                                      | no test in scope                                                                         |
| CHAT-11 | Approval card shows the tool card or the decision reason                                              | reason and raw input tested; the tool card is not used and not tested                    |
| CHAT-11 | Secondary button "Yes for this session"                                                               | no code, no test                                                                         |
| CHAT-11 | Always allow "saves the permission for later chats"                                                   | card sends `always_allow`; persistence has no test in scope                              |
| CHAT-11 | Only one interaction per chat; a new message or cancel withdraws it                                   | no dock-level test (M1); the service has its own tests                                   |
| CHAT-11 | Codex requests show "timed out" after 300 seconds                                                     | past `expiresAt` only; `timedOut` prop and future timer: passes without it (L3)          |
| CHAT-11 | Keyboard shortcuts fire only with focus and never while typing                                        | typing guard tested for Enter only; Enter on a button not tested (M2)                    |
| CHAT-12 | All 18 items                                                                                          | placeholder; the only test asserts a sentinel (M13)                                      |
| CHAT-08 | Registry maps each tool name to a card                                                                | passes without it (M11)                                                                  |
| CHAT-08 | Garry mode setting                                                                                    | passes with a wrong key (M11)                                                            |
| CHAT-08 | Context7 and Linear MCP cards                                                                         | Linear name split only; Context7 no test                                                 |
| CHAT-08 | Card for Codex collaborating-agent tool calls                                                         | card is a placeholder; no test                                                           |
| CHAT-08 | Bash card "Formatted" toggle back                                                                     | no test (only Raw)                                                                       |
| CHAT-08 | Edit card "Edit" link                                                                                 | no test (only "Open in editor")                                                          |
| CHAT-09 | Collapsible Thinking card                                                                             | not in this scope                                                                        |
| COMP-01 | Send, Queue and Save button                                                                           | "Save edit" tested on SendButton; Composer cannot produce it, no test                    |
| COMP-01 | Send-key mode swaps the four Enter bindings                                                           | editor level tested; Composer level mapping passes without it (M4)                       |
| COMP-01 | Draft per chat kept across restarts                                                                   | covered, but stale-load race has no test (M12)                                           |
| COMP-01 | The bar has no importer / Couldn't send message / sendWithFromSetting / minimise / new-workspace form | open scaffold items, no test                                                             |
| COMP-02 | "Opens in new chat" with mid-chat switch warnings                                                     | no test (M5)                                                                             |
| COMP-02 | `visible_provider_models` decides which models show                                                   | no test (M5)                                                                             |
| COMP-02 | Agent submenu: agent not installed is disabled                                                        | no test (M5)                                                                             |
| COMP-02 | Agent submenu: OpenCode, Pi                                                                           | listing only; they are disabled in the fixture                                           |
| COMP-02 | Effort submenu shows each supported level                                                             | no test clicks a level directly                                                          |
| COMP-02 | Cmd+Ctrl+1 to 5 select favourite N                                                                    | only 1 (unavailable) and 2 tested                                                        |
| COMP-02 | Favourites: pick                                                                                      | no test (M7)                                                                             |
| COMP-03 | Composer chip calls setAutoApproveEdits, end to end                                                   | spy only; the checklist asks for a UI-to-sidecar test, none exists                       |
| APP-04  | Composer bar "This workspace is archived." with Unarchive                                             | tested on an unmounted component (M10)                                                   |

#### Covered (test that fails without it)

- CHAT-10: multi-select `QuestionCard.test.tsx:91`; Other and key 0 `:125`; arrow keys `:142`; number keys `:72`; Enter submits `:53`; Cancel agent `:193`; failed answer retry `:201`; failed cancel retry `:217`; preview when picked `:181`; history card answers, skipped, waiting, withdrawn `AskUserQuestionCard.test.tsx:41, :61, :89`.
- CHAT-11: Enter/Backspace `ToolApprovalCard.test.tsx:64, :77`; Cmd+Enter alternate `:90, :99`; titles `:110`; reason and input `:128`; Subagent badge `:135`; blocked path `:141`; suggested rules `:148`; deny message `:157`; typing guard `:174`; one answer for two clicks `:183`; retry `:203`; Codex grant, session grant, deny `PermissionGrantCard.test.tsx:57, :71, :85`; network note `:98`; MCP accept, number and boolean types, decline, cancel, unknown schema `McpFormCard.test.tsx:86, :106, :136, :148`.
- CHAT-09: `TodoCard.test.tsx:31, :50, :61, :72, :77`.
- CHAT-08: unknown falls back to generic `ToolCard.test.tsx:62`; boundary on throw and on placeholder `:79, :90`; frame behaviours `registry.test.tsx:57-98`; per-card renders `chat-08-cards.test.tsx:96-519`; progress update shows nothing `:257`.
- COMP-01: send button states and tooltips `send-button.test.tsx:44-107`; Enter/Shift+Enter/Cmd+Enter/IME in the editor `composer-editor.test.tsx:46-83`; Cmd+Enter opposite delivery `composer-shell.test.tsx:380, :390`; Cmd+L `:297`; Cmd+Shift+Backspace `:254`; MCP button wide and narrow `:264, :277`; draft restore `:308`; draft write failure `:366`; clear failure `:337`; send failure and cancelled send `:323, :353`.
- COMP-02: effort fallback and toast `ModelPicker.test.tsx:208, :221`; Cmd+/ `:337`; Cmd+Shift+E `:344`; Cmd+Shift+/ and rebind `:356, :368`; live shortcut label `:252`; No models found `:235, :277`; latest-wins on agent choice `:384`; sixth favourite refused `FavoriteModels.test.tsx:105`; reorder `:145`; remove `:160`.
- COMP-03: plan on and off, Shift+Tab, failed write, auto-accept toggle, tooltip, hidden for Codex `ModeChips.test.tsx:42-198`.

### 5.5 Sidebar

Test locations are in `features/sidebar/` unless said.

#### NAV-03 (#111, row `done`)

| Item                                                                       | Gap                                                                                                                                                                      |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Row badges 'Draft' and 'Archive workspace'                                 | no test, no code                                                                                                                                                         |
| Right-click on a row opens the workspace actions menu                      | no test, no code                                                                                                                                                         |
| Line counts (+/-) on the row                                               | no test, no code                                                                                                                                                         |
| Optional status matrix animation, and its experimental setting             | no test, no code                                                                                                                                                         |
| View options: sort by Updated or Created, hidden when manual order is on   | "hidden" has no test; test :46 asserts the opposite                                                                                                                      |
| Hover shortcut hint on each nav row, from the live binding                 | test would pass without it (SidebarNav hard-coded default)                                                                                                               |
| '+' create-workspace on each project header                                | href tested (GroupedWorkspaces test :191); the create page ignores `repo`                                                                                                |
| Main list grouped by status (five groups in order)                         | partial: 3 of 5 statuses; swapping in_review and in_progress passes                                                                                                      |
| Workspace row status icon (dot, typing, waiting, setting-up, alert, glyph) | dot tested; icon removed from the row passes (the "no live region" test :162 passes without an icon); icon kinds live in `workspace/WorkspaceStatusIcon.nav-03.test.tsx` |
| Row is a link to the workspace route, focus ring                           | link `href` never asserted; focus ring not asserted                                                                                                                      |
| Sidebar state: group by, sort by, repo filter                              | only the group write is tested (GroupedWorkspaces test :254); sort and filter writes: no test                                                                            |
| Cmd+Alt+ArrowUp/Down previous and next                                     | partial: only with no open workspace                                                                                                                                     |
| Archived workspaces are not listed                                         | `state: archived` tested; `archiving` and `archivedAt` rule: test would pass without it                                                                                  |
| Row subtitles (12 labels)                                                  | 'Need permission' and 'Working…' at the row; the rest in `workspace/status-text.test.ts` (out of scope)                                                                  |
| Cmd+1 to Cmd+9                                                             | handler tested, key press through the dispatcher: no test                                                                                                                |

#### NAV-04 (#112, row `stub`, code present)

| Item                                                                           | Gap                                                                                                               |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Drag a workspace into Pinned                                                   | test would pass with the feature broken (C1)                                                                      |
| Drag workspaces between sections                                               | no test (row-drop is a dead zone, C9)                                                                             |
| Reorder by drag when 'Arrange manually' is on                                  | tested inside one section only (SectionList test :296); the main list has no component                            |
| Keyboard alternative: 'Move to section' in the row menu                        | no test, no code                                                                                                  |
| 'New section...' (sidebar background menu and workspace menu)                  | no test                                                                                                           |
| Hide Sort by when manual order is on; honour saved order; grouping by sections | no test, no code                                                                                                  |
| Pin or unpin the hovered workspace (hover key P)                               | no test, no code                                                                                                  |
| While dragging: grabbing cursor and links ignore pointer events                | partial: style element appears and goes (hook test :120-127); the CSS content is not asserted                     |
| User sections with name, emoji, collapse and count                             | emoji, saved collapse and the collapsed count: no test                                                            |
| 'Pinned' collapsible with count                                                | tested (PinnedSection test :92)                                                                                   |
| 'Delete section' returns its workspaces to the main list                       | UI calls `remove` (test :127); the return-to-main rule belongs to `core/services/sections.test.ts` (out of scope) |
| Errors on move, reorder, delete                                                | tested, but with a vacuous "list stays" assertion (:118, :255)                                                    |

#### NAV-11 (#119, row `stub`, code present)

| Item                                                                  | Gap                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Unread dot on the row                                                 | dot appears: tested; no dot when all chats are read: no test        |
| Hover key R toggles read state                                        | tested on the element, not on a hover (C5)                          |
| Cmd+Alt+L next chat needing attention                                 | no test                                                             |
| 'Go to next unread' palette command                                   | no test                                                             |
| Opening a workspace clears the dots of its chats except waiting chats | no test, no code (`scaffold: missing`)                              |
| 'Next unread' button in the chat                                      | `chat/NextUnreadButton.nav-11.test.tsx` (out of scope): three tests |

#### PRJ-01 (#93, row `done`)

| Item                                            | Gap                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| Sidebar footer 'Add project...' button and menu | menu tested; footer mounting: no test                                    |
| 'Recents' group in the Add project menu         | no code; test :115 asserts it is absent                                  |
| Cmd+Alt+A 'Add repository'                      | handled in core (`command-runner.test.ts:149`); not in this folder       |
| Landing 'Open project' button                   | label only (AddProjectButton test :45); the landing page lives in `app/` |

#### APP-04 (#231, row `done`, sidebar part)

| Item                                       | Gap                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| Sidebar empty: no projects / no workspaces | tested (app-04.test.tsx, sidebar.test.tsx) with `AddProjectButton` mocked |
| Skeleton and status role                   | tested for the projects query; workspaces query: no test                  |
| Error with retry                           | projects tested; workspaces retry: no test                                |

### 5.6 Workspace and tab strip

Legend. "none" means no test; "pass without" means the quoted test stays green if the item is removed. Line numbers are test-file lines.

#### NAV-10 (#118, backlog.md:153 `done`)

| Item                                                             | Test that fails without it                                                                   | Gap                                                                                                                                                                   |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drag tabs between groups or to an edge, with a drag ghost        | SplitPanes :174-218 (four edges), :220 (move onto a split strip); TabStrip :282 (drag image) | Partial. Split pane's own drag source untested (TabItem mocked). A tab in a split pane cannot be dropped back on the main strip (G3). Drag type string unlinked (M4). |
| Target branch picker in the header                               | Header :176                                                                                  | Branch existence check not built (audit LATER).                                                                                                                       |
| Workspace name with 'Rename workspace'                           | Header :94, :166                                                                             | Archived disable: none (M6).                                                                                                                                          |
| Directory name chip copies folder path                           | Header :137                                                                                  | Copy failure toast: none.                                                                                                                                             |
| 'Toggle right sidebar' button                                    | Header :112                                                                                  | Real collapse: pass without (M7).                                                                                                                                     |
| Tab types with icon and close button; middle click closes        | TabItem :23, :33; TabStrip :196                                                              | Icon per type: none (low value).                                                                                                                                      |
| 'Rename workspace' and 'Rename chat' dialogs                     | RenameDialog (all 8), Header :166, TabContextMenu :104                                       | Rename-chat dialog's initial name: none (TabContextMenu.tsx:108).                                                                                                     |
| Right-click on a row opens Workspace actions menu                | none                                                                                         | Moved to NAV-03; not built. `ui.tsv` says covered.                                                                                                                    |
| Actions: Mark as read or unread                                  | ActionsMenu :139, :153                                                                       | Real service behind it is a NAV-11 placeholder (open).                                                                                                                |
| Actions: Pin or Unpin                                            | ActionsMenu :110                                                                             | Unpin click: none (M8).                                                                                                                                               |
| Actions: Set status                                              | ActionsMenu :167, :264                                                                       | Current-status check mark: none.                                                                                                                                      |
| Actions: Move to section and 'New section...'                    | ActionsMenu :181, :212                                                                       | "No sections yet": none.                                                                                                                                              |
| Actions: Rename                                                  | ActionsMenu :194                                                                             |                                                                                                                                                                       |
| Actions: Copy link (Cmd+Shift+C)                                 | ActionsMenu :227                                                                             | Shortcut hint: none (`useLiveShortcut` mocked to null).                                                                                                               |
| Actions: Archive (Cmd+Shift+A) or Unarchive                      | ActionsMenu :237, :249, :129                                                                 | Shortcut hint: none. `deleteBranch: false` is an invented default (audit LATER).                                                                                      |
| Branch menu: Copy (C), Rename (R)                                | Header :145, :153                                                                            | Rename disabled when archived or no branch: none.                                                                                                                     |
| 'Workspace actions' menu button                                  | none                                                                                         | Header :100 passes on the test's own stub (M6).                                                                                                                       |
| '+' menu: New chat, Browser, Local terminal                      | NewTabMenu :58 (terminal), :95 (browser disabled)                                            | "New chat" item: none. Browser open from the menu: none.                                                                                                              |
| '+' menu: New chat, same files                                   | NewTabMenu :102                                                                              | Hidden when there is no recent chat: none.                                                                                                                            |
| Terminal group: initialise saved terminal tabs                   | TabStrip :242 (retry calls `loadWorkspace`)                                                  | Service behaviour is out of scope.                                                                                                                                    |
| Right panel (about 35 percent, collapsible)                      | Layout :34                                                                                   | Sizes and collapse: none (M7).                                                                                                                                        |
| Right panel vertical group                                       | Layout :34                                                                                   | Sizes: none.                                                                                                                                                          |
| Breadcrumb: repo icon and name, branch                           | Header :94                                                                                   | Repo icon: none.                                                                                                                                                      |
| Chat tab: status icon, title, unread dot, fixed width            | TabStrip :260, TabItem :47                                                                   | Other statuses, fixed width: none.                                                                                                                                    |
| Terminal tabs 'Terminal N' with 'Close terminal N'               | TabStrip :196                                                                                | Numbering: pass without (M15).                                                                                                                                        |
| 'View chat history' button and tab menu mounting                 | TabStrip :206 (menu); none (button)                                                          | History button inside the strip: pass without (M14).                                                                                                                  |
| Cmd+T new chat handler                                           | TabStrip :325                                                                                | At the limit: none (M3).                                                                                                                                              |
| Composer minimises when a content tab is open                    | none                                                                                         | Not built (grep for composer in the folder is empty).                                                                                                                 |
| Open a centre terminal with the big-terminal preset              | EmptyTabGroup :64, NewTabMenu :72                                                            |                                                                                                                                                                       |
| Supply onNewTerminal from the tab strip                          | none                                                                                         | Not built (TabContent.tsx:89).                                                                                                                                        |
| Terminal action that calls composer.addText                      | none                                                                                         | Not built here.                                                                                                                                                       |
| Report the composer failure in the terminal UI                   | none                                                                                         | Not built here.                                                                                                                                                       |
| UI that opens terminals.openForRepo                              | none                                                                                         | Not built here.                                                                                                                                                       |
| Big-terminal preset flow with terminals.create({ command })      | EmptyTabGroup :64, NewTabMenu :72                                                            | Same as above.                                                                                                                                                        |
| Create terminals in the centre with the preset command           | same                                                                                         |                                                                                                                                                                       |
| Drag a terminal from the right panel into the centre             | none                                                                                         | Not built.                                                                                                                                                            |
| Persist closed tabs and a recent-workspace list                  | none                                                                                         | Not built (`useRef`, TabStrip.tsx:201).                                                                                                                               |
| PR and git buttons move into the header when the panel is closed | none                                                                                         | Not built (M13).                                                                                                                                                      |
| New tab buttons disable at the limit; Tab Freak raises it to 10  | TabStrip :213, :222, :232; NewTabMenu :85                                                    | New chat and Browser items individually: none.                                                                                                                        |
| Split panes with the 'Split tabs' setting                        | SplitPanes :167, :174                                                                        | Resize: not built, `sizes` is never read when rendering (G2).                                                                                                         |
| Experimental: Tab Freak Mode and Split tabs                      | TabStrip :222, SplitPanes :167                                                               | Registry entries live elsewhere.                                                                                                                                      |
| Previous and next tab                                            | TabStrip :307                                                                                | Direction flip: pass without (M1). Key bindings: none (M3).                                                                                                           |
| Cmd+W close tab                                                  | TabStrip :297                                                                                | Key press: none (M3).                                                                                                                                                 |
| Cmd+Shift+T reopen closed tab                                    | TabStrip :334                                                                                | Selection after reopen: pass without; failure paths: none.                                                                                                            |
| Cmd+D splits the tab                                             | SplitPanes :252, :262                                                                        | URL move: pass without (M4); setting off: none.                                                                                                                       |
| Workspace load states                                            | Gate :31, :44, :55; workspace.test :31 (loading)                                             | Retry: none (L2).                                                                                                                                                     |
| Error card 'This chat tab failed to render'                      | TabContent :67                                                                               |                                                                                                                                                                       |
| Error card 'Tabs failed to load' with Retry                      | TabStrip :242                                                                                | Retry failure toasts: none.                                                                                                                                           |
| Empty tab group with three buttons                               | TabContent :48; EmptyTabGroup (all 5)                                                        |                                                                                                                                                                       |
| The top tab bar state                                            | none                                                                                         | Not built.                                                                                                                                                            |
| File tab                                                         | TabStrip :348 (counted only); active-tab :12, :22                                            | Content routing: pass without (M5).                                                                                                                                   |
| Comment tab 'Comment by <author>'                                | TabStrip :269                                                                                | Fallbacks "You", agent, missing comment: none (M16).                                                                                                                  |
| PR tab 'PR #N'                                                   | none                                                                                         | M16.                                                                                                                                                                  |
| Browser tab labelled with the URL host                           | none                                                                                         | M16.                                                                                                                                                                  |
| Workspace route with tab strip, chat and panels                  | WorkspaceScreen :34 (mocks); app/router.test.tsx:132 (real, out of scope)                    | Wiring props: pass without.                                                                                                                                           |

#### CHAT-01 (#126, `done`), items in this folder

| Item                                                             | Test                                                | Gap                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------- |
| 'View chat history' button; Popover                              | ChatHistoryButton :80-129                           | Error state, sort, large list: none (L8, L9).                        |
| Chat history 'Loading chats' and 'No open chats' with 'New chat' | :80, :86, :131                                      |                                                                      |
| Chat tab menu: Mark as read or unread                            | TabContextMenu :93                                  | Failure toast: none (M11).                                           |
| Chat tab menu: Rename chat                                       | TabContextMenu :104                                 | Initial name: none.                                                  |
| Chat tab menu: Copy link                                         | :113                                                | Failure toast: none.                                                 |
| Chat tab menu: Close tab (Cmd+W) and Close others                | :121, :130; TabStrip :361, :372, :388               | Shortcut hint: none (mocked null).                                   |
| Use RenameDialog in TabContextMenu                               | TabContextMenu :104 (labels come from RenameDialog) | Done in source (TabContextMenu.tsx:104-110). Backlog item can close. |
| Cmd+T new chat tab                                               | TabStrip :325                                       | M3.                                                                  |
| A local workspace with no chat creates one automatically         | none in this folder                                 | Service-level.                                                       |

#### NAV-03 (#111, `done`), items in this folder

| Item                                                                                     | Test                         | Gap                                                                                        |
| ---------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| Workspace row status icon (unread dot, typing, waiting, setting-up, alert, branch glyph) | StatusIcon :8, :13, :21, :29 | Typing, waiting, setting-up kinds: pass without (L13). Unread dot belongs to the row.      |
| Row subtitles Review plan, Need permission, Answer question                              | status-text table            |                                                                                            |
| Row subtitles Planning..., Working..., Cancelling..., Waiting...                         | table                        | "Planning..." has no case and no test (status-text.ts:7-9 admits it). Item is marked done. |
| Row subtitles Initializing..., Initialization failed, Setting up..., Archiving...        | table                        | Ellipsis character differs (L1).                                                           |
| Sidebar status text 'Review plan'                                                        | table                        |                                                                                            |
| Row name from user-set name, PR title, branch or directory                               | workspace-name.test.ts       |                                                                                            |

#### NAV-02 (workspace-search.ts, `done`), items in this folder

| Item                                                                         | Test                           | Gap                                                            |
| ---------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------- |
| URL state: active tab type, chat id, terminal id                             | workspace-search :7 (tab only) | Session and terminal id parsing: none (L12).                   |
| URL state: file path, file mode, content mode, line, comment id, browser URL | :13, :17                       | fileMode, fileView, commentId, browserUrl: pass without (L12). |
| URL state: git panel tab and diff scope                                      | :35, :52, :56                  |                                                                |
| URL state: which PR the PR tab shows                                         | :25, :30                       |                                                                |

#### WS-06 (#103, open) item in this folder

| Item                                       | Test                                         | Gap                                                                                                              |
| ------------------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Archived card action 'Unarchive workspace' | WorkspaceGate :63; workspace.test :61 (busy) | Fine. 'Clear & unarchive' is missing in source and unlisted in tests. WS-06 is still `stub` so this is expected. |

### 5.7 Scripts panel, settings, terminal, diff

Issues read: RUN-01 #206, RUN-06 #211, SET-03 #217, SET-07 #221, WS-03 #100, REV-02 #165. Service-only items (run-scripts, workspace, terminals services) are out of this scope and left out. Items marked "covered" name the test that would fail without the item.

**RUN-01**

| Item                                                            | Result                                                                                                                                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Action select 'Select task'                                     | RunToolbar.run-01.test.tsx:54 checks it appears; choosing an action: no test                                                                                                |
| Labels 'Run', 'Run again', 'Stop', 'Starting...', 'Stopping...' | pure model covered (run-button-label.run-01.test.ts:13-72); in RunTab only Run and Stop (RunTab.run-01.test.tsx:70, 82); 'Run again' in the tab: test would pass without it |
| Run empty: Add action, manually, Configure                      | RunEmptyState.run-01.test.tsx:13, 32 covered; RunTab wiring to the settings pages (RunTab.tsx:147-148): no test                                                             |
| Icon picker 'Search icons', 'No icons found'                    | ActionIconPicker.test.tsx:9, 21 covered                                                                                                                                     |
| Scripts: run mode                                               | RepoScriptsPage.test.tsx: no test for the Run mode select                                                                                                                   |
| Dialog 'Action name'                                            | AddActionDialog.test.tsx:39, 51 covered                                                                                                                                     |
| Run tab starts, stops, restarts with Starting and Stopping      | start via Cmd+R covered (RunTab.run-01.test.tsx:112, mocked service); stop, Starting, Stopping in the tab: no test                                                          |
| Collapse control                                                | ScriptsPanelTabs.run-01.test.tsx:70 checks the callback only; the panel collapsing: no test                                                                                 |
| Mount the tab body in the scripts panel                         | ScriptsPanel.run-01.test.tsx:68 would pass with the Run tab hidden                                                                                                          |
| Auto-run after setup (switch)                                   | RepoScriptsPage.test.tsx:127 covered                                                                                                                                        |
| Cmd+R start or stop                                             | start covered through the dispatcher; stop: no test; real key to command mapping not in scope                                                                               |
| Run states incl. waiting for setup, stopping                    | pure model covered; in the tab 'Waiting for the setup script to finish.' (RunTab.tsx:173): no test                                                                          |
| Stop not confirmed                                              | no test in the UI                                                                                                                                                           |
| Run empty copy                                                  | RunTab.run-01.test.tsx:129 covered                                                                                                                                          |
| Scripts panel tabs Setup, Run, Terminal N, Ports                | ScriptsPanelTabs tests cover the strip; the panel: no test                                                                                                                  |
| Hidden actions remembered                                       | RepoActionsPage.test.tsx:47 covered                                                                                                                                         |
| Spotlight (always exclusive, button text)                       | RunTab hard-codes `isSpotlight: false` (RunTab.tsx:70); no test; Spotlight switch on the Actions page: no test                                                              |

**RUN-06**

| Item                                                                                                                 | Result                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal tabs with xterm                                                                                             | only against the fake (C2); no real xterm test                                                                                                             |
| 'New terminal' Cmd+T                                                                                                 | TerminalView.test.tsx:275 (wrapper keydown); the tab-strip button creating a tab: no test                                                                  |
| 'Close terminal' Cmd+W                                                                                               | TerminalView.test.tsx:249; neighbour selection on close: pure function only (TerminalTabBody.test.tsx:24-37), panel wiring: no test                        |
| 'Find in terminal' Cmd+F                                                                                             | open covered (TerminalView.test.tsx:222); search logic covered (TerminalFindBar.test.tsx:36-124); Next/Previous through the view and focus return: no test |
| Confirm 'Open this terminal link?' Cancel and Open                                                                   | Open and failure covered (TerminalView.test.tsx:112, 221); Cancel and Cmd-click-only: no test                                                              |
| 'Maximum N terminals allowed'                                                                                        | covered (ScriptsPanelTabs.run-01.test.tsx:31, TerminalEndedBanner.test.tsx:31, TerminalView.test.tsx:42)                                                   |
| Restart a finished shell                                                                                             | covered (TerminalView.test.tsx:81, 97); divider and cold restore replay: no test, history empty                                                            |
| Terminal keys: Shift+Enter, Cmd+K, Cmd+Backspace, Cmd+Left/Right, Alt+Left/Right                                     | Shift+Enter covered (TerminalSurface.test.tsx:236); Cmd+C covered (264); the rest: no test                                                                 |
| Cmd+Shift+T                                                                                                          | no code in the terminal view and no test                                                                                                                   |
| States starting, running, ended, failed to start                                                                     | ended covered (TerminalView.test.tsx:195, 212); load error covered (234, with a message the test supplies); input disabled when ended: no test (C3)        |
| xterm settings follow Conductor                                                                                      | TerminalView.test.tsx:292 and terminal-theme.test.ts covered                                                                                               |
| Terminal text sent to chat, openForRepo UI, repo-level terminal, starting command, big terminal mode, drag to centre | no UI in scope; no test                                                                                                                                    |
| Cmd+J 'Toggle terminal panel'                                                                                        | no code or test in scope                                                                                                                                   |

**SET-03**

| Item                                                                                | Result                                                                                            |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Cards, states, ACP names, middle truncation                                         | AgentCard.test.tsx:34-116 covered                                                                 |
| Search and 'No providers match'                                                     | AgentsPage.test.tsx:80 covered                                                                    |
| 'Paste code from Claude', setup-token                                               | AgentLoginDialog.test.tsx:72, 94 and AgentsPage.test.tsx:125 covered                              |
| Codex device code, copy toast, ChatGPT toast                                        | AgentsPage.test.tsx:168 covered (Toast mocked)                                                    |
| Cursor sign-in                                                                      | no test of the Cursor flow                                                                        |
| Close mid-flow cancels the login                                                    | no test (C9)                                                                                      |
| Red ACP text with 'Update'                                                          | AgentCard.test.tsx:73 passes the handler itself; the page passes none: test would pass without it |
| Install, update, remove, download progress (D021)                                   | not built here; no test                                                                           |
| API key save, remove, import, Bedrock fields, custom provider, Claude settings JSON | not built here; moved to SET-09 and SET-12 for part; no test                                      |

**SET-07**

| Item                                               | Result                                                                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Action row Show or Hide, Edit                      | ActionList.test.tsx:32, 65 and RepoActionsPage.test.tsx:97 covered; Show click and Delete: no test                                  |
| Action row Delete                                  | no test                                                                                                                             |
| Make default                                       | no test                                                                                                                             |
| Reset to the shared version                        | ActionList.test.tsx:47 (visibility); RepoActionsPage.test.tsx:138 mocks the service; real body: no test (C8)                        |
| Hide a shared action for this user only            | RepoActionsPage.test.tsx:47 covered (real path)                                                                                     |
| 'Branch new workspaces from'                       | RepoMiscPage.test.tsx:80 asserts read-only default; the checklist wants a field before creation uses it; test would pass without it |
| 'Remote origin'                                    | RepoMiscPage.test.tsx:98 args covered; write mocked                                                                                 |
| Files to copy preview, detecting, .worktreeinclude | component tests only; page passes null (C13)                                                                                        |
| Prompts general and five buttons                   | RepoPromptsPage.test.tsx:59, 78, 98, 112 covered; failure: no test                                                                  |
| Misc 'Icon'                                        | RepoMiscPage.test.tsx:162 (mocked `setIcon`)                                                                                        |
| 'Remove repository' confirm                        | RepoMiscPage.test.tsx:66 covered; failure path and per-repo count: no test                                                          |
| Root and workspaces path read-only                 | RepoMiscPage.test.tsx:80 covered                                                                                                    |
| 'No custom actions yet'                            | RepoActionsPage.test.tsx:68 covered                                                                                                 |
| Shared file read-only, personal file written       | covered in core (repo.config.test.ts:443); at the page it passes whatever is written (C6)                                           |
| Hidden actions in local storage                    | RepoActionsPage.test.tsx:47 covered                                                                                                 |
| Scripts page summary, setup and archive text       | RepoScriptsPage.test.tsx:59, 74, 95 covered                                                                                         |

**WS-03**

| Item                                                            | Result                                                                                                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 'Add setup script' with Ask agent or Add manually               | SetupEmptyState.test.tsx covered; SetupTab only checks both buttons exist (SetupTab.test.tsx:126); send of `ADD_SETUP_PROMPT` and the settings route: no test |
| 'Setup script failed' with fix prompt to the chat               | SetupTab.test.tsx:103, 261 covered                                                                                                                            |
| "Failed to attach setup logs" and "...context"                  | SetupTab.test.tsx:158, 170 covered                                                                                                                            |
| "Setup script failed. Check the setup tab for logs."            | SetupTab.test.tsx:181 covered, but `toast` and `toast.error` are one mock, so a swap passes                                                                   |
| 'Running setup script...'                                       | SetupStatusBar.test.tsx:22 covered                                                                                                                            |
| 'Cancelled', 'Stopping', 'Detecting' titles                     | kinds covered (setup-state.test.ts:39); the titles in the bar: no test                                                                                        |
| Not-run empty text                                              | kind only; the text in SetupTab: no test                                                                                                                      |
| Couldn't load the logs / expired, with Retry                    | saved-log error and Retry covered (SetupTab.test.tsx:237); the `log_missing` view (SetupTab.tsx:254-266): no test                                             |
| Interrupted by quit text                                        | SetupStatusBar.test.tsx:48 covered                                                                                                                            |
| Stop a running setup                                            | SetupTab.test.tsx:146 covered                                                                                                                                 |
| A second setup start is refused (Retry cannot be pressed twice) | no test of the UI guard (`busy`)                                                                                                                              |
| Files copied count on the Setup tab                             | no test (SetupTab.tsx:224-228)                                                                                                                                |
| Archived workspace                                              | no test                                                                                                                                                       |

**REV-02**

| Item                                                | Result                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 'Dismiss diff rendering warning'                    | DiffView.test.tsx:154, 189 and DiffWarnings.test.tsx:48 covered                                        |
| Unified view, Split view, Entire file               | Split and Entire covered (DiffToolbar.test.tsx:48, 55); Unified: no test                               |
| 'View options': Hide whitespace changes, Wrap lines | Wrap covered (39); Hide whitespace checkbox: no test                                                   |
| Warnings: whitespace only, binary, updating         | DiffView.test.tsx:100, 120, 138 covered                                                                |
| Diff viewer unified and split                       | split covered with the real renderer (DiffView.renderer.test.tsx:35); unified draw: no test            |
| Large file guard (UI part)                          | DiffView.test.tsx:106, 154, 162, 168 covered; service threshold in core/services/file-diff.test.ts:220 |
| Diff state saved (split, wrap, whitespace)          | persistence is outside these files; no test here                                                       |
| 'Failed to open editor'                             | DiffView.test.tsx:173 covered                                                                          |
| Viewed, arrow keys                                  | outside these files                                                                                    |

### 5.8 Git panel, Home, onboarding, app-04 state files, kanban

Legend: "T" is the test that would fail without the item.

| Feature | Item                                                            | Result                                                                                                                             |
| ------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| NAV-05  | Archived workspaces reachable from Home                         | T: HomeScreen.test.tsx:124                                                                                                         |
| NAV-05  | Archived card Open in Finder, Copy path                         | T: WorkspaceCard.test.tsx:107 (calls only, toasts none)                                                                            |
| NAV-05  | Archived card Unarchive                                         | T passes without the real service (placeholder); see M7                                                                            |
| NAV-05  | Search box                                                      | T: home-query.test.ts:60,73 and HomeFilters.test.tsx:60. Repo-name match `:83` is red. PR title: no test                           |
| NAV-05  | Filter by project                                               | T: home-query.test.ts:153, HomeFilters.test.tsx:85. Not at screen level                                                            |
| NAV-05  | Active or archived toggle                                       | T: HomeScreen.test.tsx:124                                                                                                         |
| NAV-05  | Sort                                                            | T: home-query.test.ts:178 (order); tie-break and screen level: none                                                                |
| NAV-05  | Empty buttons Create a workspace, Clear filters                 | T: HomeEmptyState.test.tsx:9,24; HomeScreen.test.tsx:149 (Create at screen: none)                                                  |
| NAV-05  | Display menu                                                    | T: HomeFilters.test.tsx:111, WorkspaceCard.test.tsx:123 (repository). lastActive field, screen wiring: test would pass without it  |
| NAV-05  | Pinned group                                                    | T: HomeScreen.test.tsx:104                                                                                                         |
| NAV-05  | Pages by 50, Show more                                          | T: HomeScreen.test.tsx:88. Unit `:96` red                                                                                          |
| NAV-05  | Cmd+Shift+H go to Home                                          | no test in scope (prior audit: no handler)                                                                                         |
| NAV-05  | No matching workspaces                                          | T: HomeScreen.test.tsx:149                                                                                                         |
| NAV-05  | Loading skeleton, error with retry                              | T: HomeScreen.test.tsx:71,77. Workspace-store retry: no test                                                                       |
| APP-02  | Exit, Continue (Enter), Down cycles                             | T: OnboardingScreen.test.tsx:54,72. Last-step Continue, Enter on control: no test                                                  |
| APP-02  | Error toast "Couldn't finish setup"                             | T: OnboardingScreen.test.tsx:107                                                                                                   |
| APP-02  | Right-hand visual per step                                      | test would pass without it (only `data-step` read, `:77`)                                                                          |
| APP-02  | One onboarding step key for one flow                            | no test (two keys exist, `core/registries/settings.ts:1577,1589`)                                                                  |
| APP-02  | Steps: what it does, agents, add project                        | T: OnboardingScreen.test.tsx:54                                                                                                    |
| APP-02  | First launch routes to onboarding when no project exists        | no test, no code (`app/router.tsx:362` is only a route)                                                                            |
| APP-02  | Agents step installs and updates programs (D021)                | no test, not built                                                                                                                 |
| APP-02  | Arrow and Enter shortcuts                                       | T: OnboardingScreen.test.tsx:72                                                                                                    |
| APP-02  | Agents step: detect, version, sign-in, none installed           | detect: stubbed (M8); version, none installed: AgentStep.test.tsx:32,136; sign-in start: `:73`; sign-in finish and cancel: no test |
| APP-02  | Project step: add, skip                                         | T: ProjectStep.test.tsx:40,84                                                                                                      |
| APP-04  | PrEmptyState six states                                         | T: pr/app-04.test.tsx:8-46 (state `gh` missing: no test, not built)                                                                |
| APP-04  | ChangesEmpty five reasons                                       | T: changes/app-04.test.tsx; no_git_status: rev-01-hooked.test.tsx:158                                                              |
| APP-04  | FileTabState six states                                         | T for loading, archived, error, too_large (file-viewer/app-04.test.tsx). `missing`, `binary`: no test                              |
| APP-04  | Wiring of the three components                                  | no importer for PrEmptyState and FileTabState; moved to PR-07 and REV-08                                                           |
| NAV-06  | Kanban five columns                                             | T: kanban.test.ts:10 (order). All other items (grouping, drag, filter chips, empty states, setting gate): no test, stub            |
| GIT-05  | Cmd+Shift+Y commit and push                                     | T: git-panel.git-05.test.tsx:99                                                                                                    |
| GIT-05  | Instruction to agent, no direct commit                          | T: core test (out of scope). Panel button: git-05 `:89`                                                                            |
| PR-02   | Create PR button and Cmd+Shift+P                                | T: git-panel.pr-02.test.tsx:88,96 for the panel half; the join to the service: test would pass without it                          |
| PR-02   | "Open on GitHub" runs `gh pr create --web`                      | no panel test, no button (`openOnGithub` has no caller, prior audit)                                                               |
| REV-01  | Click file opens diff tab                                       | T: rev-01-hooked.test.tsx:122 (callback only; `GitPanel.openFile` to `files.open`: none)                                           |
| REV-01  | Filter changed files                                            | T: rev-01-hooked.test.tsx:106                                                                                                      |
| REV-01  | Show flat list, folder hierarchy                                | folder tree logic T: rev-01-tree.test.ts:20; the toggle: no test                                                                   |
| REV-01  | Back button to All changes                                      | T: rev-01-components.test.tsx:222 for the bar; `ChangesTab` wiring: none                                                           |
| REV-01  | PR status details popover                                       | T: rev-01.test.tsx:92                                                                                                              |
| REV-01  | Diff scope: Current branch, All changes                         | no test                                                                                                                            |
| REV-01  | Diff scope: Target branch, Select target branch...              | picker T: rev-01-components.test.tsx:246; choose branch emits `{kind:"target"}`: none; hook is a placeholder (WS-02)               |
| REV-01  | Uncommitted changes, shortcut hint, N files changed             | click T: rev-01-hooked.test.tsx:238; count shown and hint: test would pass without it                                              |
| REV-01  | Per-commit entries: message, short hash, author, date           | message only: rev-01-components.test.tsx:210; rest: none                                                                           |
| REV-01  | Note "Some untracked files are not shown"                       | T: rev-01-hooked.test.tsx:129; app-04 `:26`                                                                                        |
| REV-01  | File list with status, +/-, conflict badge                      | status letter: rev-01-components.test.tsx:65; +/- and badge: none                                                                  |
| REV-01  | GitHeader via useLiveShortcut                                   | T: rev-01.test.tsx:44                                                                                                              |
| REV-01  | Pass onToggleViewed from ChangesTab to setViewed                | no test, not built (done row)                                                                                                      |
| REV-01  | Cmd+Alt+U                                                       | T: rev-01-panel.test.tsx:146                                                                                                       |
| REV-01  | Cmd+Shift+D                                                     | T: rev-01-hooked.test.tsx:165 (binding not checked)                                                                                |
| REV-01  | Rebase or merge in progress; Changes appear here; No git status | T: rev-01-hooked.test.tsx:152,187,158                                                                                              |
| REV-01  | Empty: No files match this filter                               | ChangesEmpty T: app-04 `:8`; at the tab: test would pass without it (M9)                                                           |
| REV-01  | Changes tab with count badge                                    | T: rev-01.test.tsx:100, rev-01-panel.test.tsx:118                                                                                  |

Done rows whose checklist items lack a failing test: REV-01 (Viewed wiring, target-branch picker, "N files changed", hint, flat/folder toggle, No files match at the tab, commit hash/author/date, conflict badge), APP-04 (FileTabState `missing` and `binary`, unreachable parents), PR-02 (the panel-to-service join and Open on GitHub).

---

## 6. Missing test layers

### 6.1 App shell, routing, startup (`app/`, `main.app-01`)

- **Boot integration.** `startApp` over a real migrated database: startup reaches ready, settings load after the first render, the shell restores the saved sidebar, no boundary fallback shows, a thrown render error and a failed query reach the log. Covers C1, C2.
- **Root dispatcher integration.** `createAppRouter` plus `createTestContainer` plus seeded workspaces. Press `Ctrl+1..9`, `Cmd+[`, `Cmd+]`, `Escape` with the palette open (modal priority), a key inside a textarea, a key during IME composition. Assert location and overlay state. Covers C5, C6.
- **Fixture contract.** Delete `shell-test-support.ts` and use `createTestContainer`; add a guard helper that fails a route test when a boundary fallback or a non-`NotImplemented` boundary error appears. Covers C3.
- **Persistence round trip.** Open a chat tab, let `setActiveSession` write to the database, build a second container over the same database, and assert "/" restores the tab. Covers NAV-02's stored chat tab.
- **Real size.** Sidebar and "/" restore with 300 workspaces; `chooseRestoreTarget` with 5,000.
- **Late answers.** Stores that load after the route mounts (`RestoreLastLocation`, `WorkspaceRoute` repair), a workspace that disappears while open, create-workspace finishing after the user left the page.
- **Real layout (end to end).** Sidebar drag, collapse, window resize and `SurfaceLayer` placement need a real WebKit view; jsdom has no layout. Covers C12 and NAV-15.
- **Contract.** `menuShortcuts` accelerators against the Rust menu parser (shared sample list), so a string like `CmdOrCtrl+Plus` that Tauri rejects fails a test.

### 6.2 UI primitives (`ui/`)

- **Browser or screenshot tier** (CLAUDE.md "moment 2", planned, none yet). Covers what class-string tests only pretend to: dialog widths, 1px handle with 8px hit area, toast width, Button heights, focus rings, translucent sidebar, reduced motion, light/dark/low-contrast/colour-vision renders of one view.
- **Real-key tier.** Switch, Checkbox, menu digits and Cmd+Enter driven by real key sequences (user-event is not installed; Playwright in the browser tier works).
- **Integration:**
  - AppShell with the real `ResizableGroup`, panel sizes, `--shell-left-inset` (M1, M2).
  - Real Dialog and Menu under the real `CommandDispatcher` (M10).
  - A restore test: store with saved sizes, group mounts, panels take them (M3).
- **Contract:** `styles.css` token values against `docs/research/conductor/ui-dimensions.md` (the low-contrast and colour-vision hex pins in app-14.test.tsx:294-326 copy numbers by hand); `statusIcons` keys against the workspace status union in `core/status/workspace-status.ts`.
- **Real size:** Select with 300 options (model lists); HighlightedText with thousands of matches; Menu with hundreds of items for digit keys; Table with a few thousand rows if the shortcuts list grows.
- **Accessibility scan:** an axe-style check on Dialog, AlertDialog, forms and Table. No axe tool is installed.

### 6.3 Chat top level (`features/chat/*.test`)

1. **Integration, chat screen over the real container.** Seed a workspace and session with `createTestContainer`, feed real session events, render `ChatPane` with nothing in `features/chat` mocked. Cover: user message, text, tool card, thinking, todo, footer, error banner, retry line, failed send, empty chat and archived workspace, loading and error states, unread cleared on open, viewed chat cleared on unmount. This is the layer that would have caught the slice-1 chat bugs.
2. **Integration, dispatcher.** Real `CommandDispatcher`, real key events: Ctrl+O with a rebind (MessageList) and Cmd+Alt+L (NextUnreadButton).
3. **Real size.** Build 20,000 events with the real builder, render the list, assert the mounted window and that appending one event re-renders one item. Keep the builder's own timing test in core.
4. **Browser-level scroll test.** WebKit or Tauri webview (the planned heavy tier in CLAUDE.md): open at the bottom, follow output only while at the bottom, new content while reading old messages shows the button without jumping, button click scrolls to the last turn, chat switch resets, the button sits over the list (replaces L1).
5. **Contract for the action stand-ins.** If any `vi.mock` of `useActions` stays, type it as `Pick<Actions, ...>` so a signature change fails typecheck. Better, drop it (M11).
6. **Real shiki.** `CodeBlock` stands in for shiki at the module edge because it cannot run under jsdom. One browser or node test with the real highlighter would show that the grammar names the app passes exist.

### 6.4 Interaction cards, tool cards, composer

- **Integration (highest value):** real SessionsService behind `createTestContainer` with a fake sidecar client, driving the dock. Question, approval, permission and MCP form each: card appears from `requestInteraction`, the right `answerInteraction` params leave, accepted removes the card, refused keeps it, superseded removes it, `interactionClosed(timed_out)` marks it timed out, a newer interaction replaces an answered one (M1).
- **Integration, composer:** the same container with the real draft file store, driving Enter, the send, the cleared editor and draft, then a restart (M4).
- **Contract:** answer text format shared between sidecar and desktop (M8); send-key parity between `resolveSendKey` and the dispatcher's swap (L4); `fakeFs` against the memory platform or `platform/contract.ts` (M6).
- **Real size:** 5,000-match Grep card, 1 MB Bash output, 10,000-path Glob card, 200-item Todo, a model list of 200 with search, a 5 MiB draft through `useDraftSync` and `draftToContent` (a 90-line paste), a question with four long options (L7).
- **End to end:** Enter, Shift+Enter and IME confirmation in the real WKWebView. jsdom cannot show the WebKit keyCode 229 quirk (M3).
- **Coverage:** not measured for this area; the folder was empty.

### 6.5 Sidebar

- **Integration (highest value):** `Sidebar` mounted in the real router over `createTestContainer`. Cover: empty, loading, error, ready; seeded repos and workspaces; row `href` and `aria-current`; real `ViewOptionsMenu` changing the saved setting and regrouping; real sessions service driving the unread dot and R; real `AddProjectButton` against `memory` platform `dialogs.pickFolder`. Add the NAV-04 pieces here once wired.
- **Real-size:** 300 workspaces across repos, statuses, pinned and unread (C4); also a section holding 100 rows.
- **Drag and drop end to end:** the unit tests use jsdom with a plain-object `dataTransfer`. No test runs a real WebKit drag in the Tauri view. One end-to-end test should drag a row into Pinned and a section.
- **Keyboard through the dispatcher:** Cmd+1..9, Cmd+Alt+Up/Down, Cmd+Alt+L, and the hover keys R/P, from a real key press in the mounted shell.
- **Contract:** the hand-written `useSetting`/`useLiveShortcut`/`useActions` stand-ins in six files are not checked against the real hooks. Either stop using them (C3) or add one contract test comparing a stand-in with the real hook for the keys used.
- **Latest-wins:** `use-workspace-drag` has it. `SectionList` reorder/place and `AddProjectButton` have none (two quick drops with answers in the wrong order).

### 6.6 Workspace and tab strip

1. **Integration, centre (highest value).** Real container via `createTestContainer`, `seedWorkspace`, `ServicesProvider`; mount SplitPanes with the real strip, content, new-tab menu and history button. Cover: new chat from the empty group; close the active middle tab and the last tab (assert "No tab is open"); reopen from history; limit of 5 and 10; a live-state change updating the tab's status icon; terminals showing as "Terminal N"; close failure showing a toast and leaving the tab. Replaces the mocked wiring in TabStrip, SplitPanes, WorkspaceScreen tests.
2. **Integration, keyboard.** Real dispatcher plus mounted strip; fire `KeyboardEvent` for Cmd+W, Cmd+T, Cmd+Shift+T, Cmd+D, Ctrl+Tab, Ctrl+Shift+Tab, Cmd+Shift+[ / ], Cmd+Alt+Arrow. Asserts the binding table and the handlers agree. Includes the "no handler at the limit passes the key on" case.
3. **Integration, drag.** Real TabItem `dragStart` to SplitPanes `drop`, with the tab leaving the main strip and the URL moving to the neighbour. Include dragging a tab back out of a split pane (currently not wired, G3).
4. **Contract.** A test that the string `workspace_unknown` the gate keys on is the one the hook returns (shared constant). A test that the tab-drag MIME is shared.
5. **Browser (not jsdom).** Right panel collapse and expand with real sizes; 65/35 defaults; resize handle; split pane layout and resize (once resize is built). jsdom's `ResizeObserver` is a no-op, so only a browser test can prove these.
6. **Real size.** 500 closed chats in the history popover (search, scroll, render time); 10 tabs plus a long title (truncation uses a class, so view-screenshot test); nested split layout with 3 to 4 groups.
7. **Latest-wins and double action.** Two history picks resolving out of order; double middle-click on a tab; double click on Unarchive.
8. **Unit.** `specialTab`, `chatTabs`, `terminalTabs`, `buildTabs` (all exported, none tested directly); nested `insertBeside`; `searchPatchFor` round trip.

### 6.7 Scripts panel, settings, terminal, diff

1. **Contract tests.**
   - xterm fake against the real Terminal (or `@xterm/headless`): write callback timing, `options`, buffer.
   - `TerminalConnection`: one contract suite for the two hand-built `fakeConnection`s and the real connection in core/services/terminals.ts (pending replay on subscribe, `onExit` for an already ended terminal, `ack`, empty history).
   - Every name in `TERMINAL_THEME_TOKENS` exists in `styles.css` (a renamed token makes the terminal show "Couldn't use the terminal colours").
2. **Integration over the real container (the seams that carry user-visible behaviour).**
   - ScriptsPanel with real terminals, run and setup services and a fake PTY: new, close, limit, collapse, tab switch keeps output.
   - TerminalView with the real TerminalSurface against a headless or real xterm: history then live, ack, ended input off, find stepping.
   - RunTab Run to Stop to Run again, stop not confirmed, double click.
   - SetupTab with a fake PTY: failing script, Run again twice, Stop, expired log.
   - AgentsPage over the agent-catalog service with a fake sidecar client.
   - Each repo settings page: edit, read the file back, remount on a fresh container, and a refused write.
3. **Real size.**
   - Find over 100,000 lines of scrollback, and the cost of `lineTexts` (rebuilds every line per search).
   - An output flood through `BufferedTerminalConnection` (thousands of chunks, ack bytes equal bytes written).
   - ActionList with hundreds of actions; DiffView with one multi-megabyte file near the `tooLarge` threshold (hash per render). The 5,000-file list belongs to ChangedFileList and is covered there (git-panel/changes/rev-01-components.test.tsx:120); DiffView draws one file, so no 5,000-file case is needed here.
4. **End to end (a real browser).** Cmd+F, Cmd+W, Cmd+T, Cmd+R through the real keybinding layer and xterm's own textarea. `fireEvent.keyDown` on the wrapper (TerminalView.test.tsx:236, 268, 288) skips xterm's key handling, which is where those keys can be swallowed.
5. **Late answers.** Two overlapping calls whose answers arrive out of order for the setup log read, the login finish after close, and two restarts.

### 6.8 Git panel, Home, onboarding, app-04 state files, kanban

- **Integration, Git panel:** `GitPanel` over `createTestContainer` with a seeded git cache, real `useGitState` and real `computeGitHeader`. Each header state shows the right title and button; clicking runs the matching service method; unbuilt actions show a message; a thrown action does not vanish.
- **Integration, keys:** a mounted `CommandDispatcher` (not `defaultRegistry`) with a real keydown for Cmd+Shift+Y, Cmd+Shift+P, Cmd+Alt+U, Cmd+Shift+D, and a second press while the first is pending. The panel tests use the fallback registry (`command-dispatcher.ts:448,477`); production uses the provided one.
- **Integration, ChangesTab:** over the real hooks with a fake git runner: scope switch with two answers arriving in the wrong order (the rule in `docs/engineering.md`), discard through the tab, loading and error states.
- **Contract, agents:** one fixture of the sidecar `getAgentInstalls` answer, checked against the protocol schema and then fed to the UI via a loopback client into `AgentStep`. Includes a not-installed, installed-not-signed-in and signed-in agent.
- **Integration, first run:** a fresh database goes to `/first-run-onboarding`; finishing stores `onboarding_step` 3; the next launch skips it (no code exists for the redirect yet).
- **Real size:** Home with 300 to 1,000 workspaces (pages, pinned above 50, search then Show more, sort ties); Changes tab with 5,000 files through filter and folder view (today only the list component is tested at that size).
- **End to end:** none in scope. A Home to workspace to Git panel flow belongs to the planned Mac runner.

---

## 7. Rules and guards

### 7.0 Merged guard list for `docs/engineering.md` and a test-lint script

Counts are from a text scan of the 167 files in this area (my own, using grep) unless a part is named. Each check needs a known-bad sample it must flag, per "A guard proves it can fail".

| #   | Check (deterministic)                                                                                                                                                        | Flags in this area today                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Source file with no importer outside `*.test.*` (orphan) whose header claims a feature                                                                                       | `app/SurfaceLayer.tsx`, `sidebar/PinnedSection.tsx`, `SectionList.tsx`, `SectionDialog.tsx`, `use-workspace-drag.ts`, `chat/TurnChanges.tsx`, `composer/ArchivedComposerBar.tsx`, `pr/PrEmptyState`, `file-viewer/FileTabState`, `ui/theme-variants.ts`. Highest value: it is the slice-1 "never mounted" bug. Also flag an optional prop that only tests pass (`UserMessage` `failed`/`onRetry`/`onDiscard`, `TurnChanges` `onOpenDiff`) |
| 2   | Component test uses `vi.mock` on `core/hooks.ts` or `core/context.tsx` (allow-list with a `// seam:` comment)                                                                | 41 files (chat 10+, workspace 12, sidebar 6, git-panel 6, onboarding, settings, scripts-panel, terminal)                                                                                                                                                                                                                                                                                                                                  |
| 3   | `as unknown as Container` or `{} as <Deps>` in a test                                                                                                                        | 10 files: `CreateWorkspacePage`, `startup.app-01`, `ExternalLink`, `chat-08-cards`, `FavoriteModels`, `ModelPicker`, `composer-shell`, `send-button`, `use-draft-sync`, `use-workspaces.nav-03`                                                                                                                                                                                                                                           |
| 4   | Test or comment says `createTestContainer` "cannot run under jsdom"                                                                                                          | `app/shell-test-support.ts` header, `ExternalLink.test`, `chat-08-cards.test`, `send-button.test`. Delete the claim, it is false                                                                                                                                                                                                                                                                                                          |
| 5   | `Not built yet` in an assertion, or `findByText` of a name only a `NotBuiltYet` placeholder prints; plus staleness: the id no longer appears in any `notImplemented("<ID>")` | 9 files: `router`, `router.nav-02`, `AppShell` (via "Git panel"/"Scripts"), `ChatBlockView`, `ToolCard`, `chat-08-cards`, `rev-01-hooked`, `git-panel.tabs` (already stale: GIT-04), `WorkspaceActionsMenu.nav-10`, `states`                                                                                                                                                                                                              |
| 6   | Test mentions a command id but the file has no `KeyboardEvent` or `fireEvent.keyDown` (shortcut tested through `registry.run(` or `runCommandHandlers(` only)                | `TabStrip.nav-10`, `SplitPanes.nav-10`, `GroupedWorkspaces.nav-03`, `MessageList`, `rev-01-hooked` (Cmd+Shift+D), `git-panel.git-05`, `git-panel.pr-02`, `rev-01-panel`, `RunTab.run-01`                                                                                                                                                                                                                                                  |
| 7   | Constant-echo test: body is only `expect(importedConstant).toBe("<literal>")`                                                                                                | `ui/layout-sizes.test.ts` (3 tests); `dashboard/kanban.test.ts:18` (set built from the keys compared with the keys)                                                                                                                                                                                                                                                                                                                       |
| 8   | Mock factory ignoring its arguments (`useSetting: () => x`, `useLiveShortcut: () => null`)                                                                                   | `ToolCard.test`, `Sidebar.nav-03`, `SidebarNav.nav-03`, `GroupedWorkspaces.nav-03`, `useNewTab.nav-10`, `WorkspaceActionsMenu.nav-10`                                                                                                                                                                                                                                                                                                     |
| 9   | Hand-made store with a no-op `subscribe: () => () => {}`                                                                                                                     | `TabStrip.nav-10`, `SplitPanes.nav-10`, `WorkspaceActionsMenu.nav-10`                                                                                                                                                                                                                                                                                                                                                                     |
| 10  | Fake id source from a collection length or a constant (`fav-${length + 1}`, `uuid: () => "id"`)                                                                              | `FavoriteModels.test:52`, `main.app-01.test:46,73`, `command-dispatcher.hooks.test:36`                                                                                                                                                                                                                                                                                                                                                    |
| 11  | `setTimeout(` in a test file without fake timers                                                                                                                             | `composer-shell.test:189`, `use-draft-sync.test:141`, `ModelPicker.test:399`; real-time waits via `duration`/`openDelay` in `ui/app-05-toast`, `ui/app-13`, `ui/app-05`                                                                                                                                                                                                                                                                   |
| 12  | Spy or console restore inside the test body, not in `afterEach`                                                                                                              | `CreateWorkspacePage`, `TerminalSurface`, `TerminalView`, `TurnItem`, `ChatBlockView`, `startup.app-01` (cleanup outside `finally`), `TabContent.nav-10:77` (state reset in body)                                                                                                                                                                                                                                                         |
| 13  | Source-reading guard (reads `styles.css` or `src/**`, asserts an absence) with no positive sample, or with a hard-coded folder list beside a `readdirSync`                   | `ui/tokens.test.ts:194-236` (misses 11 feature folders), `ui/app-14.test.tsx` contrast matrix                                                                                                                                                                                                                                                                                                                                             |
| 14  | Negative assertion right after a `waitFor` that watches a different signal, or after `await Promise.resolve()`                                                               | `app/git-16.test:74-79`, `PinnedSection.nav-04:118`, `use-workspace-drag.nav-04:112`, `ProjectStep:61`, `AgentStep:129`                                                                                                                                                                                                                                                                                                                   |
| 15  | `vi.spyOn(realService, "m").mockResolvedValue(...)` followed only by `toHaveBeenCalled*`, with no read-back of the store or file                                             | `RepoActionsPage`, `RepoMiscPage`, `RepoPromptsPage`, `RepoScriptsPage`, `PinnedSection.nav-04`, `SectionList.nav-04`, `SectionDialog.nav-04`, `git-panel.git-05`, `WorkspaceCard`                                                                                                                                                                                                                                                        |
| 16  | A `vi.fn()` configured in a harness and never inside an `expect`, or a harness option no call site sets                                                                      | `rev-01-hooked` (`setViewed`, `discardFile`), `ModelPicker.test:169` (`create`), `composer-shell` `sendKey`, `focusOnMount={false}` in all nine Surface tests                                                                                                                                                                                                                                                                             |
| 17  | Header "Must handle" or "Test first" clause with no matching word in the test file (report only)                                                                             | `UserMessage`, `AssistantText`, `MessageList`, `SetupTab`, `ScriptsPanel`, `RunTab`, `TerminalSurface`, `AgentsPage`, `CopyButton`, `TruncatedText`, `Dialog`                                                                                                                                                                                                                                                                             |
| 18  | Same describe subject or identical test body in two files of one folder                                                                                                      | `composer.test` vs `composer/app-04`, `workspace.test` vs four others, `ui/components.test` vs `app-04/05/13`, `sidebar.test` vs `UnreadDot`/`app-04`, `ScriptsPanel.run-01` vs `RunTab.run-01`, `rev-01-hooked:187` vs `changes/app-04:15`                                                                                                                                                                                               |
| 19  | Feature id missing from `describe` and header                                                                                                                                | `ui/components.test`, `ui/tokens.test`, `workspace.test`, `workspace-search.test`, `sidebar.test`, `rev-01-*`, most `app/` files                                                                                                                                                                                                                                                                                                          |
| 20  | Redundant `import "../test/dom-polyfills.ts"` (`test/setup.ts` already loads it)                                                                                             | about 70 files (the part reports count 7, 16, 20 in their folders)                                                                                                                                                                                                                                                                                                                                                                        |
| 21  | Stderr written during a test run (CI log `s7-r1`: 77 stderr blocks across the shell tests)                                                                                   | `router.nav-02`, `router`, `AppShell`, `startup.app-01`                                                                                                                                                                                                                                                                                                                                                                                   |
| 22  | Module-level mutable state in a source file the tests exercise (zustand `create(` or `let` at module scope)                                                                  | `app/command-dispatcher.ts:448`, `app/overlay-store.ts:21`, `ui/Toast.tsx:31`                                                                                                                                                                                                                                                                                                                                                             |
| 23  | Count of `expect(getBy...).toBeTruthy()` per file above a budget (a `getBy` already throws, so it asserts nothing extra)                                                     | `chat-08-cards` 44, `router` 25, `app-13` 24, `states` 16, `AgentStep` 15. Style only                                                                                                                                                                                                                                                                                                                                                     |

Rules worth writing into `docs/engineering.md`:

1. **A screen is not done until one test mounts it over `createTestContainer` with nothing in its own folder mocked.** Child mocks are allowed only for a placeholder that another feature owns, with a comment naming the feature.
2. **A shortcut is tested by pressing the key into the mounted dispatcher**, then asserting the effect. `registry.run` tests the handler, not the binding.
3. **A component with a test and no importer is a defect**, not a delivered feature. The backlog row stays `stub` until the mount exists.
4. **A test never asserts a `Not built yet` string.** Test the placeholder once in `ui/`.
5. **A failure path asserts what the user sees**, using a real service made to refuse (the memory platform's file system refusing a write), not a spy returning `err`.
6. **A persistence test reads back through a second container over the same store.**
7. **A hidden tab body uses the `hidden` attribute or `aria-hidden`**, so tests can tell which tab is shown (the Tailwind `hidden` class is invisible to jsdom).

---

### 7.1 Per-part guard notes

#### 7.1.1 App shell, routing, startup (`app/`, `main.app-01`)

Each is a script over test files. What it flags in this scope today:

1. `as unknown as (Container|Platform)` or `{} as <Deps>` in a `*.test.ts(x)`: `CreateWorkspacePage.test.tsx:63, 107`, `startup.app-01.test.ts:34, 38`.
2. A constant id source (`uuid: () => "<literal>"`): `main.app-01.test.tsx:46, 73`, `command-dispatcher.hooks.test.tsx:36`.
3. A hand-built `Database` object literal in a test or fixture (`execute:` and `select:` keys): `main.app-01.test.tsx:26-33`, `command-dispatcher.hooks.test.tsx:29-33`, `shell-test-support.ts:44-51`.
4. The string `Not built yet` in an assertion (placeholder pinning): `router.test.tsx:119, 160`, `router.nav-02.test.tsx:113, 120`; plus `findByText("Git panel"|"Scripts")` in `router.test.tsx`, `AppShell.test.tsx`.
5. `vi.spyOn(...)` with a `mockRestore()` inside the test body instead of `afterEach` or `restoreMocks`: `CreateWorkspacePage.test.tsx:169-177, 253-266`.
6. Cleanup (`dispose()`, `unmount()`, `close()`) outside a `finally` or `afterEach`: `startup.app-01.test.ts:199-239`.
7. Stderr noise: the CI runner fails the run if a test writes to stderr. Today: `router.nav-02.test.tsx`, `router.test.tsx`, `AppShell.test.tsx`, `startup.app-01.test.ts` (log s7-r1).
8. A test file with `describe("<ID> ...")` and no header comment naming the feature: `AppShell.test.tsx`, `CreateWorkspacePage.test.tsx`, `FullPage.test.tsx`, `ShellControls.test.tsx`, `app-04.test.tsx`, `git-16.test.tsx`, `layout-persistence.test.ts`, `navigation-history.test.ts`, `overlay-store.test.ts`, `router.test.tsx`.
9. `vi.mock` of a module that is also a direct child import of the file under test: `app-04.test.tsx:8-10` (AddProjectButton).
10. A source file with no importer outside its own tests (orphan check): `app/SurfaceLayer.tsx`; also exports `sharedQueryOptions`, `immutableQueryOptions` (query-options.ts:56, 63), `parseDeepLinkRoute`, `toggleZenMode` (placeholders, expected).
11. Module-level `createXxx()` call that holds state in `src/app` (architecture rule "no module-level mutable state"): `command-dispatcher.ts:448`, `overlay-store.ts:21` (a global zustand store, shared across tests; tests reset it by hand).
12. A negative `queryBy*`/`toBeNull` assertion directly after a `waitFor` that watches a different signal: `git-16.test.tsx:74-79` (hard to script; a review checklist line).

#### 7.1.2 UI primitives (`ui/`)

Each is a script over test files; "flags today" is what it would report in this scope.

1. **Constant-echo test:** a test body that only does `expect(<imported value>).toBe("<literal>")` with no render or call. Flags `ui/layout-sizes.test.ts` (3 tests).
2. **className-assertion budget:** more than N `className` `toContain` assertions in one file, or any `toContain` with an arbitrary-value class (`[...]`). Flags `app-05-look.test.tsx` (8), `app-12.test.tsx` (12), `resizable.test.tsx` (8), `app-13.test.tsx` (8), `app-05-menu.test.tsx` (7), `components.test.tsx`, `app-04.test.tsx`, `TitleBarInset.test.tsx`, `app-14.test.tsx`, `app-05-toast.test.tsx`.
3. **Expected value built by the function under test:** `getByText(fn(x))` where `fn` is imported from the file under test. Flags `app-13.test.tsx:355`.
4. **Spied `console.error` asserted only with `toHaveBeenCalled()`:** Flags `states.test.tsx:45`.
5. **Test title with "shows a spinner" or similar and no matching query in the body:** hard to script. A cheaper form: title words `spinner|tooltip|toast` with no `querySelector`/`getBy` on that word. Flags `components.test.tsx:50` (spinner).
6. **Source-reading guard without a positive sample** (reads `styles.css` or `src/**` with `readFileSync` and asserts an absence): requires a second `it` that feeds a known-bad string to the same function. Flags `tokens.test.ts:192-236` (colour scan); `app-14.test.tsx` is covered only for the ratio formula.
7. **Directory-list drift:** a hard-coded folder list next to a `readdirSync` of the parent. Flags `tokens.test.ts:194-206` (11 folders missing).
8. **Duplicate describe subject across files:** same component name in `describe(...)` in two files. Flags EmptyState, Spinner, Toast, Menu, Dialog, Button, ContextMenu (components.test.tsx vs app-04/05/13).
9. **Feature id missing from `describe`:** flags `components.test.tsx` (all), `tokens.test.ts`.
10. **Real timer waits:** `waitFor`/`findBy` with `timeout:` over 500 or a `setTimeout`-driven component with a short ms prop. Flags `app-05-toast.test.tsx:116-119`, `app-13.test.tsx:98-103`.
11. **Mutable module state in tests or sources they exercise:** `let`/object at module scope in a test file, and `create(` (zustand) at module scope in `ui/`. Flags `states.test.tsx:15`, `ui/Toast.tsx:31`.
12. **Redundant polyfill import:** `import "../test/dom-polyfills.ts"` in a test when `setup.ts` loads it. Flags seven files (app-04, app-05, app-05-look, app-05-toast, app-12, app-13, resizable).
13. **Source symbol with no non-test caller:** exported function used only by tests. Flags `themeAttributes`, `applyThemeAttributes` (ui/theme-variants.ts).

No file in scope has `vi.mock`, a test with no `expect`, or a test that asserts only on `vi.fn` calls it configured. The `vi.fn` assertions that exist (`onCheckedChange`, `onSelect`, `onCopy`) check a callback that real component code invokes, so they count as behaviour.

#### 7.1.3 Chat top level (`features/chat/*.test`)

| Check (deterministic)                                                                                                  | Flags today in this scope                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vi.mock("../../core/hooks.ts"` in a component test                                                                    | AssistantText, CodeBlock, ChatBanner, ChatBanner.chat-27, MessageList, MessageList.chat-27, TurnFooter, TurnItem, TurnItem.chat-27, UserMessage (10 files)                                  |
| A test mocks four or more sibling components                                                                           | ChatPane.test (6), ChatBlockView.test (5), MessageList.test (4), TurnItem.test (4), TurnItem.chat-27.test (4)                                                                               |
| `as unknown as Container` or `as unknown as ChatTurn` in a test                                                        | ExternalLink.test:22, MessageList.chat-27.test:47                                                                                                                                           |
| Exported component with no importer outside `*.test.*`                                                                 | TurnChanges.tsx (also the placeholders in the folder)                                                                                                                                       |
| Optional prop passed only by tests (ts-morph over the call sites)                                                      | UserMessage `failed`, `onRetry`, `onDiscard`, `onRevert`; TurnChanges `onOpenDiff`                                                                                                          |
| Test whose assertions are only `querySelector('[data-region]')` or only `getBy*` of nodes the test's own mock rendered | ChatPane.test (28-30); candidates for review: MessageList.chat-27.test, TurnItem.test footer mock                                                                                           |
| Test with no `expect`                                                                                                  | none today                                                                                                                                                                                  |
| Test whose `expect`s are all `toHaveBeenCalled*` on a `useActions` fake                                                | TurnFooter.test:79-92, ChatBanner.chat-27.test:58-67, TurnItem.chat-27.test:98-113, UserMessage.test:132-138 (legitimate "edge reached" checks, so the guard needs a human or an allowlist) |
| `className` assertions (`.className).toContain(`)                                                                      | ScrollToBottomButton.test:29-31, TurnChanges.test:90                                                                                                                                        |
| `vi.spyOn(console` without a `finally` or `afterEach` restore                                                          | TurnItem.test:96, ChatBlockView.test:78 and :91                                                                                                                                             |
| Header "Test first" or "Must handle" phrase with no matching word in the test file (heuristic, report only)            | UserMessage ("Show more"), AssistantText ("raw HTML"), MessageList ("Scroll to bottom", "chat switches")                                                                                    |

Each guard needs a sample it must flag, per engineering.md "A guard proves it can fail".

#### 7.1.4 Interaction cards, tool cards, composer

Each is a deterministic script over `*.test.ts(x)`. What it would flag today in this scope:

1. **`vi.mock` of `core/hooks.ts` in a feature test.** Flags `InteractionDock.test.tsx:16`, `QuestionCard.test.tsx:16`, `ToolCard.test.tsx:13`.
2. **`vi.mock` of a sibling component in the same folder.** Flags `InteractionHost.test.tsx:13`, `:16`.
3. **`as unknown as Container` (or `Actions`, `*Deps`) in a test.** Flags `chat-08-cards.test.tsx:44`, `FavoriteModels.test.tsx:81, :97`, `ModelPicker.test.tsx:172, :193`, `composer-shell.test.tsx:154`, `send-button.test.tsx:27`, `use-draft-sync.test.tsx:129`. Allow-list `as unknown as Editor` only where a real editor is impossible, and flag `use-draft-sync.test.tsx:157` and its four siblings.
4. **`setTimeout(` in a test file without fake timers.** Flags `composer-shell.test.tsx:189`, `use-draft-sync.test.tsx:141`, `ModelPicker.test.tsx:399`.
5. **A mock factory whose function ignores its arguments** (`useSetting: () =>`). Flags `ToolCard.test.tsx:14`.
6. **Assignment into an exported table from a test** (`TOOL_CARDS.x =`). Flags `ToolCard.test.tsx:81, :91`, `chat-08-cards.test.tsx:183, :186`.
7. **Harness option never passed by any test** (declared in an options interface, never set at a call site). Flags `sendKey` in `composer-shell.test.tsx:72`; the unused `create` assertion at `ModelPicker.test.tsx:169` is the same family (a `vi.fn` never asserted).
8. **`toBeDefined` or `toBeTruthy` on a value the test built.** Flags `ModelPicker.test.tsx:401`. (`expect(getBy...).toBeTruthy()` is a no-op assert, since `getBy` throws; 5 to 44 per file here. Prefer `toBeInTheDocument` or an assertion on the value.)
9. **Production component with no importer but a test.** Flags `ArchivedComposerBar.tsx`.
10. **Duplicate test bodies across files.** Flags `composer.test.tsx` against `app-04.test.tsx`.
11. **A fake whose id comes from a collection length.** Flags `FavoriteModels.test.tsx:52`.
12. **A branch guard with no test of its false case** (needs coverage branch data): `ToolApprovalCard.tsx:158`, `QuestionCard.tsx:135`, `ComposerEditor.tsx:101`.

#### 7.1.5 Sidebar

Each is a deterministic script check. "Flags today" lists the files in this folder.

1. `vi.mock` of `core/hooks.ts` (or `core/context.tsx`) in a component test: AddProjectButton.test.tsx, Sidebar.nav-03.test.tsx, sidebar.test.tsx, SidebarNav.nav-03.test.tsx, GroupedWorkspaces.nav-03.test.tsx, WorkspaceRow.nav-03.test.tsx. Allow-list only where the hook cannot run.
2. `vi.mock` of a sibling component under the same feature folder: Sidebar.nav-03 (AddProjectButton), sidebar.test (GroupedWorkspaces, AddProjectButton), app-04 (AddProjectButton), GroupedWorkspaces.nav-03 (WorkspaceRow, ViewOptionsMenu). Require a named integration test for the pair.
3. `as unknown as Container` (or `as Container`) in tests: use-workspaces.nav-03.test.tsx:48. Also flag `as unknown as <Model>` for domain rows: sidebar.test.tsx:40-41.
4. `vi.spyOn(<real service or actions>, ...).mockResolvedValue(...)` followed only by `toHaveBeenCalled*`: PinnedSection.nav-04 (2 tests), SectionList.nav-04 (8), SectionDialog.nav-04 (4). Require one assertion on the real store or rendered output in the same test.
5. A failing-path test whose last assertion reads state after a mocked action that cannot change it: SectionList.nav-04 :118 and :255. Hard to script; flag "spy returns err, then expect on store" as a review hint.
6. Negative assertion after `await Promise.resolve()` or a fixed microtask: PinnedSection.nav-04:118, use-workspace-drag.nav-04:112.
7. `fireEvent.keyDown` on the element that owns the handler, for a feature whose header says "hover" or "global": WorkspaceRow.nav-11 :85.
8. Source files with a test but no non-test importer (orphans): PinnedSection.tsx, SectionList.tsx, SectionDialog.tsx (only imported by an orphan), use-workspace-drag.ts (same), DraftMarker.tsx (stub).
9. Backlog `stub` row whose owning files have no `notImplemented`: NAV-04 and NAV-11 (this is `pnpm stubs`, which will fail on CI).
10. Test files with no `@feature` header or no feature id in `describe`: sidebar.test.tsx (id missing in `describe` names for SidebarEmptyState and UnreadDot), use-workspaces.nav-03.test.tsx, SidebarNav, Sidebar.nav-03, GroupedWorkspaces, WorkspaceRow.nav-03, ViewOptionsMenu, sidebar-view (feature id is in the file name and `describe` only).
11. Duplicate test titles/assertions across files (same `getByRole` + name): UnreadDot (sidebar.test vs UnreadDot.nav-11), SidebarEmptyState (sidebar.test vs app-04).
12. Test helper copied in several files: `repo()`/`workspace()` builders in sidebar-view, GroupedWorkspaces, ViewOptionsMenu, WorkspaceRow.nav-03, use-workspaces (and `renderRow`/`renderWith` router scaffolds in 5 files).
13. A fake hook that ignores its argument (`useSetting: () => false`): Sidebar.nav-03:15, SidebarNav.nav-03:10, and the key-agnostic fallback in GroupedWorkspaces.nav-03:25-29.

#### 7.1.6 Workspace and tab strip

Each would be a script reading test files. "Flags today" lists what it finds in this folder.

1. **Component test mocks `core/hooks.ts`.** Allow only `core/hooks/*.test.*`. Flags 12 files today: ChatHistoryButton.test.tsx, EmptyTabGroup.nav-10, NewTabMenu.nav-10, SplitPanes.nav-10, TabContent.nav-10, TabContextMenu.test.tsx, TabStrip.nav-10, WorkspaceActionsMenu.nav-10, WorkspaceGate.nav-10, WorkspaceHeader.nav-10, useNewTab.nav-10, workspace.test.tsx.
2. **Component test mocks `core/context.tsx`.** Flags 8: ChatHistoryButton, EmptyTabGroup, NewTabMenu, SplitPanes, TabContent, TabStrip, useNewTab, WorkspaceActionsMenu.
3. **`vi.mock` of a file in the same folder as the file under test (child component mock).** Flags: TabStrip.nav-10 (NewTabMenu, ChatHistoryButton), SplitPanes.nav-10 (TabStrip, TabContent, TabItem), WorkspaceScreen.nav-10 (WorkspaceHeader, SplitPanes, WorkspaceGate, plus GitPanel and ScriptsPanel in other folders), WorkspaceHeader.nav-10 (WorkspaceActionsMenu, OpenInMenu), TabContent.nav-10 (ChatPane). Needs an allow-list comment (`// seam: <reason>`) for placeholders like OpenInMenu.
4. **Hand-made store with a no-op `subscribe`.** Flags TabStrip.nav-10, SplitPanes.nav-10, WorkspaceActionsMenu.nav-10.
5. **Shortcut tested through `registry.run(` only.** A test that mentions a command id must also contain a `KeyboardEvent` or `fireEvent.keyDown` in the same file. Flags TabStrip.nav-10 and SplitPanes.nav-10 (7 calls).
6. **A string given to `appError(` or a state literal that is later passed to `getByText(` unchanged.** Heuristic; a human decides. Flags workspace.test.tsx:38/41 (the harmful one), and, as harmless pass-throughs, WorkspaceGate.nav-10 :56-59, WorkspaceHeader.nav-10 :192-194, RenameDialog.nav-10 :61-65, TabStrip.nav-10 :245-248.
7. **Test file without an `@feature` header, or without a feature id in any `describe` title.** Flags 7 without header: active-tab.test.ts, status-text.test.ts, workspace-search.test.ts, ChatHistoryButton.test.tsx, TabContextMenu.test.tsx, WorkspaceStatusIcon.nav-03.test.tsx, workspace.test.tsx. Flags 2 with no id anywhere: workspace-search.test.ts, workspace.test.tsx.
8. **`console.error` replaced by a no-op.** Flags TabStrip.nav-10.test.tsx:154.
9. **`toast` never asserted in a test file whose source calls `toastError`.** Flags: useNewTab, TabStrip, ChatHistoryButton, TabContextMenu, WorkspaceGate, WorkspaceHeader tests (all six). Only WorkspaceActionsMenu passes.
10. **Redundant `import "../../test/dom-polyfills.ts"`** now that `setup.ts` loads it. Flags 16 files.
11. **State reset inside a test body instead of `afterEach`** (`state.x = false;` as the last line). Flags TabContent.nav-10.test.tsx:77.
12. **Duplicate `it(` titles or near-identical bodies across files in one folder.** Flags workspace.test.tsx against WorkspaceGate, WorkspaceLayout and WorkspaceStatusIcon files (7 tests).
13. **Assertion on a `getBy*` result with `toBeTruthy()`** is harmless (`getBy` throws), but 57 uses make real weak assertions harder to see. Prefer `toBeInTheDocument` (needs jest-dom) or drop the `expect`. Style only, not a block.
14. **Constant duplicated between source files** (drag MIME at TabStrip.tsx:373 and SplitPanes.tsx:53). A script that finds the same string literal of 20+ characters in two non-test files in one folder would flag it today.

#### 7.1.7 Scripts panel, settings, terminal, diff

Each is a script that can run in CI. What it flags in this scope today:

1. **`vi.mock` of a module in the same feature folder or of `core/hooks.ts` / `core/context.tsx`** in a component test. Flags: TerminalView.test.tsx (TerminalSurface, hooks), TerminalTabBody.test.tsx (TerminalView), SetupTab.test.tsx (hooks, context, TerminalView, router, Toast), AgentsPage.test.tsx (hooks, Toast), DiffView.test.tsx (`@pierre/diffs/react`; allow-list it because DiffView.renderer.test.tsx pairs it), TerminalSurface.test.tsx (`@xterm/xterm`, allow-list only with a contract test).
2. **A test file where every write goes through `vi.spyOn(...).mockResolvedValue` and no test reads the result back.** Flags: RepoActionsPage (5), RepoMiscPage (6), RepoPromptsPage, RepoScriptsPage.
3. **A settings page test file with no test that returns `err(...)` from a write.** Flags: RepoActionsPage, RepoMiscPage, RepoPromptsPage.
4. **A component with a `busy`, `saving`, `loading` or `finishing` flag whose test never clicks twice.** Flags: SetupTab, AddActionDialog, RemoveRepoDialog, AgentLoginDialog, AgentsPage (start login).
5. **`toBeTruthy()` as the only assertion on a `getBy*` result** (getBy already throws). Today ~108 occurrences in scope; the sharpest files are TerminalView.test.tsx (13), AgentsPage.test.tsx (10), AgentCard.test.tsx (9), DiffView.test.tsx (9), ScriptsPanel.run-01.test.tsx (3 of 3 assertions). Prefer a check on text, state or a call.
6. **A prop passed in every test of a file with one fixed value** (here `focusOnMount={false}` in all nine Surface tests, `canAskAgent={false}` in the RunEmptyState tests but one). Flags TerminalSurface.test.tsx and RunEmptyState.run-01.test.tsx.
7. **Two test files that seed the same store state and assert the same label.** Flags ScriptsPanel.run-01 and RunTab.run-01 (identical `RunState` literals).
8. **A `mockRestore()` or cleanup call inside the test body instead of `afterEach`.** Flags TerminalSurface.test.tsx:328, 360 and TerminalView.test.tsx:109, 124, 139.
9. **Manual import of `test/dom-polyfills.ts`** when `setupFiles` already loads it. Flags about 20 files in scope.
10. **A `hidden` Tailwind class used to hide a mounted tab body.** Flags ScriptsPanel.tsx:135-145 and TerminalTabBody.tsx:55 (not a test rule, but it is why panel tests cannot see the active tab).
11. **Header "Must handle" words with no matching test title.** A script can look for each "Must handle" clause's keywords (for example "ended", "archived", "stale", "double") in the test file. Flags SetupTab, ScriptsPanel, ScriptsPanelTabs (status dot), RunTab (stop not confirmed), TerminalSurface (fit, history, ended), AgentsPage (cancel).

#### 7.1.8 Git panel, Home, onboarding, app-04 state files, kanban

Each is a script over test files. "Flags today" lists this scope.

1. `vi.mock("../../core/hooks.ts", factory)` without `importOriginal` in a screen test. Flags: git-panel.pr-02, git-panel.tabs, rev-01-panel, rev-01, changes/rev-01-hooked, changes/rev-01-components (6). git-05 passes (uses `importOriginal`).
2. `vi.mock` of a sibling component or a `core/status` function in a feature test. Flags: git-panel.git-05, git-panel.pr-02, rev-01-panel (header and tabs); git-panel.tabs (ChangesTab).
3. Hand-made `useServices` or `as unknown as` in a screen test (rule: use `createTestContainer`). Flags: git-panel.pr-02 `:41-44`, rev-01-panel `:35-38`, tabs `:32-35`.
4. A `vi.fn()` created in a hoisted state or option bag but never inside an `expect`. Flags: rev-01-hooked (`setViewed`, `discardFile`), pr-02 (`git.commitAndPush`), rev-01-panel (`files.open`).
5. A test whose only assertions are `toHaveBeenCalled*` on spies it configured. Flags: git-05 (both tests), pr-02 (both), HomeFilters (five of six), most `rev-01-components` interaction tests (acceptable when the spy is a prop callback, so limit the rule to spies on `container.*`/`actions.*`: flags git-05, WorkspaceCard `:91,:107`).
6. `await waitFor(() => expect(...).not.toHaveBeenCalled())` or `.toBeNull()` as the only wait. Flags: ProjectStep.test.tsx:61, AgentStep.test.tsx:129.
7. A string `Not built yet: <ID>` in a test where `<ID>` no longer appears in a `notImplemented("<ID>")` in source (staleness), and any such string outside `ui/not-built-yet` tests (placeholder testing). Flags: git-panel.tabs.test.tsx:74 (GIT-04 stale), `:72` `:83` `:91` and rev-01-hooked.test.tsx:206 (placeholders).
8. Duplicate test titles across files in one feature (a title that promises "stable" or "sum" with no matching fixture is not scriptable). Flags: "says changes appear here" (app-04 `:15`, hooked `:187`).
9. Missing `@feature` header or feature id in the describe title. Flags: rev-01-panel, rev-01, hooked, components, tree, HomeFilters, HomeScreen and most others have no header (ids are in the titles).
10. A guard proves it can fail: the mutation check for rule 7 should include a sample file it must flag.

---

## 8. Out-of-area notes and source observations

One-liners about core, sidecar, Rust, docs and source files. They are for the other reviewers or for the fixer.

### 8.1 App shell, routing, startup (`app/`, `main.app-01`)

- `main.tsx:212-224`: the router is rendered before `runStartup` finishes, so every component that reads settings once at mount sees defaults (see C1). `AppShell.tsx:51-53, 53` is the first victim.
- `core/services/command-runner.ts:133-150` registers only `app.checkForUpdates`, `app.openSidecarLogs` and `project.add`. `app.commandPalette` (Cmd+K) and `view.toggleLeftSidebar` (Cmd+B) have no handler anywhere (`grep useCommandHandler`), so the dispatcher swallows the key (`command-dispatcher.ts:600`) and the user sees "Couldn't open the command palette". Known stubs (NAV-08, NAV-12), but the keys are live today.
- `router.tsx:140-148`: `CommandDispatcher` is mounted without `onDeepLink`; `main.tsx:128-152` `openWorkspaceLink` serves only notification clicks. A `conducted://workspace?...` deep link event logs "No command handles the deep link" (`command-dispatcher.ts:634-637`).
- `command-dispatcher.ts:495-496`: a `useCommandHandler` call outside a provider silently registers in the module-level default registry that the root dispatcher never reads.
- `command-dispatcher.ts:598-601`: `isEnabled` is checked twice (in the listener and again in `dispatchCommand`). Harmless.
- `ShellControls.tsx:41-45`: the forward button is never disabled at the end of history (header only promises back).
- `test/container.ts`, `app/shell-test-support.ts:7-8`: the header claims `createTestContainer` cannot run under jsdom; it can (`test/container.jsdom.test.tsx`).
- `main.tsx:33-70`: own place-name list (prior finding in `harden/core-findings.md:235` still stands).
- `main.app-01.test.tsx:17-24`: `stopApp` stubs `runScripts.stopAll` and `sidecar.stop` "placeholders"; the comment may be stale. If the real stop steps work, the stubs hide leaks.
- No Rust or sidecar code was read.

### 8.2 UI primitives (`ui/`)

- `ui/Toast.tsx:31-50` keeps a module-level zustand store. architecture.md ("State and time") says there is none.
- `ui/theme-variants.ts` has no caller outside `app-14.test.tsx` (checked with a search of `src`). The settings page that should apply it (SET-06, stub) is where it will be wired. Until then, appearance settings do nothing.
- `docs/design.md:70` says colour-vision variants, the search-highlight colour and the translucent sidebar are "not built yet". They are in `styles.css` (lines 107-108, 235-280) and tested. Update the line, or mark it stale in the same PR as APP-14.
- `ui/CopyButton.tsx:72`: a slow first copy that resolves after a faster second one overwrites `timer.current` and leaves the second timer running (it fires early and resets the label). Minor.
- `ui/Switch.tsx:35-39`, `ui/Checkbox.tsx:41-45`: probably redundant with native button activation (L6).
- `test/setup.ts` header names `@feature COMP-01` for a shared setup file. Wrong id, harmless.
- `app/layout-persistence.ts:12` says the shell never stores an `app-shell` entry. That depends on AppShell passing `persist={false}` (app/AppShell.tsx:128). The ui test that would break if the flag stopped working does not exist (M3).
- Nothing noticed in Rust or the sidecar.

### 8.3 Chat top level (`features/chat/*.test`)

- `core/services/turn-builder.test.ts:434-455`: the 20,000-event test checks counts only, with no time bound.
- `core/services/checkpoint.ts:207-215`: `revertTo` and `forkFrom` are placeholders that throw; the live buttons in `UserMessage.tsx:179-186` and `TurnFooter.tsx:106-131` call them.
- `core/hooks/chats.ts:70`: `useChat` subscribes to the whole session slice (`useSessionSlice((value) => value)`) and has no test.
- `core/model.ts:322-337`: `ChatView` has no `failedSends`.
- `docs/plans/items/system.tsv:2956`: APP-16 says thinking blocks show "Not built yet"; `ThinkingBlock` is built in this snapshot.
- Source: `AssistantText.tsx:214,271-272` snake_case italicised (M17).
- Source: `EmptyChat.tsx:16` label differs from the research (M8).
- Source: `TurnItem.tsx:72` with `ChatBanner.tsx:184`, "Try again" never shows for a failed turn (M4).
- Source: `TurnItem.tsx:83-84, 93-94` Retry and Retry now return silently when the turn has no user message (also a prior audit finding for CHAT-27).
- Source: `TurnItem.tsx:127` does not pass `failed` to `UserMessage` (M3).
- Source: `TurnFooter.tsx:58-65` no Fast mode line (M16).
- Source: `UserMessage.tsx:171` attachment key is the path.
- Source: `MessageList.tsx:3-19` header says 2000 turns "stay smooth (tested at that size)"; the test counts mounted items and measures nothing about smoothness.

### 8.4 Interaction cards, tool cards, composer

- `core/services/sessions.chat-10.test.ts:55` builds the service with `{ sidecar } as unknown as SessionsServiceDeps` (core, hand-built deps).
- `core/hooks/chats.ts:68` (`useChat`) and `core/services/sessions.ts:1375` (`chatView`) have no direct test with an open interaction.
- `features/chat/ChatPane.test.tsx:10` mocks `InteractionDock`, so the dock's place in `ChatPane` is covered by reading only.
- `features/chat/ExternalLink.test.tsx:21` repeats the false "needs a node environment" comment.
- `packages/sidecar/src/tools/ask-user-question.ts:29-41, :59-64`: the Claude AskUserQuestion schema and mapping drop `secret` (M9).
- Source bug: `QuestionCard.tsx:135` and `ToolApprovalCard.tsx:147` check only `isComposing`; `ComposerEditor.tsx:101` also checks `keyCode === 229` (M3).
- Source bug: `ModelPicker.tsx:200-211` drops the load error and shows "No models found, install or sign in" when `loadModels` fails.
- Source smell: `ModelPicker.tsx:339` passes `applyConfig` as `onPick`, bypassing `pickFavorite` (:261); two copies of the availability rule (M7).
- Source smell: `PermissionGrantCard.tsx:60` and `McpFormCard.tsx:152` call `Date.now()` inside an effect instead of taking time as input.
- Source smell: `ModeChips.tsx:50-51` keeps accept-edits state in the component, so remounting the composer resets the chip while the sidecar may still auto-accept (reported before as audit s2-1-ui-1 COMP-03).
- Source smell: `registry.ts:37` and `cards/SubAgentCard.tsx:1` import each other.
- Source smell: `use-draft-sync.ts:81` assigns a ref during render.

### 8.5 Sidebar

Source bugs (file:line):

- `features/sidebar/PinnedSection.tsx:64-69`: a drop of an unpinned workspace is cancelled because the id is searched only in the pinned list (C1).
- `features/sidebar/SectionList.tsx:273`: header drop always places the dragged section after the target; the first position is unreachable.
- `features/sidebar/SectionList.tsx:347-353` with `use-workspace-drag.ts:136-140`: dropping an outside workspace on a section row is ignored.
- `features/sidebar/SectionList.tsx:222,374`: dead `renaming` state and a second `SectionDialog` per section.
- `features/sidebar/WorkspaceRow.tsx:111-116`: hover key R works only while the row has focus (C5).
- `features/sidebar/next-unread.ts:83`: skips only `state === "archived"`; the sidebar hides `archiving` and `archivedAt` too (`core/workspace-open.ts:15`). Line 43: `updatedAt ?? ...` never falls through, `updatedAt` is a number.
- `features/sidebar/GroupedWorkspaces.tsx:61`: `manualOrder: false` is hard-coded, so the `manual_workspace_order` setting changes nothing in the main list (SectionList reads it, :64).
- `features/sidebar/AddProjectButton.tsx:39-45` and `core/services/command-runner.ts:143-148`: the pick-folder-then-add flow exists twice, with different error handling (toast versus returned `Result`).

Out of area:

- `app/router.tsx:298-306` and `app/CreateWorkspacePage.tsx`: the create route has no `validateSearch` and the page never reads `repo` or `section`, though the sidebar links pass them (known: `system.tsv:2862`, NAV-17).
- `app/shell-test-support.ts:4-5` says `createTestContainer` cannot run under jsdom; `test/sqlite.ts:12-16` and 8 sidebar tests prove it can. The comment is stale.
- `features/chat/NextUnreadButton.nav-11.test.tsx:19-21` mocks all of `@tanstack/react-router` with only `useNavigate`; the navigation target (`search: { tab, sessionId }`) is checked against a mock, not the router.
- `app/command-dispatcher.ts:477-487`: sidebar tests depend on the module-level `defaultRegistry` and `clearCommandHandlers`; a test that forgets the cleanup leaks handlers to the next test (architecture.md: "no module-level mutable state").

### 8.6 Workspace and tab strip

Source bugs seen while reading (verified by reading only; not run).

1. active-tab.ts:121-122: `searchPatchFor` for a file tab returns only `tab` and `path`, so the file's mode, scope and line are dropped when a file tab is re-selected through the strip (TabStrip.tsx:222-223, :288); the test at active-tab.test.ts:81-83 pins the loss.
2. SplitPanes.tsx:293-307 and tab-layout.ts:49, :264, :290: `sizes` is written but never read, and there is no resize handle between groups. The NAV-10 title says "split panes" and the strip header says tabs can be dragged; resize is not built and not on the checklist as such, but the field is dead state.
3. SplitPanes.tsx:187-193 and :230-233: the main strip has no drop target (TabStrip.tsx has no `onDrop`), and dropping a split-pane tab on the main centre calls `split` for a group that does not hold it, which returns the same tree. A tab dragged into a split pane can only come back by closing the pane.
4. TabContent.tsx:89: `TerminalView` is rendered without `onNewTerminal` or `canStartNew`; an ended centre terminal shows a dead restart control (step-3 audit RUN-06 item, still present).
5. ChatHistoryButton.tsx:51-67: reopening a closed chat from history ignores the tab limit (the limit gates only the "+" menu and Cmd+T, TabStrip.tsx:294-301). Not verified against Conductor; the research says the "buttons disable at the tab limit".
6. WorkspaceHeader.tsx:177-188: no PR or git buttons when the right panel is closed (checklist item, `ui.tsv` says covered).
7. ArchivedNotice.tsx:21-22 and status-text.ts: visible words differ from the research (L1).
8. app/shell-test-support.ts header says `createTestContainer` "cannot run under jsdom"; test/container.jsdom.test.tsx and features/sidebar/WorkspaceRow.nav-11.test.tsx show it does. The header is stale and may keep authors from using the real container (feeds M12).
9. features/home/WorkspaceCard.tsx:28 and features/sidebar/WorkspaceRow.tsx:27 import `statusText` and `WorkspaceStatusIcon` from `features/workspace`. architecture.md says workspace status words live with the core status rule; the sidebar and Home now depend on a sibling feature folder. Not a bug; a layering note.
10. Core (out of area, one line): core/hooks/workspaces.ts:104 and :162 build the same `workspace_unknown` error with the same message in two hooks; a shared factory would remove the copy and give the gate a constant to key on.

### 8.7 Scripts panel, settings, terminal, diff

- core/services/terminals.ts:399, 411: `history` is a fixed empty `Uint8Array` that nothing fills, so the saved-screen replay the terminal view relies on (ended terminals readable after restart) has no data. Check with the terminals service owner.
- TerminalSurface.tsx:287 with TerminalTabBody.tsx:61: tab switch rebuilds xterm (C1).
- TerminalFindBar.tsx:84, 126 and TerminalSurface.tsx:139, 210-215: string index used as cell column (C5).
- TerminalSurface.tsx:157: `convertEol: true` (prior LATER finding, still present).
- RunTab.tsx:70: `isSpotlight: false` is fixed, so `start_spotlight` and `stop_spotlight` (run-button-label.ts:38-49) can never be reached from the Run tab, while RepoActionsPage.tsx:280-284 offers the Spotlight switch.
- RunTab.tsx:145: `canAskAgent={false}` is fixed, so the "Ask agent" button on the Run empty state is always disabled.
- RepoMiscPage.tsx:259-260, 281: `matches={null}`, `source="settings"`, `runningAgentCount={0}` fixed (C13).
- ScriptsPanel.tsx:141-145 mounts `PortsTab`, which is `notImplemented("RUN-03")` and throws on render (ports/PortsTab.tsx). It will crash the panel the first time `detectedPorts` is not empty, unless RUN-03 lands first.
- DiffView.tsx:89: both file texts hashed on every render (L10).
- core/services/repo.ts:965-977: `resetRunAction` has no test and its merge semantics are unconfirmed (C8).
- docs/plans/backlog.md: RUN-01 and SET-07 rows are `stub` while their UI files are built and tested; RUN-06, SET-03, WS-03, REV-02 are `done` with the gaps in C14 and D. Settle the rows with the owner before the slice closes.

### 8.8 Git panel, Home, onboarding, app-04 state files, kanban

- `core/hooks/git.ts:104`: `useBranches` is `notImplemented("WS-02")`, so the Target branch scope cannot be chosen in the live app although REV-01 is `done`.
- `core/services/workspace.ts:1224-1229`: `unarchive` is `notImplemented("WS-06")`; Home's Unarchive is a dead button (see M7).
- `core/services/github.ts:1466-1475,1535-1547`: placeholder methods are plain functions that throw synchronously instead of returning a rejected promise or an `Err`; callers see a throw before they can wrap it.
- `core/services/git.ts:987`: `commitAndPush` (and `github.create`) have no single-flight, so every caller must guard (M5).
- `features/git-panel/GitHeader.tsx:381`: `.then(settle, settle)` discards the rejection reason (M6).
- `features/home/WorkspaceCard.tsx:70-77`: busy flag is not cleared when the action throws; `:72-75` ignores `needsBranchName` and `uncommittedChangesLost`.
- `features/home/HomeEmptyState.tsx:30`: "Nothing is archived" shown for any active filter plus the archived toggle.
- `features/home/home-query.ts:13` header: "page 2 of 60 results has 10 items" contradicts the cumulative paging at `:113-114` (audit LATER, still open).
- `app/router.tsx:362`: the onboarding route exists but nothing sends a first launch there.
- `app/shell-test-support.ts` header (`:12-13`) says `createTestContainer` cannot run under jsdom; Home and onboarding tests use it under jsdom. The header is stale.
- `docs/plans/backlog.md`: GIT-04 (`:237`) and NAV-05 (`:148`) rows are still `stub` while their code is built (the D041 mark-done step has not run).

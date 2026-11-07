# Audit n15-s1-ui-1 (APP-03, APP-07, APP-10, CHAT-13, CHAT-22, CHAT-23, CHAT-24, CHAT-25)

Paths are relative to `apps/desktop/src/`. Read only; no test suite was run.

## APP-03 Diagnostics page and log export

- MUST `features/diagnostics/diagnostics-report.ts:9` and `:166-252`: the header says "Hashing is passed in (it needs the platform's crypto)", but the file holds a hand-written SHA-256, and both `writeRedactedReport` (line 153) and `DiagnosticsScreen.tsx:33,~63` import `shortSha256` directly. The header claim is false, and hand-rolled crypto sits in a feature file. Fix: use Web Crypto (async) or add a `Platform` hash method, and make the hash a real parameter. Or cut the claim. Nothing else in `src/` hashes; Rust already has SHA-256 for downloads.
- MUST `features/diagnostics/diagnostics-report.ts:62-75`, `:130`, `:137`: `redactCapture` only strips the home folder from `path`. `capture.agents[].path`, `capture.sidecar.logPath` and `capture.shell` keep the full home path (the user name) in the "redacted" report, the on-screen redacted view and the file attached to the chat. Fix: run `redactHome` over those fields in `redactCapture`, and add a test with a home-folder agent path.
- MUST `features/diagnostics/DiagnosticsScreen.tsx:197` and `EnvironmentReport.tsx` header ("sections that failed to capture (each shows its own error and Retry)"): the screen always passes `failedSections={[]}` and `onRetrySection` just re-runs the whole capture. The capture is all or nothing, so the per-section error path has no live caller. `EnvironmentReport.test.tsx:60` tests it only with a hand-made prop. Fix: cut the claim and the prop, or make `captureDiagnostics` report failed sections.
- MUST `features/diagnostics/EnvironmentReport.tsx:113`: `key={entry}` repeats when PATH holds the same folder twice (common on macOS), giving duplicate React keys and wrong rendering. Fix: key by index plus entry (or use `withKeys`). Add a duplicate-PATH test.
- LATER `features/diagnostics/DiagnosticsScreen.tsx:126`: the new chat's id is read as `byWorkspace[id][0]`. This is right only while `create` prepends (`sessions.ts:469`). Fix: have `createDiagnosticsChat` return the new session id.
  Outcome: fixed already, 30a388db `createDiagnosticsChat` returns a `Result` and the screen awaits it directly; the `byWorkspace[id][0]` read is gone (`DiagnosticsScreen.tsx:149`).
- LATER `core/services/sessions.ts:1318-1352` (`createDiagnosticsChat`): the redacted report file in the temp folder is never removed. The draft written with `saveDraft` is left behind if the send fails and the chat is deleted. Fix: trash the file after the send, and clear the draft on the failure path.
  Outcome: open, item APP-03 - the report file is still never trashed and the draft survives the failure path (`core/services/sessions.ts:1307-1341`).
- LATER `platform/memory.ts:1123` and `DiagnosticsScreen.test.tsx:105,200`: the stand-in returns `conducted-logs.zip`, but the real `logs_export` (`src-tauri/src/logger.rs:572`) writes `.ndjson`. The Copy logs flow reads the file as text, so a zip would copy garbage. Fix: name the stand-in file `.ndjson`. Several screen tests use `vi.spyOn(...).mockResolvedValue` on `exportLogs` where the real stand-in would do.
  Outcome: open, item APP-03 - the memory stand-in still names `conducted-logs.zip` (`platform/memory.ts:1134`), and the tests still expect it.
- LATER `features/diagnostics/DiagnosticsScreen.tsx:93-118`: Copy logs reads the whole log file into the clipboard with no size limit.
  Outcome: open, item APP-03 - Copy logs still reads the whole exported file with `readText` and copies it (`DiagnosticsScreen.tsx:134-139`).
- Items without a test that would fail without the feature: none found. Every checklist item has a test, but see the `failedSections` finding above.

## APP-07 Resource usage table

- LATER `features/sidebar/ResourceUsageTable.tsx:157-175` and test `ResourceUsageTable.app-07.test.tsx:162`: a process above the 512 MB dial (our own number, line 48) is logged on every 5 s poll, and the test locks that in. One heavy agent gives about 12 log lines a minute for as long as it runs, and the polling runs even when the table is hidden. Fix: log on crossing the threshold (remember the pid), and report the dial as a setting or a named constant with a reason.
  Outcome: open, item APP-07 - `logHeavyProcesses` still writes a line on every poll for every process above the dial (`ResourceUsageTable.tsx:162-180`).
- LATER `features/sidebar/ResourceUsageTable.tsx:143` imports `formatFileSize` from `features/file-viewer/preview/PreviewUnavailable.tsx` (a component file), while `features/settings/pages/AdvancedPage.tsx:258` keeps its own `formatBytes`. Two byte formatters. Fix: move one to a shared helper and use it in both.
  Outcome: open, item APP-07 - `formatFileSize` is still imported from a component file and `AdvancedPage` still keeps `formatBytes` (`ResourceUsageTable.tsx:46`, `AdvancedPage.tsx:325`).
- LATER `features/sidebar/ResourceUsageTable.tsx:236-243`: the poll's failure is shown in the popover, but a failing poll while the table is hidden is silent. Acceptable, noted.
  Outcome: stale, the behaviour is unchanged and the audit already accepted it as noted (`ResourceUsageTable.tsx:236-243`).
- The header claims all hold (setting off renders nothing, skeleton, one-line error, sorting, exit between polls, copy). Each has a test.

## APP-10 Dismissible hints (callouts)

- LATER `features/settings/pages/GeneralPage.tsx:80-84`: `dismissCallout` reads `dismissedIds` and writes `[...dismissedIds, id]`. Two dismissals before the store updates lose one. The read-modify-write logic also lives in a page, so a second page with a callout would copy it. Fix: a small `useCalloutDismissal(id)` hook beside `Callout`.
  Outcome: open, item APP-10 - the page still does the read-modify-write itself (`GeneralPage.tsx:91-96`).
- LATER `features/settings/pages/GeneralPage.tsx:90` and `ResetCalloutDismissals.tsx:25`: a failed reset shows an error twice (toast and inline alert). Pick one.
  Outcome: open, item APP-10 - the reset failure still reaches both a toast (`GeneralPage.tsx:101`) and the inline error in `ResetCalloutDismissals` (`ResetCalloutDismissals.tsx:70-73`).
- LATER `features/settings/ResetCalloutDismissals.tsx:33-42`: it mirrors the stored list in local `ids` state with a sync effect. Derive from props, and clear on success through the prop.
  Outcome: open, item APP-10 - the component still mirrors the list in local state with a sync effect (`ResetCalloutDismissals.tsx:33-43`).
- LATER: the only live `Callout` is the page's own "how to reset" hint (`GeneralPage.tsx:105`). The send-button hint named in the header has no caller. Allowed by the issue, but nothing proves a real feature uses it.
  Outcome: open, item APP-10 - the only `Callout` use is still the General page's hint; no other feature mounts one.
- Items without a test: none. Component, reset, error, double-click and the settings round trip are all tested.

## CHAT-13 Progress tracker above the composer

- none. Header claims match the code (empty block list clears, new turn clears, steer keeps, `progressUpdates` gates the tool in the sidecar `mcp-launch.ts:61`). Tests cover done/in-progress/pending, failed, done, "No tasks", nothing, and the real container.

## CHAT-22 Codex visualizations in the chat

- MUST `features/chat/CodexVisualization.tsx` header ("cannot reach the network") vs `:46-47`: the CSP is `default-src 'none'` and does not cover `form-action` or the frame navigating itself, so a script in the page can leave the sandbox's network block by navigating (`location = "https://..."`). The page can only send what is in its own file, but the claim is too strong. Fix: add `form-action 'none'` and either soften the claim or test it. No test checks the CSP text at all.
- LATER `features/chat/CodexVisualization.tsx:236-241` and `tools/cards/WriteCard.tsx:67`: the frame runs for every Codex write of any `.html` file (a project template, for example), not only a file Codex marked as a visualization. This is stated as our design choice, but it runs scripts from project files on every write card. Fix: confirm what event Conductor keys on before shipping.
  Outcome: open, item CHAT-22 - the write card still opens the visualization for any `.html` file Codex writes (`CodexVisualization.tsx:236-241`).
- LATER `features/chat/CodexVisualization.tsx:64-77`: the "inside the workspace" check is lexical. A symlink inside the workspace that points out of it is read as if inside.
  Outcome: open, item CHAT-22 - the check still compares resolved strings without following a link (`CodexVisualization.tsx:73-83`).
- Items without a test: CSP and the `form-action` gap (above). The rest are tested.

## CHAT-23 Run button on shell code blocks

- MUST `features/chat/CodeBlock.tsx:199` (`start`) with `:158-160`: Run executes the full `code`, but a block over 4,000 characters shows only the first 4,000 until "Show all". The user can run text they have not seen. Fix: require "Show all" first, or run the shown text only. Add a test with a 5,000-character block.
- MUST `features/chat/CodeBlock.tsx:82`: `setOutput(previous + chunk)` has no cap. A command such as `yes` or a verbose build grows the string and the `<pre>` without limit (each chunk copies the whole string). The test rules ask for tests at real size and stores need a lifetime. Fix: keep the last N kilobytes and say "earlier output cut". Add a test with a few megabytes of output.
- LATER `features/chat/CodeBlock.tsx:104-113`: a user's Stop shows "Stopped" even if the command had already exited with code 0 during the stop. Use the exit event first.
  Outcome: open, item CHAT-23 - `runStatus` still returns "stopped" whenever the stop flag is set, even when the exit code is 0 (`CodeBlock.tsx:75-78`).
- LATER `features/chat/CodeBlock.tsx:80-90`: output produced before `CommandRunView` subscribes may be lost. This needs checking against what `useTerminalConnection` replays; no test covers a command that prints and exits at once.
  Outcome: open, item CHAT-23 - the subscription still starts in the view's effect after the command can have run, and no test covers print-and-exit (`CodeBlock.tsx:104-121`).
- LATER `features/chat/CodeBlock.tsx` header ("memoised on the text"): `CodeBlock` is not wrapped in `memo`. This is old CHAT-06 text; fix the claim or add `memo`.
  Outcome: open, item CHAT-23 - `CodeBlock` is still not wrapped in `memo` and the header claim remains (`CodeBlock.tsx`).
- LATER: the run terminal keeps running when the block unmounts, and no one stops it. State that as a design choice or stop it.
  Outcome: open, item CHAT-23 - the view unsubscribes on unmount but never stops the terminal (`CodeBlock.tsx:115-121`).
- CHAT-23 has no owning-file header of its own in the issue. Tests: `CodeBlock.chat-23.test.tsx`, `...-output.test.tsx`, `terminals.chat-23.test.ts` cover Run, output, exit code, failed, stop and clear.

## CHAT-24 Mermaid diagrams and video in replies

- MUST `features/chat/MermaidDiagram.tsx:114` (`catch {`): the real error is dropped. A failed dynamic `import("mermaid")` (chunk missing) and a parse error both show "This diagram could not be drawn", and nothing is logged. Fix: separate the load failure from the parse failure, and hand the error message on (at least to the log).
- MUST `features/chat/MermaidDiagram.tsx:200-203`: the header says "a very large diagram (the expanded view scrolls and zooms)", but the zoom uses `transform: scale()` with `origin-center`. Scaled content grows in all directions, and the scroll area only covers right and bottom, so the top and left of a zoomed-in diagram cannot be reached. Fix: use `origin-top-left`, or size the wrapper by the zoom. The test only reads `data-zoom`, so it cannot see this (jsdom has no layout).
- MUST `features/chat/ChatVideo.tsx` header ("several videos in one reply (starting one pauses the others)"; "no autoplay and no sound until the user starts it"; "a file still being written"): no test starts a second video, and none checks autoplay. The "still being written" claim has no code or test. Fix: add the tests, or cut the lines.
- LATER `features/chat/ChatVideo.tsx:95,125`: the "web address, not loaded" message is almost unreachable, because `AssistantText.tsx:237` turns any http(s) target into a link first. The other half of the claim (non-http schemes) is untested.
  Outcome: open, item CHAT-24 - the message is still there but a plain http(s) target becomes a link in `AssistantText` first, and no test covers the other schemes (`ChatVideo.tsx:88`).
- LATER `features/chat/ChatVideo.tsx:88` and `AssistantText.tsx:251`: "Open in another app" for a path outside the workspace calls `actions.app.openUrl(src)` with a file path. Check that `openUrl` accepts a path.
  Outcome: open, item CHAT-24 - "Open in another app" still hands a file path to `openUrl`, and nothing checks it (`ChatVideo.tsx:88`).
- LATER `features/chat/ChatVideo.tsx:61-67`: the workspace check is lexical, so a symlink out of the workspace is not caught.
  Outcome: open, item CHAT-24 - the path check still works on the string form without following a link (`ChatVideo.tsx:38-46`).
- LATER `features/chat/MermaidDiagram.tsx:50-65`: `sanitizeSvg` removes `script`, `foreignObject`, `on*` and `javascript:` links, but keeps `<image href>`/`<use href>` to remote URLs. Mermaid's strict level covers most of it. The test only checks the first two.
  Outcome: open, item CHAT-24 - the sanitiser still keeps remote `image`/`use` references and the test checks only scripts and event handlers (`MermaidDiagram.tsx:58-76`).
- LATER `features/chat/MermaidDiagram.tsx:95-100`: `mermaid.initialize` is global and called per diagram. Two diagrams with different themes would race.
  Outcome: open, item CHAT-24 - `mermaid.initialize` is still called globally for each diagram (`MermaidDiagram.tsx:121`).
- LATER: no test for zoom limits (0.5 and 3), for Escape closing the expanded view, or for the licence check. The licence line in the header ("MIT, checked 2026-11-06") is a claim with no script behind it.
  Outcome: open, item CHAT-24 - no test covers the zoom limits, Escape closing the expanded view, or the licence claim.

## CHAT-25 Turn outline and jump list

- MUST `features/chat/MessageList.tsx:143-149` (`onJumpToTurn`) and `MessageList.chat-25.test.tsx`: the only integration test counts ticks. Nothing checks that picking a turn calls `scrollToIndex` with the right index, or that the current-turn highlight follows `rangeChanged`. The header claims "the caller scrolls by index". Fix: add a test over `MessageList` that picks the second turn and asserts the scroll.
- LATER `features/chat/MessageList.tsx:131-135`: `rangeChanged.startIndex` includes the 600 px of overscan (`increaseViewportBy`), so the highlighted turn can be one above the visible top. Verify, and use the first visible item if so.
  Outcome: open, item CHAT-25 - the highlight still uses `rangeChanged.startIndex`, which includes the overscan, with no adjustment (`MessageList.tsx:167-175`).
- LATER `features/chat/TurnOutline.tsx` header ("2,000 turns (grouped ticks and a virtualised list)"): the 2,000-turn test only counts ticks; the virtualised list is not tested at that size.
  Outcome: open, item CHAT-25 - the large-chat test still counts ticks only and does not exercise the virtualised jump list at 2,000 turns.
- LATER `features/chat/TurnOutline.tsx:24,131`: imports `radix-ui` directly instead of the shared `ui/Popover` for `Close`.
  Outcome: open, item CHAT-25 - `TurnOutline` still imports `radix-ui` directly for the close button (`TurnOutline.tsx:24`).

Summary: APP-03 4 MUST + 4 LATER; APP-07 0 MUST + 3 LATER; APP-10 0 MUST + 4 LATER; CHAT-13 none; CHAT-22 1 MUST + 2 LATER; CHAT-23 2 MUST + 4 LATER; CHAT-24 3 MUST + 6 LATER; CHAT-25 1 MUST + 3 LATER.

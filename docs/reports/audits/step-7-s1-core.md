# Audit n7-s1-core (step 7)

Read from `git show overnight/step-7:<path>` and the diff against main. Nothing was run. Issue #141 checked against `tunnel.ts`, `handlers.ts`, `resume.ts`, `core/services/sessions.ts` and `container.ts`.

## CHAT-18 Resume after restart and reconnect

1. **MUST** `apps/desktop/src/core/services/sessions.ts` (`applyLiveState`, about line 1039): `void this.#deps.repositories().liveStates.upsert(...)` drops the Result. A failed write is invisible, and the stored live state drifts from the screen. Fix: make `applyLiveState` return a Promise of Result (or log the Err through a dep) and have the handler and resume report it.

2. **MUST** `sessions.ts` `applyLiveState` (about line 730): the store update only sets `openInteractions` when the new live state has an open interaction. A live state without one never clears an old card. After `markInterrupted` (idle live state) or a sidecar `liveState` with `openInteraction` gone, a stale question card stays on screen. Fix: delete `openInteractions[sessionId]` when `openInteraction` is undefined, and settle the waiting interaction as `withdrawn`, as `applyStoredEvent` does. Add a test.

3. **MUST** `core/sidecar/resume.ts:59-80`: the status answer is applied after an await with no newest-answer guard. A `liveState` notification (or a `turn_ended`) that lands between the `getSessionStatus` request and its answer is overwritten by the older status. This breaks the "only the newest async result changes state" rule in docs/engineering.md. Fix: compare the chat's live state before and after the await and drop the answer if it changed, or stamp the request. Test it with a notification arriving mid-request.

4. **MUST** Issue rule "After a restart the UI ... re-sends warm with resume" is not built. No code outside `tunnel.ts` mentions `warmAgent`, and `resume.ts` neither warms nor claims to. The next `send` does carry `resume: { agentSessionId }` (`sessions.ts:539`), so the chat does continue, but the checklist item is skipped. Fix: warm each adopted or interrupted chat with its stored agent session id after resume, or change the issue item and the backlog row through a decision. No test covers it.

5. **MUST** `sessions.ts` `markInterrupted` (about lines 1128-1150) duplicates `core/db/repair.ts` (build a `turn_ended` event with outcome `interrupted`, fresh id, current time, for each turn found by `findInterruptedTurns`). It also calls `findInterruptedTurns()` for every chat and then filters by session id, so one lost chat scans all chats. Fix: a per-session query (or a parameter on the existing SQL), with the event-building shared between repair and the service in one helper. Also `this.#deps.newId() as EventId` is an unchecked cast.

6. **MUST** `markInterrupted` is not atomic. Each `turn_ended` is appended on its own, then the idle live state is applied. A failure part-way leaves some turns closed and the chat still "working", and the idle write ignores errors (finding 1). Fix: do the appends in one transaction, apply the idle live state only after they commit, and return the live-state write's Err.

7. **MUST** `core/sidecar/handlers.ts:135-137`: the `sessionEvent` notification handler awaits `ports.ingest.ingest(envelope)` and throws away the Result. Header: "Each handler only translates ...". Ingest logs its own failures, but the handler gives the tunnel no signal. Fix: if ingest owns the log, say so in a comment. Otherwise log the Err here.

8. **MUST** `handlers.ts:141-143`: the `agentSessionId` handler discards the Result of `setAgentSessionId`. If the write fails, the next message after a restart cannot resume, and nothing reports it. Fix: log the Err (or throw so the tunnel logs -32603). Add a test for the failing write.

9. **MUST** `handlers.ts` header says "`shellEnvFailed` reports the folder, kind and message to the caller". The only implementation (`container.ts` `shellEnv.captureFailed`) writes a log line. No caller sees it. Fix: change the header to "logs", or surface it to the user as the issue intends.

10. **MUST** `handlers.ts` header says "a session id the UI does not know gets a clear error text, never a crash". Only `getWorkspaceDiff` has such a path (error text in `diff`). The other handlers do not check the id. `deliverEvent` for an unknown chat is acked and dropped by ingest, which is not the same claim. Fix: narrow the header to what the code does.

11. **MUST** `core/sidecar/tunnel.ts:405` (`#reconnect`): `for (const listener of this.#reconnectedListeners) listener();` has no try/catch. A throwing listener rejects `#ready`, so every later `request` and `notify` throws into callers. This breaks the header line "never a throw into the caller". Fix: wrap each listener, log the error, and continue.

12. **MUST** `container.ts` `workingSessionIds` reads only the in-memory `liveStates`. The header of `resume.ts` says "from memory and from stored live states". Repair resets stored live states to idle before the UI loads (`repair.ts` `resetLiveStates`), so the startup run of "resume chats" finds nothing. Only the reconnect run does real work. Fix: correct the header and the issue wording, or look at queued or open-turn chats at startup too (see finding 6 on what is "working").

13. **MUST** Test gap: `container.app-01.test.ts:125` mocks `onReconnected`, and no test starts a container and restarts the sidecar. The wiring `tunnel.onReconnected -> resume.resume()` and the "resume chats" start step (`container.ts:499` and `:609`) would not fail if removed. Fix: one container test that emits a restart on the fake transport and checks that a lost working chat is closed as interrupted.

14. **MUST** Test gaps against the issue checklist:
    - "A chat resumes after an app restart or sidecar reconnect without losing events": no test replays unacked events across a reconnect and checks that duplicates are not stored. (Ingest's duplicate test is DATA-04's.)
    - "Dedupes replayed events": the same.
    - "Each RPC method has its own timeout": `tunnel.chat-18.test.ts` checks one method pair, not that `getSessionStatus` (5 s) differs from the default.
    - The "Record the agent's session id" handler test uses a fake port. The real write is covered only by `sessions.chat-02.test.ts`, not through the notification path.
    - "A turn cut off by a crash is shown as 'interrupted'": the resume test checks stored events, but no test checks the screen (`TurnItem.tsx:60`).

15. **LATER** `tunnel.ts` `request`: after a timeout, the pending request stays registered in the endpoint until restart or stop. A late answer is ignored, but the entry leaks. Fix: reject the pending id on timeout (library has no per-id cancel, so track ids in the tunnel).
    Outcome: fixed already, 59393e00 — the timeout callback now rejects the pending entry through `endpoint.client.receive(createJSONRPCErrorResponse(...))` after the race (`apps/desktop/src/core/sidecar/tunnel.ts:242-253`).

16. **LATER** `tunnel.ts` `#reconnect`: if the second `ensureStarted` fails, `#ready` stays an Err forever. Every request fails with that error until the next restart signal. Fix: retry with a backoff, or clear `#ready` so the next request tries again.
    Outcome: fixed already, 87eb35f1 — a failed `ensureStarted` now schedules `#startReconnect` after `backoff.fail()`, so another attempt runs without a new signal (`apps/desktop/src/core/sidecar/tunnel.ts:477-491`).

17. **LATER** `tunnel.ts` `RPC_TIMEOUTS_MS`: the numbers are labelled "Our design choice", but nothing in the research cites them. Fix: cite the services-map 1.5 values if it has them, or record the choice in `docs/decisions.md`.
    Outcome: open, item CHAT-18 — `RPC_TIMEOUTS_MS` still carries "Our design choice" with no research citation (`apps/desktop/src/core/sidecar/tunnel.ts:100-113`), and `docs/decisions.md` has no entry for these values.

18. **LATER** `handlers.ts`: `getDiffComments`, `addDiffComments`, `getTerminalOutput`, `setTargetBranch`, `progress`, `agentConfigChanged`, `interactionClosed` and `goalChanged` still call `notImplemented` with other feature ids (REV-03, RUN-07, GIT-08, CHAT-13, SIDE-20, CHAT-11, COMP-10). The header's `@feature CHAT-18` and "one handler per method" overstate this. Fix: say which handlers are live, or accept it because the stubs name their owners. `container.ts` already wires the real ports for four of them, so the stubs hide working code.
    Outcome: fixed already, 62f7c047 — `apps/desktop/src/core/sidecar/handlers.ts` has no `notImplemented` left; every handler calls a port.

19. **LATER** `handlers.chat-18.test.ts` header says the test checks that the ack is sent. The ack belongs to `EventIngest`. The test uses a fake ingest, so "sends the ack" is untested here. Fix: reword the "Test first" line or add a case with the real `EventIngest`.
    Outcome: fixed already, 87eb35f1 — the test header now says a `deliverEvent` request for a stored event answers `persisted: true`, with no ack claim (`apps/desktop/src/core/sidecar/handlers.chat-18.test.ts:1-5`).

Behaviour against Conductor (D020, D022): reconnect and interrupted marking follow sessions.md 8. The missing pieces are findings 4 and 12.

Summary: CHAT-18 has 19 findings (14 MUST, 5 LATER).

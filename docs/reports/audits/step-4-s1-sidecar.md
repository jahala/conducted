# Audit n4-s1-sidecar (branch overnight/step-4 against main)

Scope: SIDE-03 only (`packages/sidecar/src/session/{manager,serial-queue,queued-messages,steering,duplicate-guard}.ts` and tests, plus the desktop wiring for `setAutoApproveEdits`). Read-only. The suite was not run.

## SIDE-03 Session manager

1. **MUST** `packages/sidecar/src/session/manager.ts:559-580` (`prepareRequest`): the issue says prompt assembly gets "the first-message flag, the pull request's repository and the workspace preferences". `PromptInput.pullRequestRepositoryFullName` exists (`prompt/assemble.ts:45`), but the manager never passes it, and `sendMessage` has no field to carry it. The test at `manager.test.ts:758` checks only `text`, `firstMessage` and `workspace`. I did not verify where preferences come from. Fix: carry the repository name on the wire (or read it from `WorkspaceContext`), pass it in, and assert it in the test. Also confirm how preferences reach the assembler.

2. **MUST** Checklist item "Wire the RPC, composer chip and setClaudeEditAutoAccept end to end and add its end-to-end test" is not done, yet the backlog row is `done`.
   - The sidecar side exists (`manager.ts:433-441`) and the app service forwards it (`apps/desktop/src/core/services/sessions.ts:619`).
   - Nothing calls `setAutoApproveEdits` from a screen. `features/composer/ModeChips.tsx` toggles `requireToolApproval` through `updateConfig` (see its header).
   - No test crosses UI, RPC and sidecar. `sessions.test.ts:327` and `manager.test.ts:846` each cover one side with a fake.
   - Fix: make the chip call the action (or drop the action and the item with a decision entry), and add the end-to-end test. Otherwise set the row back to `stub` or open a visible task.

3. **MUST** `manager.ts:597-646`, `772-807`, D032 and the issue rule "Step 3: ours applies config with every message": `sendMessage` stores `state.config` but never calls `agent.applyConfig` for an agent that is already running. `claimAgent` reuses the live agent through `claimActive`, and only `updateConfig` (`manager.ts:417`) applies a changed config. A model or approval change that arrives only in the next `sendMessage` reaches the runner only if `Turn` passes `request.config` on. `Turn` is still a SIDE-04 stub, so nothing proves it. No test sends two messages with different configs and checks the runner. Fix: either apply the config in `startTurn` (live, or restart with resume) or state in the header that SIDE-04 does it, and add the test.

4. **MUST** `manager.ts:220` and `864-866`, `duplicate-guard.ts:72-76`: a steer is marked in flight when it is sent and cleared only by `steerConsumed` (`manager.ts:759`). If the turn ends before the agent reads the steer, `turnSettled` calls `cancelInFlight()`, which forgets the id entirely, including its remembered delivery. A later retry of that same messageId is "new" and starts a second turn with the same text. The duplicate test (`manager.test.ts:599-634`) only retries after `consumed` resolved. Fix: after a successful steer, move the id to the guard's "running" or "handled" state; leave only unsent ids in-flight. Add a test: steer, end the turn before `consumed`, resend the same id, expect `steer` and no new turn.

5. **MUST** Duplicated logic inside `manager.ts`:
   - The agent start closure is written twice: `warmAgent` (`351-365`) and `claimAgent` (`783-795`). Both do `runner.start`, set `state.agent`, `agentConfig` and `runner`, and apply `autoApproveEdits`.
   - "Agent kind changed, so dispose the old agent" is written three times: `334-336`, `409-412` and `588-595`. Each uses `sameAgent` plus `disposeAgent`.
   - Fix: one `startAgent(state, runner, config, workspace, env)` helper and one `replaceAgentIfKindChanged(state, config)` helper.

6. **LATER** `steering.ts:46`, `58-59` and `manager.ts:732-734`: the `cancelled` steer failure and the `drop` action are never produced. `steerFailure()` (`manager.ts:741-752`) never returns `{kind:"cancelled"}`, and cancellation is handled by the epoch checks at `678` and `700`. The header line "the user cancelled meanwhile: drop it quietly" describes a path that never runs, and cancellation has two mechanisms. Fix: delete the `cancelled` kind and `drop` action, or route the epoch check through `resolveSteerFailure`. Update the header.
   Outcome: open, item SIDE-03 — `steerFailure()` still never returns `cancelled` (`packages/sidecar/src/session/manager.ts:1226-1236`), the `drop` action and its header line remain (`steering.ts:16,58-59`; `manager.ts:1217-1219`), and cancellation still uses the epoch checks (`manager.ts:1110,1149`).

7. **LATER** `manager.ts:303`: `drain` after `cancel` does nothing, because the queue was cleared at `290` and `activeTurn` is null. Remove the dead call.
   Outcome: fixed already, aad02f59 — `cancel()` no longer schedules a drain; the only drain is after a turn or self-started work ends (`packages/sidecar/src/session/manager.ts:436-473`).

8. **LATER** `manager.ts:766` (`enqueue` calls `withdrawAll`): the header says only a new non-steering message and a steer withdraw the open interaction. A queued message arrives while the agent may be waiting for an answer, and withdrawing it would stall that turn. I found no support in `sessions.md`, `claude-runner.md` or `other-runners.md`. Fix: confirm against the research; if unsupported, remove the withdraw from `enqueue` and test that a queued message leaves the open question alone.
   Outcome: open, item SIDE-03 — `enqueue` still calls `this.deps.interactions.withdrawAll(...)` (`packages/sidecar/src/session/manager.ts:1250-1255`), with no research support recorded for withdrawing on a queued message.

9. **LATER** Checklist items with no test that would fail without the feature:
   - A steer with no active turn (`NoActiveTurnError`) starts a new turn if the session is idle, and is rejected if not. Only the pure function is tested (`steering.test.ts:25`). The mapping in `manager.ts:741-752` is not.
   - A failed queued message is logged and the next one is tried (`drain`, `manager.ts:870-881`).
   - Option changes are serialised on the lifecycle queue: no test that `updateConfig` waits behind a `sendMessage`.
   - `getSessionStatus` carrying pending steers and an open question (test at `manager.test.ts:718` shows only known and unknown).
   - A queued message for a chat whose agent kind changed (`manager.ts:241-246`).
     Outcome: open, item SIDE-03 — the idle-steer mapping is now tested (`manager.test.ts:803`) and a failed queued message has a test (`manager.test.ts:1570`), but serialised option changes and a queued message after an agent-kind change still have none.

10. **LATER** `manager.ts:316-321`, `340-346`, `366-371` (`warmAgent`): every failure is logged and the answer is `ok({})`. This is best-effort warming, so it is probably intended, but the header does not say so and no test covers a failing runner start. Add one line to the header and one test.
    Outcome: open, item SIDE-03 — `warmAgent` still logs every failure and returns `ok({})` (`packages/sidecar/src/session/manager.ts:476-532`), with no header line or failing-runner-start test.

11. **LATER** `manager.ts:259-264`: `Turn` is still a stub (`session/turn.ts:75,80` call `notImplemented("SIDE-04")`), so in production every new turn fails with the generic `send_failed` ("The message could not start a turn.") and the cause is only in the log. All manager tests use the `createTurn` fake. Fine while SIDE-04 is open, but the issue title promises "idle after flush", which only SIDE-04 can show. Fix: return the cause in the error, and add one manager test with the real `Turn` when SIDE-04 lands.
    Outcome: fixed already, 90288d42 — `Turn` is real, the manager returns a start's own error (`packages/sidecar/src/session/manager.ts:42-44,1017-1065`), and manager tests run the real pipeline with `realPipeline: true` (`manager.test.ts:1405,1421`).

12. **LATER** Header drift: the `manager.ts` header "Owns" list (lines 3-4) omits `setAutoApproveEdits`, which the interface has (`113`). The "Must handle" list says cancel "takes the end checkpoint", but that is done by `Turn.cancel`, not by this file.
    Outcome: fixed already, aad02f59 — the "Owns" list now includes `setAutoApproveEdits` and cancel "asks the running turn to take the end checkpoint" (`packages/sidecar/src/session/manager.ts:3-5,34-35`).

Clean files: `serial-queue.ts` (header, code and three tests agree), `queued-messages.ts` (FIFO and clear tested). Behaviour is consistent with D031 (delivery in place of a queued state) and D032 (one manager).

Summary: SIDE-03: 12 findings (5 MUST, 7 LATER).

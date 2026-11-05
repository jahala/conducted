# Test quality review: packages/sidecar, packages/protocol, packages/shared

Snapshot: commit `808d632` of `slice2/step-1` (slice 1 on main plus slice 2 step 1). Reviewed by reading only; no test, bun, vitest or cargo was run. Two things I did run, both read-only: `--version` of `claude`, `codex` and `opencode`, and `codex app-server generate-json-schema` into a temp folder (trashed afterwards) to get the real Codex wire types. Six sub-reviewers read the runner, session and model tests; I read the rest myself and checked every claim I repeat below against the code, the SDK type files or the generated Codex schema. Items I could not check by running are marked "by reading".

## 1. Summary

**Files read:** 106 test files (about 885 tests) and the sources they test: 100 in `packages/sidecar/src`, 5 in `packages/protocol/src`, 1 in `packages/shared/src`.

**Verdicts:** REAL 57, WEAK 48, THEATER 1 (`runners/codex/protocol.test.ts`). Eight more assertions inside WEAK files are theater: `manager.test.ts:1081-1082`, `utility-prompt.test.ts:270-307`, `session-mirror.test.ts:46`, `self-started-turns.test.ts` (~:143), `claude/translate.test.ts:383-398`, `claude/constants.test.ts`, `async-queue.test.ts:18`, `catalog.test.ts:254-284`.

**The three worst problems**

1. **The agent programs never meet the code.** There is no recorded session, no fixture file and no contract test for Claude Code, Codex, OpenCode or Pi. Every message is typed by hand, usually through `as unknown as`. Where I could compare with the real thing, it did not match: the Codex client filters frames with a library that requires `"jsonrpc":"2.0"`, and the real Codex schema has no such field, so by reading it drops every reply (CX-1); `turn/start` sends `sandbox` where the real field is `sandboxPolicy`, and the policy `on-failure` does not exist (CX-2); the Claude translator assumes one `init` per process while the SDK types say one per turn, which inflates cost from the second turn (CT-1); ACP tool frames carry a `name` the real OpenCode never sends (ACP-5); `claude auth status` fixtures use values the real CLI does not print (MD-7). Pi is not installed on this Mac, so its adapter has config-shape tests only.
2. **The seams between parts are untested, and at least six are unwired.** The sidecar cannot start (the startup path calls `AppToolsBridge.start()`, a SIDE-13 placeholder that throws; H-1); the 30-minute idle stop never fires for ordinary chats (nobody calls `markIdle`; H-3); `getContextUsage` always answers "unavailable" (H-2); Codex approvals are never registered (CX-3); AGENT-15 has no caller (CS-5); the ACP runner never receives the app-tools server (ACP-9); the agent detector is built without its Codex, Cursor and Settings ports (MD-1). `startSidecarHost`, the composition root, is not called by any test. The closed issues SIDE-02 and SIDE-06 list a real-host smoke test as an open checklist item.
3. **Nothing checks what the sidecar sends against the protocol schemas.** `zSessionEvent` is parsed only when the outbox file is read at startup. `append` writes events unvalidated, so one event with an empty id or a fractional token count is written, refused by the peer on every send and replay, and then makes `open()` fail with `outbox_corrupt` on the next start (H-4, SN-1).

**Judgement.** Where the code is pure or talks to a real system the suite is professional: the checkpoint script against real git repositories, the real Unix socket server, real child processes in `spawn-child` and `run-checkpointer`, the outbox and its replay, the process manager's rules, the watchdog and shutdown steps with injected time. Where parts meet each other or an outside program the suite is thin and its fakes are friendlier than the real thing (they answer at once, end streams cleanly on abort, accept any payload). The backlog shows `done` for features whose seams have no test; a line coverage of 90% hides it, because the uncovered lines are exactly the wiring.


## 2. Coverage


Measured on `main` (slice 1 only), CI run https://github.com/jahala/conducted/actions/runs/42059567155, from `coverage/summary.md` and `files.tsv`. Sidecar `bun test`: 87 files, 646 tests, 5.7 s. Lines 90.64% (7362/8122), functions 84.05% (838/997). Branches are not reported by Bun. The snapshot has 885 tests in my area, so slice 2's code (Codex, ACP, Cursor, tools bridge, self-started turns) is not in these numbers; I judged it by reading.

Line coverage is a weak signal here and I did not rely on it. The 100% for `packages/protocol` comes from importing schema files whose lines run when the module loads, so it says nothing about whether any schema is checked. The 96 to 98% for `session`, `claude`, `outbox` and `checkpoints` are real, but the review found missing behaviour tests in all of them (for example `claude-session.ts` is 97.5% covered while the checkpoint hook and MCP wiring lines at `:401-402` are executed by tests that assert nothing about them).

Least covered files that matter (main):

| File | Lines | Uncovered | Why it matters |
| --- | ---: | ---: | --- |
| `modes/sidecar-mode.ts` | 43.0% | 443 | The composition root. The largest uncovered file in the sidecar. `startSidecarHost` (about 250 lines) is not called by any test. |
| `tools/in-process-server.ts` | 14.3% | 6 | Claude's app tools: the real MCP wiring. |
| `tools/backend.ts` | 26.2% | 31 | `RpcAppToolBackend`: the app round trips for diff, comments, terminal, questions. |
| `tools/socket-bridge.ts` | 36.8% | 12 | SIDE-13 placeholder. |
| `models/slash-and-mcp.ts` | 44.4% | 10 | Slash command and MCP listing. |
| `runners/acp/acp-runner.ts`, `codex/codex-runner.ts`, `cursor/cursor-runner.ts` | 50.0% | 8 each | Runner `start()` is the live path. |
| `main.ts` | 61.0% | 16 | The real `import.meta.main` entry. |
| `process/process-manager.ts` | 61.9% | 8 | Idle stop and warm pool. |
| `rpc/handlers.ts` | 72.1% | 17 | Which module answers which request. |

Sidecar sources that no test loads at all (listed by the coverage run, 29 files): `logging/logger-server.ts`, `models/completions-cache.ts`, `modes/app-tools-mcp-mode.ts`, `modes/logger-mode.ts`, `process/launch-fingerprint.ts`, `runners/launch-env.ts`, `runners/claude/launch-settings.ts`, `runners/claude/skill-plugin.ts`, `runners/codex/goals.ts`, `runners/codex/thread-settings.ts`, `runners/cursor/*` and the slice-2 runners. I checked: the first ones are `notImplemented` placeholders, so no test is correct. `runners/claude/self-started-turns.ts` and `session/self-started-turns.ts` are the exception: real code. They are slice 2, so main does not load them; the snapshot has tests for them, but no production code imports them (CS-5). The same holds for `acp-client.ts`, `acp-session.ts`, `codex-session.ts` and `app-server-client.ts`, which are real code that main has no tests for.


## 3. Findings

Ids: H = host and wiring, CX = Codex, CT = Claude translator and permissions, CS = Claude session and runner, ACP, SN = session manager, MD = models and detection, TL = app tools. Every finding names the mutation a test misses and the fix. File paths are relative to `packages/sidecar/src` unless they start with `packages/`.

### MUST

Order of importance (the full text follows by area):

| Rank | Id | One line | Features |
| ---: | --- | --- | --- |
| 1 | H-1 | The sidecar cannot start (placeholder on the startup path) and no test starts the host | SIDE-01, 02, 06, 13 |
| 2 | CX-1 | The Codex client probably drops every real reply (`jsonrpc` field) | AGENT-06, 07, 08 |
| 3 | H-3, SN-10 | The 30-minute idle stop never fires; the test fake hides it | SIDE-07, 03, 04 |
| 4 | H-4, SN-1 | Events are never checked against the schema; one bad event bricks the next start | SIDE-05, 06 |
| 5 | CT-1, CS-6 | Cost and "Session started" wrong from the second turn (SDK says init is per turn) | AGENT-03 |
| 6 | H-2 | `getContextUsage` is always "unavailable" in production | SIDE-17 |
| 7 | CX-3 | Codex approvals are never registered in a live chat | AGENT-08 |
| 8 | MD-1 | The agent detector is built without its Codex, Cursor and Settings ports | SIDE-15 |
| 9 | CT-2, CT-3 | The edit-path sandbox has no hostile-path test and may not run in the default mode | AGENT-04 |
| 10 | CS-5, ACP-9 | AGENT-15 has no caller; the ACP runner never gets the app-tools server | AGENT-15, AGENT-11 |
| 11 | CX-2, CX-4 | Codex params and `skills/list` do not match the real protocol | AGENT-06 |
| 12 | SN-2 to SN-5 | Manager: the deadlock guard is thin, shutdown, overlapping turns and mid-way failures untested | SIDE-03, 04, 05 |
| 13 | CS-1 to CS-4 | Claude session: abort semantics, hung interrupt, resend after crash, hook wiring | AGENT-02 |
| 14 | ACP-1 to ACP-8 | ACP: temp-folder leak (will fail CI), no wire test, cancel race, sandbox | AGENT-11, 12 |
| 15 | H-5, H-6, H-7, H-8 | Outbox at size, flaky checkpoint timeouts, handler wiring, peer validation paths | SIDE-06, 08, 02 |


#### The host, the wiring and process lifetime (SIDE-01, 02, 03, 07, 19)

**H-1. The sidecar cannot start in the snapshot, and no test starts the host.** `startSidecarHost` (`modes/sidecar-mode.ts`, the startup step "start the app tools bridge") awaits `bridge.start()`. `AppToolsBridge.start()` is `return notImplemented("SIDE-13")` (`tools/socket-bridge.ts`), and `notImplemented` throws (`shared/not-implemented.test.ts` proves it). `runStartupSteps` has no try/catch, so the host rejects, `main.ts` prints "Not implemented: SIDE-13" and exits 1, before the socket is opened and without the other undo steps. I checked that `main` and `origin/main` have the same two lines. By reading; not run. The file header admits "Not yet covered: startSidecarHost has no test". `bun test` still reports 90% sidecar coverage because the other 600 lines of the file are covered by helper tests. The SIDE-02 issue (closed) lists "A smoke test starts the real sidecar host on a temporary socket path and sees the handshake line" as an open item; so do SIDE-06 and SIDE-01. Mutations missed in this one function: delete `server.listen()` from the startup steps; swap `eventPersisted`'s outbox for a no-op; build the `DelegatingApp` without `setPeer`; skip `peer.onAttach(...handleAppAttached...)` (no replay after reconnect). Fix: a smoke test that spawns `bun src/main.ts sidecar` with temp folders under `TMPDIR`, reads the `SOCKET_PATH=` line, connects, calls `getAgentInstalls`, `listModels` and `getSessionStatus` for an unknown chat, then sends SIGTERM and expects exit 0, the socket file gone and nothing left in the run folder. It fails today, which is the point: it is the spec for SIDE-13's landing. Run it once against the compiled binary on a Mac runner (`bun build --compile`), because `packaging.test.ts` checks only argument arrays.

**H-2. `getContextUsage` always answers "unavailable" in production.** `sidecar-mode.ts:643` builds `new SessionUsageReader({ logger })` with no `sessions` source, and the reader answers `context_usage_unavailable` without one. `usage.test.ts` always passes a source. Same bug class as slice 1's "every agent showed not installed". Mutation missed: any of the host's constructor arguments. Fix: a composition test that sends a message through the real manager with a fake runner and then calls the `getContextUsage` handler from `buildHandlers`; it must return tokens.

**H-3. The 30-minute idle stop never applies to a chat that ran ordinary turns; the test fake hides it.** By reading: `markBusy` and `markIdle` have one production caller, `session/self-started-turns.ts`, which nothing imports (CS-5). `manager.ts` releases the lease right after `turn.start()` returns (the `finally` at ~:632), and `AgentProcessManager.release()` then sets `busy = true` because no idle transition happened. Nothing marks the process idle when the turn ends, so `lastIdleAt` stays null (and `selectIdleToStop` skips `lastIdleAt === null`). `setBackgroundTasks` has no production caller either. Result: every `claude` or `codex` process lives until the sidecar exits. The manager tests use `FakeProcesses` (`session/manager.test.ts:279-310`) whose `release`, `markBusy`, `markIdle` and `setBackgroundTasks` are no-ops, so the real behaviour of `release()` never meets the manager. Mutation missed: none needed; the production path is unwired. Fix: one integration test with the real `AgentProcessManager`, the real `SessionManager` and a fake runner: send a message, let the turn end, advance a fake clock by `IDLE_STOP_AFTER_MS`, call `sweep()`, expect `dispose()` once; a second test with a background task expects it to survive until the task ends. Features: SIDE-07, SIDE-03, SIDE-04.

**H-4. An event the schema refuses is written to the log and then bricks the next start.** `FileEventOutbox.append` (`outbox/event-outbox.ts`) does not validate events before `JSON.stringify`; `open()` validates every file with `zOutboxFile` (`parseFile`) and returns `outbox_corrupt` for the first one that fails, which is fatal at start. So a producer that emits an empty id, a fractional token count or a negative number (the schema has `int().nonnegative()` and non-empty ids) writes a file the sidecar then refuses to read. While it runs, the same event is also refused by `RpcPeer` (`deliverEvent` params fail `zSessionEventEnvelope`), so replay stops at that head forever. No test anywhere parses a translator, publisher or manager output with `zSessionEvent` (the only schema-parsing tests are in `protocol/` and `outbox-file.test.ts:31`). Mutation missed: any translator change that produces `linesAdded: 1.5` or `eventId: ""`. Fix: a test helper `expectValidEvent` (`zSessionEvent.parse`) used in every test that captures published events; one outbox test that `append` of an invalid event returns an error and writes nothing. Features: SIDE-05, SIDE-06, AGENT-03.

**H-5. The outbox was never tested at the size it is capped at, with real storage.** The 20,000-event test uses `MemoryStorage` (`event-outbox.test.ts`). The real path rewrites the whole file, with two fsyncs, on every append and every acknowledgement (`writeFile`), so replaying N events costs N rewrites of up to N entries. With 20,000 pending events of about 1 KB each, draining them rewrites on average 10,000 entries per acknowledgement: about 200 GB of writes and 40,000 fsyncs (my arithmetic, not measured). No test measures writes or bytes with `createOutboxStorage`. Fix: a real-storage test with 2,000 one-event appends and acks that asserts the bytes written stay linear in the number of events (or a documented bound), or change the design (append-only log with compaction) and test that.

**H-6. A flaky pair in `run-checkpointer.test.ts`.** "sends SIGTERM and then SIGKILL..." and "stops the whole process group..." use `smallTimeouts()` of 300 ms and 200 ms. The script must start bash, install its trap or start `sleep` and write a pid file before the 300 ms SIGTERM fires. On a loaded runner bash can start later than that; then the marker file `term-sent` or `child-pid` is missing and the test fails with ENOENT. Fix: timeouts of seconds (the test already asserts only an upper bound of 5 s), or a ready file the script writes and the test awaits before it lets the clock matter.

**H-7. `rpc/handlers.ts` wiring is checked for 5 of its 24 request handlers.** `handlers.test.ts` checks `cancel`, `setAutoApproveEdits`, `listModels`, `getShellEnv`, `runUtilityPrompt`, `eventPersisted`, `setLogLevel`. Mutations missed: swap `warmAgent` and `resetAgent`; pass `params.agent` where `params.acpAgent` belongs in `startAgentLogin`; return `fromCache: true`; point `getContextUsage` at the wrong reader (`rpc/handlers.ts:56`). The two handler test files also repeat a 40-line dependency block. Fix: one table-driven test that calls every handler with recording deps and asserts which dep and which arguments were used.

**H-8. Only 3 of 6 validation paths of the sidecar peer are tested.** Covered: incoming request params, outgoing handler result, incoming notification params (plus the logging test). Untested although the header promises them (`rpc/peer.ts`): invalid params on an outgoing request (`rpc_invalid_params`), a result from the app that fails its schema (`rpc_invalid_result`), an outgoing notification that fails its schema, and "a late response for a request that already timed out is ignored". `peer.test.ts` "requestInteraction has no timeout" waits a real 30 ms: if the exemption were removed and the 20 s default applied, the test would still pass. Also the test transport hands over one whole line per call; chunking is only tested in `ndjson.test.ts`. Fix: the four tests, and an injectable timer so "no timer is created for requestInteraction" is asserted.


#### Codex, Cursor and top-level runner files (AGENT-01, 06 to 10, 13, 14)

The Codex fixtures are partly invented, and I confirmed one wire-format mismatch myself (CX-1). The `codex` program on this Mac (0.154.0) generated its own schemas with `codex app-server generate-json-schema` into a temp folder (trashed afterwards); the session reviewer compared them with the tests.

**CX-1. The client probably drops every real Codex reply, and no test can see it.** `runners/codex/app-server-client.ts:256-267` filters lines with `isJSONRPCResponse` and `isJSONRPCRequest` from `json-rpc-2.0`; both require `payload.jsonrpc === "2.0"` (`node_modules/json-rpc-2.0/dist/models.js:25, 36`). The schemas the real `codex` generates give `JSONRPCResponse` the properties `id`, `result` and `JSONRPCRequest` the properties `id, method, params, trace`: no `jsonrpc` field. Every fixture wraps its frames with `jsonrpc: "2.0"` (`app-server-client.test.ts:105, 142, 181, 194`; `codex-runner.test.ts:104, 151, 199, 227`). By reading, `initialize` would time out after 30 s and approvals and notifications would be skipped as "not JSON-RPC". Not run against the binary; confirm with one local `initialize` over stdio. Fix: a transcript recorded from the real binary, replayed through the real line splitter; accept frames without `jsonrpc`.

**CX-2. Per-turn sandbox and approval policy do not match the real protocol.** `codex-session.ts:515-517` and `protocol.ts` (`CodexTurnStartParams.sandbox`) send `sandbox`; the real `TurnStartParams` has `sandboxPolicy`, an object like `{type:"workspaceWrite", writableRoots, networkAccess}`. `CodexApprovalPolicy` (`protocol.ts`) and `zCodexApprovalPolicy` (`packages/protocol/src/session-config.ts:42`) include `"on-failure"`; the real `AskForApproval` is `untrusted | on-request | never | {granular}`. No test sets `codexSandboxMode` or `codexApprovalPolicy` (`codex-session.test.ts` `baseConfig`). The header of `protocol.ts` says the shapes were checked against 0.154.0; they were not. Fix: assert the exact `turn/start` and `thread/start` params against a validator built from `generate-json-schema`.

**CX-3. Codex approvals are not wired in a live chat and no test notices.** `codex-runner.ts:96-122` (`start()`) never builds or registers `CodexApprovalBridge`, and `CodexSession` has no accessor for the current turn's callbacks, so every `item/commandExecution/requestApproval` gets "method not found". `approval-bridge.test.ts` hands the bridge a fake client directly. Mutation: the bridge is already absent from the live path and every test is green. Fix: start a session through `CodexRunner.start()`, have a fake child send an approval request, expect an interaction and an `accept` reply on the wire.

**CX-4. `listSlashCommands` returns nothing against the real `skills/list` reply.** Real response is `{data:[{cwd, skills:[{name, description}], errors}]}`; `readSkills` (`codex-runner.ts:279-281`) reads `root.skills`, else treats `root.data` entries as skills; real entries have no `name`, so the result is always `[]`. The fixture at `codex-runner.test.ts:269` is invented. Fix: schema-derived fixture; assert one skill per entry's `skills`.

**CX-5. Three session behaviours have no failing test.** Delete `callbacks.onAgentSessionId(threadId)` (`codex-session.ts:437, 487`): the test callbacks are `() => {}` (`codex-session.test.ts:118-127`), so resume breaks silently. Delete the `callbacks.onMessage` loops (`:399-401, 412-414`): the translator is a stub returning `[]` (`:129-134`). Delete `await client.close()` in `dispose()` (`:314`): `dispose` is never called in a test and `FakeClient.closed` is never read, so a Codex process would leak per chat. Fix: record `onMessage` and `onAgentSessionId`, drive a child-thread `item/started` through the real translator, assert `dispose` closes the client.

**CX-6. Spawn command line, cwd and env are never asserted.** `app-server-client.ts:122-127` builds `["app-server","--listen","stdio://",...extraArgs]`; every spawn fake ignores its options (`app-server-client.test.ts:87-88`; `codex-runner.test.ts:93, 203`). Mutations that pass: drop `--listen`, drop `...extraArgs`, wrong cwd, `{}` as env. Fix: capture and assert the spawn options, including the app-tools config args.

**CX-7. Cancel during startup and a stale `turn/completed` are untested.** Stop-generation branches (`codex-session.ts:171, 175, 203-212`) are a header "Must handle" with no test. `:352` accepts any `turn/completed` while `active.id` is null, and `cancel()` resolves right after the interrupt reply, not after `turn/completed(interrupted)`; a late completed notice for the cancelled turn can end the next turn as `cancelled`. Fix: a startup-cancel test (interrupt with the late id, `cancelled` outcome) and a stale-completed test.

**CX-8. The consent timeout leaves the interaction open.** `approval-bridge.ts:176-190` answers Codex after 300 s, but nothing withdraws the card (`TurnCallbacks.requestInteraction` has no withdraw call); `approval-bridge.test.ts:330-367` asserts only the Codex reply. A late click resolves into the void. Fix: extend the callbacks contract and assert withdrawal.

**CX-9. `codex/protocol.test.ts` is theater.** It checks that method names are unique and have no spaces. Mutation: rename `turn/steer` to `turn/steering`; green. Fix: replace with the schema check of CX-2 (every method name and params shape against the generated schema).


#### Claude translator and permissions (AGENT-03, AGENT-04)

**CT-1. Cost and "Session started" are probably wrong from the second turn on, and every fixture hides it.** `runners/claude/translate.ts:220-224` says "The SDK sends init once per process" and resets `lastReportedCostUsd` on a second init (`:287`). The SDK type file says the opposite: `SDKSystemMessage` is "Session metadata the CLI emits at the start of each turn" (`sdk.d.ts` ~6305), and `total_cost_usd` is "cumulative across turns in streaming-input sessions" (`sdk.d.ts` 6008, 6150). If both hold, every turn after the first reports the whole running total as its own cost and emits "Session started" again. All fixtures (`translate.test.ts:323-339`, the smoke fake's init per prompt) either bake in the assumption or run one turn. Checked by reading only; not run. Mutation missed: delete `resetProcessState()` on the second init; only the respawn test at `:323` fails. Fix: a two-prompt test on one process with `total_cost_usd` 0.25 then 0.5; expect cost 0.25 for each turn and one "Session started". Confirm with a recorded stream.

**CT-2. The edit-path sandbox has no hostile-path test, and two holes are visible by reading.** `permissions.ts:78` resolves lexically with `resolve()` before `realPath`; no test feeds `/work/app/../../etc/x`. Mutation missed: replace `resolve(target)` with `target`; the identity `realPath` fake then returns the raw string and the escape is allowed. A symlink followed by `..` (`/work/app/link/../x`) is untested. A dangling symlink inside the root pointing outside passes: the real `realPath` (`sidecar-mode.ts:984`) swallows every error, the code walks up to the root and allows a write that creates the outside file. Also untested: `NotebookEdit` and `notebook_path` (`permissions.ts:63`), non-string or empty `file_path`, a root of `/`, empty `allowedDirectories` (`permission-handler.ts:110`), APFS case variants, and "edit outside the roots with `requireToolApproval: false`" must deny. Fix: a test over a real `mkdtemp` tree with real symlinks (inside to outside, dangling, nested) through `ClaudePermissionHandler` with `node:fs` `realpath`, plus a table of hostile strings.

**CT-3. The sandbox may never run in the default configuration.** `options.ts:69` starts every chat in `permissionMode: "bypassPermissions"`. The research doc (`claude-runner.md:147`) says "INFERRED: in bypassPermissions the CLI does not ask for ordinary tools". If so, `canUseTool` is not called with approvals off and the sandbox only applies once approvals are on, while `docs/architecture.md` "Trust boundaries" states the path check as unconditional. Unverified against a real CLI. Mutation missed: delete the whole edit-path block in `classifyToolUse`; with the SDK faked everywhere, nothing fails. Fix: a real-CLI contract test (developer machine only, per `parallel-build.md:38`) that makes an Edit outside the root in default mode and asserts `canUseTool` was called; if not, fix the design or the doc.

**CT-4. Fixtures are invented and cast through `as unknown as SDKMessage`; nothing fails when the SDK renames a field.** Every helper in `translate.test.ts:28-81` and `translate.smoke.test.ts:81-141` uses the cast; `translate.ts:197` casts again. There is no recorded stream anywhere. Concrete drift: `translate.test.ts:253-270` puts `api_error_status` on an `error_during_execution` result, but in `sdk.d.ts:6142` it exists only on `SDKResultSuccess`. A real rate-limit failure arrives as `subtype: "success"`, `is_error: true` with the text in `result`; the `result` branch of `resultErrorText` (`translate.ts:353-358`) has no test because the fixture defaults `result: ""`. `translate.test.ts:403` feeds `autocompact_state` as a system subtype; the bundle shows a top-level `type: "autocompact_state"`. Fix: a `satisfies SDKResultMessage` fixture builder for the fields read; one recorded real turn (init, assistant with tool_use, user tool_result, result, rate_limit_event) replayed through the translator.

**CT-5. The "dropped" test cannot fail on what it names.** `translate.test.ts:383-398` asserts only `[]`, and the default branch also returns `[]`. Mutation missed: delete `DROPPED_TYPES` and the `task_*` / `thinking_tokens` cases. Fix: assert `debug.length === 0` for dropped kinds and `1` for unknown ones with the existing `fakeLogger`; add `session_state_changed`, `background_tasks_changed`, `control_response`, `control_cancel_request`.

**CT-6. Translator branches with no test.** `informational` (`translate.ts:238`), `local_command_output` (`:240`), `api_retry` (`:244`); `status` with `compact_result: "failed"` and `status: "requesting"`; assistant error kinds other than `authentication_failed` (retryable flag, the `session limit` override in `assistantError`); `assistantErrorText` defaults; `resultErrorText` fallbacks and `resultErrorRetryable` for 5xx; `rateLimitText` window names and "almost reached" for `allowed_warning` (the existing test, `translate.test.ts:320`, checks only `kind`); an unknown content block (the header promises "never a throw", `translate.ts:161`); string content in a `user` message; `tool_result` with array content; a malformed `TodoWrite`. Mutations missed: swap `max_retries` and `attempt` in the retry text; make `server_error` non-retryable; make `allowed_warning` say "reached".

**CT-7. `translate.smoke.test.ts` duplicates `translate.test.ts:427-475` and uses a constant id.** `newUuid: () => "turn-uuid"` at `:178`; the fake echoes `user_message_uuid`, so uuid matching is trivially satisfied. It runs one turn (see CT-1) and does not `dispose` on failure (`:228` is not in a `finally`). Fix: turn it into the multi-turn test of CT-1 and delete the duplicate.

**CT-8. `allow_edits_for_session` is lost on a process respawn.** `claude-session.ts:400` builds a new `ClaudePermissionHandler` per spawn and the answer-based grant lives on the handler (`permission-handler.ts:66, 196`). A restart for a fast-mode or effort change then asks again. Unverified by execution. Fix: a `ClaudeSession` test: grant, `applyConfig` that forces a restart, then an Edit expects no prompt.


#### Claude session and runner (AGENT-02, AGENT-05, AGENT-15, AGENT-16)

**CS-1. The fake SDK stream ends cleanly on abort; the real one throws.** `claude-session.test.ts:160` and `:417-422` close the stream on abort. In the SDK bundle (`sdk.mjs`, read as minified code, not run) `readMessages` rethrows `exitError` and `waitForExit` rejects with "Operation aborted" when the signal is aborted. Consequence: `claude-session.ts:448` logs "Claude session failed" at error level on every deliberate cancel and dispose, and every abort test exercises the unreal path. Fix: make the fake fail with an AbortError on abort and assert that a deliberate stop logs no error and still gives `cancelled`.

**CS-2. Cancel hangs if `interrupt()` never answers.** `claude-session.ts:297` awaits the interrupt before the grace timer starts at `:304`; both fakes (`:136`, `:443`) resolve at once. A wedged CLI makes Stop hang and the process is never stopped. A test with `interrupt: () => new Promise(() => {})` fails today. Fix: start the grace timer first, or race the interrupt against it.

**CS-3. "A turn cut off by a crash is never resent" has no test.** `docs/architecture.md` calls it a money rule and says nothing holds it. `claude-session.test.ts:616-671`: mutation, resend the failed message on respawn; green, because `processes[1].prompts` is never asserted. Fix: assert `processes[1].prompts` has length 1 with the second turn's text and that `processes.length` stays 1 until the second `runTurn`.

**CS-4. The checkpoint hook and MCP servers are never checked at session level.** `claude-session.ts:188` (`once(beforeFirstWrite)`), `:401` (hooks), `:402` (`createMcpServers`). Mutation: delete the `hooks` line; the "snapshot before the first write" guarantee (SIDE-04) disappears and every test is green. Mutation: drop `once`; green. Fix: call `script.options.hooks.PreToolUse[0].hooks[0]` for Bash twice, assert `beforeFirstWrite` ran once and a Read did not trigger it; assert `createMcpServers` receives the config's `appTools`.

**CS-5. AGENT-15 is dead code.** `SelfStartedTurnTracker` (`runners/claude/self-started-turns.ts:31`) and `SelfStartedTurns` (`session/self-started-turns.ts:34`) have no non-test importer; `TurnCallbacks` has no `onInProgressChanged`; `claude-session.ts` never calls the tracker. A background-task wake-up does not flip the chat to working. All three checklist items pass unit tests and have no live path. Fix: wire it, then a `ClaudeSession` test that streams `session_state_changed` running then idle with no open turn and expects the callbacks. (The AGENT-15 backlog row is `stub`; `scripts/check-stubs.ts` should flag a stub row with no placeholder.)

**CS-6. The cost baseline on respawn contradicts the SDK doc.** `usage.test.ts:6-9` and `translate.ts:287-290` treat a restarted process as starting at zero; the SDK doc for `total_cost_usd` says a resumed session "continues from the total its transcript saved, so the first result already carries the earlier turns". After every respawn with resume, the whole history cost is booked as one turn. (Same root as CT-1.) Fix: record a real result before and after a resume and assert the delta.

**CS-7. Dispose during start is untested.** `claude-session.ts:382` (`if (this.disposed) throw`). Mutation: delete that line; a `claude` process starts after dispose and is never aborted. Existing tests (`:810`) cover `cancel` during start only. Fix: block `hasTranscript`, call `dispose`, release it, assert `starts === 0`.

**CS-8. The symlink fix is checked only by its log line.** `claude-runner.test.ts:214` asserts the warning and `sessionId`. Mutation: pass `options` instead of `start` (`claude-runner.ts:120`); resume would look in the wrong transcript folder and the test passes. Fix: capture the `query` options through `warm()` and assert `cwd` is the real path.

**CS-9. Steer is tested against an invented CLI sequence.** `claude-session.test.ts:1187-1236` emits two results (`uuid-1` held back, then `uuid-2`); a real folded steer likely produces one result with `user_message_uuids`. `consumedUuidFromMirrorEntry` accepts `source_uuid` at the top level and inside `attachment`; no recorded entry backs either. `session-mirror.test.ts:46` ("never writes from the key") cannot fail: the adapter ignores the key and the test inspects no file system.

**CS-10. Fast mode never reaches the CLI.** `config-change.ts:38` makes `fastMode` a restart change, but `options.ts` passes no `settings` (only `config-change.ts` and `usage.ts` mention `fastMode` in non-test files). The AGENT-16 row says "ours passes fast mode only", which is false. No test asserts `fastMode` in `Options`.

**CS-11. No real SDK and no recorded stream anywhere in the slice.** 42 `as unknown as` casts in the Claude tests; every fake `Query` is cast, so tsc cannot see drift (a renamed `applyFlagSettings` would pass all tests). No `.jsonl` fixture, no stub-executable contract test.


#### ACP runner (AGENT-11, AGENT-12, AGENT-17)

**ACP-1. A temp folder is created at module level and never removed.** `runners/acp/acp-client.test.ts:178` calls `mkdtemp(tmpdir())` once and shares it across tests (`checkpoint.txt`, `large.txt`). `pnpm test` fails the run when anything is left in the run folder, and AGENT-11 has not been through CI yet. Mutation missed: none, it is a leak. Fix: per-test folder, removed with `trash` in a cleanup.

**ACP-2. The wire handlers have no test over the real SDK.** The client test drives only `fs/*` (`acp-client.test.ts:290, :354`). `session/update`, `session/request_permission` and `elicitation/create` are tested by calling `session.requestPermission()` directly. Mutations missed: delete `app.onNotification(sessionUpdate...)` at `acp-client.ts:527-529` (all streamed output vanishes); delete `session?.handleUpdate(notification)` at `acp-runner.ts:162`; rename the permission method constant. The runner test at `acp-runner.test.ts:206` runs a real client and session, but its fake agent emits no updates and a stub translator supplies "ok". Fix: one integration test with the in-memory agent and the real client, session, translator and runner. The agent streams two chunks, a `tool_call`, a `request_permission` (answer deny), an `elicitation/create`, then `end_turn`. Assert the items reaching the callbacks and the `outcome` the agent received.

**ACP-3. Cancel then a new turn is untested and broken by reading.** `finishTurn` (`acp-session.ts:425`) and `promptEnd` carry no turn id, so a late "cancelled" reply to the old prompt settles the new turn. `cancel()` (`:239-252`) never flushes the translator, so the cancelled turn's buffered text is prepended to the next turn's text. Mutation missed: remove the `activeTurn = null` ordering or the flush. Fix: real translator; send chunk "A", cancel, run a second turn that sends "B", then finish the old prompt as `cancelled`. Assert the second turn's text is exactly "B" and its outcome is success.

**ACP-4. "Refuse a second turn" and "child dies mid-turn" have no test.** The guard at `acp-session.ts:141` runs before three awaits (`:150-156`), so overlapping `runTurn` calls both pass. `FakeClient.exit()` (`acp-session.test.ts:112`) exists and is never called. Fix: overlapping `runTurn` returns the "already running" error; `exit("x")` mid-turn gives an error naming the adapter and the reason; a turn after the exit reconnects through `connectClient`.

**ACP-5. Tool payloads are invented and differ from real OpenCode 1.18.18.** Real OpenCode sends `tool_call` as `{toolCallId, title, kind, status:"pending", locations, rawInput}` with no `name`; then `tool_call_update` frames (`in_progress` with `rawInput` and `content`, then `completed` or `failed` with `rawOutput`). `translate.test.ts:48-58` always sets `name: "shell"`, `"find"`, `"write"`. `translate.ts:151-155` looks up hints by `update.name` only, so with the real agent the hint and the `mcp__` prefix (`tool-kinds.ts:37-38`) never fire and `app_tool` and `mcp` are unreachable. `translate.ts:174` drops every non-terminal update, so the real input from the `in_progress` frame is thrown away (what OpenCode sends first is not confirmed). Fix: recorded OpenCode frames (title only) as fixtures; look up hints by `name ?? title`; assert `input` is populated from the `in_progress` update.

**ACP-6. The empty-answer check is probably defeated by `usage_update`.** `acp-session.ts:416-421` sets `sawVisibleContent` for any translator message. OpenCode sends `usage_update` every turn and the translator turns it into a `usage` item. Mutation: an agent that answers nothing but sends `usage_update` is reported as success. The one test (`acp-session.test.ts:271`) sends nothing at all. Fix: count only `text`, `thinking`, `tool_call`, `todo`; test `usage_update` plus `end_turn` expects the error.

**ACP-7. The file-write boundary is weakly tested.** `acp-client.test.ts:336`: the "extra folder" is `join(workspace, "extra")`, already inside the workspace, so ignoring `additionalDirectories` still passes. `:320` is titled "read or write outside" but only reads; deleting `allowedPath` from `writeTextFile` (`acp-client.ts:591`) fails nothing. Untested: symlink escape, relative paths, the sibling-prefix case (`/ws-evil` vs `/ws`). `:331` uses a bare `rejects.toThrow()`, and the handler throws a plain `Error` (`acp-client.ts:555, 560`), which the SDK turns into JSON-RPC -32603 "Internal error", so the agent never learns why. Fix: separate temp root for the extra folder, a write-refusal test, assert the error carries a reason.

**ACP-8. `beforeWrite` ordering is unchecked.** `acp-client.test.ts:335-363` asserts only that a flag is true afterwards. Mutation: move `await beforeWrite()` after `writeFile` (`acp-client.ts:594`). Fix: record `existsSync(target)` inside `beforeWrite` and assert it was false.

**ACP-9. The live path ignores the app-tools MCP server and the test hides it.** The runner test passes `appToolsServers` (`acp-runner.test.ts:216`); `sidecar-mode.ts` (~:974-978) builds `new AcpRunner({...common, adapter, spawn})` without it, so production always sends `mcpServers: []`. `translator` and `createClient` are also test-only deps. Fix: make the dep required, or a composition test.

**ACP-10. `start()` wiring is untested.** `permission.value` is merged into the child env at `acp-runner.ts:146-150`; the test at `acp-runner.test.ts:397` asserts only `OPENCODE_DB` and the id prefix. Mutation: drop `...permission.value`; "the policy reaches OpenCode" still passes. The not-installed branch of `start()` (`:135`) is untested.

**ACP-11. Client ladder, close and exit paths untested.** Resume falls back to load, then to new (`acp-client.ts:269-311`); only happy resume is tested, `how: "loaded"` is never produced. Close timeouts (1 s `session/close`, 1 s stdin end, then `stop`, `:425-450`), child exit during a pending request, the 4 KB stderr tail, `onClose` and the "could not start / exited early" messages have no test. The bridge sets `onExit: () => {}` and `onStderr: () => {}`. Which of stdout EOF and `onExit` wins is untested.

**ACP-12. Model-wait tests are weak.** The `waitForModelOption` test (`acp-runner.test.ts:357`) queues a microtask before `openSession` returns, so the update probably lands before the check at `acp-runner.ts:227`; deleting `:225-232` may still pass (not run). `cancel()` does not wake `modelWaiters` (`acp-session.ts:243-251`; only `dispose` and `handleClosed` do), so the checklist line "stops early when the user cancels" is not built and not tested.


#### Session manager, turns, publisher, prompt (SIDE-03, 04, 05, 09, 11, 20, 24)

The suite is solid at unit level and weak at the seams: almost every test uses fakes that answer at once and never block, and none validates what the sidecar publishes. No whole file is theater; two files hold assertions that cannot fail (SN-8, SN-3).

**SN-1. No test parses what the sidecar publishes with the protocol schema.** `zSessionEvent` is used in the whole sidecar only at `outbox/outbox-file.ts:30`, on read at startup. The six copies of `FakeApp` (`event-batcher.test.ts:65`, `manager.test.ts:147`, `turn.test.ts:124`, `live-state.test.ts:55`, `self-started-turns.test.ts:39`, `interactions.test.ts:91`) record `notify` params without checking them. The real `RpcPeer.notify` validates and returns false on a bad payload; `send()` in `event-batcher.ts:411` ignores that result; `FileEventOutbox.append` writes without validating; `open()` then fails with `outbox_corrupt` on the next start (same root as H-4). Mutation missed: make Turn publish `turnId: ""` or a float in a usage item; everything stays green. Fix: one shared `FakeApp` whose `notify` runs `sidecarToAppNotifications[method].safeParse`; use it in the real-pipeline test and every Turn test; one test publishes one event of each kind, a shrunk event and a steer `user_message`.

**SN-2. The first-message deadlock has one guard, and it is thin.** `manager.test.ts:1089-1100` uses the real outbox, publisher, `LiveStateStore` and `Turn` on the shared queue, but the runner is an instant `FakeRunner`, storage is in memory, processes, checkpoints and interactions are fakes, and `app.notify` does no validation. It sends one message and asserts only the return value, then calls `shutdown`. After `startTurn` returns, `finalize` and `turnSettled` (`manager.ts:921`, which re-enters the same queue key) run unobserved: no assertion on `turn_ended`, idle, the `user_message` event, or a second message draining. The 1.5 s `setTimeout` (`:1095`) is never cleared: a leaked timer and a flake risk. The wiring is a copy of `sidecar-mode.ts:549-640`; nothing runs the real composition. Mutation missed: any deadlock in `finalize`, `onTurnSettled` or `drain` after the first reply. Fix: a runner whose `runTurn` blocks on a gate; assert user_message, checkpoint start, agent, checkpoint end, `turn_ended` and idle (schema-validated); queue a second message and assert it starts; use `Promise.race` against an event-driven failure.

**SN-3. The shutdown assertions cannot fail.** `manager.test.ts:1069-1086`: `FakeTurn` never touches checkpoints, so "takes no checkpoint" (`:1081-1082`) is vacuous. Mutation missed: `shutdown` calls `active.turn.cancel()` instead of `agent.cancel()`; that would take an end checkpoint and write `turn_ended`. The 10 s cap of `waitForTurns` (`manager.ts:982`, real `setTimeout`, no injected scheduler) is unchecked: remove the `await` and the test passes. Fix: shut down with the real Turn and assert no `turn_ended` event and an empty `checkpoints.ends`; inject a scheduler.

**SN-4. Latest-wins and stale runs under overlapping turns are barely tested.** `turnSettled`'s guard (`manager.ts:924`) has no test: delete it, and a late `succeed()` from cancelled turn A, arriving after B started, nulls B's `activeTurn`, so B can no longer be cancelled. `turn.test.ts:548-568` never asserts that the replaced run published nothing. The "late success after cancel" test (`:503`) passes without the guard at `turn.ts:228`, because `finish()` is idempotent. `cancelEpoch` (`manager.ts:210-216`) has no test; cancel during a steer in flight (`:665, 704`) and the abort checks after `claimAgent` (`:264, 611`) have none. No test overlaps two `sendMessage` calls; every call is awaited in turn. Fix: gate prompt assembly, send A and B concurrently, assert B waits and `prompt.inputs` has length 1 until A finishes; a stale `succeed()` after cancel-then-send publishes nothing.

**SN-5. A failure in the middle is untested.** Manager: `runner.start` throws, `startTurn` returns false and `sendMessage` answers a generic `send_failed` (`manager.ts:269-274`); the real error (not installed, not signed in) is only logged. `shellEnv.get` or `prompt.assemble` throwing after `markInFlight` (`:230`) leaves the id in flight, and every retry answers `duplicate_without_delivery`. Publisher: `appendBatch` (`event-batcher.ts:380-405`) retries any error forever, including the permanent `outbox_full` and `outbox_durability_uncertain`, so `flush()` never resolves, `finalize` hangs at flush and the chat never reports idle (a failure listener does put an error on the chat). If `outbox.append` rejects instead of returning an error, `drain` loses the sliced events. Fix: FakeOutbox variants returning `outbox_full` and rejecting; assert the error appears and `flush` settles; a failing `runner.start` surfaces its code, forgets the id and lets the next message run.

**SN-6. Interaction withdrawal at the manager call sites is unasserted (SIDE-11).** `withdrawAll` is called in `startTurn` (`:577`), `deliverSteer` (`:672`), `enqueue` (`:770`), `resetAgent` (`:380`) and `shutdown` (`:483`); only `cancel` is asserted (`manager.test.ts:776`). `manager.answerInteraction` (`:441-446`) has no test. Fix: assert `interactions.withdrawn` after each action, and the unknown-session answer.

**SN-7. "The send RPC returns after the steer event is flushed" (SIDE-05) has no code and no test.** `deliverSteer` publishes the `user_message` at `:685`, after the live-state flush at `:676`, and returns at `:702` without flushing, so the app can see `pendingSteerIds` before the steer event arrives. The `NoActiveTurnError` mapping (idle gives a new turn, working gives `steer_failed`) and `SteerNotSupportedError` are untested; only `SteerRevertedError` is (`manager.test.ts:741`).

**SN-8. The utility-prompt tests include assertions that cannot fail (SIDE-24).** `utility-prompt.test.ts:270-281` ("writes no events, takes no checkpoints, publishes no live state"): the service takes no publisher, checkpoint or live-state dependency, so the claim holds by construction. `:283-307`: `launch` is never read (`utility-prompt.ts:63`, header says "until SIDE-21"), so "no secrets in logs" passes trivially. The "not signed in" test throws from `start`, but the Claude runner reports auth failure as an error item inside a message (`claude/translate.ts:292-297`), so the real result would be `utility_prompt_failed`. Also, because `launch` is ignored, API keys entered in the app are not applied to title and branch-name prompts.

**SN-9. Prompt assembly is never given the pull request's repository (SIDE-03, SIDE-09).** `prepareRequest` (`manager.ts:552-558`) never passes `pullRequestRepositoryFullName` (declared in `prompt/assemble.ts:45`; the `sendMessage` params have no such field). The stub's GitHub URL is unreachable in production, though `assemble.test.ts:141` passes it directly. Fix: add the field to `sendMessage` and assert the manager forwards it.

**SN-10. The manager never tells the process manager a chat went idle** (the same bug as H-3, found independently). `markIdle` and `setBackgroundTasks` have no production caller; `FakeProcesses` (`manager.test.ts:280`) has no-op markers and a `claimActive` that does not single-flight, so it hides this.


#### Agent detection, model catalog, slash and MCP listing (SIDE-14, 15, 16)

**MD-1. The `DefaultAgentDetector` is built without most of its ports.** `sidecar-mode.ts:601-610` passes `runners`, `shellEnv`, `onChanged`, `logger`, `ids`, `probe`, `clock`; it does not pass `codex`, `cursor`, `executablePath`, `findManagedProgram` or `cursorApiKey` (I confirmed these are optional deps at `models/agent-detection.ts:~115-135`). In the live app Codex sign-in always answers `agent_auth_required`, Codex and Cursor never report `authenticated`, Settings path overrides and managed copies are never used, and no class implements `CodexAuthPort.startDeviceLogin`, `finishLogin` or `cancelLogin`. Every one of these paths passes unit tests against hand-made ports; issue #56 (SIDE-15) is closed. Mutation missed: delete `codex`, `cursor` and `executablePath` from the unit setups; nothing breaks, because no test builds the detector the way the host does. Fix: a composition test that builds the detector from the host's pieces and asserts a Settings path wins; either implement the Codex port or reopen the Codex items.

**MD-2. The Claude sign-in flow cannot succeed, and the test cannot tell.** `agent-detection.ts:278-300` and `agent-detection.test.ts:627-643`. `claude setup-token` mints a token to be set as `CLAUDE_CODE_OAUTH_TOKEN`; it does not store a login (the CLI's own help says "Set up a long-lived authentication token"). The detector discards the pasted code, checks only that it is non-empty and re-reads `claude auth status`. A signed-out user gets `failed` every time, so the item "accepts a pasted code from Claude" is not met. The fake probe answers `loggedIn: true` whatever was pasted. Fix: decide between `claude auth login` and storing the token and passing the variable (a product choice for Jan); assert the code reaches the probe's environment.

**MD-3. The catalog's generation-guard test passes without the guard.** `catalog.test.ts:254-284`, `catalog.ts:127-130`. The old discovery resolves first, then the new one, so last write wins either way. Mutation missed: remove `if (generation === this.generation)`. Fix: resolve the new run first, then the old one, and assert `list()` still returns the new list with `calls === 2`. Also untested: dropping the `inFlight.get(key) === started` guard (`catalog.ts:84`).

**MD-4. `validate()` and `defaultModel()` have no production caller.** `session/manager.ts:970-972` (`warmConfig`) calls `runner.listModels()` directly, skipping the cache and single flight and re-implementing the `isDefault` lookup. `toModelInfo` in `claude-runner.ts:229` hard-codes `isDefault: false`, so "each agent has a default model" holds only for the invented base model in the tests. Mutation missed: delete `validate`; no live test fails. Fix: route `warmConfig` through the catalog and test it with the real Claude mapping.

**MD-5. The spec numbers are compared with themselves.** `agent-detection.test.ts:204, 230, 234, 260, 550` and `catalog.test.ts:194` import `VERSION_PROBE_TIMEOUT_MS`, `CLAUDE_AUTH_CACHE_MS`, `CODEX_LOGIN_TIMEOUT_MS`, `MODEL_CATALOG_TTL_MS` and compare them with themselves. Mutation missed: `10 * 60 * 1000` becomes `10 * 1000`; `5_000` becomes `500_000`. There is no fake-clock test of the 10-minute Codex flow because the port that waits does not exist. Fix: assert the literals 5000, 60000, 600000, 3600000.

**MD-6. The hang case is not exercised and no test uses the real probe.** The real `probeCommand` (`sidecar-mode.ts:842`) returns `ok` with a non-zero `exitCode` when it kills a hung child; `probeVersion` (`agent-detection.ts:551-556`) never reads `exitCode`. Fix: run the detector with the real `probeCommand` on `/bin/sh -c 'sleep 30'` with a short timeout; expect installed true and no version.

**MD-7. The `claude auth status --json` fixtures drift from the real CLI.** From the 2.1.318 binary: `authMethod` values are `claude.ai`, `oauth_token`, `api_key`, `api_key_helper`, `third_party`, `none`; the tests use `"bedrock"` and `"api_key"`. A Bedrock user reports `authMethod: "third_party"` with `apiProvider: "bedrock"`, which the detector never reads. The real CLI exits 1 when signed out (`process.exit(loggedIn ? 0 : 1)`), while every fixture has `exitCode: 0`; a change that treats exit 1 as a probe failure would turn "signed out" into "unknown" and pass all tests. `parsed.authenticated` (`agent-detection.ts:515`) is an invented fallback key. Fix: record real outputs for signed in, signed out (exit 1) and third party.

**MD-8. The managed-copy versus Settings-path priority is not pinned** (`agent-detection.ts:392-416`). Swap the two branches and no test fails: "managed preferred" runs without `executablePath`, "configured path replaces PATH" runs without a managed copy. Fix: one test with both set.

**MD-9. A failing `detect()` is not tested.** Remove the `try/catch` in `detectOne` (`agent-detection.ts:375-381`) and one broken runner rejects the whole `detectAll`; every test uses a one-runner registry. Fix: a registry with claude, codex and acp where one `detect` throws.

**MD-10. The Codex MCP injection closure is untested and puts the bridge token on a command line.** `sidecar-mode.ts:907-931` (`appToolsConfigArgs`) loops over `entry.env` and pushes `--config mcp_servers.conducted.env.CONDUCTED_APP_TOOLS_TOKEN=<token>` into Codex's argv. `mcp-launch.test.ts:16` pins only the helper's args ("the token goes in the environment and never in the arguments"), and `codex-runner.test.ts` stubs the closure with `[]`. The header of `mcp-launch.ts` says the token must never be on a command line. Fix: test the closure's output and decide whether the token may appear in Codex's argv.

**MD-11. MCP listing exists only in the lister.** Claude (`claude-runner.ts:71`) and Codex (`codex-runner.ts:60`) declare `mcpServers: true`; no runner has `listMcpServers`, so the RPC returns `mcp_list_unsupported` for both. The SDK's `McpServerStatus` (`sdk.d.ts:1294`) has `status: 'needs-auth'` with a hyphen plus `error`, `scope`, `source`, `tools[]`; the protocol and `McpServerStatusView` use `needs_auth`, and nothing maps between them. SIDE-16 is still open, so this is expected; the mapping needs a type-level test against the SDK type.


#### App tools (SIDE-12, SIDE-13)

**TL-1. The in-process MCP server is never driven over MCP.** `tools/tools.test.ts:104-112` reads the SDK's private `_registeredTools` field and calls each `handler({}, {})` directly. That skips the input schema (`definition.inputShape` is a zod shape passed to `tool()`), the JSON schema the SDK derives from it, and the MCP wire. A zod 4 shape the SDK cannot convert, a renamed private field after an SDK update, or `alwaysLoad` and `annotations` dropped would not fail anything about behaviour; the private-field read would break on a harmless SDK upgrade (pins incidental detail, earlier audit logged it). `tools/in-process-server.ts` is 14% covered on main. Fix: an in-memory MCP client against `createSdkMcpServer(...).instance` that lists tools and calls `GetWorkspaceDiff` with real arguments and with an invalid one; assert the JSON schema and the error result.

**TL-2. `RpcAppToolBackend` is tested for 3 of its 7 methods.** `tools.test.ts:441-499` checks no-app, the 20 s diff timeout and the progress notification. Untested (`tools/backend.ts`, 26% on main): `getDiffComments`, `addDiffComments`, `getTerminalOutput`, `setTargetBranch` request mapping (mutation: return `result.value.comments` for `addDiffComments`'s count, or swap `file`/`statOnly`), `askQuestions` with the `unexpected_answer` branch, and `call()`'s catch (`app_request_failed`). The earlier audit already listed these items for SIDE-12. Fix: a table of the seven methods against a recording `SidecarToApp`.

**TL-3. The socket bridge and its helper are placeholders (SIDE-13), yet they sit on the startup path** (H-1). `socket-bridge.ts` and `mcp-stdio-server.ts` have no test; `bridge-protocol.test.ts` and `mcp-launch.test.ts` cover the pure parts (token never in the arguments; arguments parse back).


### LATER


#### Core, LATER

- **Two peers, never joined.** The sidecar `RpcPeer` and the desktop `core/sidecar/tunnel.ts` both validate with the one table in `packages/protocol/src/rpc.ts`, which is a good single source. But no test connects them: the peer tests use the `json-rpc-2.0` library on the other end, the tunnel tests use a fake `Platform.sidecar`. A test that joins the two over an in-memory transport and sends one valid params/result pair per method would catch error-code mapping (`RPC_ERRORS`), timeout, reconnect and replay (`deliverEvent` reply `persisted`) drift between the two implementations.
- **Protocol tests are thin.** 4 files, 11 tests for 24 request methods, 2 + 9 notifications, 4 event types and about 14 item kinds. The "user message round-trips" test (`events.test.ts`) would still pass if `zSessionEvent` were `z.any()`; the negative tests save the file. `interactions.test.ts` covers 2 of the interaction kinds; `mentions.test.ts` has one test (a path containing `⟧` cannot round trip, `MENTION_TOKEN` is a shared global regex). No golden sample per method exists for both runtimes to parse.
- `outbox`: `MemoryStorage` is copied in `event-outbox.test.ts` and `replay.test.ts` and never checked against `createOutboxStorage` (a shared contract test). The "live events keep flowing during a replay" line of `replay.ts`'s header has no test. `outbox-file.ts` header says a corrupt file "blocks that chat"; `event-outbox.ts` and its test make it block the whole sidecar (the first bad file fails `open()` for every chat). Decide which, then test it. A duplicate `eventId` appended twice is not rejected or tested.
- `server.test.ts`: the "stale socket" test writes a regular file, not a socket left by a crash; no test of a path over the 104-byte `sun_path` limit of macOS, or of a UTF-8 character split across two socket chunks (the decoder uses `stream: true`).
- `process-manager.test.ts`: untested: `warm()` rejecting; a start that fails while `disconnect` is pending; `stopAll` while a start is pending; a crashed agent staying in the map; `ensureWarm` after `stopAll`. The "change agent type" test (`:379`) checks only that two keys are separate; the actual disconnect on a kind change lives in `manager.replaceAgentIfKindChanged` (see the session findings).
- `watchdog.test.ts`: the parent check that throws (`"The parent check failed"`) has no test; the real `process.ppid` in Bun and the 2-second exit after a parent dies are only tested with an injected pid and scheduler. A real test would spawn a short-lived parent that starts the sidecar and exits, and assert the child is gone within a few seconds.
- `spawn-child.ts` signals only the direct child (no process group), so grandchildren of an agent (`pi-acp` starts `pi`) survive `stop()`; `run-checkpointer.ts` does it right with `detached`. Not tested for agents.
- `modes/sidecar-mode.test.ts`: the `probeCommand` kill test asserts `result.ok` and `< 5 s`, not the exit code or signal; `spawnText` returns `shell_capture_failed` for a killed shell, and `classifyShellEnvFailure` is tested with an error text (`"The command timed out after 5000 ms"`) that production never produces. The SIDE-01 checklist item "Make spawnText return a timeout error code so a killed shell is classified as timeout" is unbuilt and untested.
- `rpc/peer.ts:398` still uses the literal `"agent_auth_required"`; the SIDE-02 item "Use AGENT_ERROR_CODES.authRequired" (moved from AGENT-03) is open although the issue is closed.
- `shell-env/rust-contract.test.ts` compares constants with regexes over `shell.rs`, not captured PATHs. `capture.test.ts` never runs a real shell on the happy path (`env -0` through `zsh -ilc`), only on a failing folder; the product is macOS only and `pnpm test` runs on ubuntu in CI.
- `packaging.test.ts` checks compile arguments and one `--version` run through `bun src/main.ts`; it does not build or run the compiled binary, where `await import("./modes/sidecar-mode.ts")` and the Agent SDK's bundled CLI path could break.
- `logging/*.test.ts`, `tools/{format,registry,bridge-protocol,mcp-launch}.test.ts`, `runners/{errors,registry}.test.ts`, `session/{queued-messages,serial-queue,steering}.test.ts`, `runners/acp/{methods,permission}.test.ts` and the four protocol tests carry no feature id in their titles (21 of 94 files in my area have no `SIDE-`, `AGENT-`, `GIT-` or `PLAT-` id anywhere).
- Untested placeholders on the live path: `logging/logger-server.ts`, `modes/logger-mode.ts`, `modes/app-tools-mcp-mode.ts` (all `notImplemented`); nothing starts them.
- `shared/`: `result.ts` (`appError` with and without cause), `ids.ts`, `clock.ts` have no test; there is no shared fake `IdSource` that hands out a new id per call, so every test file writes its own, and five of them wrote a constant (see the guards).
- `process/spawn-child.ts:51-52` reports the exit from `child.exited` without waiting for stdout to drain; a final reply could be lost (reported by the Codex reviewer, not verified). No test with a child that writes and exits at once.


#### Codex, Cursor, top-level runner files, LATER

- `translate.test.ts:56` sets `status:"failed"` along with exit code 1, so `isError` is true anyway; drop the exit-code check at `translate.ts:143` and it passes. Add `status:"completed", exitCode:1`. The real `declined` status maps to `isError:false`; add a test and decide.
- Rate-limit retry: `codex-session.test.ts:412` only checks `sleeps[1] > sleeps[0]`; drop the jitter at `codex-session.ts:545` and it passes. Retry exhaustion (fifth failure returns `retryable:true`) is untested.
- Client lifecycle paths without a test: write refused (`app-server-client.ts:325-339`), request timeout `codex_timeout`, 4 KB stderr cap, `close()` with pending requests, initialize error response, connect twice, handler throw (-32603), the `steer` stale-error mapping (`codex-session.ts:247-249`). `FakeChild.stop` never fires `onExit`, but a real child reports "exited (SIGTERM)" before "connection closed".
- Line splitting is untested: the production splitter is `spawnJsonRpcChild` in `modes/sidecar-mode.ts:1013-1056`; the fake hands over whole lines. No test for a line split mid-JSON, several lines in one chunk, CRLF, a multi-megabyte line or a partial last line (the reader drops an unterminated final line). The real binary caps message size.
- `FakeChild` is copied in `app-server-client.test.ts:27-75` and `codex-runner.test.ts:23-59` with duplicated `logger()` and `waitFor`; `answerInitialize(child)` at `codex-runner.test.ts:147, 255` is dead; `answerCompletedTurn` returns `turn-1` for both turns of the follow-up test (`codex-session.test.ts:209-222`): the known same-id bug.
- Approvals: `kind:"writeStdin"` shows an empty Bash card (`approvals.ts:84`); `approvalId` is ignored so zsh sub-command approvals collide on `itemId`; `serverRequest/resolved` is not used to close a card.
- `codex-runner.ts:57` declares `resumeAt:true`, but nothing implements `thread/rollback` or `atNativeMessageId`. `readUsage`/`readTokenUsage` fill `total` with a copy of `last`. `account/read` with `account:null` untested. `errors.test.ts` checks `instanceof` only (`SteerRevertedError extends NoActiveTurnError` would pass).
- `initialize` reply fixture `{serverVersion}` is invented; the real reply is `{userAgent, codexHome, platformFamily, platformOs}` and the code returns the whole user-agent string as the version, untested.
- Real size: no test sends a 5 MB line, 20,000 notifications or a long tool output; `startedTools` is never cleared for items that never complete.


#### Claude translator and permissions, LATER

- `permission-handler.ts:94` `resetSessionGrants()` has no caller and no test; the `editsAutoApproved` getter is read only by a test. Dead code under the "done means reachable" rule.
- `permission-handler.test.ts` lacks: a plan answer of the wrong kind (header claims "treated as withdrawn"); `callbacks()` undefined during `ExitPlanMode`; an already-aborted signal (`:205`); a rejecting `requestInteraction` (`:216`); explicit `autoApproveEdits: false` after a grant; `ExitPlanMode` while approvals are off; additional directories as roots.
- `permissions.test.ts:97` tests the check order with `requireToolApproval: true` for the edit cases only; it does not pin "sandbox before app tool" or "sandbox before approvals off". Seven top-level tests lack the AGENT id (`:25, 33, 39, 88, 97, 114, 202`).
- `EDIT_TOOLS` contains `MultiEdit`, which is not in `BUILTIN_TOOL_NAMES` of SDK 0.3.318 (harmless, unverified).
- `always_allow` writes `{toolName}` with no `ruleContent` (`permissions.ts:181`): for Bash that allows every command. The test (`:120`) checks the shape only.
- Bash and other tools are not sandboxed (by design); the architecture doc should say so.
- Types the translator handles that `sdk.d.ts` does not declare (`post_turn_summary`, `session_metadata`, `autocompact_state`, `task_summary`) exist only in the `sdk.mjs` bundle; model names in `usage` fixtures are "main" and "small", not real ids.


#### Claude session and runner, LATER

- Constant ids: `claude-session.test.ts:307` (`newUuid: () => "turn-uuid"`), `claude-runner.test.ts:62, 73`, `claude-runner-translators.test.ts:178`, `translate.smoke.test.ts:178`. The tracker marks uuids stale, so two default-id turns would hide real results.
- Tick counting: `until()` (`claude-session.test.ts:316`) and `flushMicrotasks(20)` (`:325`) count microtask ticks; a harmless extra `await` breaks them, and the negative asserts after them (`:715`, `:749`) pass too early if the code settles after 21 ticks.
- A watchdog force-settle (`turn-tracker.ts:143`) is silent and settles as `success`; a late real result is dropped as stale with its usage. `delete armWatchdog()` at `turn-tracker.ts:91` fails no test. Eviction of stale uuids at 1000 is untested. The ClaudeAgentRunner log-tag item has no code or test.
- `claude-runner.ts:82` (`this.lastEnv = env`) is hidden state; deleting it passes everything; `listModels` before `detect` would run with `{}`. The probe `timeoutMs` (`:87`) is unasserted. `failOn: "models"` (`claude-runner.test.ts:39`) is declared and never used. `ClaudeRunner.capabilities` (`:65`) has no test.
- `backgroundTasks.reset()` (`claude-session.ts:421`) is untested; after a crash the app keeps showing stale tasks. The SDK's `background_tasks_changed` message carries the full set with REPLACE semantics; the code ignores it.
- A crash while idle (no open turn) followed by `runTurn` is untested (the common out-of-memory case).
- `claude-session.ts:391-394` injects `resume`, but `sessionChoice` ignores it when `hasTranscript` is true: dead code. `turn-tracker.ts:102` (cancelled branch in `onStreamEnded`) is unreachable. Real `interrupt()` returns `still_queued` uuids; a steer queued before Stop can still run as a foreign turn, untested. `register(uuid)` twice overwrites the first resolver (`steer-receipts.ts:30`).
- Test session ids are `"s1"`; the real SDK requires a UUID (`sdk.d.ts:2173`).
- Duplicate fakes: `fakeScheduler` in two files; `scriptedQuery` and the config/workspace/start helpers in at least five. One shared fake `Query` with `satisfies Pick<Query, ...>` would do.
- `constants.test.ts` copies literals back from constants; `config-change.test.ts` never changes only effort (hard-code `live.effort=false` passes); `transcript.ts:67` `.catch(() => {})` swallows; the hash is checked for shape only. A contract test should write a file at `transcriptPath` and read it with the SDK's `getSessionMessages`.


#### ACP runner, LATER

- `adapters/opencode.ts:95` refuses any prompt whose first token starts with `/`; `/Users/jan/x.ts is broken` matches, is not a known command, and is rejected. The test (`adapters.test.ts:107`) uses `/deploy` only.
- `notice` and `compaction_update` are sent only if the client advertises `session.notices` or `session.compaction`; `acp-client.ts:499-506` advertises neither. `translate.test.ts:204-229` covers updates a real OpenCode never sends.
- `describeAcpFailure`'s `lastOutput` is never supplied in production and `lastText` (`acp-session.ts:119`) is never assigned; `acp-client.test.ts:410` tests the dead path. The `stderrTail` fallback is untested. The credit pattern runs before the rate-limit pattern (`acp-client.ts:155`).
- Permission mapping (`permission.ts:32-45`): `allow` with no `allow_once` offered returns `cancelled` (an approve silently turned into a cancel); no test for it, for `allow_with_suggested_rules`, `allow_edits_for_session`, `max_tokens` or `max_turn_requests`. The `tool_approval` interaction shape (`acp-session.ts:659-664`) is never asserted. The URL-mode elicitation decline exists twice (`acp-client.ts:542`, `acp-session.ts:338`) and is tested in neither.
- Fixed sleeps: `acp-client.test.ts:263` (5 ms), `acp-session.test.ts:505-506` (5 ms), `:433` (real 5 ms timer).
- Real size: no test of `AcpTranslator` with 20,000 chunks or 5,000 tool calls, tool output over the truncation limit (`translate.ts:203`), `readTextFile` reading a whole file before cutting (a byte cut can split UTF-8), or a model list with hundreds of entries (`modelChoices` checks only `entries[0]` for groups).
- Duplicate: `acp-runner.test.ts:172-173` repeats `adapters.test.ts:28`.
- Casts: `translate.test.ts` casts every payload `as SessionUpdate` (lines 31, 45, 57, 71, 171, 190, 210, 225); `acp-session.test.ts:203` and `acp-runner.test.ts:120` use `as unknown as AcpTranslator`.
- The OpenCode version floor is a warning log only (`acp-runner.ts:121-127`), not asserted.
- Hypothesis, not confirmed: a `session/load` replay may still be draining when `runTurn` sets `activeTurn`, leaking history into the turn.


#### Session, prompt, util, LATER

- Fixed ticks and real timers: `turn.test.ts:510, 606` assert a negative after one `setTimeout(0)`; `manager.test.ts:455` and `turn.test.ts:329` poll with a 2 s deadline; `utility-prompt.test.ts:373` uses a real 5 ms timer.
- The shrinker can corrupt structure at tiny budgets: `shrinkValue` shortens every string, including `eventId`, `type`, `kind` (`event-batcher.ts` ~:107); under about 36 characters the shape breaks. Test with an event of 30,000 items. `minimalEvent` for `user_message`, `checkpoint`, `turn_ended` and the final fallback are untested; the largest batch in `event-batcher.test.ts` is 60 events.
- `manager.test.ts:838-842` builds a `question` interaction with `questions: []` behind `as unknown as`, which `zInteraction` rejects (min 1).
- Duplicates: `manager.test.ts:932` and `:951` both assert the restart resume id; `workspace-instruction.test.ts:25` and `:39` both assert `.context`. Six `FakeApp`, four `FakePublisher`, three `FakeInteractions`, three copies each of `until`, `deferred`, `baseConfig`: one `test/fakes.ts`.
- `event-batcher.test.ts:261` ("warns every 60 s") is checked once; make the warning fire once and it passes. `event-batcher.test.ts:30` has a module-level counter.
- SIDE-20: `applyAgentConfig` (`manager.ts:840-841`) updates session state; no test; the `notify` result is ignored. The backlog says stub, yet the code, the claude-session tests and the app handler exist.
- `workspace-instruction.test.ts` uses `toContain` on keywords: change "Never read" to "Always read" (line 34) and it passes. `prompt/mentions.test.ts`: `number <= 0` to `< 0` (`mentions.ts:50`) makes `⟦pr:0⟧` a link and nothing fails. `pull-request-stub.test.ts`: the write-failure branch (`:45-51`) is untested. `util/async-queue.test.ts:18` says "woken by close" but `close()` runs with no waiting consumer: delete `async-queue.ts:35-39` and it passes. `interactions.test.ts:313` promises a resend but checks only the `openRequest` getter. `steering.ts:60-61` kinds `other` and `unsupported` untested.
- Many titles lack the feature id: `duplicate-guard.test.ts:7-58`, `queued-messages.test.ts:8-17`, `serial-queue.test.ts:12-41`, `steering.test.ts:4-25`, `assemble.test.ts` (11 tests), `blocks.test.ts`.
- For SIDE-11, `RpcPeer.detach` rejects pending requests and a request made while detached returns `app_not_connected` at once, so the broker settles the interaction with the safe answer; the open interaction that `onAppAttached` would resend is already gone. Nothing tests this with the real peer.


#### Models and tools, LATER

- `slash-and-mcp.ts:75-87` labels every Claude entry `source: builtin`, `kind: command`; the SDK `SlashCommand` has `builtin?: boolean`, so project, user and plugin commands and skills are mislabelled, and `slash-and-mcp.test.ts:81-123` pins "review" as builtin. The SIDE-16 item "Typing / also lists the project's own slash commands" has no test and the code cannot meet it.
- Untested: the `onChanged` throw catch (`agent-detection.ts:201-206`); Cursor `account()` (`:468-473`); a failing Codex `account/read` leaving `authenticated` unset; cancel during an in-flight start (orphans the flow until its timeout); two concurrent `finishLogin` calls both reaching `codex.finishLogin`; `agent-detection.test.ts:584` asserts `old.ok === false` and not the code `login_unknown`. `resolveProgram` calls `runner.detect` again (an extra `--version` spawn the comment says does not happen; the fake `detect` is free). `parseVersion` has no direct test; the detector reads stdout only while the runners read `stdout || stderr`.
- `mcp-launch.test.ts:28-39`: the round trip uses one fixture on both sides, with only `--enable-diff-comments`; drop `args.push("--enable-progress")` and it passes. `registry.test.ts` checks 3 of 4 gated names; `DiffComment` has no `enabledBy`, so with `diffComments` off an agent can still write comments but not read them; nothing pins this. `bridge-protocol.ts`: `args` is `z.unknown()`; the 1 MiB limit constant and `BRIDGE_IDLE_TIMEOUT_MS` have no consumer; the tests are silent on it.
- Duplicates: `registry.test.ts` repeats `tools.test.ts:156-170`; `format.test.ts:12` and `tools.test.ts:295`. `catalog.test.ts:136, 157` echo the fake's list back; no test that the returned array is a copy.
- Real size: all tests use 1 to 3 agents or models; a 300-model catalog is not tried.


## 4. Per-file verdicts

Paths are relative to `packages/sidecar/src`, except `protocol/` and `shared/` (under `packages/`). Rows that name several files give one verdict for all of them.

| Path | Verdict | Reason (key missed mutation for WEAK and THEATER) |
| --- | --- | --- |
| protocol/src/events.test.ts | WEAK | 3 tests for 4 event types and 14 item kinds; the round-trip test passes if the schema were `z.any()`, only the two negative tests bite |
| protocol/src/interactions.test.ts | WEAK | 2 of the interaction kinds; first test positive only |
| protocol/src/mentions.test.ts | WEAK | one test; a path containing the closing bracket, an empty path and the shared global regex are untested |
| protocol/src/session-config.test.ts | REAL | enum narrowing (`codexSandboxMode`, effort) and the missing switch each fail when the schema changes; narrow |
| shared/src/not-implemented.test.ts | REAL | small and exact |
| checkpoints/checkpoint-id.test.ts, checkpointer-constants.test.ts, checkpoint-rules-agreement.test.ts | REAL | three overlapping checks of the same prefix and exit codes (duplicate), each with a drift self-test |
| checkpoints/checkpoint-service.test.ts | REAL | exit codes, ordering of start and end, diff summary, truncation; recording runner only |
| checkpoints/checkpointer.test.ts | REAL | the script against real temporary repositories: save, diff, restore, odd file names, merge and rebase skips, signals |
| checkpoints/diff-summary.test.ts | REAL | renames, copies, binary, odd paths, 200-file cap |
| checkpoints/git-busy-check.test.ts | REAL | real repositories for merge, rebase (both backends), squash, cherry-pick, revert, linked worktree |
| checkpoints/run-checkpointer.test.ts | REAL | real scripts, process group and 64 KiB cap; flaky timeouts (H-6) |
| config.test.ts | REAL | named missing variables, relative paths refused |
| logging/log-ring.test.ts, logging/logger.test.ts | REAL | byte limit, filters, level, throwing sink, redaction; no feature ids |
| main.test.ts | REAL | dispatch and exit codes; the `import.meta.main` block is untested |
| models/agent-detection.test.ts | WEAK | good state-machine tests (single flight, generation guard, 60 s cache), but the detector is built without its ports in production (MD-1), constants compared with themselves (MD-5), invented `auth status` fixtures (MD-7) |
| models/catalog.test.ts | WEAK | the generation-guard test cannot fail without the guard (MD-3); several tests echo the fixture back; `validate` has no live caller (MD-4) |
| models/slash-and-mcp.test.ts | WEAK | fakes feed the lister its own `McpServerStatusView`; no runner implements MCP listing; Claude entries pinned as `builtin` (MD-11) |
| models/usage.test.ts | REAL | fixtures match the real `SDKControlGetUsageResponse` fields (`rate_limits.five_hour.utilization/resets_at`); hang guard, refusals and "never zero" paths each fail when the code changes; production wiring is missing (H-2) |
| modes/sidecar-mode.shutdown.test.ts | REAL | production step list, coordinator and signal handlers over fakes |
| modes/sidecar-mode.test.ts | WEAK | many helper tests, but `startSidecarHost` (about 250 lines) is not called (H-1, H-2); the probe kill test asserts `ok` only |
| outbox/event-outbox.test.ts | REAL | restart, atomic batch, rollback, directory fsync refusal, cap, corrupt and newer-version files, sweep race; no validation on append (H-4), memory storage only (H-5) |
| outbox/node-storage.test.ts | REAL | real files: mode 0600, no temp file, Trash refusal, directory fsync failure as its own code |
| outbox/outbox-file.test.ts | REAL | name encoding and file shape |
| outbox/replay.test.ts | REAL | order, persisted false, timeout, disconnect, single flight, ack during replay |
| packaging.test.ts | WEAK | compile arguments only; no real build; Rust contract by regex |
| process/idle-policy.test.ts | REAL | boundary values and skip rules |
| process/process-manager.test.ts | REAL | single flight, release race, warm cap, idle clock, disconnect during start, stopAll failure each fail when the code changes; seam to the manager is H-3 |
| process/spawn-child.test.ts | REAL | real `sh` child; SIGTERM-ignoring child is killed, stderr arrives early, stop after exit |
| prompt/assemble, blocks, system-additions .test.ts; util/errors.test.ts | REAL | escaping and ordering mutations are caught |
| prompt/mentions.test.ts | WEAK | `<= 0` to `< 0` (mentions.ts:50) passes |
| prompt/pull-request-stub.test.ts | WEAK | write-failure branch untested |
| prompt/workspace-instruction.test.ts | WEAK | keyword `toContain`; "Never read" to "Always read" passes |
| rpc/handlers.test.ts | WEAK | 5 of 24 request handlers checked (H-7); swap `warmAgent` and `resetAgent` passes |
| rpc/ndjson.test.ts | REAL | split chunks, CRLF, blank lines, oversize line and resume all asserted |
| rpc/peer.test.ts | WEAK | 3 of 6 validation paths (H-8); late response after timeout and requestInteraction's missing timeout not checked; 30 ms real-time race |
| rpc/server.test.ts | REAL | real Unix socket in a temp folder: second connection wins, mode 0600, stale file, close removes the file |
| rpc/shell-env-handlers.test.ts | REAL | asserts the workspace folder reaches the provider; duplicates 40 lines of deps |
| runners/acp/acp-client.test.ts | WEAK | leaks a temp folder (ACP-1); only `fs/*` over the wire; deleting the `session/update` handler fails nothing (ACP-2) |
| runners/acp/acp-runner.test.ts | WEAK | stub translator at :111; dropping `...permission.value` (acp-runner.ts:149) fails nothing (ACP-10) |
| runners/acp/acp-session.test.ts | WEAK | hand-written FakeTranslator; `FakeClient.exit()` never called; no second-turn or cancel-then-new-turn test (ACP-3, ACP-4) |
| runners/acp/adapters/adapters.test.ts | REAL | env JSON, merge precedence and v1/v2 config shape each fail when the source changes |
| runners/acp/methods.test.ts | REAL | compares our method names with the SDK constants |
| runners/acp/permission.test.ts | WEAK | never tests `allow`, `allow_with_suggested_rules`, `allow_edits_for_session`, `max_tokens` |
| runners/acp/tool-kinds.test.ts | REAL | covers the full kind table (the drift is in the caller, ACP-5) |
| runners/acp/translate.test.ts | WEAK | payloads carry a `name` the real agent never sends; non-terminal updates, truncation, multi-turn state untested (ACP-5) |
| runners/claude/background-tasks.test.ts | REAL | ambient and skip-transcript tasks, reset and updates covered |
| runners/claude/checkpoint-hook.test.ts | REAL | wait, no-wait, rejecting gate covered; non-PreToolUse events and "no gate set" untested; no feature id in titles |
| runners/claude/claude-runner-translators.test.ts | REAL | using the template translator instead of `fresh()` throws; factory-function branch untested |
| runners/claude/claude-runner.test.ts | WEAK | pass `options` instead of resolved `start` (claude-runner.ts:120) still passes (CS-8); capabilities, probe timeout, `lastEnv` unchecked |
| runners/claude/claude-session.test.ts | WEAK | good on cancel, stale start, respawn, config; fake stream ends cleanly on abort (CS-1); drop `hooks`/`mcpServers` (claude-session.ts:401-402) fails nothing (CS-4) |
| runners/claude/config-change.test.ts | WEAK | hard-coding `live.effort=false` passes: no test changes only effort |
| runners/claude/constants.test.ts | WEAK | copies literals back from constants: a change detector |
| runners/claude/options.test.ts | WEAK | thorough on resume and fork; `ultra` to `max` untested; `hooks`, `canUseTool`, `mcpServers`, `sessionStore` pass-through unasserted |
| runners/claude/permission-handler.test.ts | REAL | interaction, answer, mode-switch and abort paths assert outputs; sandbox part as weak as above |
| runners/claude/permissions.test.ts | WEAK | sandbox runs on a fake `realPath`; no `..`, symlink, dangling link, NotebookEdit (CT-2) |
| runners/claude/self-started-turns.test.ts | WEAK | unit logic real, but nothing constructs the class on a live path (CS-5); the test at ~:143 asserts `messages` stays `[]`, which the class can never fill (theater inside) |
| runners/claude/session-mirror.test.ts | WEAK | the test titled "never writes from the key" cannot detect a write (theater inside) |
| runners/claude/steer-receipts.test.ts | REAL | removing `waiting.delete` is caught |
| runners/claude/todo.test.ts | REAL | shape matches the SDK `TodoWriteInput` |
| runners/claude/tool-names.test.ts | REAL | best test in the slice: checks names against the real `BUILTIN_TOOL_NAMES` export |
| runners/claude/transcript.test.ts | WEAK | real temp files, cleaned; hash checked for shape only; rename failure untested |
| runners/claude/translate.smoke.test.ts | WEAK | duplicates translate.test.ts:427-475, constant id, one turn only (CT-7, CT-1) |
| runners/claude/translate.test.ts | WEAK | happy paths real, but the "dropped" test cannot fail (CT-5), fixtures invented (CT-4), many branches untested (CT-6) |
| runners/claude/turn-tracker.test.ts | WEAK | delete `armWatchdog()` at turn-tracker.ts:91 fails nothing |
| runners/claude/usage.test.ts | WEAK | hand-made narrow input; respawn cost rule contradicts the SDK doc (CS-6) |
| runners/codex/app-server-client.test.ts | WEAK | every frame carries `jsonrpc:"2.0"` which the real server omits (CX-1); spawn args never asserted (CX-6); write-refused, timeout, stderr cap, close ordering untested |
| runners/codex/approval-bridge.test.ts | WEAK | assertions good, but the bridge is not wired into any live path (CX-3); timeout does not check withdrawal (CX-8) |
| runners/codex/approvals.test.ts | REAL | reply shapes match the generated types; gaps `writeStdin`, `approvalId` |
| runners/codex/codex-runner.test.ts | WEAK | invented `skills/list` fixture (CX-4); `start()` never exercised; duplicate fake child |
| runners/codex/codex-session.test.ts | WEAK | stub translator, no-op callbacks, `dispose` untested, constant turn ids (CX-5, CX-7) |
| runners/codex/protocol.test.ts | THEATER | checks names are unique and spaceless; rename `turn/steer` to `turn/steering` and it stays green (CX-9) |
| runners/codex/tool-names.test.ts | REAL | mapping `bash` to `edit` is caught |
| runners/codex/translate.test.ts | REAL | item shapes match `ThreadItem`; one weak case at :56 |
| runners/cursor/tool-names.test.ts | REAL | names come from the research, the Cursor SDK is not installed |
| runners/errors.test.ts | WEAK | `instanceof` only |
| runners/output.test.ts | REAL | tail-side surrogate branch untested |
| runners/registry.test.ts | REAL | fine for the map; whether the real composition registers all four agents is untested |
| session/duplicate-guard, queued-messages, run-guard, serial-queue, steering .test.ts | REAL | small and exact; steering skips `other` and `unsupported` |
| session/event-batcher.test.ts | WEAK | largest run is 60 events; no schema check; 3 of 4 `minimalEvent` branches untested (SN-1, SN-5) |
| session/interactions.test.ts | REAL | title at :313 promises a resend but only checks a getter |
| session/live-state.test.ts | REAL | ordering, drop-while-flushing and write-failure paths driven |
| session/manager.test.ts | WEAK | runs on `FakeTurn`/`FakeProcesses`; delete the `queue.run` wrapper (manager.ts:211), the `cancelEpoch` check (214-216) or make shutdown call `turn.cancel()`: all pass (SN-2, SN-3, SN-4) |
| session/self-started-turns.test.ts | REAL | unit logic real; the class has no production importer (CS-5) |
| session/turn.test.ts | WEAK | delete the stale guard at turn.ts:228 and the test at :548 still passes (SN-4) |
| session/utility-prompt.test.ts | WEAK | lines 270-307 cannot fail (SN-8) |
| shell-env/capture.test.ts | REAL | commands per shell, fallback, single flight, per-folder cache, failure kinds; no real shell on the happy path |
| shell-env/env.test.ts | REAL | `env -0` parsing with noise and multi-line values, secrets stripped, override order |
| shell-env/rust-contract.test.ts | WEAK | regexes over `shell.rs` compare constants, not captured PATHs |
| shutdown.test.ts | REAL | failing step, step timeout, timer cancelled |
| tools/bridge-protocol.test.ts | REAL | missing token, unknown tool, non-JSON all refused; no feature id |
| tools/format.test.ts | REAL | exact text for answers, comments, terminal output; pins wording the agent reads (intended); one case duplicated in tools.test.ts; title carries CHAT-10 not a SIDE id |
| tools/mcp-launch.test.ts | WEAK | token only in the environment is pinned, but only `diffComments` is switched on: drop `args.push("--enable-progress")` and it passes; no feature id |
| tools/registry.test.ts | WEAK | checks 3 of 4 gated names; `DiffComment` has no gate and nothing pins it; duplicates tools.test.ts:156-170 |
| tools/tools.test.ts | WEAK | tool definitions are checked well with a fake backend, but the MCP server is read through a private SDK field, the wire is skipped (TL-1) and 4 of 7 backend methods are unchecked (TL-2) |
| util/async-queue.test.ts | WEAK | "woken by close" does not exercise a waiting consumer |
| watchdog.test.ts | REAL | injected scheduler and pid; single shutdown, overlapping sweeps skipped, stop cancels both timers |


## 5. Checklist map gaps

Source: the GitHub issue checklists and `docs/plans/items/system.tsv`. About 700 checklist rows belong to my features; I read each feature's list and mapped the items that have code. Only gaps are listed ("no test", or "passes without it" meaning a test exists but would stay green if the feature were removed). "Not built" items (placeholders that call `notImplemented`) are listed once and are not gaps.

Backlog rows marked `done` whose issues are closed but whose checklists hold an item with no failing test: **SIDE-02** (real-host smoke test; `AGENT_ERROR_CODES.authRequired` instead of the literal at `rpc/peer.ts:398`), **SIDE-06** (real-host smoke test; valid events only), **SIDE-01** (host wiring of the catalog `invalidate`, of `shellEnvFailed`, and the `spawnText` timeout code), **SIDE-15** (Codex sign-in port, Settings paths, Claude pasted code), **SIDE-14** (`validate` and default model have no live caller). Rows marked `stub` that already carry code but have items without tests: SIDE-07, SIDE-12, SIDE-17, SIDE-20, AGENT-05, AGENT-15.

### Core: SIDE-01, 02, 06, 07, 08, 19, GIT-10, GIT-11

- SIDE-01 (8 items): "Mode sidecar runs the agent sidecar": **no test** (H-1). Composition root builds the catalog and calls `invalidate()` from the detector's `onChanged`: **passes without it** (only the helper's order is tested; the host's argument is not). Pass `notifyFailure` and call `app.notify("shellEnvFailed")`: **passes without it** for the host line. Make `spawnText` return a timeout code: **no test, not done**. Config.ts stale comment about the log files: a doc item, no guard. Others covered.
- SIDE-02 (26 items): real-host smoke test: **no test** (closed issue). `AGENT_ERROR_CODES.authRequired` instead of the literal: **not done** (`rpc/peer.ts:398`). Validation in both directions: **passes without it** for 3 of 6 paths (H-8). `listModels` answered by the catalog: covered. Others covered.
- SIDE-06 (34 items): real-host smoke: **no test**. Fatal bad outbox at start: **no test** at the host (only `open()` returning an error). "With no app connected, events still queued ... requests answered with an empty result": no test in my area (batcher). Valid events only: **no test** (H-4). Others covered by the 14 outbox tests.
- SIDE-07 (30 items): "A session can change agent type; the old process is disconnected": **passes without it** at this layer. "One agent process per active chat, started and supervised": **no test** for supervision. "Busy and idle marks follow the live state": **no test** of the wiring (H-3). "Idle timeout skipped for sessions with background tasks": **passes without it** (no production caller). Warm cap, leases, single flight, disconnect: covered.
- SIDE-08 (35 items): mostly covered by the service and script tests. "A missing environment skips it": the real spawn of a missing script is **untested** (fake runner only). Items about the manager (start checkpoint before runner, end on cancel, shutdown takes none, previous end awaited) belong to the session review.
- SIDE-19 (8 items): "The sidecar exits within 2 seconds when its parent dies": **no test** with a real process. Others covered by injected-timer tests.
- GIT-11, GIT-10: covered by real-repo tests.


### Claude translator and permissions: AGENT-03, AGENT-04

- AGENT-03 (25 items checked): stream deltas / thinking tokens / task progress dropped: **passes without it** (CT-5). Rate limits pass through as a notice: **passes without it** for the text. Result errors and session-limit banner: **passes without it** for the real shape (CT-4). Autocompact state, post-turn summary, metadata: **passes without it** for the real autocompact shape. Cost delta across turns: **no test** (CT-1). Compact failed / informational / api_retry notices: **no test**. Unknown content block ignored: **no test**. Fast mode / service tier from usage: partial.
- AGENT-04 (52 items checked): edit tools must target a real path inside the workspace: **passes without it** for `..`, dangling symlink, existing symlink, `NotebookEdit` (CT-2). Every tool use asks the permission callback / approvals off allows: **passes without it** (the real CLI is never asked, CT-3). Allow edits for the session: **passes without it** across a respawn (CT-8). Auto-approve explicit false after a grant: **no test**. No approval callback means deny, for `ExitPlanMode`: **no test**. Permission prompts have no SDK timeout: **no test**. Always allow writes a rule to local settings: only the update shape is checked. Plan-mode instructions not set on the SDK: **no test**.


### Claude session and runner: AGENT-01 (Claude), 02, 05, 15, 16

- AGENT-02 (65 items): cancel interrupt then stop after 5 s: **passes without it** for the hung interrupt (CS-2). In-process MCP server option: **no test** (CS-4). PreToolUse checkpoint hook wired: **no test** (CS-4). Crash then next message respawns, nothing retries: **passes without it** (CS-3). Stale start raced by a stop: **no test** for dispose (CS-7). Stream throws or ends with no open turn, then respawn: **no test**. Background list reset per process: **no test**. ClaudeAgentRunner log tag: **no test, no code**. Symlinked workspace resolved: **passes without it** (CS-8). Config dir pinned at start: **passes without it** (the real pin is `sidecar-mode.ts:532`). Empty transcript renamed, rename fails: **no test**. `claude --version` 5 s hang guard: **no test**. SIGTERM then SIGKILL after 5 s, NODE_OPTIONS strip, TIMING, ProcessTransport and Query log tags: **no test possible** (SDK-owned, needs a real or recorded process).
- AGENT-05 (10 items, 7 in slice): steer only while a turn is open: partial, the settled-turn, closed-queue and failed-push branches (`claude-session.ts:268-282`) untested. SessionStore tag: **passes without it** (`session-mirror.test.ts:46`). Steer sequencing against the real CLI: **passes without it** (CS-9).
- AGENT-15 (3 items): all **pass without a live path** (CS-5).
- AGENT-16 (23 items, 12 touch Claude): effort `ultra` becomes `max`: **no test**. Settings JSON passes fast mode: **no test, no code** (CS-10). Not built: `launch-settings.ts` (output style, ultracode, Chrome flag, restart rule, toast). AGENT-18 `skill-plugin.ts` not built.
- AGENT-01 (Claude part): capabilities declared up front: **no test**.


### Codex, Cursor and top-level runner files: AGENT-01, 06 to 10, 13, 14

- AGENT-01 (24 items, about 16 with code): runner methods run/steer/stop/destroy are types only; capability flags honoured: **no test** (Codex `resumeAt:true` is not implemented); real runner factory wiring: **no test**; typed outcomes `SteerNotSupportedError`, `SteerRevertedError`: **passes without it**.
- AGENT-06 (33 items, about 20 with code): handshake with `experimentalApi`: **passes without it** against a real `initialize` (CX-1); spawn argv and launch env: **no test** (CX-6); cancel via `turn/interrupt` with one retry: covered, stop generations **no test**; jittered rate-limit backoff: **passes without it** for the jitter; JsonRpcAdapter log lines and backpressure: **no test**; `Thread` log tag: **no test**; report of the agent session id: **no test** (CX-5). Not built: code-mode host warning, rollback, pre-tool hook, managed requirements, resolved real path, 120 s gate.
- AGENT-07 (8 items, 5 with code): sub-agent child-thread tagging: translator covered, session passing the thread id **no test**; images staged: `codex-runner.ts:98` builds the translator with no stager. Not built: per-agent auth codes, a distinct sub-agent status event.
- AGENT-08 (24 items, about 11 with code): five server requests handled: bridge level covered, live wiring **no test** (CX-3); 300 s timeout: reply covered, card withdrawal **no test** (CX-8). Not built: delivery-failure dismiss, consent-delivery-failed notice, plan approval with no text.
- AGENT-09 (28 items): **not built** (`notImplemented` in runner, session, env-lock). AGENT-10 (2 items): name table covered; Cursor error message type not built. AGENT-13 (11 items): **not built** (`goals.ts` is placeholders). AGENT-14 (4 items): **not built**.
- Items checked: 134.


### ACP: AGENT-11, 12, 17

- AGENT-11 (35 items checked): client answers `session/update`, `request_permission`, `elicitation/create` over the wire: **no test**. Resume then load then new: **passes without it** (only happy resume). `session/load` call: **no test**. Elicitation form only (URL declined): **no test**. A new turn refuses a second one: **no test**. Waits for config writes (`writeChain`): **no test**. Cancel releases pending elicitation: **no test**. Model wait stops early on exit or cancel: exit untested, cancel not built. Empty reply is an error naming the adapter: **passes without it** when `usage_update` arrives. Sign-in methods listed in the message: **passes without it** (initialize-response path untested). Bare "Internal error" replaced by provider output: **passes without it** (dead path). App-tools MCP in `session/new`: **passes without it** in production. Policy env: **passes without it**. File access limited: weak (ACP-7). Write waits for `beforeFirstWrite`: **passes without it** (ACP-8). Closing waits at most 1 s: **no test**. AcpAgentRunner log tag: **no test**.
- AGENT-12 (15 items): model list wait / 90 s cap: pure function tested, wait not. OpenCode minimum version: constant and warning only. Tool-name hints: **passes without it** with real frames (ACP-5). Both OpenCode majors: only via a direct `agentVersion`; `start` passing the detected version is untested. MCP timeout floor: unit-tested, runner wiring not.
- AGENT-17 (9 items): mostly **not built** (`listAcpConfigOptions`, `setAcpConfigOption` are placeholders at `rpc/handlers.ts:99-100`). Built but untested: the `acpConfig` reconcile loop (`acp-session.ts:602-608`), boolean refresh, `setConfigOption` returning updated options.


### Session, prompt, util: SIDE-03, 04, 05, 09, 11, 20, 24

(155 items checked: SIDE-03 31, SIDE-04 19, SIDE-05 36, SIDE-09 28, SIDE-11 22, SIDE-20 8, SIDE-24 11.)
- SIDE-03: warm agent used by the first message: **passes without it** (checks one start only). PR repository to prompt assembly: **no code, no test** (SN-9). Query payload carries `resume` on the first message: **no test**. One-at-a-time queue, cancel skips it: **no test** (SN-4). Queue key per chat: **no test** (a constant key passes). Duplicate guard in-flight id: unit only, no overlapping send. Steer with no active turn: **no test** (SN-7). Cancel with nothing running goes idle: **passes without it**. Option changes serialised on the queue: **no test**. `setAutoApproveEdits` end to end: **no test** (restarted agent, unknown chat silently dropped).
- SIDE-04: run number checked at the runner result: **passes without it** (`turn.ts:228`). Stale branch in `launch` and callbacks: **no test** (`turn.ts:204, 293, 300`). Abort controller per query: partial.
- SIDE-05: steer RPC returns after flush: **no code, no test** (SN-7). Fast-mode callback reaches live state: **no test** (`turn.ts:299-300`). Event shrunk above 80 percent: partial. "Has not settled" every 60 s: **passes without it**. Envelope carries valid events: **no test** (SN-1).
- SIDE-09: stub holds the GitHub URL when known: **no test at the seam** (SN-9). Stub write failure: **no test**.
- SIDE-11: new message, steer, shutdown or reset withdraws: **no test** (SN-6). Answer through the manager: **no test**. Resend after reconnect: **passes without it**.
- SIDE-20: config stored in session state: **passes without it**.
- SIDE-24: writes nothing, never logs launch: **passes without it** (SN-8). Never resent (D016): **no test**. Real ACP and Cursor start path: **no test**.
- Not built, not gaps: SIDE-24 privacy switch (3 items), hosted-summarizer toast, app-side branch rename; SIDE-05 two app-side `store` rows; SIDE-03 about four design-note rows.


### Models and tools: SIDE-12 to 16, 22

(SIDE-14 8 of 11 items checked, SIDE-15 24 of 38, SIDE-16 7 of 16, SIDE-12 7 of 26 here plus the rest in `tools.test.ts`, SIDE-13 5 of 13, SIDE-22 0 of 12: not built.)
- SIDE-15: 5 s version hang guard: **passes without it** (constant echo, real probe never run, MD-5, MD-6). Codex device-code sign-in starts and waits up to 10 minutes: **passes without it** (port faked, not implemented, not wired). Codex `account/read` gives the account type: **passes without it**. Settings executable paths override the program path: **passes without it** (never wired). Prefer the managed copy, then the Settings path: **no test** of the order. CLI sign-in accepts a pasted code from Claude: **passes without it** (code discarded, MD-2). Cursor account read: **no test**. `CONDUCTED_ACP_PROVIDERS_DIR`: not built.
- SIDE-14: validate the model before a turn: **passes without it** (no live caller, MD-4). Each agent has a default model: **passes without it** (`isDefault` always false for Claude). A cache with a stated lifetime: **passes without it** (literal 1 hour not asserted, guard untested).
- SIDE-16: list MCP servers with status: **not built** (no runner implements it). List the project's own slash commands and skills: **no test**, code cannot meet it.
- SIDE-12: availability flags decide which tools exist: **passes without it** for `DiffComment`. Others per TL-1, TL-2 and the earlier audit (unexpected_answer, app_request_failed, alwaysLoad, annotations, disallowed tools).
- SIDE-13: app tools injected into Codex config: **no test** (MD-10). Bridge hello and idle timeout, private bridge folder, serving Codex and ACP, one bridge per run with one token per chat, `codex-mcp` as an MCP server, reserved server name clash, leftover folder check: **not built**.
- SIDE-22: all 12 items **not built** (`completions-cache.ts` is a placeholder).


## 6. Missing test layers

1. **Host smoke (real process).** Spawn `bun src/main.ts sidecar` (and once the compiled binary on a Mac runner) with temp folders under `TMPDIR`; read `SOCKET_PATH=`; connect; call `getAgentInstalls`, `listModels`, `getSessionStatus`, `getContextUsage` for a live chat; send SIGTERM; expect exit 0, socket gone, nothing left behind. Covers H-1, H-2 and the unbuilt SIDE-13 bridge. Three closed or open issues (SIDE-01, SIDE-02, SIDE-06) already list it. It fails today.
2. **Recorded-transcript replay for each agent program.** The parallel-build plan says "a recorder captures a real session once, CI replays it" and "real-agent contract tests (planned)". Neither exists; every Claude, Codex and ACP fixture is hand-typed. Record one real session per program (Claude Code through a stub `pathToClaudeCodeExecutable`; `codex app-server` over stdio; OpenCode over ACP), keep it as a `.jsonl` fixture, and replay it through the real transport, translator and session. This catches CX-1 (no `jsonrpc` field), CX-2, CX-4, ACP-5, CT-1, CT-4 and CS-1. The `claude`, `codex` and `opencode` programs are installed on this Mac. `pi` is not installed anywhere I looked, so the Pi adapter (`acp/adapters/pi.ts`, 25 lines) has config-shape tests only.
3. **Contract tests between fakes and the real thing.** `FakeProcesses` against `AgentProcessManager` (release, markIdle, single flight); `MemoryStorage` against `createOutboxStorage` (both copies); `FakeApp` against `RpcPeer` (schema validation); the fake `Query` against the SDK (abort throws, control requests fail after exit); `FakeChild` against a real piped child (chunked lines, exit ordering). Today none exists in my area; `rust-contract.test.ts` and `checkpoint-rules-agreement.test.ts` are the only contract-style tests and they compare constants by regex.
4. **Manager with a blocking runner and the real process manager.** Cancel mid-turn, steer, interaction mid-turn, queued drain, idle stop after 30 minutes, background tasks. All 113 session tests answer instantly. Covers H-3, SN-2, SN-4, SN-5.
5. **Sidecar peer joined to the desktop tunnel.** One valid params/result pair per protocol method over an in-memory transport, both directions, plus reconnect and replay. The two sides share one schema table (good) but not one test.
6. **Schema-validation layer for producers.** Every event or notification a test captures goes through `zSessionEvent` or the notification schema (SN-1, H-4). Golden samples per method in `packages/protocol` parsed by both runtimes.
7. **Real size.** Outbox with real storage and thousands of events (H-5); 20,000 events through the publisher and the real outbox; replay of N pending events; the tracker's 1,000-uuid eviction; the ACP and Codex translators with 20,000 chunks and 5,000 tool calls; a 5 MB JSON-RPC line through `spawnJsonRpcChild`; a 2 MiB event through the shrinker.
8. **macOS runner layer.** The product is macOS only and `pnpm test` runs the sidecar tests on ubuntu. Not exercised on a Mac: `zsh -ilc` capture happy path, `trash`, APFS case rules for the edit sandbox, `process.ppid` after the parent dies, process-group kill of grandchildren, the compiled binary.
9. **Real-process lifetime tests.** Parent dies, sidecar exits within the 2-second claim; sidecar killed with SIGKILL, agent children exit; an agent child crashing mid-turn and the next turn starting a new one (`ClaudeSession`, `CodexSession`, `AcpSession`).
10. **Detector and catalog composition.** Build `DefaultAgentDetector` and `RunnerModelCatalog` as the host does, with the real `probeCommand`, real runners and scripted programs (outputs recorded from the real `claude --version`, `claude auth status --json` including exit 1, `codex --version`, `opencode --version`). Covers MD-1, MD-4, MD-6, MD-7.


## 7. Rules and guards

Rules worth adding to `docs/engineering.md` (each one is a failure I found):

- **A stand-in for an agent program ships with a recorded session.** A fake `Query`, Codex child or ACP agent is only allowed if a recorded transcript of the real program replays through the same code path.
- **Every event or notification a test captures is schema-parsed.** One shared `FakeApp` applies the protocol schema.
- **Every composition root function is called by a smoke test.** A header line "Not yet covered" is a finding, not a note.
- **A port between two features gets one test with both real halves.** Process manager with session manager; outbox with real storage; peer with tunnel.
- **A process test never uses a timeout under 2 seconds to start a script.** Wait for a ready file, then let the clock matter.
- **A fake that closes a stream on abort also has a case that throws, when the real one throws.**

Checks a script could run, with what each flags today (grep or a small TypeScript pass over `*.test.ts` and `src`):

| Check | Flags today |
| --- | --- |
| A production export (class or method on a port) with no importer outside tests | `SelfStartedTurnTracker`, `SelfStartedTurns`, `ProcessManager.markIdle` and `setBackgroundTasks`, `CodexApprovalBridge` construction, `ClaudePermissionHandler.resetSessionGrants` |
| An exported function of 100 or more lines in `modes/` with no call in any test | `startSidecarHost` |
| A fake `notify` / `publish` / `request` that records params without running a schema `safeParse` | six `FakeApp` classes (`event-batcher`, `manager`, `turn`, `live-state`, `self-started-turns`, `interactions` tests) |
| A constant id fake: `(uuid\|newUuid): \(\) => "..."` | `claude-runner.test.ts:62, 73`, `claude-session.test.ts:307`, `translate.smoke.test.ts:178`, `claude-runner-translators.test.ts:178` |
| `as unknown as` on SDK or schema-bound fixtures, counted per file against a baseline | 42 in `runners/claude`, 10 in `runners/acp`, `manager.test.ts:842` |
| A fixture containing `jsonrpc: "2.0"` in a Codex test | `app-server-client.test.ts:105, 142, 181, 194`, `codex-runner.test.ts:104, 151, 199, 227` |
| A test whose only assertion is `toEqual([])` or `toHaveLength(0)` over a loop | `claude/translate.test.ts:383-398`, `manager.test.ts:1081-1082` |
| A test file with no `expect` | none today |
| `vi.mock`, `mock.module` or `spyOn` of the unit under test | none today (the suite uses hand fakes only) |
| `mkdtemp(tmpdir())` at module level with no cleanup | `acp/acp-client.test.ts:178` |
| `setTimeout` or `Bun.sleep` in a test, outside a hang guard | 23 lines in 14 files; the ones that decide a result: `peer.test.ts` (30 ms race), `claude-session.test.ts:316-327` (tick counting), `acp-session.test.ts:505-506`, `turn.test.ts:510, 606` |
| A hang-guard timer that is never cleared | `manager.test.ts:1095` |
| Timeouts below 1 second for a spawned shell script | `run-checkpointer.test.ts` `smallTimeouts()` (300 ms, 200 ms) |
| A fake class defined in more than one test file | `FakeApp` x6, `FakePublisher` x4, `FakeInteractions` x3, `MemoryStorage` x2, `FakeChild` x2, `fakeScheduler` x2, `scriptedQuery` in 5 files |
| A fake member no test calls | `FakeClient.exit` (`acp-session.test.ts:112`), `failOn: "models"` (`claude-runner.test.ts:39`), `FakeChild.stop` never firing `onExit` |
| Bare `rejects.toThrow()` | `acp-client.test.ts:331` |
| A test file whose titles carry no `SIDE-`, `AGENT-`, `GIT-` or `PLAT-` id | 21 of 106 files (listed in the core LATER section) |
| A "Must handle" line in a header with no test title that names the case | stop generations, `CodexMcpConsent` log tag, late response after timeout, "live events keep flowing during a replay" |
| A zod `parse` of one object the test wrote itself that would pass for `z.any()` | `protocol/events.test.ts` first test, `interactions.test.ts` first test |
| A source file in the coverage "no test loads" list that has no `notImplemented` | `runners/claude/self-started-turns.ts` and `session/self-started-turns.ts` only matter once slice 2 merges |
| An optional dep of a class that the composition root never passes | `DefaultAgentDetector`: `codex`, `cursor`, `executablePath`, `findManagedProgram`, `cursorApiKey` (`sidecar-mode.ts:601`); `AcpRunner`: `appToolsServers`, `translator`, `createClient`; `SessionUsageReader`: `sessions` |
| A runner that declares `mcpServers: true` (or another capability) with no method behind it | `claude-runner.ts:71`, `codex-runner.ts:60` (no `listMcpServers`); `codex-runner.ts:57` `resumeAt: true` |
| `toBe(CONST)` or `timeoutMs: CONST` where `CONST` is imported from the file under test | `agent-detection.test.ts:204, 230, 234, 260, 550`, `catalog.test.ts:194` |
| A `JSON.stringify({ loggedIn ...` or other CLI-output literal in a test that did not come from a recorded fixture file | `agent-detection.test.ts:186, 216, 334, 629, 650, 673` |
| Mutation testing (Stryker) on small, pure modules as a periodic check, not a gate | the survivors named in MD-3, MD-5, MD-8, MD-9 are what it would report |


## Findings outside my area (one line each)

- `apps/desktop/src/core/sidecar/tunnel.ts` and the sidecar `RpcPeer` are two implementations of one peer and are never joined in a test (see layer 5).
- `apps/desktop/src/core/async/serial-queue.ts` (`createKeyedQueue`, listed under "Shared helpers") and `packages/sidecar/src/session/serial-queue.ts` (`KeyedSerialQueue`) are the same rule written twice; it belongs in `packages/shared`.
- `scripts/check-stubs.ts`: a `stub` row with code but no `notImplemented` (AGENT-05, AGENT-15, SIDE-20) is not flagged.
- `docs/architecture.md` "Trust boundaries" states the edit-path check as unconditional; CT-3 says it may not run in bypass mode.
- `docs/plans/items/system.tsv` still marks the boolean ACP config capability "partly" although the code advertises it.
- `apps/desktop/src-tauri/src/sidecar.rs` is 64% covered on main, with 443 uncovered lines, the same count as `sidecar-mode.ts`; the launcher side of the host smoke test has no counterpart either.
- `packages/sidecar/src/config.ts` comment about where log lines go is stale (SIDE-01 checklist item).

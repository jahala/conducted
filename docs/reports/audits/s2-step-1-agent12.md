# Audit: n8-s1-agent12.audit (branch slice2/step-1)

Read: CLAUDE.md, architecture, engineering, issue #77, other-runners 2.2/3/4/5, all AGENT-12 files and their callers (`acp-runner.ts`, `acp-session.ts`, `sidecar-mode.ts`). No conflict markers remain in `runners/acp`. Nothing was run.

## AGENT-12 ACP adapters for OpenCode and Pi, with translation

### MUST

1. `packages/sidecar/src/runners/acp/translate.ts:297-305`: `chunkText` and `blockText` are identical functions. Fix: delete one and call the other from both places.
2. `packages/sidecar/src/runners/acp/acp-runner.ts:121-127` and `adapters/adapter.ts:55`: the adapter.ts doc comment says versions below `minimumVersion` are "reported as update needed". The code only logs a warning, and `detect` returns the same `{ path, version }` shape. Nothing downstream can tell that OpenCode is older than 1.16.2, so the checklist rule "needs at least version 1.16.2" is not enforced. Fix: return the below-minimum state from `detect` (or refuse `start` with a named error) and test it. Otherwise cut the claim from the comment.
3. `packages/sidecar/src/runners/acp/adapters/opencode.ts:33-37`: `majorVersion` returns 1 when the version is unknown or unparseable. This is an invented default. `detect` passes `undefined` when the version probe fails, so OpenCode 2 would get the v1 config shape and no MCP timeout, with no error. Fix: have `permissionEnv` return an error (or skip the timeout and say so) when the version is unknown. The "defaults to 1" path has no test either.
4. `packages/sidecar/src/runners/acp/acp-runner.ts:225-233`: when the 15 s model-catalog wait ends without a model option, `listModels` returns `[]` with no error. The picker shows nothing and the user never learns why (silent fallback). Fix: return or throw a named "model list did not arrive" error when the wait times out, and test that path.
5. `packages/sidecar/src/runners/acp/adapters/opencode.ts:90-105`: `checkSlashCommand` treats any prompt that starts with `/` as a command. A prompt such as `/Users/me/file.ts fails to parse` is refused with "OpenCode does not know the command" once the command list is non-empty. This is a user-facing bug; the research says the exact `f0o` logic was "not read in full" (other-runners line 216). Fix: refuse only when the first token has no further `/` in it. Add a test with an absolute path.
6. `packages/sidecar/src/runners/acp/translate.ts:89-90` and `acp-session.ts:399-403`: `usage_update` is handled twice, with the same `used`/`size` mapping. The translator emits a usage item and the session keeps its own `this.usage`. Fix: have the session read context usage from the translator's output, or the reverse, so one place owns the mapping.
7. `docs/plans/backlog.md:97`: the AGENT-12 row is still `stub` although no placeholder remains in `runners/acp`. The issue says the PR that closes it sets the row to `done`, and `pnpm stubs` fails on a `stub` row with no placeholders. Also stale: `docs/plans/items/system.tsv` lines 515, 521, 2647 still say `missing` for checkPrompt, sessionStorage and the two OpenCode majors, and line 2646 should be re-checked. Fix: set the row to `done` and update the item statuses in the same change.

### LATER

8. `translate.ts:173-189` (`toolCallUpdate`): non-terminal `tool_call_update` messages are dropped, including the ones that carry `rawInput`, a new `title` or `kind`. ACP agents often send `tool_call` with an empty `rawInput` first and the real input in an `in_progress` update. The chat card then shows an empty input. Fix: merge `rawInput` and `title` from non-terminal updates before the call is emitted, or re-emit the call. Needs a test with two updates for one call.
Outcome: open, item AGENT-12
9. `translate.ts:307-311` (`diffText`): the header says "diff content is shown as an edit", but the result only carries the text "Edited <path>". The diff itself (`oldText`/`newText`) is lost. Fix: either pass the diff to the card in a canonical edit input, or change the header to say that only a one-line summary is shown.
Outcome: fixed already, 470e25c1 the header now says "diff content is summarised as Wrote/Edited <path>", which matches `diffText` (`translate.ts:6`).
10. `translate.ts:207-273`: `plan`, `usage`, `notice` and `compaction` also call `drain()`. The header and the checklist say the buffer is flushed at tool boundaries and the turn end only. The behaviour is reasonable (it keeps order), but the header should list it, and no test covers a flush caused by `usage_update` or `plan`. Fix: add one test and one header line.
Outcome: open, item AGENT-12 (header line added in 184aa57b; `translate.test.ts` still has no case with text buffered before a `plan` or `usage_update`)
11. `acp-session.ts:407-418`: a throw inside `translator.push` is logged and the update is dropped. This is "an error that is only logged" (engineering.md). It belongs to AGENT-11, but it hides translator bugs. Fix: surface it as an `error` item for the turn.
Outcome: fixed already, ad3ab4b9 `acp-session.ts:604-606` lets a translator throw propagate and ends the turn with the error.
12. Test gaps against the checklist:
    - "The ACP model list waits 15 seconds and is capped at 90 seconds": `adapters.test.ts` tests only the pure `modelCatalogWaitMs`. No runner test shows that OpenCode waits, that Pi (wait 0) does not, that the wait ends at the timeout, or that `spent` from the clock is used.
    - `ACP_COMMAND_LIST_WAIT_MS` (2 s): no test for the timeout path of `listSlashCommands`.
    - `permissionEnv` has no test that the value never reaches a log, although the opencode.ts header says "must never log the value".
    - "The Agent submenu also lists OpenCode and Pi" (ui-map 3.5): no AGENT-12 test. `ModelPicker.test.tsx:408` covers the entry, so treat as covered elsewhere and name the owner in the issue.
Outcome: open, item AGENT-12 (model-wait tests added in `acp-runner.test.ts:444-497`, the clock path in 470e25c1; the command-list timeout and the "permissionEnv never logs" test are still missing)
13. `adapters/pi.ts:22-24`: `permissionEnv` ignores `requireToolApproval`, so Pi gets no approval policy through the environment. This may match Conductor (research line 159 names only OpenCode), but the header is silent. Fix: add one header line saying Pi's approval goes through ACP `session/request_permission` only.
Outcome: fixed already, 470e25c1 the `pi.ts` header now says approval goes through ACP session/request_permission only.
14. `adapters/opencode.ts:7-9` and `:19-20`: the OpenCode 2 key `mcp.timeout.execution` is taken from the inventory and could not be checked here (installed OpenCode is 1.18.x). `OPENCODE_DB` does appear in the installed binary, and the v1 key `experimental.mcp_timeout` is read there. Fix: verify the v2 key against an OpenCode 2 build before the claim stays in the header.
Outcome: fixed already, 470e25c1 the header now says the key "was not checked against a 2.x build here" (`opencode.ts:8-9`).
15. `acp-runner.ts:60` (comment on `translator?`): "AGENT-12 supplies it in the composition root" is now false, because `makeTranslator` builds `AcpTranslator` by default. Fix: reword to say the option is a test injection point, or remove it if nothing passes it.
Outcome: fixed already, 470e25c1 the comment now says "a test injection point the composition root leaves out" (`acp-runner.ts:82`).
16. `acp-runner.ts:206-210, 244-248`: `listModels` and `listSlashCommands` start the agent with `this.lastEnv` only. They skip `sessionStorage.env` and `permissionEnv`, so the throwaway session reads the user's global OpenCode database and config. Fix: state this choice in the header or apply the adapter env.
Outcome: fixed already, 833f6059 the header states the design choice: listing sessions run the `ListingContext` environment and do not apply the adapter's approval policy or session storage (`acp-runner.ts:28-31`); the code takes `context.env`.

### Checks with no finding

- Header claims kept: `tool-kinds.ts`, `registry.ts`, and all `Owns`/`Must handle` lines in `adapter.ts` except items 2 and 15 above.
- Wired into a live path: `ACP_ADAPTERS` in `sidecar-mode.ts:967`; `modelsFromConfigOptions`, `modelCatalogWaitMs`, `sessionStorage`, `permissionEnv`, `checkPrompt` and the translator in `acp-runner.ts`; `translator.flush()` at turn end in `acp-session.ts`.
- Fakes: the translator tests use distinct tool call ids per scenario; no constant-id fake found.
- Shared helpers: no copy of a helper from the architecture.md table; `messageOf`/`isAppError` are not re-implemented. `isRecord` exists only in opencode.ts.
- Newest-answer guard: not applicable; the translator is synchronous per session.
- Listeners: the collector's timers clear on resolve; `listModels` and `listSlashCommands` close the client in `finally`.

Summary: AGENT-12: 16 findings (7 MUST, 9 LATER).

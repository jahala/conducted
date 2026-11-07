# Sidecar differential run, 7 November 2026

Conductor's sidecar started sealed, and all 16 scenarios ran on both sidecars. The run found five bugs in ours and two gaps to research; every other difference is one our decisions already make.

## How it ran

- Conductor 0.92.1's `conductor-runtime sidecar` ran in place from /Applications. Nothing of it was copied. Ours ran from this checkout the same way.
- Each scenario got a fresh folder under /tmp for home, temp, data folders, a small git repository and the fake agents. The folder was removed after each scenario. The environment was built from nothing. PATH held the fake `claude` and `codex` and the system folders, which the run checks hold no real agent. The login shell both sidecars capture is a stand-in running `zsh -f`, so the system profile cannot put Homebrew's real agents back on PATH.
- Both ran under `sandbox-exec`: no IP traffic beyond loopback, and no writes under the owner's home. Each run proves this first: curl to a name and to 1.1.1.1 fail, and a write in the home folder fails. Loopback stays open because Conductor's Codex runner serves a hook bridge on 127.0.0.1. With loopback closed, every Codex chat failed.
- One fake program plays both agents, in Claude's stream-json and Codex's app-server format. A marker in the message picks the turn. Shapes come from our test fixtures and the SDK's types. Where Conductor's checks rejected a field the fake left out (Codex approval `startedAtMs`, `environmentId`), the fake was fixed.
- The harness is `scripts/conductor-reference/sidecar-diff/`. The full run took 2.4 minutes at `nice -n 19`. Raw output stays in `.context/day/conductor-ref/sidecar-diff/`. The kill criterion was not reached.

## Scenarios

Each sidecar ran these 16: start a chat (warm, then status), send a message, a tool turn, cancel, an API error, a queued message, plan mode, approval allowed, approval denied, a Claude result without `user_message_uuid`, list Codex models, list Claude models, slash commands, a Codex message, a Codex approval and a Codex cancel. Each comparison covers two things in order: what came back on the socket, normalised, and what each sidecar wrote to the agent.

## Bugs in ours, for fixing

1. **A result without `user_message_uuid` hangs the turn.** Older Claude programs send results without that field. `turn-tracker.ts` treats such a result as foreign, so the chat stays working until the 120 s watchdog fires: no `turn_ended` and no end checkpoint. Conductor takes it as the turn's end unless `origin.kind` is `task-notification`. Scenario `legacy-result`.
2. **An API-error turn shows its error twice and ends as `success`.** The assistant message carries `error: server_error`, and the result carries `is_error: true`. `translate.ts` makes an error item from each, with the same text, once retryable and once not. `turn_ended` then says `success`, though D008 defines an `error` outcome. Scenario `error`. The fake's shape follows the SDK types, not a recorded failure.
3. **Every model is asked for adaptive thinking.** `claudeThinkingOption` in `launch-settings.ts` always sends adaptive thinking. claude-runner.md 1.2 and Conductor give models without adaptive thinking a token budget instead. For Sonnet 4.6 at high effort, Conductor sent `--max-thinking-tokens=16000` and ours sent `--thinking=adaptive`.
4. **An approval request arrives before the events that led to it.** `requestInteraction` reached the app 1 to 3 ms before the `system/init` and `tool_use` events. Live state waits for the event batcher to flush, and interactions do not. Conductor sends the events first for Claude tool approvals. Scenarios `approval`, `approval-denied` and `plan-mode`. #361 made ours send every interaction after its events; the plan and Codex cases are measured again below, in "Event order, measured again".
5. **Codex's managed requirements are ignored.** Before a thread starts, Conductor calls `configRequirements/read`. It then narrows the approval policy and the sandbox to what the managed requirements allow. Ours sends the requested values unchecked. The research does not mention this.

## Gaps to research, not judged

- Codex start-up. Conductor sends things ours does not: `experimentalFeature/enablement/set`, plus `account/read` and `thread/goal/get` for each chat. On `thread/start` it adds `personality` (default `pragmatic`), `persistExtendedHistory` and six `features.*` flags. On each `turn/start` it adds `collaborationMode` (Codex plan mode) and `summary: "none"`. other-runners.md covers none of these.
- Claude models. Conductor maps its catalog id `sonnet` to `claude-sonnet-4-6`, and ours passes the id through. For `listModels` and `warmAgent`, ours starts a throwaway Claude process to read the list. Conductor has no sidecar call for this (its catalog is hosted). This is written down in `catalog.ts` (SIDE-14), but no decision records it. The same goes for our `agentSessionId` notification.

## Deliberate differences

- Our `turn_ended` event comes after the end checkpoint, and then the chat goes idle. Conductor reports idle first and sends its checkpoint events after. Both follow from D008.
- Ours has no `queryError` and no `sessionStatusNotification`, and `user_message` has no queued or sent state. A queued message is stored when its turn starts. Conductor stores it twice, once as `queued` and once as `sent`. All of this is D031.
- On cancel, ours sends Claude's `interrupt`, and Conductor stops the process (D015).
- In Codex chats, ours stores completed items and tool starts only, so there are no `thread`, `turn` or message `item.started` events (D005).
- Method names, answer shapes and config echoes differ. Conductor sends the config state with every send. Ours sends `agentConfigChanged` only when plan mode ends, which matches Conductor's config state after a plan approval (D031, D032).
- Ours passes `--allow-dangerously-skip-permissions`, which SDK 0.3.318 requires for `bypassPermissions`.
- Version probes and install lists differ, and ours also probes Codex at start. These are listed but not compared.

## What matched

Agent output reached the app in the same order in every Claude scenario. Approvals and denials reached the agent the same way. A message sent mid-turn reached the agent only after the first turn on both. Slash command and Codex model lists matched by name. Codex message text and usage matched.

## Event order, measured again

Four runs of `plan-mode`, `approval`, `approval-denied` and `codex-approval` on 7 November 2026 (one run of three scenarios, then three of all four), with ours at #361's order. Where the interaction reached the app:

| Scenario | Conductor, in each run | Ours |
| --- | --- | --- |
| `approval`, `approval-denied` | after the Bash `tool_use`, every run | after the `tool_use`, every run |
| `plan-mode` | after "Here is my plan." and before ExitPlanMode's `tool_use`, every run | after the `tool_use` |
| `codex-approval` | before `item.started` (two runs), after it (one run), before `turn.started` (one run) | after `item.started`, every run |

- Codex: Conductor's order changes from run to run, so it is timing, not a rule. Ours keeps the events-first order, which is one of the orders Conductor produces.
- Plan mode: Conductor's order is stable but sits between two events: the plan approval goes out one event ahead of its own `tool_use`. A trial that sent the plan approval without waiting for the flush put ours before `system/init` and the plan's text, which raised the scenario's differences from 9 to 11, so it was not kept. Matching Conductor here would mean holding back only the ExitPlanMode `tool_use` event, a rule fitted to one tool. The likely cause is Conductor's in-process SDK answering `can_use_tool` at once for ExitPlanMode, while its message loop is one message behind; for Bash its permission path waits first. Ours keeps events first for every interaction. Left for the owner to rule on.

## Next

Fix 1 to 4, each with a failing test first; each scenario already reproduces its bug. Item 5 and the gaps need a research pass. To rerun: `nice -n 19 bun scripts/conductor-reference/sidecar-diff/diff.ts [scenario ...]`.

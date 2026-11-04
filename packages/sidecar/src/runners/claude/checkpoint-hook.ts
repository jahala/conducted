/**
 * @feature AGENT-02 Claude: the checkpoint gate
 * Owns: the PreToolUse hook that makes a tool wait until the turn's start checkpoint exists.
 * Behaviour: research/conductor/claude-runner.md section 1.4: for every tool outside the
 * read-only set the hook awaits the pending start checkpoint, then returns an empty result. The
 * snapshot never delays the model's first tokens, but always precedes the first change.
 * Must handle: read-only and app tools pass at once, a writing tool waits, a rejected gate does
 * not block the tool (the checkpoint service resolves to a skipped outcome and never rejects, but
 * the hook still guards), other hook events are ignored, and a turn with no gate set yet passes.
 * Test first: a Bash call waits for the gate promise; a Read call returns without waiting.
 */
import type { HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import { isNonWritingTool } from "./tool-names.ts";

export interface CheckpointGate {
	/** The current turn's TurnCallbacks.beforeFirstWrite, or undefined between turns. */
	current(): (() => Promise<void>) | undefined;
}

export function createCheckpointHook(gate: CheckpointGate): HookCallbackMatcher {
	return {
		hooks: [
			async (input) => {
				if (input.hook_event_name !== "PreToolUse") return {};
				if (isNonWritingTool(input.tool_name)) return {};
				const wait = gate.current();
				if (wait) {
					try {
						await wait();
					} catch {
						// The tool still runs; the missing checkpoint is already in the turn's events.
					}
				}
				return {};
			},
		],
	};
}

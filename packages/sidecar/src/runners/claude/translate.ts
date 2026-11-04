/**
 * @feature AGENT-03 Claude: translate SDK messages to the neutral format
 * Owns: mapping each message the Agent SDK yields to zero or more AgentMessage values.
 * Behaviour: research/conductor/claude-runner.md section 2 (what the SDK yields and what Conductor
 * forwards unchanged) and other-runners.md section 3 (the neutral format). Conductor forwards the
 * raw SDK message and renders it in the UI; we translate here, so the UI has one renderer.
 * Mapping, by SDK message:
 *  - assistant: text blocks become text items, thinking blocks become thinking items (summarized
 *    true, because the runner asks for summarized thinking), tool_use blocks become tool_call items
 *    with the canonical tool from tool-names.ts and parentToolUseId from parent_tool_use_id;
 *    TodoWrite becomes a todo item instead of a tool_call, and its result is dropped
 *  - user with tool_result blocks: tool_result items, output cut by truncateOutput
 *  - result: a usage item (usage.ts); is_error results also produce an error item with the
 *    result text and retryable true for rate-limit and overload errors
 *  - system compact_boundary: notice "compacted"; system init: notice "session_started" once per
 *    process; rate_limit_event with status other than "allowed": notice "rate_limit"
 *  - dropped: stream deltas, thinking_tokens, task_progress, keep_alive, control messages, and
 *    transcript mirror frames (consumed by the SDK before they reach us)
 *  - `raw` keeps the original message so a later translator version can re-read old events
 * Must handle:
 *  - a tool_result for a dropped TodoWrite call (state in the translator, not a global)
 *  - sub-agent messages (parent_tool_use_id set) keep the link on both call and result
 *  - unknown message types and unknown content blocks: ignored with a debug log, never a throw
 *  - the same SDK message translated twice gives the same items (no hidden counters, except the
 *    cost baseline, which the caller owns)
 *  - a message with several blocks keeps them in display order in one AgentMessage
 * Test first: an assistant message with a text block and a Bash tool_use yields one AgentMessage
 * whose items are [text, tool_call(bash)] with the tool_use id as toolUseId.
 */
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMessage } from "@conducted/protocol";
import { notImplemented } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";

export interface ClaudeTranslatorState {
	/** Tool use ids whose call was replaced by a todo item. Their results are dropped. */
	droppedToolUses: Set<string>;
	/** Total cost reported by the last result message, for marginalCost. */
	lastReportedCostUsd: number;
	/** True after the first system init message of this process was translated. */
	sessionStartedReported: boolean;
}

export class ClaudeTranslator {
	readonly state: ClaudeTranslatorState = {
		droppedToolUses: new Set(),
		lastReportedCostUsd: 0,
		sessionStartedReported: false,
	};

	constructor(protected readonly deps: { logger: Logger }) {}

	/** Returns the messages to emit for one SDK message, in order. May be empty. */
	translate(_message: SDKMessage): AgentMessage[] {
		return notImplemented("AGENT-03");
	}
}

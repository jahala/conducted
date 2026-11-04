/**
 * @feature AGENT-07 Codex: translate items to the neutral format
 * Owns: mapping Codex's thread items and notifications to AgentMessage values.
 * Behaviour: research/conductor/other-runners.md section 3 "Codex dialect": Conductor keeps
 * Codex's own item format and the UI needs a second renderer. We translate instead. Items seen in
 * the generated bindings of codex-cli 0.154.0: agentMessage, reasoning, plan, commandExecution,
 * fileChange, mcpToolCall, dynamicToolCall, collabAgentToolCall, webSearch, contextCompaction,
 * imageView, imageGeneration, sleep, hookPrompt, userMessage, functionCallOutput,
 * subAgentActivity, enteredReviewMode, exitedReviewMode.
 * Mapping (item completed unless noted):
 *  - agentMessage: text item
 *  - reasoning: thinking item; the summary if present, else the content, summarized true when it
 *    is the summary
 *  - plan: text item
 *  - commandExecution: tool_call bash with { command, cwd } on start, tool_result with
 *    aggregatedOutput; a non-zero exit code sets isError
 *  - fileChange: tool_call edit with the list of changes, tool_result with the status
 *  - mcpToolCall: tool_call mcp, rawName mcp__<server>__<tool>; the app's own server maps to
 *    app_tool; the result text from the MCP result content, error from the error field
 *  - dynamicToolCall: tool_call mcp
 *  - collabAgentToolCall: tool_call sub_agent; items of child threads carry parentToolUseId
 *  - webSearch: tool_call web_search
 *  - contextCompaction and thread/compacted: notice compacted
 *  - thread/tokenUsage/updated: usage item (see codexUsageItem)
 *  - error notification: error item; willRetry true means retryable
 *  - ignored: userMessage, hookPrompt, functionCallOutput, sleep, review mode markers, deltas
 * Must handle: a tool call that starts and completes (one tool_call on start, one tool_result on
 * completion, same toolUseId = item id), items that arrive only as completed (both emitted
 * together), unknown item types (debug log, no throw), output cut with truncateOutput, and a
 * sub-agent whose child thread items arrive interleaved with the parent's.
 * Test first: a completed commandExecution item with exit code 1 yields a tool_call(bash) and a
 * tool_result with isError true, same toolUseId.
 */
import type { AgentMessage } from "@conducted/protocol";
import { notImplemented } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";

export class CodexTranslator {
	constructor(protected readonly deps: { logger: Logger }) {}

	/** Translates one item/started or item/completed notification. */
	translateItem(
		_phase: "started" | "completed",
		_item: unknown,
		_threadId: string,
	): AgentMessage[] {
		return notImplemented("AGENT-07");
	}

	/** Translates a non-item notification (usage, error, compaction). */
	translateNotification(_method: string, _params: unknown): AgentMessage[] {
		return notImplemented("AGENT-07");
	}
}

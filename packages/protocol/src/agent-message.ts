/**
 * Our neutral agent-message format. Every runner (Claude, Codex, Cursor, ACP) translates its
 * agent's output into these items, so the chat UI has a single renderer.
 *
 * Research: other-runners.md section 3 and 7.1. Conductor used Claude's SDK format as the
 * common dialect and needed a second renderer for Codex. Our design choice: a format we own.
 * `raw` keeps the agent's original payload for debugging and future re-translation.
 */
import { z } from "zod";
import { zAgentKind, zToolUseId } from "./ids.ts";
import { zCanonicalTool } from "./tools.ts";

export const zTextItem = z.object({ kind: z.literal("text"), text: z.string() });

export const zThinkingItem = z.object({
	kind: z.literal("thinking"),
	text: z.string(),
	/** True when the agent sent a summary instead of the full reasoning. */
	summarized: z.boolean(),
});

export const zToolCallItem = z.object({
	kind: z.literal("tool_call"),
	toolUseId: zToolUseId,
	tool: zCanonicalTool,
	/** The agent's own tool name, for example "Bash", "shell" or "mcp__linear__get_issue". */
	rawName: z.string(),
	input: z.unknown(),
	/** Set when a sub-agent made this call. The chat groups it under that parent call. */
	parentToolUseId: zToolUseId.optional(),
});

export const zToolResultItem = z.object({
	kind: z.literal("tool_result"),
	toolUseId: zToolUseId,
	/** Plain-text output. Large outputs are cut by the runner and `truncated` is set. */
	output: z.string(),
	isError: z.boolean(),
	truncated: z.boolean(),
	parentToolUseId: zToolUseId.optional(),
});

export const zTodoItem = z.object({
	kind: z.literal("todo"),
	items: z.array(
		z.object({
			label: z.string(),
			status: z.enum(["pending", "in_progress", "done"]),
		}),
	),
});

export const zUsageItem = z.object({
	kind: z.literal("usage"),
	inputTokens: z.number().int().nonnegative(),
	outputTokens: z.number().int().nonnegative(),
	cacheReadTokens: z.number().int().nonnegative(),
	cacheWriteTokens: z.number().int().nonnegative(),
	/** Cost of this turn in US dollars, when the agent reports it. */
	costUsd: z.number().nonnegative().optional(),
	contextUsedTokens: z.number().int().nonnegative().optional(),
	contextWindowTokens: z.number().int().positive().optional(),
});

export const zNoticeItem = z.object({
	kind: z.literal("notice"),
	/** compacted: the agent summarised its context. rate_limit: a provider limit was hit. */
	notice: z.enum(["session_started", "compacted", "rate_limit", "model_changed", "info"]),
	text: z.string(),
});

export const zErrorItem = z.object({
	kind: z.literal("error"),
	code: z.string(),
	message: z.string(),
	retryable: z.boolean(),
});

export const zAgentItem = z.discriminatedUnion("kind", [
	zTextItem,
	zThinkingItem,
	zToolCallItem,
	zToolResultItem,
	zTodoItem,
	zUsageItem,
	zNoticeItem,
	zErrorItem,
]);
export type AgentItem = z.infer<typeof zAgentItem>;

/** One message from an agent. A message holds one or more items in display order. */
export const zAgentMessage = z.object({
	agent: zAgentKind,
	/** The agent's own id for this message, when it has one. */
	nativeId: z.string().optional(),
	items: z.array(zAgentItem),
	raw: z.unknown().optional(),
});
export type AgentMessage = z.infer<typeof zAgentMessage>;

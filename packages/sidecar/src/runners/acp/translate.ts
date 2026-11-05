/**
 * @feature AGENT-12 ACP adapters for OpenCode and Pi: translate ACP updates
 * Owns: turning `session/update` notifications into AgentMessage values.
 * Behaviour: research/conductor/other-runners.md section 3: streaming text and thought chunks are
 * buffered and flushed as one message at tool boundaries or the end of the turn; a plan becomes a
 * todo list; diff content is summarised as "Wrote/Edited <path>"; usage updates feed the context
 * wheel; questions (permission requests with several allow options) become question interactions
 * elsewhere, not messages. ACP update kinds are from @agentclientprotocol/sdk SessionUpdate.
 * Mapping:
 *  - agent_message_chunk: text, buffered; agent_thought_chunk: thinking, buffered
 *  - tool_call: tool_call with canonicalToolForAcp, rawName from `name` or `title`, rawInput as
 *    input; tool_call_update with a terminal status (completed, failed): tool_result with the
 *    text content, isError for failed, output cut with truncateOutput
 *  - plan: todo item (pending, in_progress, completed map to pending, in_progress, done)
 *  - usage_update: usage item with contextUsedTokens = used and contextWindowTokens = size
 *  - notice: notice "info" (severity error: error item); a completed compaction_update: notice
 *    "compacted"
 *  - ignored: user_message_chunk (our own message echoed back), available_commands_update,
 *    current_mode_update, config_option_update, session_info_update (handled by the session),
 *    compaction_summary_chunk (the completed compaction already produces the notice)
 * Must handle: a tool_call_update that arrives before its tool_call (kept until the call is seen,
 * dropped at the end of the turn with a debug log), several terminal updates for one call (only the
 * first result is emitted), the buffer flushed before every tool call, plan, usage update, notice
 * and completed compaction so order is kept, content blocks that are not text (image and audio are
 * shown as a placeholder such as "[image]"), and a turn that ends while text is buffered (flush()
 * emits it). flush() belongs at the end of a turn; a tool call flushes the buffer itself.
 * Test first: two agent_message_chunk updates then a tool_call yield text("ab") then tool_call in
 * order.
 * Our design choice: a thinking chunk that follows text is kept in the same buffered message, so
 * the two keep their order. Flush at the end of a turn also clears the per-turn tool state, so the
 * translator can serve the next turn without growing.
 */
import type {
	ContentBlock,
	SessionUpdate,
	ToolCall,
	ToolCallContent,
	ToolCallStatus,
	ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import type { AgentItem, AgentMessage, CanonicalTool } from "@conducted/protocol";
import type { ToolUseId } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import { truncateOutput } from "../output.ts";
import { canonicalToolForAcp } from "./tool-kinds.ts";

interface BufferedChunk {
	kind: "text" | "thinking";
	text: string;
	sources: SessionUpdate[];
}

type ToolEnd = {
	toolCallId: string;
	status?: ToolCallStatus | null | undefined;
	content?: ToolCallContent[] | null | undefined;
	rawOutput?: unknown;
};

export class AcpTranslator {
	private buffer: BufferedChunk[] = [];
	/** Tool calls whose first update was seen. */
	private readonly seenCalls = new Set<string>();
	/** Terminal updates that arrived before their tool call. */
	private readonly pendingResults = new Map<string, ToolCallUpdate>();
	/** Calls whose result was already emitted this turn. */
	private readonly emittedResults = new Set<string>();

	constructor(
		protected readonly deps: {
			/** The adapter's name hints (adapters/adapter.ts). */
			toolNameHints: Readonly<Record<string, CanonicalTool>>;
			logger: Logger;
		},
	) {}

	push(update: SessionUpdate): AgentMessage[] {
		switch (update.sessionUpdate) {
			case "agent_message_chunk":
				return this.chunk("text", update.content, update);
			case "agent_thought_chunk":
				return this.chunk("thinking", update.content, update);
			case "tool_call":
				return this.toolCall(update);
			case "tool_call_update":
				return this.toolCallUpdate(update);
			case "plan":
				return this.plan(update);
			case "usage_update":
				return this.usage(update);
			case "notice":
				return this.notice(update);
			case "compaction_update":
				return this.compaction(update);
			case "user_message_chunk":
			case "available_commands_update":
			case "current_mode_update":
			case "config_option_update":
			case "session_info_update":
			case "compaction_summary_chunk":
				return [];
			default:
				this.deps.logger.debug("Ignoring an ACP update we do not translate", {
					sessionUpdate: (update as { sessionUpdate?: unknown }).sessionUpdate,
				});
				return [];
		}
	}

	/** Emits whatever is still buffered, drops unseen tool results, and ends the turn's state. */
	flush(): AgentMessage[] {
		const messages = this.drain();
		for (const toolCallId of this.pendingResults.keys()) {
			this.deps.logger.debug("Dropped an ACP tool result whose call never arrived", {
				toolCallId,
			});
		}
		this.pendingResults.clear();
		this.seenCalls.clear();
		this.emittedResults.clear();
		return messages;
	}

	private chunk(
		kind: BufferedChunk["kind"],
		content: ContentBlock,
		source: SessionUpdate,
	): AgentMessage[] {
		const text = blockText(content);
		if (text === "") return [];
		const last = this.buffer.at(-1);
		if (last !== undefined && last.kind === kind) {
			last.text += text;
			last.sources.push(source);
		} else {
			this.buffer.push({ kind, text, sources: [source] });
		}
		return [];
	}

	private toolCall(update: ToolCall): AgentMessage[] {
		const messages = this.drain();
		const id = update.toolCallId;
		this.seenCalls.add(id);
		messages.push(
			this.message(
				[
					{
						kind: "tool_call",
						toolUseId: id as ToolUseId,
						tool: canonicalToolForAcp(
							{ kind: update.kind, name: update.name },
							this.deps.toolNameHints,
						),
						rawName: update.name ?? update.title,
						input: update.rawInput,
					},
				],
				update,
			),
		);

		const pending = this.pendingResults.get(id);
		if (pending !== undefined) {
			this.pendingResults.delete(id);
			this.emitResult(messages, id, pending);
		} else if (isTerminal(update.status)) {
			this.emitResult(messages, id, update);
		}
		return messages;
	}

	private toolCallUpdate(update: ToolCallUpdate): AgentMessage[] {
		if (!isTerminal(update.status)) return [];
		const id = update.toolCallId;
		if (!this.seenCalls.has(id)) {
			this.pendingResults.set(id, update);
			return [];
		}
		if (this.emittedResults.has(id)) {
			this.deps.logger.debug("Ignored another final update for an ACP tool call", {
				toolCallId: id,
			});
			return [];
		}
		const messages: AgentMessage[] = [];
		this.emitResult(messages, id, update);
		return messages;
	}

	private emitResult(messages: AgentMessage[], id: string, update: ToolEnd): void {
		if (this.emittedResults.has(id)) return;
		this.emittedResults.add(id);
		const output = toolContentText(update);
		const cut = truncateOutput(output);
		const item: AgentItem = {
			kind: "tool_result",
			toolUseId: id as ToolUseId,
			output: cut.output,
			isError: update.status === "failed",
			truncated: cut.truncated,
		};
		if (cut.truncated) item.originalLength = cut.originalLength ?? output.length;
		messages.push(this.message([item], update));
	}

	private plan(update: Extract<SessionUpdate, { sessionUpdate: "plan" }>): AgentMessage[] {
		const messages = this.drain();
		if (update.entries.length === 0) return messages;
		messages.push(
			this.message(
				[
					{
						kind: "todo",
						items: update.entries.map((entry) => ({
							label: entry.content,
							status:
								entry.status === "completed"
									? "done"
									: entry.status === "in_progress"
										? "in_progress"
										: "pending",
						})),
					},
				],
				update,
			),
		);
		return messages;
	}

	private usage(update: Extract<SessionUpdate, { sessionUpdate: "usage_update" }>): AgentMessage[] {
		const messages = this.drain();
		const usage = usageFromUpdate(update);
		const item: AgentItem = {
			kind: "usage",
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			contextUsedTokens: usage.usedTokens,
		};
		if (usage.windowTokens !== undefined) item.contextWindowTokens = usage.windowTokens;
		messages.push(this.message([item], update));
		return messages;
	}

	private notice(update: Extract<SessionUpdate, { sessionUpdate: "notice" }>): AgentMessage[] {
		const messages = this.drain();
		const text =
			update.description === undefined || update.description === null
				? update.title
				: `${update.title}: ${update.description}`;
		const item: AgentItem =
			update.severity === "error"
				? { kind: "error", code: "agent_notice", message: text, retryable: false }
				: { kind: "notice", notice: "info", text };
		messages.push(this.message([item], update));
		return messages;
	}

	private compaction(
		update: Extract<SessionUpdate, { sessionUpdate: "compaction_update" }>,
	): AgentMessage[] {
		if (update.status !== "completed") return [];
		const messages = this.drain();
		messages.push(
			this.message(
				[{ kind: "notice", notice: "compacted", text: "Chat history compacted" }],
				update,
			),
		);
		return messages;
	}

	private drain(): AgentMessage[] {
		if (this.buffer.length === 0) return [];
		const entries = this.buffer;
		this.buffer = [];
		const items: AgentItem[] = entries.map((entry) =>
			entry.kind === "text"
				? { kind: "text", text: entry.text }
				: { kind: "thinking", text: entry.text, summarized: false },
		);
		const raw = entries.flatMap((entry) => entry.sources);
		return [{ agent: "acp", items, raw }];
	}

	private message(items: AgentItem[], raw: unknown): AgentMessage {
		return { agent: "acp", items, raw };
	}
}

function isTerminal(status: ToolCallStatus | null | undefined): status is "completed" | "failed" {
	return status === "completed" || status === "failed";
}

function blockText(block: ContentBlock): string {
	if (block.type === "text") return block.text;
	return `[${block.type}]`;
}

/** The only mapping from an ACP usage update to token counts; the session reuses it. */
export function usageFromUpdate(
	update: Extract<SessionUpdate, { sessionUpdate: "usage_update" }>,
): { usedTokens: number; windowTokens: number | undefined } {
	return {
		usedTokens: Math.max(0, update.used),
		windowTokens: update.size > 0 ? update.size : undefined,
	};
}

function diffText(block: Extract<ToolCallContent, { type: "diff" }>): string {
	return block.oldText === undefined || block.oldText === null
		? `Wrote ${block.path}`
		: `Edited ${block.path}`;
}

function toolContentText(update: ToolEnd): string {
	const parts: string[] = [];
	for (const block of update.content ?? []) {
		if (block.type === "content") parts.push(blockText(block.content));
		else if (block.type === "diff") parts.push(diffText(block));
		else parts.push(`[terminal ${block.terminalId}]`);
	}
	const text = parts.filter((part) => part !== "").join("\n");
	if (text !== "") return text;
	if (update.rawOutput === undefined || update.rawOutput === null) return "";
	if (typeof update.rawOutput === "string") return update.rawOutput;
	return JSON.stringify(update.rawOutput) ?? String(update.rawOutput);
}

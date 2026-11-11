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
 *  - an assistant message with an error is translated like any other: its text stays text, as
 *    Conductor renders it (renderApp kpa @9558460)
 *  - user with tool_result blocks: tool_result items, output cut by truncateOutput
 *  - result: a usage item (usage.ts); an is_error result also produces the turn's one error item,
 *    by Conductor's rules for a failed result (`resultErrorItem`, renderApp Rpa @9564247). An API
 *    error arrives twice, as an assistant message with `error` and as a result with `is_error` and
 *    the same text (the SDK's types): the first is the text, the second the error view
 *  - system compact_boundary and a successful compact: notice "compacted"; system status
 *    "compacting": notice "info" with "Compacting..."; system init: notice "session_started"
 *    once per process; rate_limit_event with status other than "allowed": notice "rate_limit"
 *  - autocompact_state, post_turn_summary, session_metadata and active_goal are passed on as a
 *    message whose raw payload carries them, with no items of their own
 *  - dropped: stream deltas, thinking_tokens, task progress and task bookkeeping, keep_alive,
 *    control messages, and transcript mirror frames (consumed by the SDK before they reach us)
 *  - `raw` keeps the original message so a later translator version can re-read old events
 * Must handle:
 *  - a tool_result for a dropped TodoWrite call (state in the translator, not a global)
 *  - sub-agent messages (parent_tool_use_id set) carry the link on the message, and on their
 *    call and result
 *  - unknown message types and unknown content blocks: ignored with a debug log, never a throw
 *  - translating the same message twice can differ: the translator keeps per-chat state, and a
 *    second init means the process respawned, which resets that state
 *  - a message with several blocks keeps them in display order in one AgentMessage
 * Test first: an assistant message with a text block and a Bash tool_use yields one AgentMessage
 * whose items are [text, tool_call(bash)] with the tool_use id as toolUseId.
 * Our design choice: one translator belongs to one chat; ClaudeRunner gives each ClaudeSession its
 * own. Its state is the ids of dropped TodoWrite results, the last reported cost and whether this
 * process's start notice was emitted. A second init resets the cost baseline and the dropped ids,
 * then emits the start notice again. A result's speed stays in its raw payload because the neutral
 * usage item has no speed field. Whether a result is foreign (its user message was not ours) is
 * decided in turn-tracker.ts; a foreign result still yields a usage item here. `raw` keeps the
 * whole SDK message, including uncut tool output, until the lifetime job removes it. The
 * session_state_changed message only disarms the watchdog here; its in-progress report belongs to
 * AGENT-15 (self-started-turns.ts).
 */
import type {
	SDKAssistantMessage,
	SDKMessage,
	SDKResultMessage,
	SDKUserMessage,
	SDKUserMessageReplay,
} from "@anthropic-ai/claude-agent-sdk";
import {
	AGENT_ERROR_CODES,
	type AgentItem,
	type AgentMessage,
	isClaudeSignInErrorText,
} from "@conducted/protocol";
import type { ToolUseId } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import { contentToText, truncateOutput } from "../output.ts";
import { todoItemFromTodoWrite } from "./todo.ts";
import { canonicalToolFor } from "./tool-names.ts";
import { type ClaudeResultUsage, usageItemFromResult } from "./usage.ts";

export interface ClaudeTranslatorState {
	/** Tool use ids whose call was replaced by a todo item. Their results are dropped. */
	droppedToolUses: Set<string>;
	/** Total cost reported by the last result message, for marginalCost. */
	lastReportedCostUsd: number;
	/** True after the first system init message of this process was translated. */
	sessionStartedReported: boolean;
}

type SystemMessage = Extract<SDKMessage, { type: "system" }>;
type UserMessage = SDKUserMessage | SDKUserMessageReplay;

/** Frames with no item of their own, kept whole in `raw` for a later translator. */
const RAW_PASSTHROUGH_FRAMES = new Set([
	"active_goal",
	"post_turn_summary",
	"session_metadata",
	"autocompact_state",
]);

const DROPPED_TYPES = new Set([
	"stream_event",
	"keep_alive",
	"transcript_mirror",
	"control_request",
	"control_response",
	"control_cancel_request",
]);

export class ClaudeTranslator {
	readonly state: ClaudeTranslatorState = {
		droppedToolUses: new Set(),
		lastReportedCostUsd: 0,
		sessionStartedReported: false,
	};

	constructor(protected readonly deps: { logger: Logger }) {}

	/**
	 * A translator for one chat, with its own state and the same logger. Each ClaudeSession calls
	 * this, so two chats never share the cost baseline or the dropped TodoWrite ids.
	 */
	fresh(): ClaudeTranslator {
		return new ClaudeTranslator(this.deps);
	}

	/** Returns the messages to emit for one SDK message, in order. May be empty. */
	translate(message: SDKMessage): AgentMessage[] {
		switch (message.type) {
			case "assistant":
				return this.assistant(message);
			case "user":
				return this.user(message);
			case "result":
				return this.result(message);
			case "system":
				return this.system(message);
			case "rate_limit_event":
				return this.rateLimit(message);
			default:
				return this.other(message);
		}
	}

	private assistant(message: SDKAssistantMessage): AgentMessage[] {
		// An assistant message with `error` (an API error, a limit, a sign-in failure) is shown like
		// any other: its blocks as blocks. Conductor does the same (kpa @9558460); the turn's result
		// carries the error view.
		const parentToolUseId = message.parent_tool_use_id ?? undefined;
		const items: AgentItem[] = [];
		for (const block of message.message.content) {
			switch (block.type) {
				case "text":
					if (block.text !== "") items.push({ kind: "text", text: block.text });
					break;
				case "thinking":
					items.push({ kind: "thinking", text: block.thinking, summarized: true });
					break;
				case "tool_use": {
					const todo = block.name === "TodoWrite" ? todoItemFromTodoWrite(block.input) : null;
					if (todo !== null) {
						this.state.droppedToolUses.add(block.id);
						items.push(todo);
						break;
					}
					items.push({
						kind: "tool_call",
						toolUseId: block.id as ToolUseId,
						tool: canonicalToolFor(block.name),
						rawName: block.name,
						input: block.input,
						...(parentToolUseId === undefined
							? {}
							: { parentToolUseId: parentToolUseId as ToolUseId }),
					});
					break;
				}
				default:
					this.deps.logger.debug("Ignoring a Claude content block we do not translate", {
						type: block.type,
					});
			}
		}
		return items.length === 0 ? [] : [this.agentMessage(message, items)];
	}

	private user(message: UserMessage): AgentMessage[] {
		const parentToolUseId = message.parent_tool_use_id ?? undefined;
		const content = message.message.content;
		if (!Array.isArray(content)) return [];
		const items: AgentItem[] = [];
		for (const block of content) {
			if (block.type !== "tool_result") continue;
			// A TodoWrite result has no card of its own; the todo item already shows the list.
			if (this.state.droppedToolUses.delete(block.tool_use_id)) continue;
			const raw = contentToText(block.content);
			const cut = truncateOutput(raw);
			const item: Extract<AgentItem, { kind: "tool_result" }> = {
				kind: "tool_result",
				toolUseId: block.tool_use_id as ToolUseId,
				output: cut.output,
				isError: block.is_error === true,
				truncated: cut.truncated,
			};
			if (cut.truncated) item.originalLength = cut.originalLength ?? raw.length;
			if (parentToolUseId !== undefined) {
				item.parentToolUseId = parentToolUseId as ToolUseId;
			}
			items.push(item);
		}
		return items.length === 0 ? [] : [this.agentMessage(message, items)];
	}

	private result(message: SDKResultMessage): AgentMessage[] {
		const usageSource = message as unknown as ClaudeResultUsage;
		const items: AgentItem[] = [usageItemFromResult(usageSource, this.state.lastReportedCostUsd)];
		if (typeof message.total_cost_usd === "number") {
			this.state.lastReportedCostUsd = message.total_cost_usd;
		}
		const error = resultErrorItem(message);
		if (error !== null) items.push(error);
		return [this.agentMessage(message, items)];
	}

	private system(message: SystemMessage): AgentMessage[] {
		const subtype = (message as { subtype?: unknown }).subtype;
		if (typeof subtype === "string" && RAW_PASSTHROUGH_FRAMES.has(subtype)) {
			return [this.agentMessage(message, [])];
		}
		switch (message.subtype) {
			case "init":
				// The SDK sends init once per process, so a second one means the process respawned.
				if (this.state.sessionStartedReported) this.resetProcessState();
				this.state.sessionStartedReported = true;
				return [this.notice(message, "session_started", "Session started")];
			case "compact_boundary":
				return [this.notice(message, "compacted", "Chat history compacted")];
			case "status":
				if (message.compact_result === "success") {
					return [this.notice(message, "compacted", "Chat history compacted")];
				}
				if (message.compact_result === "failed") {
					return [this.notice(message, "info", "Compacting failed")];
				}
				if (message.status === "compacting") {
					return [this.notice(message, "info", "Compacting...")];
				}
				return [];
			case "informational":
				return [this.notice(message, "info", message.content)];
			case "local_command_output":
				return message.content === ""
					? []
					: [this.agentMessage(message, [{ kind: "text", text: message.content }])];
			case "api_retry":
				return [
					this.notice(
						message,
						"info",
						`Retrying the request (attempt ${message.attempt} of ${message.max_retries})`,
					),
				];
			case "session_state_changed":
			case "thinking_tokens":
			case "task_progress":
			case "task_started":
			case "task_notification":
			case "task_updated":
			case "background_tasks_changed":
				return [];
			default:
				this.deps.logger.debug("Ignoring a Claude system message we do not translate", {
					subtype: message.subtype,
				});
				return [];
		}
	}

	private rateLimit(message: Extract<SDKMessage, { type: "rate_limit_event" }>): AgentMessage[] {
		const info = message.rate_limit_info;
		if (info.status === "allowed") return [];
		return [this.notice(message, "rate_limit", rateLimitText(info))];
	}

	private other(message: SDKMessage): AgentMessage[] {
		const type = (message as { type?: unknown }).type;
		if (typeof type === "string" && RAW_PASSTHROUGH_FRAMES.has(type)) {
			return [this.agentMessage(message, [])];
		}
		if (typeof type === "string" && DROPPED_TYPES.has(type)) return [];
		this.deps.logger.debug("Ignoring a Claude message we do not translate", {
			type: typeof type === "string" ? type : undefined,
		});
		return [];
	}

	/** A new process reports its cost from zero and starts a new TodoWrite lifetime. */
	private resetProcessState(): void {
		this.state.droppedToolUses.clear();
		this.state.lastReportedCostUsd = 0;
	}

	private notice(
		source: SDKMessage,
		notice: Extract<AgentItem, { kind: "notice" }>["notice"],
		text: string,
	): AgentMessage {
		return this.agentMessage(source, [{ kind: "notice", notice, text }]);
	}

	private agentMessage(source: unknown, items: AgentItem[]): AgentMessage {
		const uuid = (source as { uuid?: unknown }).uuid;
		const nativeId = typeof uuid === "string" && uuid !== "" ? uuid : undefined;
		const parent = (source as { parent_tool_use_id?: unknown }).parent_tool_use_id;
		const parentToolUseId =
			typeof parent === "string" && parent !== "" ? (parent as ToolUseId) : undefined;
		return {
			agent: "claude",
			...(nativeId === undefined ? {} : { nativeId }),
			...(parentToolUseId === undefined ? {} : { parentToolUseId }),
			items,
			raw: source,
		};
	}
}

type ErrorItem = Extract<AgentItem, { kind: "error" }>;

/** Conductor's prefix for an error line that only carries diagnostics (renderApp Npa @9566059). */
const DIAGNOSTIC_PREFIX = "[ede_diagnostic]";

/**
 * The error item a failed result shows, or null when it shows none. The turn tracker uses it too,
 * so the turn's error and the item carry the same words and the chat shows the error once.
 * Conductor's rules (renderApp Rpa @9564247):
 *  - the text is the first error line that is not a diagnostic, else the result text, reworded
 *    by TQi @9537800 ("Session cancelled:" reads "Session interrupted:")
 *  - a success result whose text is a sign-in error (SQi @9517413) shows the sign-in view
 *  - a result whose error lines are all diagnostics shows nothing
 *  - every other failed result reads "Claude Code error: <text>", or "Claude Code error" without
 *    text, with Retry (GFe @9534766 offers it by default)
 */
export function resultErrorItem(message: SDKResultMessage): ErrorItem | null {
	if (!message.is_error) return null;
	const errors = (message as { errors?: unknown }).errors;
	const lines = Array.isArray(errors)
		? errors.filter((line): line is string => typeof line === "string")
		: [];
	const shown = lines.filter((line) => !line.startsWith(DIAGNOSTIC_PREFIX));
	const resultText = (message as { result?: unknown }).result;
	const result = typeof resultText === "string" ? resultText : undefined;
	const text = interruptedWording(shown[0] ?? result);

	if (message.subtype === "success" && isClaudeSignInErrorText(result)) {
		return {
			kind: "error",
			code: AGENT_ERROR_CODES.authRequired,
			message: text ?? "",
			retryable: false,
		};
	}
	if (lines.length > 0 && shown.length === 0) return null;
	return {
		kind: "error",
		code: "agent_error",
		message: text ? `Claude Code error: ${text}` : "Claude Code error",
		retryable: true,
	};
}

/** Conductor words a cancelled session as interrupted (renderApp TQi @9537800). */
function interruptedWording(text: string | undefined): string | undefined {
	return text?.replace(/^Session cancelled:/, "Session interrupted:");
}

function rateLimitText(
	info: Extract<SDKMessage, { type: "rate_limit_event" }>["rate_limit_info"],
): string {
	const window = rateLimitWindow(info.rateLimitType);
	const reached = info.status === "rejected" ? "reached" : "almost reached";
	const used =
		typeof info.utilization === "number" ? ` (${Math.round(info.utilization * 100)}% used)` : "";
	const resets =
		typeof info.resetsAt === "number"
			? ` It resets at ${new Date(info.resetsAt * 1000).toISOString()}.`
			: "";
	return `${window} rate limit ${reached}${used}.${resets}`;
}

function rateLimitWindow(type: string | undefined): string {
	switch (type) {
		case "five_hour":
			return "Five-hour";
		case "seven_day":
			return "Seven-day";
		case "seven_day_opus":
			return "Seven-day Opus";
		case "seven_day_sonnet":
			return "Seven-day Sonnet";
		case "overage":
			return "Overage";
		default:
			return "Claude";
	}
}

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
 *  - an assistant message with an error: authentication_failed becomes an agent_auth_required
 *    error so the chat can offer sign-in; other errors become error items, retryable for rate
 *    limits and overload
 *  - user with tool_result blocks: tool_result items, output cut by truncateOutput
 *  - result: a usage item (usage.ts); is_error results also produce an error item with the
 *    result text and retryable true for rate-limit and overload errors, unless the turn's own
 *    assistant message already reported the error. An API error arrives twice, as an assistant
 *    message with `error` and as a result with `is_error` and the same text (the SDK's types); the
 *    assistant's item is kept, because its error code tells a sign-in error from the rest
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
 *  - sub-agent messages (parent_tool_use_id set) keep the link on call and result
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
 * AGENT-15 (self-started-turns.ts). The session-limit and rate-limit error codes let the chat word
 * their banners.
 */
import type {
	SDKAssistantMessage,
	SDKMessage,
	SDKResultMessage,
	SDKUserMessage,
	SDKUserMessageReplay,
} from "@anthropic-ai/claude-agent-sdk";
import { AGENT_ERROR_CODES, type AgentItem, type AgentMessage } from "@conducted/protocol";
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
	/** True when an assistant message of the main agent reported an error since the last result. */
	turnErrorShown: boolean;
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
		turnErrorShown: false,
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
		const parentToolUseId = message.parent_tool_use_id ?? undefined;
		if (message.error !== undefined) {
			// A sub-agent's error is not the main turn's, so only the main agent's hides the result's.
			if (parentToolUseId === undefined) this.state.turnErrorShown = true;
			const text = contentToText(message.message.content).trim();
			return [this.agentMessage(message, [this.assistantError(message.error, text)])];
		}

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
		const errorShown = this.state.turnErrorShown;
		this.state.turnErrorShown = false;
		if (message.is_error && !errorShown) {
			const error = resultError(message);
			items.push({
				kind: "error",
				code: errorCodeFromText(error.message, "agent_error"),
				message: error.message,
				retryable: error.retryable,
			});
		}
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
		this.state.turnErrorShown = false;
	}

	private assistantError(error: string, text: string): Extract<AgentItem, { kind: "error" }> {
		if (error === "authentication_failed") {
			return {
				kind: "error",
				code: AGENT_ERROR_CODES.authRequired,
				message: text === "" ? "Authentication required. Sign in to Claude." : text,
				retryable: false,
			};
		}
		const message = text === "" ? assistantErrorText(error) : text;
		const retryable =
			!/session limit/i.test(message) &&
			(error === "rate_limit" || error === "overloaded" || error === "server_error");
		const fallback =
			error === "rate_limit"
				? "agent_rate_limit"
				: error === "overloaded"
					? "agent_overloaded"
					: `agent_${error}`;
		return {
			kind: "error",
			code: errorCodeFromText(message, fallback),
			message,
			retryable,
		};
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
		return nativeId === undefined
			? { agent: "claude", items, raw: source }
			: { agent: "claude", nativeId, items, raw: source };
	}
}

function assistantErrorText(error: string): string {
	switch (error) {
		case "rate_limit":
			return "Rate limit reached.";
		case "overloaded":
			return "The service is overloaded. Try again shortly.";
		case "billing_error":
			return "The account could not be billed for this request.";
		case "model_not_found":
			return "The chosen model is not available.";
		case "max_output_tokens":
			return "The answer reached the model's output limit.";
		default:
			return `Claude reported an error: ${error}.`;
	}
}

/** The text of an is_error result and whether trying again may help. The turn tracker uses it too. */
export function resultError(message: SDKResultMessage): { message: string; retryable: boolean } {
	const text = resultErrorText(message);
	return { message: text, retryable: resultErrorRetryable(message, text) };
}

function resultErrorText(message: SDKResultMessage): string {
	const successText = (message as { result?: unknown }).result;
	if (typeof successText === "string" && successText.trim() !== "") return successText;
	const errors = (message as { errors?: unknown }).errors;
	if (Array.isArray(errors)) {
		const lines = errors.filter(
			(line): line is string => typeof line === "string" && line.trim() !== "",
		);
		if (lines.length > 0) return lines.join("\n");
	}
	if (message.subtype === "error_max_turns") {
		return "The agent reached its maximum number of turns.";
	}
	return "The agent reported an error.";
}

function resultErrorRetryable(message: SDKResultMessage, text: string): boolean {
	const status = (message as { api_error_status?: unknown }).api_error_status;
	if (typeof status === "number" && (status === 429 || status >= 500)) return true;
	if (/session limit/i.test(text)) return false;
	return /rate limit|too many requests|overloaded|over capacity|temporarily unavailable/i.test(
		text,
	);
}

function errorCodeFromText(text: string, fallback: string): string {
	if (/session limit/i.test(text)) return "agent_session_limit";
	if (/rate limit|too many requests/i.test(text)) return "agent_rate_limit";
	if (/overload|over capacity/i.test(text)) return "agent_overloaded";
	return fallback;
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

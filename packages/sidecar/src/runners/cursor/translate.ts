/**
 * @feature AGENT-10 Cursor: translate to the neutral format
 * Owns: turning the messages of a Cursor run into AgentMessage values.
 * Behaviour: research/conductor/other-runners.md section 3: Cursor output is text, thinking, tool
 * calls and tool results plus an error message type; Conductor buffers text and thinking chunks
 * (`pendingText`, `pendingThinking`) and flushes them as one message at tool boundaries or at the
 * end of the turn; tool names are renamed (see tool-names.ts); a plan is shown as the exit-plan
 * tool. The message fields are the SDK's (cursor-sdk.ts, checked against @cursor/sdk 1.0.11):
 *  - assistant: a text-delta chunk is an assistant message with one text block; a tool_use block
 *    carries the id, name and input of a call
 *  - thinking: a thinking chunk (`text`), including the empty text of a thinking-completed message
 *  - tool_call: `call_id`, `name`, `status` running/completed/error, optional `args` and `result`
 *  - error: the research's error message type, with `content`
 * Mapping:
 *  - text chunks join into one text item; a different chunk kind flushes the previous one first
 *  - tool_use and a running tool_call become a tool_call item with the canonical tool from
 *    tool-names.ts and the agent's input kept as is
 *  - a completed or failed tool_call becomes a tool_result item; its result text is cut with
 *    truncateOutput, and a failed call sets isError
 *  - a separate tool_result message carries `call_id` and its text in `content`, `output` or
 *    `result`
 *  - error becomes an error item with code "cursor_error" (or the agent's code) and retryable
 *    false
 *  - system, user, status, task and request messages carry no item of their own
 * Must handle:
 *  - flush() at the end of the turn and before a tool call
 *  - a tool call that arrives already completed: emit its call first, then its result
 *  - a result that arrives twice for one call: emit only the first
 *  - an unknown message type or content block: debug log, no throw
 *  - a tool call with no id: debug log and drop it
 *  - an empty error message: debug log and no item
 * Test first: two text chunks followed by a shell tool call yield [text("ab")] then
 * [tool_call(bash)] in order.
 * Our design choice: the SDK's result value is read as text (a string, content blocks, a shell
 * result's stdout and stderr, or JSON) so the chat card always has plain text. A buffer that
 * switches between text and thinking is emitted as one message holding both items, which keeps
 * their order. flush() also clears the per-turn call state, so one translator can serve the next
 * turn of the same chat.
 */
import type { AgentItem, AgentMessage } from "@conducted/protocol";
import type { ToolUseId } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import { contentToText, truncateOutput } from "../output.ts";
import type { CursorSdkMessage } from "./cursor-sdk.ts";
import { canonicalToolForCursor } from "./tool-names.ts";

interface BufferedChunk {
	kind: "text" | "thinking";
	text: string;
	sources: CursorSdkMessage[];
}

const IGNORED_TYPES = new Set(["system", "user", "status", "task", "request"]);

export class CursorTranslator {
	private buffer: BufferedChunk[] = [];
	/** Tool calls whose call item was already emitted this turn. */
	private readonly seenCalls = new Set<string>();
	/** Calls whose result was already emitted this turn. */
	private readonly emittedResults = new Set<string>();

	constructor(protected readonly deps: { logger: Logger }) {}

	/** Returns the messages ready to emit after this SDK message. May be empty while buffering. */
	push(message: CursorSdkMessage): AgentMessage[] {
		switch (message.type) {
			case "assistant":
				return this.assistant(message);
			case "thinking":
				return this.chunk("thinking", readString(message, "text") ?? "", message);
			case "tool_call":
				return this.toolCall(message);
			case "tool_result":
				return this.toolResult(message);
			case "error":
				return this.error(message);
			default:
				if (IGNORED_TYPES.has(message.type)) return [];
				this.deps.logger.debug("Ignoring a Cursor message we do not translate", {
					type: message.type,
				});
				return [];
		}
	}

	/** Emits whatever is still buffered. Call at the end of the turn. */
	flush(): AgentMessage[] {
		const messages = this.drain();
		this.seenCalls.clear();
		this.emittedResults.clear();
		return messages;
	}

	private assistant(message: CursorSdkMessage): AgentMessage[] {
		const messages: AgentMessage[] = [];
		for (const block of contentBlocks(message)) {
			const record = asRecord(block);
			if (record === null) {
				this.deps.logger.debug("Ignoring a Cursor content block that is not an object");
				continue;
			}
			const type = readString(record, "type");
			if (type === "text") {
				messages.push(...this.chunk("text", readString(record, "text") ?? "", message));
				continue;
			}
			if (type === "tool_use") {
				const id = readString(record, "id");
				const name = readString(record, "name") ?? "";
				if (id === null) {
					this.deps.logger.debug("Dropped a Cursor tool call that has no id", { name });
					continue;
				}
				messages.push(...this.drain());
				messages.push(...this.call(id, name, record.input, message));
				continue;
			}
			this.deps.logger.debug("Ignoring a Cursor content block we do not translate", { type });
		}
		return messages;
	}

	private chunk(
		kind: BufferedChunk["kind"],
		text: string,
		source: CursorSdkMessage,
	): AgentMessage[] {
		if (text === "") return [];
		const last = this.buffer.at(-1);
		if (last !== undefined && last.kind === kind) {
			last.text += text;
			last.sources.push(source);
			return [];
		}
		const messages = this.drain();
		this.buffer.push({ kind, text, sources: [source] });
		return messages;
	}

	private toolCall(message: CursorSdkMessage): AgentMessage[] {
		const id = readString(message, "call_id") ?? readString(message, "tool_use_id");
		const name = readString(message, "name") ?? "";
		const status = readString(message, "status");
		if (id === null) {
			this.deps.logger.debug("Dropped a Cursor tool call that has no id", { name, status });
			return [];
		}
		const newCall = !this.seenCalls.has(id);
		const newResult = status !== null && isTerminal(status) && !this.emittedResults.has(id);
		if (!newCall && !newResult) {
			this.deps.logger.debug("Ignored another Cursor tool call update", { id, status });
			return [];
		}

		const messages = this.drain();
		if (newCall) messages.push(...this.call(id, name, message.args, message));
		if (newResult) {
			messages.push(...this.result(id, message.result, status === "error", message));
		}
		return messages;
	}

	private toolResult(message: CursorSdkMessage): AgentMessage[] {
		const id = readString(message, "call_id") ?? readString(message, "tool_use_id");
		if (id === null) {
			this.deps.logger.debug("Dropped a Cursor tool result that has no call id");
			return [];
		}
		if (this.emittedResults.has(id)) {
			this.deps.logger.debug("Ignored another Cursor tool result", { id });
			return [];
		}
		const output = message.content ?? message.output ?? message.result;
		const isError = message.is_error === true || message.isError === true;
		const messages = this.drain();
		messages.push(...this.result(id, output, isError, message));
		return messages;
	}

	private error(message: CursorSdkMessage): AgentMessage[] {
		const text =
			readText(message.content) ??
			readString(message, "message") ??
			readString(message, "error") ??
			"";
		if (text === "") {
			this.deps.logger.debug("Dropped a Cursor error message that had no text");
			return [];
		}
		const messages = this.drain();
		messages.push(
			this.message(
				[
					{
						kind: "error",
						code: readString(message, "code") ?? "cursor_error",
						message: text,
						retryable: false,
					},
				],
				message,
			),
		);
		return messages;
	}

	private call(id: string, rawName: string, input: unknown, raw: CursorSdkMessage): AgentMessage[] {
		this.seenCalls.add(id);
		return [
			this.message(
				[
					{
						kind: "tool_call",
						toolUseId: id as ToolUseId,
						tool: canonicalToolForCursor(rawName),
						rawName,
						input,
					},
				],
				raw,
			),
		];
	}

	private result(
		id: string,
		value: unknown,
		isError: boolean,
		raw: CursorSdkMessage,
	): AgentMessage[] {
		this.emittedResults.add(id);
		const output = outputText(value);
		const cut = truncateOutput(output);
		const item: AgentItem = {
			kind: "tool_result",
			toolUseId: id as ToolUseId,
			output: cut.output,
			isError,
			truncated: cut.truncated,
		};
		if (cut.truncated) item.originalLength = cut.originalLength ?? output.length;
		return [this.message([item], raw)];
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
		return [{ agent: "cursor", items, raw }];
	}

	private message(items: AgentItem[], raw: unknown): AgentMessage {
		return { agent: "cursor", items, raw };
	}
}

function isTerminal(status: string): boolean {
	return status === "completed" || status === "error";
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
	const value = record[key];
	return typeof value === "string" ? value : null;
}

function readText(value: unknown): string | null {
	const text = contentToText(value);
	return text === "" ? null : text;
}

function contentBlocks(message: CursorSdkMessage): unknown[] {
	const inner = asRecord(message.message);
	const content = inner?.content ?? message.content;
	if (Array.isArray(content)) return content;
	if (typeof content === "string") return [{ type: "text", text: content }];
	if (typeof message.text === "string") return [{ type: "text", text: message.text }];
	return [];
}

/** The text of a tool result: a string, content blocks, a shell result, or JSON. */
function outputText(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value;
	const text = contentToText(value);
	if (text !== "") return text;
	const record = asRecord(value);
	if (record !== null) {
		const stdout = typeof record.stdout === "string" ? record.stdout : "";
		const stderr = typeof record.stderr === "string" ? record.stderr : "";
		if (stdout !== "" || stderr !== "") return [stdout, stderr].filter(Boolean).join("\n");
		return JSON.stringify(record) ?? "";
	}
	return String(value);
}

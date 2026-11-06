/**
 * @feature AGENT-07 Codex: translate items to the neutral format
 * Owns: mapping Codex's thread items and notifications to AgentMessage values, and tagging the
 * tool calls and tool results of a sub-agent's child thread with the collaboration call that
 * started it.
 * Behaviour: research/conductor/other-runners.md section 3 "Codex dialect" and 2.1 (sub-agents run
 * as child threads and their items are re-emitted under the parent). Conductor keeps Codex's own
 * item format and the UI needs a second renderer; we translate instead. Items seen in the
 * generated bindings of codex-cli 0.154.0: agentMessage, reasoning, plan, commandExecution,
 * fileChange, mcpToolCall, dynamicToolCall, collabAgentToolCall, webSearch, contextCompaction,
 * imageView, imageGeneration, sleep, hookPrompt, userMessage, functionCallOutput,
 * subAgentActivity, enteredReviewMode, exitedReviewMode.
 * Mapping (an item is translated on completion unless noted):
 *  - agentMessage: text item
 *  - reasoning: thinking item; the summary if it has text, else the content, summarized true when
 *    it is the summary
 *  - plan: text item
 *  - commandExecution: tool_call bash with { command, cwd } on start, tool_result with
 *    aggregatedOutput; a non-zero exit code or a failed status sets isError
 *  - fileChange: tool_call edit with { changes }, tool_result with the status; failed isError
 *  - mcpToolCall: tool_call mcp, rawName mcp__<server>__<tool>; the app's own server maps to
 *    app_tool; the result text comes from the MCP result content, the error message when the call
 *    has an error
 *  - dynamicToolCall: tool_call mcp, tool_result from its content items
 *  - collabAgentToolCall: tool_call sub_agent; the receiver thread ids are remembered so the tool
 *    calls and tool results of those child threads carry parentToolUseId; the result summarises
 *    the agents' states
 *  - webSearch: tool_call web_search, tool_result with the result JSON
 *  - imageView: tool_call image_view, tool_result with the path
 *  - imageGeneration: tool_call image_generation; the image is copied by the injected stager when
 *    one is supplied, otherwise its original path is kept; a copy failure is logged; an item with
 *    no saved image becomes an error result
 *  - subAgentActivity: notice "info" with the status (our design choice: the neutral format has no
 *    sub-agent status event)
 *  - contextCompaction and thread/compacted: notice "compacted"
 *  - thread/tokenUsage/updated: usage item (see codexUsageItem)
 *  - error notification: error item; willRetry true means retryable; a sign-in failure uses the
 *    shared auth code and names Codex or ChatGPT in its message
 *  - ignored: userMessage, hookPrompt, functionCallOutput, sleep, review mode markers, deltas
 * Must handle: a tool call that starts and completes (one tool_call on start, one tool_result on
 * completion, same toolUseId = item id), items that arrive only as completed (both emitted
 * together), unknown item types (debug log, no throw), output cut with truncateOutput, a sub-agent
 * whose child thread's tool items arrive interleaved with the parent's, and a failed image copy
 * (logged, original path kept).
 * Test first: a completed commandExecution item with exit code 1 yields a tool_call(bash) and a
 * tool_result with isError true, same toolUseId.
 * Our design choice: the stager is a parameter because the translator has no workspace path; when
 * no stager is supplied the image keeps its original path.
 */
import {
	AGENT_ERROR_CODES,
	type AgentItem,
	type AgentMessage,
	type CanonicalTool,
} from "@conducted/protocol";
import type { ToolUseId } from "@conducted/shared";
import { messageOf } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import { asRecord, readString } from "../../util/records.ts";
import { contentToText, truncateOutput } from "../output.ts";
import type { CodexThreadTokenUsage } from "./protocol.ts";
import { codexUsageItem, toolForCodexItem } from "./tool-names.ts";

/** Copies a generated image into the workspace and returns the path the chat can show. */
export interface CodexImageStager {
	stage(sourcePath: string, itemId: string): string;
}

export interface CodexTranslatorDeps {
	logger: Logger;
	/** Copies a generated image into the workspace; without it the original path is kept. */
	stageImage?: CodexImageStager;
}

const IGNORED_ITEMS = new Set([
	"userMessage",
	"hookPrompt",
	"functionCallOutput",
	"sleep",
	"enteredReviewMode",
	"exitedReviewMode",
]);

const SUB_AGENT_STATUS: Readonly<Record<string, string>> = {
	started: "started",
	interacted: "received a message",
	interrupted: "was interrupted",
	completed: "completed",
};

export class CodexTranslator {
	/** Item ids whose tool_call was already emitted on the started phase. */
	private readonly startedTools = new Set<string>();
	/** Child thread id -> id of the collabAgentToolCall that started it. */
	private readonly childParents = new Map<string, string>();

	constructor(protected readonly deps: CodexTranslatorDeps) {}

	/** Translates one item/started or item/completed notification. */
	translateItem(phase: "started" | "completed", item: unknown, threadId: string): AgentMessage[] {
		const record = asRecord(item);
		if (record === null) {
			this.deps.logger.debug("Ignoring a Codex item that is not an object");
			return [];
		}
		const type = readString(record, "type");
		if (type === null) {
			this.deps.logger.debug("Ignoring a Codex item with no type");
			return [];
		}
		if (type === "collabAgentToolCall") this.rememberChildThreads(record);
		const parentToolUseId = this.childParents.get(threadId);

		if (IGNORED_ITEMS.has(type)) return [];

		switch (type) {
			case "agentMessage": {
				if (phase === "started") return [];
				const text = readString(record, "text") ?? "";
				return text === "" ? [] : [agentMessage(record, [{ kind: "text", text }])];
			}
			case "reasoning": {
				if (phase === "started") return [];
				const summary = readStringArray(record, "summary").join("\n\n").trim();
				const content = readStringArray(record, "content").join("\n\n").trim();
				const text = summary === "" ? content : summary;
				if (text === "") return [];
				return [agentMessage(record, [{ kind: "thinking", text, summarized: summary !== "" }])];
			}
			case "plan": {
				if (phase === "started") return [];
				const text = readString(record, "text") ?? "";
				return text === "" ? [] : [agentMessage(record, [{ kind: "text", text }])];
			}
			case "commandExecution":
				return this.emitTool(
					phase,
					record,
					parentToolUseId,
					canonicalToolFor("commandExecution"),
					"commandExecution",
					{ command: readString(record, "command"), cwd: readString(record, "cwd") },
					(source) => {
						const output = readString(source, "aggregatedOutput") ?? "";
						const exitCode = readNumber(source, "exitCode");
						const status = readString(source, "status");
						const isError = (exitCode !== null && exitCode !== 0) || status === "failed";
						return { output, isError };
					},
				);
			case "fileChange":
				return this.emitTool(
					phase,
					record,
					parentToolUseId,
					canonicalToolFor("fileChange"),
					"fileChange",
					{ changes: readArray(record, "changes") },
					(source) => {
						const status = readString(source, "status") ?? "";
						return { output: status, isError: status === "failed" };
					},
				);
			case "mcpToolCall": {
				const server = readString(record, "server") ?? "";
				const tool = readString(record, "tool") ?? "";
				const canonical = canonicalToolFor("mcpToolCall", server === "" ? undefined : server);
				return this.emitTool(
					phase,
					record,
					parentToolUseId,
					canonical,
					`mcp__${server}__${tool}`,
					readValue(record, "arguments"),
					(source) => {
						const error = asRecord(source.error);
						const result = asRecord(source.result);
						const content = result === null ? "" : contentToText(result.content);
						const errorMessage = error === null ? null : readString(error, "message");
						const status = readString(source, "status");
						return {
							output: errorMessage ?? content,
							isError: errorMessage !== null || status === "failed",
						};
					},
				);
			}
			case "dynamicToolCall":
				return this.emitTool(
					phase,
					record,
					parentToolUseId,
					canonicalToolFor("dynamicToolCall"),
					readString(record, "tool") ?? "dynamicToolCall",
					readValue(record, "arguments"),
					(source) => {
						const status = readString(source, "status");
						const success = source.success;
						return {
							output: contentToText(source.contentItems),
							isError: success === false || status === "failed",
						};
					},
				);
			case "collabAgentToolCall":
				return this.emitTool(
					phase,
					record,
					parentToolUseId,
					canonicalToolFor("collabAgentToolCall"),
					readString(record, "tool") ?? "collabAgentToolCall",
					{
						prompt: readString(record, "prompt"),
						model: readString(record, "model"),
						receiverThreadIds: readArray(record, "receiverThreadIds"),
					},
					(source) => {
						const status = readString(source, "status");
						const summary = summariseAgents(source.agentsStates);
						return {
							output: summary === "" ? (status ?? "") : summary,
							isError: status === "failed",
						};
					},
				);
			case "webSearch":
				return this.emitTool(
					phase,
					record,
					parentToolUseId,
					canonicalToolFor("webSearch"),
					"webSearch",
					{ query: readString(record, "query") },
					(source) => {
						const results = readValue(source, "results");
						return {
							output: results === null || results === undefined ? "" : JSON.stringify(results),
							isError: false,
						};
					},
				);
			case "imageView": {
				const path = readString(record, "path") ?? "";
				return this.emitTool(
					phase,
					record,
					parentToolUseId,
					canonicalToolFor("imageView"),
					"imageView",
					{ path },
					() => ({ output: path, isError: false }),
				);
			}
			case "imageGeneration":
				return this.emitTool(
					phase,
					record,
					parentToolUseId,
					canonicalToolFor("imageGeneration"),
					"imageGeneration",
					{
						revisedPrompt: readString(record, "revisedPrompt"),
						transparentBackground: record.transparentBackground === true,
					},
					(source) => this.imageGenerationResult(source, readString(source, "id") ?? ""),
				);
			case "subAgentActivity": {
				if (phase === "started") return [];
				const kind = readString(record, "kind") ?? "changed";
				const label = SUB_AGENT_STATUS[kind] ?? kind;
				return [
					agentMessage(record, [{ kind: "notice", notice: "info", text: `Sub-agent ${label}` }]),
				];
			}
			case "contextCompaction": {
				if (phase === "started") return [];
				return [
					agentMessage(record, [
						{ kind: "notice", notice: "compacted", text: "Chat history compacted" },
					]),
				];
			}
			default:
				this.deps.logger.debug("Ignoring a Codex item type we do not translate", { type });
				return [];
		}
	}

	/** Translates a non-item notification (usage, error, compaction). */
	translateNotification(method: string, params: unknown): AgentMessage[] {
		switch (method) {
			case "thread/tokenUsage/updated": {
				const usage = readTokenUsage(params);
				if (usage === null) {
					this.deps.logger.warn("Could not read Codex token usage", { method });
					return [];
				}
				return [plainMessage([codexUsageItem(usage)], params)];
			}
			case "thread/compacted":
				return [
					plainMessage(
						[{ kind: "notice", notice: "compacted", text: "Chat history compacted" }],
						params,
					),
				];
			case "error": {
				const error = readError(params);
				if (error === null) {
					this.deps.logger.warn("Could not read a Codex error notification", { method });
					return [];
				}
				return [plainMessage([error], params)];
			}
			default:
				this.deps.logger.debug("Ignoring a Codex notification we do not translate", { method });
				return [];
		}
	}

	private emitTool(
		phase: "started" | "completed",
		record: Record<string, unknown>,
		parentToolUseId: string | undefined,
		tool: CanonicalTool,
		rawName: string,
		input: unknown,
		resultOf: (record: Record<string, unknown>) => { output: string; isError: boolean },
	): AgentMessage[] {
		const id = readString(record, "id");
		if (id === null || id === "") {
			this.deps.logger.warn("Ignoring a Codex tool item with no id", {
				type: readString(record, "type"),
			});
			return [];
		}
		const call = toolCallItem(id, parentToolUseId, tool, rawName, input);
		if (phase === "started") {
			this.startedTools.add(id);
			return [agentMessage(record, [call])];
		}
		const result = resultOf(record);
		const resultItem = toolResultItem(id, parentToolUseId, result.output, result.isError);
		if (!this.startedTools.delete(id)) return [agentMessage(record, [call, resultItem])];
		return [agentMessage(record, [resultItem])];
	}

	private rememberChildThreads(record: Record<string, unknown>): void {
		const parentId = readString(record, "id");
		if (parentId === null || parentId === "") return;
		for (const threadId of readStringArray(record, "receiverThreadIds")) {
			if (threadId !== "") this.childParents.set(threadId, parentId);
		}
	}

	private imageGenerationResult(
		record: Record<string, unknown>,
		itemId: string,
	): { output: string; isError: boolean } {
		const failure = asRecord(record.failure);
		if (failure !== null) {
			const type = readString(failure, "type") ?? "unknown";
			return { output: `Image generation failed: ${type}`, isError: true };
		}
		const savedPath = readString(record, "savedPath");
		if (savedPath === null || savedPath === "") {
			this.deps.logger.warn("Image generation finished without a saved image", { itemId });
			return { output: "Image generation finished without an image.", isError: true };
		}
		const stager = this.deps.stageImage;
		if (stager === undefined) return { output: savedPath, isError: false };
		try {
			return { output: stager.stage(savedPath, itemId), isError: false };
		} catch (cause) {
			this.deps.logger.warn("Failed to stage generated image inside the workspace", {
				path: savedPath,
				itemId,
				error: messageOf(cause),
			});
			return { output: savedPath, isError: false };
		}
	}
}

function canonicalToolFor(type: string, server?: string): CanonicalTool {
	return toolForCodexItem(type, server) ?? "unknown";
}

function agentMessage(record: Record<string, unknown>, items: AgentItem[]): AgentMessage {
	const message: AgentMessage = { agent: "codex", items, raw: record };
	const id = readString(record, "id");
	if (id !== null && id !== "") message.nativeId = id;
	return message;
}

function plainMessage(items: AgentItem[], raw: unknown): AgentMessage {
	return { agent: "codex", items, raw };
}

function toolCallItem(
	id: string,
	parentToolUseId: string | undefined,
	tool: CanonicalTool,
	rawName: string,
	input: unknown,
): Extract<AgentItem, { kind: "tool_call" }> {
	const item: Extract<AgentItem, { kind: "tool_call" }> = {
		kind: "tool_call",
		toolUseId: id as ToolUseId,
		tool,
		rawName,
		input,
	};
	if (parentToolUseId !== undefined) item.parentToolUseId = parentToolUseId as ToolUseId;
	return item;
}

function toolResultItem(
	id: string,
	parentToolUseId: string | undefined,
	output: string,
	isError: boolean,
): Extract<AgentItem, { kind: "tool_result" }> {
	const cut = truncateOutput(output);
	const item: Extract<AgentItem, { kind: "tool_result" }> = {
		kind: "tool_result",
		toolUseId: id as ToolUseId,
		output: cut.output,
		isError,
		truncated: cut.truncated,
	};
	if (cut.truncated) item.originalLength = cut.originalLength ?? output.length;
	if (parentToolUseId !== undefined) item.parentToolUseId = parentToolUseId as ToolUseId;
	return item;
}

function readError(params: unknown): Extract<AgentItem, { kind: "error" }> | null {
	const root = asRecord(params);
	if (root === null) return null;
	const error = asRecord(root.error);
	if (error === null) return null;
	const message = readString(error, "message") ?? "";
	const info = error.codexErrorInfo;
	const willRetry = root.willRetry === true;
	const auth = authMessage(message, info);
	if (auth !== null) {
		return {
			kind: "error",
			code: AGENT_ERROR_CODES.authRequired,
			message: auth,
			retryable: willRetry,
		};
	}
	return {
		kind: "error",
		code: codexErrorCode(message, info),
		message,
		retryable: willRetry,
	};
}

function authMessage(message: string, info: unknown): string | null {
	const text = message.toLowerCase();
	const auth =
		info === "unauthorized" ||
		/unauthori[sz]ed|not signed in|sign[ -]?in|log ?in|authentication|authori[sz]ation/.test(text);
	if (!auth) return null;
	if (/chatgpt|token.*expired|session.*expired|login expired/.test(text)) {
		return "ChatGPT login expired. Sign in to ChatGPT in the agent settings.";
	}
	return "Codex authentication required. Sign in to Codex in the agent settings.";
}

function codexErrorCode(message: string, info: unknown): string {
	const text = message.toLowerCase();
	if (
		/usage limit|quota/.test(text) ||
		info === "usageLimitExceeded" ||
		info === "sessionBudgetExceeded"
	) {
		return "agent_usage_limit";
	}
	if (
		/rate ?limit|too many requests|\b429\b|overloaded/.test(text) ||
		info === "rateLimitExceeded" ||
		info === "serverOverloaded"
	) {
		return "agent_rate_limit";
	}
	if (info === "contextWindowExceeded") return "agent_context_window";
	return "agent_codex_error";
}

function readTokenUsage(params: unknown): CodexThreadTokenUsage | null {
	const root = asRecord(params);
	if (root === null) return null;
	const usage = asRecord(root.tokenUsage) ?? asRecord(root.usage) ?? root;
	const last = asRecord(usage.last);
	if (last === null) return null;
	const totalTokens = readNumber(last, "totalTokens");
	const inputTokens = readNumber(last, "inputTokens");
	const cachedInputTokens = readNumber(last, "cachedInputTokens");
	const cacheWriteInputTokens = readNumber(last, "cacheWriteInputTokens");
	const outputTokens = readNumber(last, "outputTokens");
	const reasoningOutputTokens = readNumber(last, "reasoningOutputTokens");
	if (
		totalTokens === null ||
		inputTokens === null ||
		cachedInputTokens === null ||
		cacheWriteInputTokens === null ||
		outputTokens === null ||
		reasoningOutputTokens === null
	) {
		return null;
	}
	const breakdown = {
		totalTokens,
		inputTokens,
		cachedInputTokens,
		cacheWriteInputTokens,
		outputTokens,
		reasoningOutputTokens,
	};
	const window = readNumber(usage, "modelContextWindow");
	return {
		total: breakdown,
		last: breakdown,
		modelContextWindow: window,
	};
}

function summariseAgents(value: unknown): string {
	const states = asRecord(value);
	if (states === null) return "";
	const lines: string[] = [];
	for (const [threadId, raw] of Object.entries(states)) {
		const state = asRecord(raw);
		if (state === null) continue;
		const status = readString(state, "status") ?? "unknown";
		const message = readString(state, "message");
		lines.push(
			`${threadId}: ${status}${message === null || message === "" ? "" : ` (${message})`}`,
		);
	}
	return lines.join("\n");
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readArray(record: Record<string, unknown>, key: string): unknown[] {
	const value = record[key];
	return Array.isArray(value) ? value : [];
}

function readValue(record: Record<string, unknown>, key: string): unknown {
	return record[key];
}

function readStringArray(record: Record<string, unknown>, key: string): string[] {
	return readArray(record, key).filter((value): value is string => typeof value === "string");
}

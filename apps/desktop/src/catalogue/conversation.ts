/**
 * @feature catalogue Chat events for catalogue seeds
 * Owns: a small builder that writes a chat's events in order, each a few seconds after the last, with
 * ids that never repeat: user messages, agent text and thinking, tool calls with their results, todo
 * lists, usage, notices and errors, checkpoints with the files a turn changed, and the turn's end
 * with its outcome.
 * Behaviour: packages/protocol/src/events.ts and agent-message.ts are the shapes; the sidecar's runners
 * send Claude's tools with Claude's input names (file_path, old_string, command), which the tool cards
 * read.
 * Test first: not applicable; the screenshot run opens every state that uses it.
 */
import type {
	AgentItem,
	CanonicalTool,
	FileChange,
	SessionConfig,
	SessionEvent,
	UserMessageSender,
} from "@conducted/protocol";
import type { CheckpointId, EventId, MessageId, ToolUseId, TurnId } from "@conducted/shared";
import { CLAUDE_CONFIG } from "./seeds.ts";

export interface ToolStep {
	tool: CanonicalTool;
	rawName: string;
	input: Record<string, unknown>;
	/** Null leaves the call running, with no result yet. */
	output: string | null;
	isError?: boolean;
	/** The sub-agent call this call ran inside, so the Subagent card nests it. */
	parent?: ToolUseId;
}

export interface Conversation {
	/** Every event written so far, in order. */
	readonly events: SessionEvent[];
	/** Starts a new turn with the user's message and its start checkpoint. Returns the turn id. */
	user(
		text: string,
		options?: { attachmentPaths?: string[]; config?: SessionConfig; sender?: UserMessageSender },
	): TurnId;
	/** One agent message with these items. */
	agent(turn: TurnId, items: AgentItem[]): void;
	text(turn: TurnId, text: string): void;
	thinking(turn: TurnId, text: string): void;
	/** A tool call and, unless `output` is null, its result in a second message. Returns its id. */
	tool(turn: TurnId, step: ToolStep): ToolUseId;
	usage(turn: TurnId, contextUsedTokens: number): void;
	/** The end checkpoint with the files the turn changed, then the turn's end. */
	end(turn: TurnId, changes?: FileChange[], outcome?: TurnOutcome): void;
}

export type TurnOutcome = Extract<SessionEvent, { type: "turn_ended" }>["outcome"];

/** A builder whose first event is at `startAt`, `stepMs` apart, with ids starting with `prefix`. */
export function conversation(prefix: string, startAt: number, stepMs = 4_000): Conversation {
	const events: SessionEvent[] = [];
	let count = 0;
	let at = startAt;
	const next = (): { eventId: EventId; at: number } => {
		count += 1;
		at += stepMs;
		return { eventId: `${prefix}-e${count}` as EventId, at };
	};
	const agent = (turn: TurnId, items: AgentItem[]): void => {
		events.push({ ...next(), type: "agent", turnId: turn, message: { agent: "claude", items } });
	};
	let turns = 0;
	return {
		events,
		user(text, options = {}) {
			turns += 1;
			const turnId = `${prefix}-t${turns}` as TurnId;
			events.push({
				...next(),
				type: "user_message",
				messageId: `${prefix}-m${turns}` as MessageId,
				turnId,
				text,
				attachmentPaths: options.attachmentPaths ?? [],
				delivery: "new_turn",
				config: options.config ?? CLAUDE_CONFIG,
				...(options.sender === undefined ? {} : { sender: options.sender }),
			});
			events.push({
				...next(),
				type: "checkpoint",
				turnId,
				phase: "start",
				checkpointId: `${prefix}-cp${turns}a` as CheckpointId,
			});
			return turnId;
		},
		agent,
		text: (turn, text) => agent(turn, [{ kind: "text", text }]),
		thinking: (turn, text) => agent(turn, [{ kind: "thinking", text, summarized: false }]),
		tool(turn, step) {
			const toolUseId = `${prefix}-tu${count + 1}` as ToolUseId;
			agent(turn, [
				{
					kind: "tool_call",
					toolUseId,
					tool: step.tool,
					rawName: step.rawName,
					input: step.input,
					...(step.parent === undefined ? {} : { parentToolUseId: step.parent }),
				},
			]);
			if (step.output !== null) {
				agent(turn, [
					{
						kind: "tool_result",
						toolUseId,
						output: step.output,
						isError: step.isError ?? false,
						truncated: false,
						...(step.parent === undefined ? {} : { parentToolUseId: step.parent }),
					},
				]);
			}
			return toolUseId;
		},
		usage: (turn, contextUsedTokens) =>
			agent(turn, [
				{
					kind: "usage",
					inputTokens: 18_400,
					outputTokens: 2_150,
					cacheReadTokens: 96_000,
					cacheWriteTokens: 4_800,
					costUsd: 0.42,
					contextUsedTokens,
					contextWindowTokens: 200_000,
					model: "claude-opus-4-7",
				},
			]),
		end(turn, changes, outcome = "success") {
			events.push({
				...next(),
				type: "checkpoint",
				turnId: turn,
				phase: "end",
				checkpointId: `${turn}-end` as CheckpointId,
				...(changes === undefined ? {} : { changes }),
			});
			events.push({ ...next(), type: "turn_ended", turnId: turn, outcome });
		},
	};
}

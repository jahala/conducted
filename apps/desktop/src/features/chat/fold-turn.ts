/**
 * @feature CHAT-06 Folding a finished turn's work into one row
 * Owns: the pure rule that decides which blocks of a finished turn stay in view and which fold into a
 * summary row such as "6 tool calls, 4 messages", with the counts and the tool kinds the row shows.
 * Behaviour: measured from Conductor 0.92.1 (main @1420729, the turn's collapse rule; renderApp @9592138, the
 * summary row). Working backwards through the turn, these stay in view: every error, every question and plan
 * proposal, and the last piece of reply text, unless a question, plan or error comes after it. Each run of
 * other blocks between them folds into one summary when it has three or more blocks; a shorter run stays as
 * it is. Tool calls count as tool calls (sub-agents on their own), everything else as messages. A running
 * turn never folds, and neither does any turn while "Expand all tool calls" is on (the caller decides).
 * Our design choice: our blocks stand for Conductor's messages one to one: a text or thinking block is one
 * message, a tool block is one tool call, a todo list is the TodoWrite tool call it came from.
 * Must handle: a turn with no text (everything folds when long enough); a turn that ends in a question or
 * plan (the text before it folds too); empty text blocks (not counted, never shown); stable keys.
 * Test first: text, five tool calls and a final text fold into "5 tool calls, 1 message" plus the final text.
 */
import type { CanonicalTool } from "@conducted/protocol";
import type { ChatBlock } from "../../core/model.ts";

export interface KeyedBlock {
	key: string;
	block: ChatBlock;
}

export interface FoldSummary {
	toolCalls: number;
	messages: number;
	subAgents: number;
	/** The tool kinds in the run, first seen first, once each. */
	tools: CanonicalTool[];
}

export type FoldItem =
	| { kind: "block"; key: string; block: ChatBlock }
	| { kind: "summary"; key: string; summary: FoldSummary; blocks: KeyedBlock[] };

/** A run shorter than this stays in view. */
export const MIN_FOLDED_RUN = 3;

function isEmpty(block: ChatBlock): boolean {
	return (block.kind === "text" || block.kind === "thinking") && block.text.trim().length === 0;
}

function needsTheUser(block: ChatBlock): boolean {
	if (block.kind === "error") return true;
	return (
		block.kind === "tool" &&
		(block.call.item.tool === "ask_user_question" || block.call.item.tool === "exit_plan_mode")
	);
}

/** The blocks that stay in view, found walking back from the end as Conductor does. */
function shownBlocks(blocks: readonly KeyedBlock[]): Set<string> {
	const shown = new Set<string>();
	let seenText = false;
	let endsWithRequest = false;
	let seenShown = false;
	for (let index = blocks.length - 1; index >= 0; index -= 1) {
		const item = blocks[index];
		if (item === undefined) continue;
		const request = needsTheUser(item.block);
		const text = item.block.kind === "text" && !isEmpty(item.block);
		if (request && !seenShown) endsWithRequest = true;
		const show = request || (text && !seenText && !endsWithRequest);
		if (text) seenText = true;
		if (show) {
			seenShown = true;
			shown.add(item.key);
		}
	}
	return shown;
}

export function summarize(blocks: readonly KeyedBlock[]): FoldSummary {
	let toolCalls = 0;
	let messages = 0;
	let subAgents = 0;
	const tools: CanonicalTool[] = [];
	const note = (tool: CanonicalTool) => {
		if (!tools.includes(tool)) tools.push(tool);
	};
	for (const { block } of blocks) {
		if (block.kind === "tool") {
			if (block.call.item.tool === "sub_agent") subAgents += 1;
			else toolCalls += 1;
			note(block.call.item.tool);
		} else if (block.kind === "todo") {
			toolCalls += 1;
			note("todo");
		} else {
			messages += 1;
		}
	}
	return { toolCalls, messages, subAgents, tools };
}

function plural(count: number, word: string): string {
	return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** "6 tool calls, 4 messages", "1 tool call, 1 subagent". */
export function summaryLabel(summary: FoldSummary): string {
	const parts: string[] = [];
	if (summary.toolCalls > 0) parts.push(plural(summary.toolCalls, "tool call"));
	if (summary.messages > 0) parts.push(plural(summary.messages, "message"));
	if (summary.subAgents > 0) parts.push(plural(summary.subAgents, "subagent"));
	return parts.join(", ");
}

/** The items a finished turn shows: blocks in view and summaries of the runs between them. */
export function foldTurnBlocks(blocks: readonly KeyedBlock[]): FoldItem[] {
	const visible = blocks.filter((item) => !isEmpty(item.block));
	const shown = shownBlocks(visible);
	const items: FoldItem[] = [];
	let run: KeyedBlock[] = [];
	const flush = () => {
		const first = run[0];
		if (first === undefined) return;
		if (run.length < MIN_FOLDED_RUN) {
			for (const item of run) items.push({ kind: "block", key: item.key, block: item.block });
		} else {
			items.push({
				kind: "summary",
				key: `fold:${first.key}`,
				summary: summarize(run),
				blocks: run,
			});
		}
		run = [];
	};
	for (const item of visible) {
		if (shown.has(item.key)) {
			flush();
			items.push({ kind: "block", key: item.key, block: item.block });
		} else {
			run.push(item);
		}
	}
	flush();
	return items;
}

/**
 * @feature CHAT-06 Folding a finished turn's work into one row
 * Tests Conductor's rule: what stays in view, what folds, the counts and their words.
 */
import type { CanonicalTool } from "@conducted/protocol";
import { describe, expect, it } from "vitest";
import type { ChatBlock } from "../../core/model.ts";
import { foldTurnBlocks, type KeyedBlock, summaryLabel } from "./fold-turn.ts";

const text = (value: string): ChatBlock => ({ kind: "text", text: value });
const thinking = (value: string): ChatBlock => ({
	kind: "thinking",
	text: value,
	summarized: false,
});
const tool = (name: CanonicalTool, id: string): ChatBlock => ({
	kind: "tool",
	call: {
		toolUseId: id as never,
		item: { kind: "tool_call", toolUseId: id as never, tool: name, rawName: name, input: {} },
		result: null,
		children: [],
	},
});
const keyed = (blocks: ChatBlock[]): KeyedBlock[] =>
	blocks.map((block, index) => ({ key: `b${index}`, block }));

describe("CHAT-06 folding a finished turn", () => {
	it("folds the work before the final reply into one summary", () => {
		const items = foldTurnBlocks(
			keyed([
				thinking("plan"),
				tool("read", "1"),
				text("Found it."),
				tool("edit", "2"),
				tool("bash", "3"),
				text("Done."),
			]),
		);
		expect(items.map((item) => item.kind)).toEqual(["summary", "block"]);
		const [summary, last] = items;
		if (summary?.kind !== "summary" || last?.kind !== "block") throw new Error("shape");
		expect(summaryLabel(summary.summary)).toBe("3 tool calls, 2 messages");
		expect(summary.summary.tools).toEqual(["read", "edit", "bash"]);
		expect(last.block).toEqual(text("Done."));
	});

	it("keeps a run shorter than three blocks in view", () => {
		const items = foldTurnBlocks(keyed([tool("read", "1"), tool("grep", "2"), text("Done.")]));
		expect(items.map((item) => item.kind)).toEqual(["block", "block", "block"]);
	});

	it("keeps a question and folds the text before it", () => {
		const items = foldTurnBlocks(
			keyed([
				tool("read", "1"),
				text("I need to ask."),
				tool("grep", "2"),
				tool("ask_user_question", "3"),
			]),
		);
		expect(items.map((item) => item.kind)).toEqual(["summary", "block"]);
		const [summary] = items;
		if (summary?.kind !== "summary") throw new Error("shape");
		expect(summaryLabel(summary.summary)).toBe("2 tool calls, 1 message");
	});

	it("keeps every error in view", () => {
		const error: ChatBlock = {
			kind: "error",
			item: { kind: "error", code: "x", message: "broke", retryable: false },
		};
		const items = foldTurnBlocks(
			keyed([tool("read", "1"), tool("read", "2"), tool("read", "3"), error, text("Sorry.")]),
		);
		expect(items.map((item) => item.kind)).toEqual(["summary", "block", "block"]);
	});

	it("counts sub-agents apart and skips empty text", () => {
		const items = foldTurnBlocks(
			keyed([
				tool("sub_agent", "1"),
				text("  "),
				tool("bash", "2"),
				tool("sub_agent", "3"),
				text("Ok"),
			]),
		);
		const [summary] = items;
		if (summary?.kind !== "summary") throw new Error("shape");
		expect(summaryLabel(summary.summary)).toBe("1 tool call, 2 subagents");
	});

	it("folds a turn of 300 tool calls into one row", () => {
		const blocks = Array.from({ length: 300 }, (_, index) => tool("bash", `t${index}`));
		const items = foldTurnBlocks(keyed([...blocks, text("All done.")]));
		expect(items).toHaveLength(2);
		const [summary] = items;
		if (summary?.kind !== "summary") throw new Error("shape");
		expect(summary.summary.toolCalls).toBe(300);
		expect(summary.summary.tools).toEqual(["bash"]);
	});
});

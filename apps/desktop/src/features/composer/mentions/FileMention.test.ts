import { fireEvent } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../../test/dom-polyfills.ts";
import { composerBaseKit } from "../composer-extensions.ts";
import {
	createFileMention,
	FILE_MENTION_LIMIT,
	type FileMentionAction,
	type FileMentionItem,
	fileMentionState,
	fileMentionSuggestions,
} from "./FileMention.ts";

const files: FileMentionItem[] = [
	{ path: "docs/readme-notes.md", isDirectory: false },
	{ path: "README.md", isDirectory: false },
	{ path: "src", isDirectory: true },
	{ path: "src/app.ts", isDirectory: false },
];

const editors: Editor[] = [];

const mount = (search: (query: string) => FileMentionItem[], actions?: FileMentionAction[]) => {
	const editor = new Editor({
		extensions: [composerBaseKit, createFileMention({ search, actions })],
		content: "",
	});
	editors.push(editor);
	editor.commands.focus();
	return editor;
};

const type = (editor: Editor, text: string) => {
	editor.commands.insertContent(text);
};

const mentionNodes = (editor: Editor) => {
	const json = editor.getJSON();
	const nodes: { path?: string; isDirectory?: boolean }[] = [];
	const visit = (node: {
		type?: string;
		attrs?: { path?: string; isDirectory?: boolean };
		content?: unknown[];
	}) => {
		if (node.type === "fileMention") {
			nodes.push({ path: node.attrs?.path, isDirectory: node.attrs?.isDirectory });
		}
		for (const child of (node.content ?? []) as (typeof node)[]) visit(child);
	};
	visit(json);
	return nodes;
};

afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

describe("COMP-04 FileMention", () => {
	it("offers README.md first for '@rea' and inserts its path as a chip", () => {
		const editor = mount(() => files);
		type(editor, "@rea");
		const state = fileMentionState(editor);
		expect(state?.items[0]?.label).toBe("README.md");
		expect(fileMentionSuggestions("rea", { search: () => files })[0]?.path).toBe("README.md");

		expect(fileMentionState(editor)).not.toBeNull();
		fireEvent.keyDown(editor.view.dom, { key: "Enter" });
		expect(mentionNodes(editor)).toEqual([{ path: "README.md", isDirectory: false }]);
	});

	it("keeps the typed '@' when Escape closes the popup", () => {
		const editor = mount(() => files);
		type(editor, "@rea");
		fireEvent.keyDown(editor.view.dom, { key: "Escape" });
		expect(fileMentionState(editor)).toBeNull();
		expect(editor.getText()).toBe("@rea");
	});

	it("does not open inside a word", () => {
		const editor = mount(() => files);
		type(editor, "email@rea");
		expect(fileMentionState(editor)).toBeNull();
	});

	it("offers no rows when nothing matches", () => {
		const editor = mount(() => []);
		type(editor, "@zzzz");
		expect(fileMentionState(editor)?.items).toEqual([]);
	});

	it("shows at most twenty file rows", () => {
		const many = Array.from({ length: FILE_MENTION_LIMIT + 5 }, (_, index) => ({
			path: `file-${index}.ts`,
			isDirectory: false,
		}));
		expect(fileMentionSuggestions("", { search: () => many })).toHaveLength(FILE_MENTION_LIMIT);
	});

	it("offers plans, terminal output and working directories as actions", () => {
		const onChoose = vi.fn();
		const actions: FileMentionAction[] = [
			{ id: "plan:1", label: "plan: Add mentions", onChoose },
			{ id: "terminal", label: "Attach current terminal output", onChoose },
			{ id: "directories", label: "Select working directories", onChoose },
		];
		const labels = fileMentionSuggestions("", { search: () => files, actions }).map(
			(row) => row.label,
		);
		expect(labels).toEqual([
			"plan: Add mentions",
			"Attach current terminal output",
			"Select working directories",
			"docs/readme-notes.md",
			"README.md",
			"src",
			"src/app.ts",
		]);
	});

	it("runs a chosen action instead of inserting a chip", () => {
		const onChoose = vi.fn();
		const action: FileMentionAction = {
			id: "terminal",
			label: "Attach current terminal output",
			onChoose,
		};
		const editor = mount(() => files, [action]);
		type(editor, "@attach");
		expect(fileMentionState(editor)?.items[0]?.id).toBe("action:terminal");
		fireEvent.keyDown(editor.view.dom, { key: "Enter" });
		expect(onChoose).toHaveBeenCalledTimes(1);
		expect(mentionNodes(editor)).toEqual([]);
		expect(editor.getText()).not.toContain("@attach");
	});
});

import { act, fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import { createElement, useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { composerBaseKit } from "../composer-extensions.ts";
import {
	createFileMention,
	FILE_MENTION_LIMIT,
	type FileMentionAction,
	type FileMentionItem,
	fileMentionSuggestions,
} from "./FileMention.ts";

const files: FileMentionItem[] = [
	{ path: "docs/readme-notes.md", isDirectory: false },
	{ path: "README.md", isDirectory: false },
	{ path: "src", isDirectory: true },
	{ path: "src/app.ts", isDirectory: false },
];

const editors: Editor[] = [];

const mount = (
	search: (query: string) => FileMentionItem[],
	actions?: FileMentionAction[],
	onOpen?: () => void,
) => {
	const editor = new Editor({
		extensions: [composerBaseKit, createFileMention({ search, actions, onOpen })],
		content: "",
	});
	editors.push(editor);
	editor.commands.focus();
	return editor;
};

const type = (editor: Editor, text: string) => {
	editor.commands.insertContent(text);
};

/** Destroys the editor from inside a React commit, as TipTap's destroy timer can do. */
function DestroyEditorOnCommit({ editor }: { editor: Editor }) {
	useLayoutEffect(() => {
		editor.destroy();
	}, [editor]);
	return null;
}

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
	it("offers README.md first for '@rea' and inserts its path as a chip", async () => {
		const editor = mount(() => files);
		type(editor, "@rea");
		const options = await screen.findAllByRole("option");
		expect(options[0]?.textContent).toBe("README.md");
		expect(fileMentionSuggestions("rea", { search: () => files })[0]?.path).toBe("README.md");

		expect(screen.getByRole("listbox", { name: "Suggestions" })).toBeTruthy();
		fireEvent.keyDown(editor.view.dom, { key: "Enter" });
		expect(mentionNodes(editor)).toEqual([{ path: "README.md", isDirectory: false }]);
	});

	it("keeps the typed '@' when Escape closes the popup", async () => {
		const editor = mount(() => files);
		type(editor, "@rea");
		await screen.findByRole("listbox", { name: "Suggestions" });
		fireEvent.keyDown(editor.view.dom, { key: "Escape" });
		expect(screen.queryByRole("listbox", { name: "Suggestions" })).toBeNull();
		expect(editor.getText()).toBe("@rea");
	});

	it("does not open inside a word", () => {
		const editor = mount(() => files);
		// act() draws anything the trigger would have opened before the popup is looked for.
		act(() => type(editor, "email@rea"));
		expect(screen.queryByRole("listbox", { name: "Suggestions" })).toBeNull();
	});

	it("offers no rows when nothing matches", async () => {
		const editor = mount(() => []);
		type(editor, "@zzzz");
		await screen.findByRole("listbox", { name: "Suggestions" });
		expect(screen.queryAllByRole("option")).toEqual([]);
	});

	it("keeps the popup open and says 'No files found' when nothing matches", async () => {
		const editor = mount(() => []);
		type(editor, "@zzzz");
		expect(await screen.findByText("No files found")).toBeTruthy();
		expect(screen.getByRole("listbox", { name: "Suggestions" })).toBeTruthy();
	});

	it("tears the popup down outside the commit that destroys the editor", async () => {
		const editor = mount(() => files);
		type(editor, "@rea");
		await screen.findByRole("listbox", { name: "Suggestions" });
		const errors: string[] = [];
		const reported = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
			errors.push(args.map(String).join(" "));
		});
		try {
			// TipTap destroys the editor on a short timer, which can land while any React root is
			// committing. Unmounting the popup's root from inside that commit leaves React's work
			// pending past the end of the test, where a scheduler callback reads a window that is
			// gone.
			render(createElement(DestroyEditorOnCommit, { editor }));
			expect(errors.join("\n")).not.toContain("synchronously unmount a root");
		} finally {
			reported.mockRestore();
		}
		editors.splice(editors.indexOf(editor), 1);
	});

	it("asks for a fresh file list each time the trigger opens", () => {
		const onOpen = vi.fn();
		const editor = mount(() => files, undefined, onOpen);
		type(editor, "@re");
		type(editor, "a");
		expect(onOpen).toHaveBeenCalledTimes(1);
		fireEvent.keyDown(editor.view.dom, { key: "Escape" });
		type(editor, " @s");
		expect(onOpen).toHaveBeenCalledTimes(2);
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

	it("runs a chosen action instead of inserting a chip", async () => {
		const onChoose = vi.fn();
		const action: FileMentionAction = {
			id: "terminal",
			label: "Attach current terminal output",
			onChoose,
		};
		const editor = mount(() => files, [action]);
		type(editor, "@attach");
		const options = await screen.findAllByRole("option");
		expect(options[0]?.textContent).toBe("Attach current terminal output");
		fireEvent.keyDown(editor.view.dom, { key: "Enter" });
		expect(onChoose).toHaveBeenCalledTimes(1);
		expect(mentionNodes(editor)).toEqual([]);
		expect(editor.getText()).not.toContain("@attach");
	});
});

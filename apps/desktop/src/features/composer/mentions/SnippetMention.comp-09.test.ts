/**
 * @feature COMP-09 Prompt snippets
 * Owns: tests for the § trigger: its rows, its loading and empty states, Escape and insertion.
 * Behaviour: ui-map.md 3.5 (the fourth trigger for saved snippets).
 * Test first: typing "§rev" offers the snippet named Review and Enter inserts its prompt.
 */
import type { SnippetId } from "@conducted/shared";
import { act, fireEvent, screen } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Snippet } from "../../../core/model.ts";
import { composerBaseKit } from "../composer-extensions.ts";
import { createSnippetMention, snippetSuggestions } from "./SnippetMention.ts";

const snippets: Snippet[] = [
	{
		id: "review" as SnippetId,
		name: "Review",
		keyword: "rev",
		prompt: "Review this change.",
		createdAt: 0,
		updatedAt: 0,
	},
	{
		id: "fix" as SnippetId,
		name: "Fix errors",
		keyword: null,
		prompt: "Fix the errors.",
		createdAt: 0,
		updatedAt: 0,
	},
];

const editors: Editor[] = [];

function mount(
	getSnippets: () => readonly Snippet[] | null,
	getError: () => string | null = () => null,
) {
	const editor = new Editor({
		extensions: [composerBaseKit, createSnippetMention({ snippets: getSnippets, error: getError })],
		content: "",
	});
	editors.push(editor);
	editor.commands.focus();
	return editor;
}

const type = (editor: Editor, text: string) => {
	editor.commands.insertContent(text);
};

afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

describe("COMP-09 SnippetMention", () => {
	it("offers the matching snippet and inserts its prompt on Enter", async () => {
		const editor = mount(() => snippets);
		type(editor, "§rev");
		const options = await screen.findAllByRole("option");
		expect(options[0]?.textContent).toContain("Review");
		expect(snippetSuggestions("rev", snippets).map((row) => row.label)).toEqual(["Review"]);

		fireEvent.keyDown(editor.view.dom, { key: "Enter" });
		expect(editor.getText()).toBe("Review this change.");
	});

	it("keeps the typed trigger when Escape closes the list", async () => {
		const editor = mount(() => snippets);
		type(editor, "§rev");
		await screen.findByRole("listbox", { name: "Snippets" });
		fireEvent.keyDown(editor.view.dom, { key: "Escape" });
		expect(screen.queryByRole("listbox", { name: "Snippets" })).toBeNull();
		expect(editor.getText()).toBe("§rev");
	});

	it("says the list is loading, then offers it when the read answers", async () => {
		let list: readonly Snippet[] | null = null;
		const editor = mount(() => list);
		type(editor, "§");
		expect(await screen.findByText("Loading ...")).toBeTruthy();

		list = snippets;
		act(() => {
			editor.view.dispatch(editor.state.tr);
		});
		expect(await screen.findByText("Review")).toBeTruthy();
	});

	it("says when a search matches no snippet", async () => {
		const editor = mount(() => snippets);
		type(editor, "§zzzz");
		expect(await screen.findByText("No snippets found")).toBeTruthy();
	});

	it("says when there are no saved snippets", async () => {
		const editor = mount(() => []);
		type(editor, "§");
		expect(await screen.findByText("No snippets found")).toBeTruthy();
	});

	it("shows a failed read's message", async () => {
		const editor = mount(
			() => null,
			() => "The snippets could not be read.",
		);
		type(editor, "§");
		expect(await screen.findByText("Couldn't load snippets")).toBeTruthy();
		expect(screen.getByText("The snippets could not be read.")).toBeTruthy();
	});

	it("does not open inside a word", async () => {
		const editor = mount(() => snippets);
		act(() => type(editor, "email§rev"));
		expect(screen.queryByRole("listbox", { name: "Snippets" })).toBeNull();
	});

	it("inserts the selected prompt on Tab", async () => {
		const editor = mount(() => snippets);
		type(editor, "§rev");
		await screen.findByRole("listbox", { name: "Snippets" });
		fireEvent.keyDown(editor.view.dom, { key: "Tab" });
		expect(editor.getText()).toBe("Review this change.");
	});

	it("inserts a prompt's line breaks as line breaks, keeping its text", async () => {
		const prompt = "Review this change.\nThen run the tests.\n\nSay what failed.";
		const editor = mount(() => [{ ...(snippets[0] as Snippet), prompt }]);
		type(editor, "§rev");
		await screen.findByRole("listbox", { name: "Snippets" });
		fireEvent.keyDown(editor.view.dom, { key: "Enter" });

		expect(editor.getText()).toBe(prompt);
		const inline = editor.getJSON().content?.[0]?.content ?? [];
		expect(inline.filter((node) => node.type === "hardBreak")).toHaveLength(3);
		expect(inline.some((node) => "text" in node && String(node.text).includes("\n"))).toBe(false);
	});

	it("keeps Enter and Tab while no snippet matches, so the typed text is not sent", async () => {
		const editor = mount(() => snippets);
		type(editor, "§zzzz");
		await screen.findByText("No snippets found");

		const keys = ["Tab", "Enter"].map((key) => fireEvent.keyDown(editor.view.dom, { key }));

		expect(keys).toEqual([false, false]);
		expect(editor.getText()).toBe("§zzzz");
		expect(editor.getJSON().content).toHaveLength(1);
	});
});

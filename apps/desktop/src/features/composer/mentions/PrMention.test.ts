import { appError, err, ok, type Result } from "@conducted/shared";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../../test/dom-polyfills.ts";
import type {
	PrMentionItem,
	PrMentionSearchResult,
} from "../../../core/services/mention-search.ts";
import { composerBaseKit } from "../composer-extensions.ts";
import { createPrMention, type PrMentionDeps } from "./PrMention.ts";

const pullRequest: PrMentionItem = {
	kind: "pull_request",
	provider: "github",
	number: 12,
	identifier: "#12",
	title: "Fix the mention trigger",
	url: "https://github.com/octo/repo/pull/12",
	id: "12",
};

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
};

const editors: Editor[] = [];

const mount = (deps: PrMentionDeps) => {
	const editor = new Editor({
		extensions: [composerBaseKit, createPrMention(deps)],
		content: "",
	});
	editors.push(editor);
	editor.commands.focus();
	return editor;
};

const type = (editor: Editor, text: string) => {
	editor.commands.insertContent(text);
};

const chips = (editor: Editor) => {
	const json = editor.getJSON();
	const nodes: { token?: string; label?: string }[] = [];
	const visit = (node: {
		type?: string;
		attrs?: { token?: string; label?: string };
		content?: unknown[];
	}) => {
		if (node.type === "prMention") {
			nodes.push({ token: node.attrs?.token, label: node.attrs?.label });
		}
		for (const child of (node.content ?? []) as (typeof node)[]) visit(child);
	};
	visit(json);
	return nodes;
};

const depsWith = (overrides: Partial<PrMentionDeps>): PrMentionDeps => ({
	search: async () => ok({ items: [pullRequest] }),
	attach: async () => ok(".context/pull-requests/12.md"),
	onError: () => {},
	...overrides,
});

afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

describe("COMP-05 PrMention", () => {
	it("offers PR 12 for '#12' and inserts a chip with its number, title and token", async () => {
		const search = vi.fn(async () => ok({ items: [pullRequest] }));
		const attach = vi.fn(async () => ok(".context/pull-requests/12.md"));
		const editor = mount(depsWith({ search, attach }));

		type(editor, "#12");

		const row = await screen.findByRole("option", { name: /#12/ });
		expect(row.textContent).toContain("Fix the mention trigger");
		fireEvent.keyDown(editor.view.dom, { key: "Enter" });

		await waitFor(() =>
			expect(chips(editor)).toEqual([{ token: "⟦pr:12⟧", label: "#12 Fix the mention trigger" }]),
		);
		expect(attach).toHaveBeenCalledWith(pullRequest);
		expect(editor.getText()).toContain("⟦pr:12⟧");
	});

	it("keeps the newest search when two answers arrive in the wrong order", async () => {
		const first = deferred<Result<PrMentionSearchResult>>();
		const second = deferred<Result<PrMentionSearchResult>>();
		const search = vi
			.fn<(query: string) => Promise<Result<PrMentionSearchResult>>>()
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		const editor = mount(depsWith({ search }));

		type(editor, "#1");
		await waitFor(() => expect(search).toHaveBeenCalledWith("1"));
		type(editor, "2");
		await waitFor(() => expect(search).toHaveBeenCalledWith("12"));

		const other = { ...pullRequest, number: 1, identifier: "#1", title: "Older answer" };
		second.resolve(ok({ items: [pullRequest] }));
		expect(await screen.findByRole("option", { name: /#12/ })).toBeTruthy();

		first.resolve(ok({ items: [other] }));
		await waitFor(() => expect(screen.queryByRole("option", { name: /Older answer/ })).toBeNull());
		expect(screen.getByRole("option", { name: /#12/ })).toBeTruthy();
	});

	it("does not insert a chip when the context file cannot be written", async () => {
		const onError = vi.fn();
		const attach = vi.fn(async () =>
			err(appError("github_context_unavailable", "The app can't write into this workspace.")),
		);
		const editor = mount(depsWith({ attach, onError }));

		type(editor, "#12");
		await screen.findByRole("option", { name: /#12/ });
		fireEvent.keyDown(editor.view.dom, { key: "Enter" });

		await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
		expect(onError.mock.calls[0]?.[0]).toMatchObject({ code: "github_context_unavailable" });
		expect(chips(editor)).toEqual([]);
	});

	it("keeps Enter and Tab while the search runs or finds nothing, so a half-typed '#12' is not sent", async () => {
		const pending = deferred<Result<PrMentionSearchResult>>();
		const search = vi
			.fn<(query: string) => Promise<Result<PrMentionSearchResult>>>()
			.mockReturnValue(pending.promise);
		const editor = mount(depsWith({ search }));

		type(editor, "#12");
		await waitFor(() => expect(search).toHaveBeenCalledWith("12"));
		const enterWhileLoading = fireEvent.keyDown(editor.view.dom, { key: "Enter" });
		pending.resolve(ok({ items: [] }));
		await screen.findByText("No pull requests or issues found");
		const tabWithNoRows = fireEvent.keyDown(editor.view.dom, { key: "Tab" });
		const enterWithNoRows = fireEvent.keyDown(editor.view.dom, { key: "Enter" });

		expect([enterWhileLoading, tabWithNoRows, enterWithNoRows]).toEqual([false, false, false]);
		expect(editor.getJSON().content).toHaveLength(1);
		expect(editor.getText()).toBe("#12");
	});

	it("does not open inside a word", () => {
		const search = vi.fn(async () => ok({ items: [pullRequest] }));
		const editor = mount(depsWith({ search }));

		type(editor, "issue#12");

		expect(screen.queryByRole("listbox", { name: "Suggestions" })).toBeNull();
		expect(search).not.toHaveBeenCalled();
	});

	it("shows a notice above the rows when a source cannot be searched", async () => {
		const editor = mount(
			depsWith({
				search: async () =>
					ok({ items: [pullRequest], notice: 'Run "gh auth login" to connect GitHub.' }),
			}),
		);

		type(editor, "#12");

		expect(await screen.findByText('Run "gh auth login" to connect GitHub.')).toBeTruthy();
		expect(await screen.findByRole("option", { name: /#12/ })).toBeTruthy();
	});

	it("says when there is no match", async () => {
		const editor = mount(depsWith({ search: async () => ok({ items: [] }) }));

		type(editor, "#zzzz");

		expect(await screen.findByText("No pull requests or issues found")).toBeTruthy();
	});

	it("shows a failed search instead of an empty list", async () => {
		const editor = mount(
			depsWith({
				search: async () => err(appError("github_failed", "GitHub could not be reached.")),
			}),
		);

		type(editor, "#12");

		expect(await screen.findByText("GitHub could not be reached.")).toBeTruthy();
	});

	it("keeps the typed '#' when Escape closes the popup", async () => {
		const editor = mount(depsWith({}));
		type(editor, "#12");
		await screen.findByRole("option", { name: /#12/ });
		fireEvent.keyDown(editor.view.dom, { key: "Escape" });
		expect(screen.queryByRole("listbox", { name: "Suggestions" })).toBeNull();
		expect(editor.getText()).toBe("#12");
	});
});

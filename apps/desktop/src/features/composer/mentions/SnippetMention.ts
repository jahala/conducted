/**
 * @feature COMP-09 Prompt snippets
 * Owns: the snippet trigger in the composer: typing § opens the saved snippets, and choosing one
 * replaces the trigger and its query with that snippet's prompt.
 * Behaviour: ui-map.md 3.5 (a fourth trigger for saved snippets; Add snippet and Insert snippet),
 * 5.1 (Search snippets...).
 * Our design choice: § is the trigger the research inferred. The trigger inserts plain prompt text
 * rather than a chip, because the agent receives plain text. The list is read through getters so a
 * snippet list that arrives after the trigger opened can redraw without rebuilding the editor.
 * Must handle: the list still loading; a failed read; no snippets; no match; Escape keeping the
 * typed trigger; a trigger inside a word not opening; Enter and Tab choosing, and doing nothing
 * while no row matches; a prompt's line breaks (hard breaks) and angle brackets (plain text).
 * Test first: typing "§rev" offers the snippet named Review and Enter inserts its prompt.
 */
import { Fragment } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Extension } from "@tiptap/react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Snippet } from "../../../core/model.ts";
import { filterSnippets } from "../snippet-model.ts";
import { inlineTextContent } from "../text-content.ts";
import { SuggestionPopup, type SuggestionRow } from "./SuggestionPopup.tsx";
import type { TriggerMenuSpec } from "./trigger-menu.ts";

export const SNIPPET_TRIGGER = "§";
export const SNIPPET_MENTION_LIMIT = 20;
const TRIGGER = /(?:^|[\s([{])§([^\s§]*)$/u;

export interface SnippetMentionDeps {
	/** The saved snippets, or null before the first read answers. */
	snippets: () => readonly Snippet[] | null;
	/** The failed read's message, when there is one. */
	error: () => string | null;
	/** Called each time the trigger opens, so the caller can read the list again. */
	onOpen?: () => void;
}

export interface SnippetSuggestion {
	id: string;
	label: string;
	detail?: string;
	prompt: string;
}

type SnippetListState = "loading" | "ready" | "error";

export interface SnippetMentionState {
	active: boolean;
	query: string;
	/** Document position of the typed §. */
	from: number;
	/** Document position just after the query. */
	to: number;
	selectedIndex: number;
	items: readonly SnippetSuggestion[];
	status: SnippetListState;
	message: string | null;
}

export const snippetMentionKey = new PluginKey<SnippetMentionState>("conductedSnippetMention");

const inactive: SnippetMentionState = {
	active: false,
	query: "",
	from: 0,
	to: 0,
	selectedIndex: 0,
	items: [],
	status: "ready",
	message: null,
};

/** The snippets matching a typed prefix, best match first. */
export function snippetSuggestions(
	query: string,
	snippets: readonly Snippet[],
): SnippetSuggestion[] {
	return filterSnippets(snippets, query)
		.slice(0, SNIPPET_MENTION_LIMIT)
		.map((snippet) => ({
			id: snippet.id,
			label: snippet.name,
			detail: snippet.keyword ?? undefined,
			prompt: snippet.prompt,
		}));
}

function stateAtEditor(state: EditorState, deps: SnippetMentionDeps): SnippetMentionState {
	if (!state.selection.empty) return inactive;
	const { $from } = state.selection;
	const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc");
	const match = TRIGGER.exec(before);
	if (match === null) return inactive;
	const snippets = deps.snippets();
	const error = deps.error();
	const status: SnippetListState =
		snippets === null ? (error === null ? "loading" : "error") : "ready";
	const query = match[1] ?? "";
	return {
		active: true,
		query,
		from: $from.pos - (query.length + SNIPPET_TRIGGER.length),
		to: $from.pos,
		selectedIndex: 0,
		items: snippets === null ? [] : snippetSuggestions(query, snippets),
		status,
		message: status === "error" ? error : null,
	};
}

function chooseSuggestion(view: EditorView, state: SnippetMentionState, index: number): boolean {
	const item = state.items[index];
	if (item === undefined) return false;
	const { schema } = view.state;
	const prompt = Fragment.from(
		inlineTextContent(item.prompt).map((node) => schema.nodeFromJSON(node)),
	);
	const transaction = view.state.tr.replaceWith(state.from, state.to, prompt);
	const end = Math.min(state.from + prompt.size, transaction.doc.content.size);
	transaction.setSelection(TextSelection.near(transaction.doc.resolve(end)));
	view.dispatch(transaction.scrollIntoView());
	return true;
}

interface SnippetMeta {
	type: "select" | "close";
	index?: number;
}

class SnippetPopupView {
	#view: EditorView;
	#deps: SnippetMentionDeps;
	#host: HTMLDivElement | null = null;
	#root: Root | null = null;
	#signature = "";
	#open = false;

	constructor(view: EditorView, deps: SnippetMentionDeps) {
		this.#view = view;
		this.#deps = deps;
		this.update(view);
	}

	update(view: EditorView): void {
		this.#view = view;
		const state = snippetMentionKey.getState(view.state);
		if (state === undefined || !state.active) {
			this.#open = false;
			this.#close();
			return;
		}
		if (!this.#open) {
			this.#open = true;
			this.#deps.onOpen?.();
		}
		const signature = `${state.query}|${state.selectedIndex}|${state.status}|${state.items
			.map((item) => item.id)
			.join(",")}`;
		if (signature === this.#signature) return;
		this.#signature = signature;
		if (this.#host === null) {
			this.#host = document.createElement("div");
			document.body.appendChild(this.#host);
			this.#root = createRoot(this.#host);
		}
		const coords = view.coordsAtPos(state.to);
		const rows: SuggestionRow[] = state.items.map((item) => ({
			id: item.id,
			label: item.label,
			detail: item.detail,
		}));
		this.#root?.render(
			createElement(SuggestionPopup, {
				rows,
				selectedIndex: state.selectedIndex,
				state: state.status,
				label: "Snippets",
				emptyText: state.status === "error" ? "Couldn't load snippets" : "No snippets found",
				notice: state.message ?? undefined,
				anchor: { left: coords.left, top: coords.top, bottom: coords.bottom },
				onPick: (row) => {
					const index = state.items.findIndex((item) => item.id === row.id);
					if (index >= 0) chooseSuggestion(this.#view, state, index);
				},
			}),
		);
	}

	destroy(): void {
		this.#close();
	}

	#close(): void {
		this.#signature = "";
		const root = this.#root;
		const host = this.#host;
		this.#root = null;
		this.#host = null;
		if (root !== null) root.unmount();
		host?.remove();
	}
}

function createSnippetPlugin(deps: SnippetMentionDeps): Plugin<SnippetMentionState> {
	const spec: TriggerMenuSpec = {
		triggerMenuOpen: (state) => snippetMentionKey.getState(state)?.active === true,
	};
	return new Plugin<SnippetMentionState>({
		...spec,
		key: snippetMentionKey,
		state: {
			init: (_config, state) => stateAtEditor(state, deps),
			apply(transaction: Transaction, previous: SnippetMentionState, _old, next: EditorState) {
				const meta = transaction.getMeta(snippetMentionKey) as SnippetMeta | undefined;
				if (meta?.type === "close") return inactive;
				if (meta?.type === "select") {
					const count = previous.items.length;
					return {
						...previous,
						selectedIndex: count === 0 ? 0 : ((meta.index ?? 0) + count) % count,
					};
				}
				const nextState = stateAtEditor(next, deps);
				if (!nextState.active) return inactive;
				return {
					...nextState,
					selectedIndex:
						previous.active && previous.query === nextState.query
							? Math.min(previous.selectedIndex, Math.max(0, nextState.items.length - 1))
							: 0,
				};
			},
		},
		props: {
			handleKeyDown(view, event) {
				const state = snippetMentionKey.getState(view.state);
				if (state === undefined || !state.active) return false;
				const count = state.items.length;
				if (event.key === "Escape") {
					view.dispatch(view.state.tr.setMeta(snippetMentionKey, { type: "close" }));
					return true;
				}
				if (event.key === "ArrowDown" && count > 0) {
					view.dispatch(
						view.state.tr.setMeta(snippetMentionKey, {
							type: "select",
							index: (state.selectedIndex + 1) % count,
						}),
					);
					return true;
				}
				if (event.key === "ArrowUp" && count > 0) {
					view.dispatch(
						view.state.tr.setMeta(snippetMentionKey, {
							type: "select",
							index: (state.selectedIndex - 1 + count) % count,
						}),
					);
					return true;
				}
				if (event.key === "Enter" || event.key === "Tab") {
					// With no matching snippet the key does nothing, so Enter never sends "§zzzz".
					chooseSuggestion(view, state, state.selectedIndex);
					return true;
				}
				return false;
			},
		},
		view: (view) => new SnippetPopupView(view, deps),
	});
}

export function createSnippetMention(props: SnippetMentionDeps): Extension {
	return Extension.create<SnippetMentionDeps>({
		name: "snippetMention",
		addOptions() {
			return props;
		},
		addProseMirrorPlugins() {
			return [createSnippetPlugin(this.options)];
		},
	});
}
